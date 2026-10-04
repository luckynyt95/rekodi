# Rekodi — voice-first clinical documentation & follow-up companion

World Bank Youth Summit "Small AI for Development" hackathon entry — **HEALTH track**.

The nurse taps "New visit", speaks ~60 s in **Swahili**, reviews an AI-drafted
record (fixing anything flagged "not sure"), confirms — the record is saved, the
follow-up scheduled, an SMS reminder drafted. All **offline**, on her own phone.
**Never diagnoses. Never suggests treatment.** Human confirms everything.

## Quick start (demo)

```bash
cd ~/workspace/small-ai-health

# 1. environment (one-time)
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2. models (one-time) — models/ ships empty because GitHub rejects files >100MB:
bash download_models.sh   # Qwen2.5-0.5B GGUF (~490MB) from Hugging Face
# faster-whisper tiny (~39MB) auto-downloads on first transcribe

# 2. seed demo records (one overdue follow-up included)
.venv/bin/python demo_assets/seed_records.py

# 3. run the API + UI (single command)
.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
# -> open http://127.0.0.1:8000  (phone UI served by the backend; API on same origin)
```

## API smoke test

```bash
curl -s localhost:8000/health
curl -s -X POST localhost:8000/extract -H 'Content-Type: application/json' \
  -d '{"text":"Mgonjwa anaitwa Neema Peter, ana miaka 45. Amekuja na maumivu ya kichwa siku mbili."}'
curl -s localhost:8000/followups
```

## Layout
- `backend/` — FastAPI app (`app.py`), `requirements.txt`
- `web/` — phone UI (`index.html`, `app.js`, `style.css`)
- `models/` — holds `qwen2.5-0.5b-instruct-q4_k_m.gguf` after `bash download_models.sh`
  (+ whisper tiny auto-cached on first transcribe). Ships empty: the GGUF is
  ~490MB and GitHub rejects files over 100MB.
- `demo_assets/` — Swahili voice-note script, TTS audio, `seed_records.py`
- `evidence/` — real outputs from the verified end-to-end run
- `submission/` — problem statement, AI capabilities, tech stack, data,
  localizing-AI draft, demo video script
- `data/` — on-device outbox (`outbox.json`)

## Submission docs
See `submission/`: `problem_statement.md`, `ai_capabilities.md`, `tech_stack.md`,
`data.md`, `localizing_ai.md`, `demo_script.md`.

## Connecting to a ministry DHIS2 (pilot / integration guide)

Today `POST /sync` builds a **DHIS2-compatible preview** (`evidence/sync_payload.json`):
real DHIS2 `/api/events` shape, but with placeholder IDs
(`CLINIC_ID_PLACEHOLDER`, `REKODI_AGE`, …). To go live with a ministry:

1. **Ministry provides** (one-time setup per deployment):
   - DHIS2 base URL (e.g. `https://dhis.moh.go.ke`)
   - A service-account username/password with `dataValue` write access
   - The facility's `orgUnit` UID
   - The target `program` + `programStage` UIDs, and the UID mapping for each
     field below (their HMIS form's data elements).
2. **Field mapping** — replace the `REKODI_*` placeholders in `backend/app.py`
   (`sync_preview()`) with the ministry's data element UIDs:

   | Rekodi field        | Example value              |
   |---------------------|----------------------------|
   | patient_name        | Amina Juma                 |
   | age                 | 32                         |
   | summary             | Homa na kikohozi siku 3    |
   | treatment_given     | (as documented by worker)  |
   | followup_date       | 2026-09-30                 |
   | referral_needed     | true/false                 |
   | transcript          | full Swahili transcript    |

3. **Sync flow (store-and-forward):** worker-confirmed records queue in the
   on-device outbox (`sync_status: "pending"`) → when connectivity returns, the
   app POSTs the payload to `<DHIS2>/api/events` → on HTTP 200 the record is
   marked `"synced"` (never re-sent). Nothing syncs without the worker's
   explicit confirmation, and the phone always keeps its local copy.
4. **Security:** all AI runs on-device; only the confirmed structured record
   leaves the phone, over TLS, to the ministry's own server. No third-party
   cloud is involved at any step.
