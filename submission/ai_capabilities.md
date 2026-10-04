# AI capabilities — Rekodi

## What the AI does (4 capabilities)
1. **Offline Swahili speech-to-text.** faster-whisper `tiny` int8 (~39 MB) transcribes
   the nurse's ~60s voice note on-device, no connectivity needed.
2. **Speech → structured record.** Qwen2.5-0.5B-Instruct (Q4_K_M via llama.cpp,
   ~101 MB GGUF) extracts a strict JSON record: patient name, age, visit date,
   summary, treatment given (verbatim as stated), follow-up date, referral flag —
   plus a per-field confidence score. A transparent regex fallback
   (`heuristic_v1`, clearly labeled) covers model failure; it never fails silently.
3. **Swahili SMS drafting + reply intent classification.** Reminder drafts come from
   deterministic templates (no LLM — auditable, no hallucination risk); patient
   replies are classified by a keyword intent model (came / can't come / needs help /
   unclear) that suggests reschedule or escalation.
4. **Follow-up engine.** Follow-up dates become tasks; due/overdue lists and SMS
   drafts keep continuity of care alive between visits.

## Why simpler tools fail
- **SMS alone can't do this.** SMS can't transcribe free-form voice in a local
  language, can't structure it into records, can't draft reminders or classify
  replies. (Precedents Mwana in Zambia/Malawi and mTrac in Uganda prove SMS moves
  health data — Rekodi goes beyond what SMS can do.)
- **A spreadsheet can't listen.** Forms demand typing the nurse doesn't have time
  for, in a language the form may not support.
- **A human scribe doesn't scale** — the WHO 10M-worker shortfall is the point.

## Guardrails (PASS/FAIL responsible-AI surface)
- **Never diagnoses.** The extractor prompt forbids suggesting conditions or
  treatments; treatment wording is copied verbatim from the worker. The UI states
  "does not diagnose" on the review screen and guardrails panel.
- **Human-in-the-loop.** Nothing saves without the worker's explicit confirm. The
  review screen shows the transcript next to every field.
- **"Not sure — ask a person."** Every field carries a confidence badge
  (high ✅ / medium ⚠️ / low ❓ "sina uhakika — tafadhali angalia"). Low-confidence
  fields are visually flagged red for the worker to fix.
- **Hallucination containment.** Strict JSON schema via grammar-constrained decoding;
  nulls preferred over guesses; heuristic fallback is labeled, never disguised as
  the model.
- **Data honesty.** Where data sits (on the phone, `outbox.json`), who reads it
  (nurse + clinic supervisors), and the lost/shared-phone plan (plain-JSON records;
  wipe the app or reset the phone) are stated in the UI's guardrails panel and in
  `data.md`.
