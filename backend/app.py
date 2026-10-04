"""
Rekodi — voice-first clinical documentation & follow-up companion (HEALTH track).
FastAPI backend. All AI runs on-device/offline.

Endpoints:
  POST /transcribe   audio file -> {text, segments, language}
  POST /extract      {text} -> strict JSON record draft + per-field confidence
  GET  /records      list saved (worker-confirmed) records in the on-device outbox
  POST /records      save a worker-confirmed record (human-in-the-loop gate)
  POST /sync         build a DHIS2-compatible payload PREVIEW from pending records
  GET  /followups    due / overdue follow-ups derived from records
  POST /sms-draft    deterministic Swahili SMS reminder draft from a record
  POST /reply-classify  keyword-based intent classification of a patient SMS reply
"""
import json
import os
import re
import tempfile
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent / "models"
DATA_DIR = BASE.parent / "data"
OUTBOX = DATA_DIR / "outbox.json"

# Environment quirk shim (documented in tech_stack.md): the installed PyAV
# (av 19.0.1) build does not accept the `metadata_errors` kwarg that
# faster-whisper 1.2.1 passes to av.open(). Dropping it is harmless for our
# use (it only suppresses warnings on malformed stream metadata).
try:
    import av as _av

    _orig_av_open = _av.open

    def _av_open(*a, **k):
        k.pop("metadata_errors", None)
        return _orig_av_open(*a, **k)

    _av.open = _av_open
except ImportError:
    pass

WHISPER_MODEL = "tiny"
QWEN_GGUF = MODELS / "qwen2.5-0.5b-instruct-q4_k_m.gguf"

