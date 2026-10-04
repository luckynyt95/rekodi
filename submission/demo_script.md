# Demo script — Rekodi (2–5 min video, shot by shot)

**Total target: ~3.5 minutes.** The user records this; the prototype does the rest.

## Shot 1 — The problem (0:00–0:45)
- Open on a busy rural clinic (stock or staged). Voiceover: "Noor is a nurse. She
  sees 60 patients a day — and spends her evenings writing notes from memory."
- Stat cards: "WHO: 10M health-worker shortfall by 2030" · "2 hrs desk work per
  1 hr with patients (Annals of Internal Medicine)".
- Line: "Follow-ups die in a paper register nobody re-opens."

## Shot 2 — What the AI does (0:45–1:20)
- Show the phone UI. "Rekodi is a voice-first companion. It listens in Swahili,
  drafts the record, schedules the follow-up — and never diagnoses."
- Name the AI value prop explicitly: "SMS can't transcribe voice, can't structure
  it, can't draft reminders. A spreadsheet can't listen. Small AI does all three —
  offline, on her phone."

## Shot 3 — End-to-end demo (1:20–3:00)
1. Tap "Ziara mpya / New visit" → play the Swahili voice note (~40 s, or trimmed).
2. Tap Transcribe → transcript appears (Swahili).
3. Tap "Draft record" → fields fill in; point at the ❓ "sina uhakika" badge on a
   low-confidence field → edit it live → "this is the human-in-the-loop gate:
   nothing saves until she confirms."
4. Confirm → record lands in Outbox. Show "Prepare DHIS2 payload" → JSON preview.
5. Open Follow-ups → overdue patient highlighted → tap "Draft SMS" → Swahili
   reminder appears → show the sms: link. Type a patient reply ("Siwezi kuja") →
   intent "can't come" → "reschedule".
6. Guardrails panel: "does not diagnose", confidence badges, where data sits.

## Shot 4 — The gap (3:00–3:20)
- Honest: "The demo voice is synthetic. Whisper tiny handles clear Swahili, but
  real clinic noise and accents need field testing — our production path is
  Common Voice Swahili fine-tuning. The extractor is not clinically trained, which
  is exactly why diagnosis is out of bounds by design."

## Shot 5 — The take (3:20–3:35)
- "Because of Rekodi, a nurse finishes a visit record and schedules the follow-up
  within two minutes — work she'd otherwise do hours late or not at all."
- Closing card: Rekodi · small AI, big continuity · offline-first · Swahili-first.
