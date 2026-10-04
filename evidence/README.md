# Evidence — verified end-to-end run (2026-10-04, ~04:10 IST)

All files below are REAL outputs from the running prototype
(`uvicorn backend.app:app`), not mockups.

| File | What it proves |
|---|---|
| `transcript.txt` | faster-whisper tiny int8 transcribed the demo nurse voice note (English TTS; Swahili TTS backend was down — see `demo_assets/TTS_SWAHILI_STATUS.txt`) |
| `extraction.json` | Qwen2.5-0.5B-Instruct Q4_K_M via llama.cpp produced strict JSON: name, age, visit date, summary, verbatim treatment, follow-up date, referral flag + per-field confidence. No fallback used (`extractor: qwen2.5-0.5b-instruct-q4_k_m`, `llm_error: null`) |
| `record.json` | Worker-confirmed record saved to the on-device outbox (human-in-the-loop gate) |
| `followups.json` | Follow-up engine: 1 overdue + 1 due + 2 upcoming, correctly statused |
| `sms.txt` | Deterministic Swahili SMS reminder draft ("10 Oktoba 2026") |
| `sync_payload.json` | DHIS2-compatible payload preview (4 events, `REKODI_*` dataElements) |

Chain exercised: `POST /transcribe` → `POST /extract` → `POST /records` →
`GET /followups` → `POST /sms-draft` → `POST /sync` → `POST /reply-classify`
(3 reply intents: came / can't come / needs help — all correct).

Known honest limits: demo audio is English (Swahili TTS unavailable at build
time); the 0.5B model needs the deterministic date/referral guardrails in
`app.py`; see `submission/data.md` for the full "what our data does NOT cover".