app = FastAPI(title="Rekodi API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_whisper = None
_llm = None
_llm_failed = False


# ---------------------------------------------------------------- storage
def _load_outbox():
    if OUTBOX.exists():
        return json.loads(OUTBOX.read_text())
    return []


def _save_outbox(records):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTBOX.write_text(json.dumps(records, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- whisper
def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        # local_files_only: the model ships in the side-loaded cache — the
        # transcribe step must never need the network (offline-first claim).
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8",
                                local_files_only=True)
    return _whisper


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Audio -> Swahili text. Works fully offline after the tiny model is cached."""
    suffix = Path(file.filename or "audio").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        model = get_whisper()
        segments, info = model.transcribe(tmp_path, language="sw", beam_size=5)
        segs = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
        text = " ".join(s["text"] for s in segs).strip()
        return {
            "text": text,
            "segments": segs,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "model": f"faster-whisper/{WHISPER_MODEL}-int8",
        }
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------- extraction
EXTRACT_SYSTEM = (
    "You are Rekodi, a clinical documentation assistant. Extract ONLY what the "
    "health worker said. NEVER suggest a diagnosis, condition, or treatment. "
    "Copy treatment wording EXACTLY as stated, word for word. "
    "RULES: referral_needed is true ONLY if the worker explicitly mentions a "
    "referral or sending the patient to another/higher facility — otherwise false. "
    "If the worker says 'after N days' or 'in N days', put that exact phrase in "
    "followup_relative and ALSO compute followup_date from today. "
    "Use null and \"low\" confidence when the worker did not clearly state a field. "
    "Output STRICT JSON only, no other text.\n"
    'Schema: {"patient_name": string|null, "age": string|null, '
    '"visit_date": "YYYY-MM-DD"|null, "summary": string|null, '
    '"treatment_given": string|null, "followup_relative": string|null, '
    '"followup_date": "YYYY-MM-DD"|null, "referral_needed": true|false, '
    '"field_confidence": {"patient_name":"high|medium|low", ... same keys}}.\n'
    "Today's date is {today}."
)

FEWSHOT_USER = (
    "Mgonjwa anaitwa Neema Peter, ana miaka 45. Amekuja na maumivu ya kichwa "
    "siku mbili. Nimempa panadol kama alivyoelekezwa na daktari. Arudi baada ya "
    "siku tatu. Hajahitaji rufaa."
)
FEWSHOT_ASST = json.dumps({
    "patient_name": "Neema Peter", "age": "45", "visit_date": "{today}",
    "summary": "Maumivu ya kichwa kwa siku mbili.",
    "treatment_given": "panadol kama alivyoelekezwa na daktari",
    "followup_relative": "baada ya siku tatu",
    "followup_date": "{plus3}", "referral_needed": False,
    "field_confidence": {
        "patient_name": "high", "age": "high", "visit_date": "medium",
        "summary": "high", "treatment_given": "high",
        "followup_relative": "high", "followup_date": "medium",
        "referral_needed": "high",
    },
}, ensure_ascii=False)

# Deterministic guardrails: the 0.5B model is unreliable at date arithmetic and
# occasionally over-flags referrals, so these two fields are re-derived from the
# source text with auditable rules. Documented in tech_stack.md.
NUMBER_WORDS = {
    # English
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "fourteen": 14, "thirty": 30,
    # Swahili
    "moja": 1, "mbili": 2, "tatu": 3, "nne": 4, "tano": 5, "sita": 6,
    "saba": 7, "nane": 8, "tisa": 9, "kumi": 10,
}
_WORDS_ALT = "|".join(sorted(NUMBER_WORDS, key=len, reverse=True))
_FOLLOWUP_PATTERNS = [
    (re.compile(r"(?:after|in)\s+(\d+)\s+days?", re.IGNORECASE), "digit"),
    (re.compile(r"(?:after|in)\s+(" + _WORDS_ALT + r")\s+days?", re.IGNORECASE), "word"),
    (re.compile(r"baada ya siku\s+(\d+)", re.IGNORECASE), "digit"),
    (re.compile(r"baada ya siku\s+(" + _WORDS_ALT + r")", re.IGNORECASE), "word"),
    (re.compile(r"wiki\s+ijayo|juma\s+lijalo|next week", re.IGNORECASE), "const7"),
    (re.compile(r"kesho|tomorrow", re.IGNORECASE), "const1"),
]
_REFERRAL_WORDS = ["rufaa", "referral", "referred", "hospitali kubwa",
                   "big hospital", "district hospital", "muelekeze"]

SW_MONTHS = ["Januari", "Februari", "Machi", "Aprili", "Mei", "Juni", "Julai",
             "Agosti", "Septemba", "Oktoba", "Novemba", "Desemba"]


def sw_date(iso: str) -> str:
    """2026-10-10 -> '10 Oktoba 2026' for patient-facing SMS."""
    try:
        d = date.fromisoformat(iso)
        return f"{d.day} {SW_MONTHS[d.month - 1]} {d.year}"
    except Exception:
        return iso


def _postprocess(text: str, data: dict) -> dict:
    """Deterministic corrections on top of the model output."""
    for pat, kind in _FOLLOWUP_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        if kind == "digit":
            n = int(m.group(1))
        elif kind == "word":
            n = NUMBER_WORDS[m.group(1).lower()]
        elif kind == "const7":
            n = 7
        else:
            n = 1
        data["followup_date"] = (date.today() + timedelta(days=n)).isoformat()
        data["followup_relative"] = m.group(0)
        data.setdefault("field_confidence", {})["followup_date"] = "high"
        break
    # referral: only true if the worker actually said it
    t = text.lower()
    if not any(w in t for w in _REFERRAL_WORDS):
        if data.get("referral_needed"):
            data["referral_needed"] = False
            data.setdefault("field_confidence", {})["referral_needed"] = "high"
    return data


def get_llm():
    """Lazy-load Qwen2.5-0.5B-Instruct Q4_K_M via llama.cpp. Raises on failure."""
    global _llm, _llm_failed
    if _llm_failed:
        raise RuntimeError("LLM previously failed to load")
    if _llm is None:
        if not QWEN_GGUF.exists():
            _llm_failed = True
            raise RuntimeError(f"model file missing: {QWEN_GGUF}")
        from llama_cpp import Llama
        _llm = Llama(model_path=str(QWEN_GGUF), n_ctx=2048, n_threads=4,
                     verbose=False)
    return _llm


def heuristic_extract(text: str) -> dict:
    """Transparent documented fallback: regex/keyword extraction, all low confidence.
    Marked 'v1 heuristic; production = fine-tuned small LM'."""
    t = text.strip()
    today = date.today().isoformat()

    name = None
    m = re.search(r"(?:anaitwa|jina(?: lake)?(?: ni)?)\s+([A-ZÀ-ÿ][\w'\-]*(?:\s+[A-ZÀ-ÿ][\w'\-]*)?)", t)
    if m:
        name = m.group(1).strip()

    age = None
    m = re.search(r"(?:miaka|umri(?: wa)?)\s+(\d{1,3})", t, re.IGNORECASE)
    if m:
        age = m.group(1)

    followup = None
    m = re.search(r"(?:baada ya|rudi(?:ni)?)\s+(?:baada ya\s+)?siku\s+(\d+)", t, re.IGNORECASE)
    if m:
        followup = (date.today() + timedelta(days=int(m.group(1)))).isoformat()
    elif re.search(r"wiki\s+ijayo|juma\s+lijalo", t, re.IGNORECASE):
        followup = (date.today() + timedelta(days=7)).isoformat()

    referral = bool(re.search(r"rufaa|referral|hospitali\s+kubwa|muelekeze", t, re.IGNORECASE))

    treat = None
    m = re.search(r"(?:nimempa|amepewa|dawa(?: ya)?)\s+([^.。;]+)", t, re.IGNORECASE)
    if m:
        treat = m.group(0).strip()

    conf = {k: ("medium" if v not in (None, False) else "low")
            for k, v in {"patient_name": name, "age": age, "visit_date": today,
                         "summary": t[:280] or None, "treatment_given": treat,
                         "followup_date": followup, "referral_needed": referral}.items()}
    return {
        "patient_name": name, "age": age, "visit_date": today,
        "summary": t[:280] or None, "treatment_given": treat,
        "followup_date": followup, "referral_needed": referral,
        "field_confidence": conf,
        "extractor": "heuristic_v1",
        "note": "v1 heuristic; production = fine-tuned small LM",
    }


def llm_extract(text: str) -> dict:
    llm = get_llm()
    today = date.today().isoformat()
    plus3 = (date.today() + timedelta(days=3)).isoformat()
    # NOTE: plain .replace(), not .format() — the few-shot JSON contains literal
    # braces that .format() would try to interpolate (KeyError).
    system = EXTRACT_SYSTEM.replace("{today}", today)
    fewshot = FEWSHOT_ASST.replace("{today}", today).replace("{plus3}", plus3)
    out = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": FEWSHOT_USER},
            {"role": "assistant", "content": fewshot},
            {"role": "user", "content": text},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=512,
    )
    raw = out["choices"][0]["message"]["content"]
    data = json.loads(raw)
    # normalize + validate
    keys = ["patient_name", "age", "visit_date", "summary", "treatment_given",
            "followup_relative", "followup_date", "referral_needed"]
    norm = {k: data.get(k) for k in keys}
    norm["referral_needed"] = bool(norm["referral_needed"])
    fc = data.get("field_confidence") or {}
    norm["field_confidence"] = {
        k: (fc.get(k) if fc.get(k) in ("high", "medium", "low") else "low")
        for k in keys
    }
    norm = _postprocess(text, norm)  # deterministic guardrails
    norm["extractor"] = "qwen2.5-0.5b-instruct-q4_k_m"
    return norm


class ExtractIn(BaseModel):
    text: str


@app.post("/extract")
def extract(inp: ExtractIn):
    """Text -> strict JSON record draft. Never diagnoses; low-confidence fields
    are flagged 'not sure - please check' in the UI."""
    text = inp.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    try:
        data = llm_extract(text)
    except Exception as e:  # transparent fallback, never silent
        data = heuristic_extract(text)
        data["llm_error"] = str(e)[:200]
    data["source_text"] = text
    return data


# ---------------------------------------------------------------- records
class RecordIn(BaseModel):
    patient_name: str | None = None
    age: str | None = None
    visit_date: str | None = None
    summary: str | None = None
    treatment_given: str | None = None
    followup_date: str | None = None
    referral_needed: bool = False
    transcript: str | None = None
    extractor: str | None = None
    field_confidence: dict = {}


@app.get("/records")
def list_records():
    return {"records": _load_outbox()}


@app.post("/records")
def save_record(rec: RecordIn):
    """Human-in-the-loop gate: only worker-confirmed records are saved.
    The UI never auto-saves an AI draft."""
    records = _load_outbox()
    item = rec.model_dump()
    item["id"] = uuid.uuid4().hex[:8]
    item["created_at"] = datetime.now().isoformat(timespec="seconds")
    item["confirmed_by_worker"] = True
    item["sync_status"] = "pending"
    records.append(item)
    _save_outbox(records)
    return {"ok": True, "id": item["id"]}


# ---------------------------------------------------------------- DHIS2 sync preview
@app.post("/sync")
def sync_preview():
    """Build a DHIS2-compatible payload PREVIEW (store-and-forward).
    No live server needed for the demo; mapping documented in tech_stack.md."""
    records = [r for r in _load_outbox() if r.get("sync_status") == "pending"]
    events = []
    for r in records:
        events.append({
            "program": "REKODI_PRIMARY_CARE",
            "programStage": "REKODI_VISIT",
            "orgUnit": "CLINIC_ID_PLACEHOLDER",
            "eventDate": r.get("visit_date") or date.today().isoformat(),
            "status": "COMPLETED",
            "dataValues": [
                {"dataElement": "REKODI_PATIENT_NAME",
                 "value": r.get("patient_name")},
                {"dataElement": "REKODI_AGE", "value": r.get("age")},
                {"dataElement": "REKODI_SUMMARY", "value": r.get("summary")},
                {"dataElement": "REKODI_TREATMENT_GIVEN",
                 "value": r.get("treatment_given")},
                {"dataElement": "REKODI_FOLLOWUP_DATE",
                 "value": r.get("followup_date")},
                {"dataElement": "REKODI_REFERRAL_NEEDED",
                 "value": "true" if r.get("referral_needed") else "false"},
                {"dataElement": "REKODI_TRANSCRIPT", "value": r.get("transcript")},
            ],
            "notes": [{
                "storedBy": "rekodi",
                "value": "Worker-confirmed record. AI draft reviewed by "
                         "health worker before save. No diagnosis suggested.",
            }],
        })
    return {
        "preview": True,
        "target": "DHIS2 /api/events (ministry system, 70+ countries)",
        "record_count": len(records),
        "events": events,
    }


# ---------------------------------------------------------------- follow-ups
def _followup_status(fdate: str) -> str:
    try:
        d = date.fromisoformat(fdate)
    except Exception:
        return "unknown"
    today = date.today()
    if d < today:
        return "overdue"
    if d <= today + timedelta(days=2):
        return "due"
    return "upcoming"


@app.get("/followups")
def followups():
    items = []
    for r in _load_outbox():
        fd = r.get("followup_date")
        if not fd:
            continue
        items.append({
            "record_id": r["id"],
            "patient_name": r.get("patient_name"),
            "followup_date": fd,
            "status": _followup_status(fd),
            "referral_needed": bool(r.get("referral_needed")),
        })
    order = {"overdue": 0, "due": 1, "upcoming": 2, "unknown": 3}
    items.sort(key=lambda x: (order.get(x["status"], 3), x["followup_date"]))
    return {"followups": items}


# ---------------------------------------------------------------- SMS drafts (deterministic templates, no LLM)
class SmsIn(BaseModel):
    patient_name: str | None = None
    followup_date: str | None = None
    overdue: bool = False
    clinic_name: str = "kliniki"


SMS_TEMPLATES = {
    "reminder": ("Habari {name}, hii ni ukumbusho kutoka {clinic}: tafadhali "
                 "rudi kwa miadi yako tarehe {date}. Kama huwezi kuja, jibu "
                 "ujumbe huu. Asante."),
    "overdue": ("Habari {name}, miadi yako ya tarehe {date} imepita. Tafadhali "
                "rudi {clinic} haraka iwezekanavyo. Kama unahitaji msaada, "
                "jibu ujumbe huu. Asante."),
}


@app.post("/sms-draft")
def sms_draft(inp: SmsIn):
    kind = "overdue" if inp.overdue else "reminder"
    text = SMS_TEMPLATES[kind].format(
        name=inp.patient_name or "mgonjwa",
        date=sw_date(inp.followup_date) if inp.followup_date else "tarehe iliyopangwa",
        clinic=inp.clinic_name,
    )
    return {"kind": kind, "text": text, "chars": len(text)}


class ReplyIn(BaseModel):
    text: str


CAME_WORDS = ["nimefika", "nimekuja", "nipo", "nimehudhuria", "asante nimekuja"]
CANT_WORDS = ["siwezi", "sitaweza", "nashindwa", "sita", "ngumu"]
HELP_WORDS = ["msaada", "dharura", "shida", "hatari", "maumivu makali"]


@app.post("/reply-classify")
def reply_classify(inp: ReplyIn):
    """Deterministic keyword intent classification of a patient SMS reply.
    No LLM: auditable, offline, no hallucination risk."""
    t = inp.text.lower()
    if any(w in t for w in HELP_WORDS):
        intent, action = "needs_help", "escalate to nurse — call the patient"
    elif any(w in t for w in CANT_WORDS):
        intent, action = "cant_come", "reschedule follow-up to a new date"
    elif any(w in t for w in CAME_WORDS):
        intent, action = "came", "mark follow-up complete"
    else:
        intent, action = "unclear", "not sure — ask a person to read the reply"
    return {"intent": intent, "suggested_action": action}


@app.get("/health")
def health():
    return {
        "ok": True,
        "whisper_model": f"faster-whisper/{WHISPER_MODEL}-int8",
        "llm_model": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "llm_file_present": QWEN_GGUF.exists(),
        "outbox_records": len(_load_outbox()),
    }


# Serve the phone UI from the same origin (one-command demo)
WEB_DIR = BASE.parent / "web"
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
