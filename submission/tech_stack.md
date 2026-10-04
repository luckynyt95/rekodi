# Tech stack — Rekodi

## Models (all small, all offline)
| Model | Size | Quantization | Role |
|---|---|---|---|
| faster-whisper `tiny` | ~39 MB | int8 (CTranslate2) | Swahili speech → text, on-device CPU |
| Qwen2.5-0.5B-Instruct | ~101 MB (`qwen2.5-0.5b-instruct-q4_k_m.gguf`) | Q4_K_M via llama.cpp | text → strict JSON record + confidence |

Total AI footprint: **~140 MB** — side-loadable over a weak link in one 3G-bundle
download, or pre-installed on the clinic phone. No server, no API keys, no per-use
cost. After install, the core loop (record → transcribe → draft → confirm) works
with **zero connectivity**.

## Backend
- **FastAPI** (`backend/app.py`) + **uvicorn**. Endpoints: `/transcribe`,
  `/extract`, `/records` (GET/POST), `/sync`, `/followups`, `/sms-draft`,
  `/reply-classify`, `/health`.
- Storage: on-device JSON outbox (`data/outbox.json`) — plain, inspectable,
  trivially wipable if the phone is lost or shared.
- SMS drafting and reply classification are **deterministic** (templates + keyword
  rules) — deliberately not LLM, so they're auditable and can't hallucinate.

## Frontend
- `web/index.html` + `app.js` + `style.css`: phone-shaped single-page app,
  bilingual English/Swahili labels, works against the local backend.
- Audio capture via MediaRecorder (or file upload fallback for the demo).

## DHIS2 fit (ministry system, 70+ countries)
`POST /sync` builds a DHIS2-compatible **payload preview** (no live server needed
for the demo). Mapping:
- `REKODI_PRIMARY_CARE` program → `REKODI_VISIT` program stage event
- patient name / age / summary / treatment_given / followup_date / referral_needed
  → `dataElement`s `REKODI_PATIENT_NAME`, `REKODI_AGE`, `REKODI_SUMMARY`,
  `REKODI_TREATMENT_GIVEN`, `REKODI_FOLLOWUP_DATE`, `REKODI_REFERRAL_NEEDED`
- worker-confirmation note attached to every event ("AI draft reviewed by health
  worker before save. No diagnosis suggested.")
- Store-and-forward: records queue in the outbox; one batch POST to `/api/events`
  when connectivity returns.

## Offline story
Install once (models side-loaded) → everything runs on the nurse's existing phone.
Transcription and extraction are CPU-only. Sync is the only online step, and it's
deferrable indefinitely.

## Honest engineering notes (prototype)
- **Deterministic post-processing guardrails.** The 0.5B model is weak at date
  arithmetic and occasionally over-flags referrals, so two fields are re-derived
  from the source text with auditable regex rules (`_postprocess` in `app.py`):
  follow-up dates are recomputed from explicit relative expressions ("after N
  days" / "after seven days" / "baada ya siku N" / "wiki ijayo"… — digits and
  English/Swahili number words), and `referral_needed` is forced false
  unless the worker actually said a referral word. The LLM does what it's good at
  (names, verbatim treatment wording, summaries); rules do what they're good at.
- **PyAV quirk shim.** The installed `av` 19.0.1 build rejects the
  `metadata_errors` kwarg that faster-whisper 1.2.1 passes to `av.open()`; `app.py`
  drops that kwarg in a 5-line shim (warning-suppression only, no behavior change).
- **Faster-whisper model download** needs the sandbox egress proxy env
  (`https_proxy`); `no_proxy`/`NO_PROXY` must be unset because their bracketed
  IPv6 entries break httpx URL parsing. Irrelevant on the nurse's phone (models
  are side-loaded once).
