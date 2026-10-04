# Data — Rekodi

## Datasets used
| Dataset | Source / license | Size | Used for |
|---|---|---|---|
| Whisper training data (incl. Swahili) | OpenAI Whisper — model weights, permissive use | tiny model ~39 MB | Swahili speech-to-text (faster-whisper) |
| Qwen2.5 pretraining (multilingual incl. Swahili) | Alibaba Qwen2.5-0.5B-Instruct, Apache 2.0 | GGUF Q4_K_M ~101 MB | text → structured JSON extraction |
| Demo voice note | Synthesized for this prototype via TTS (`demo_assets/nurse_note_sw.mp3`), script in `voice_note_script.txt` | ~40 s | end-to-end demo + transcription test |
| Demo records (3) | Hand-authored (`demo_assets/seed_records.py`) | 3 JSON records | outbox, follow-ups, SMS drafts |

No patient data was used. No real health records appear anywhere in this prototype.

## What our data does NOT cover (frank)
- **No clinical training data.** The extractor is a general instruction-tuned LM with
  a strict schema prompt — it is NOT fine-tuned on clinical notes, and it must
  never be trusted to interpret symptoms. That's why diagnosis is architecturally
  out of bounds, not just discouraged.
- **Swahili coverage is thin.** Whisper tiny handles clear, slow Swahili adequately
  (see `evidence/transcript.txt`), but accented, fast, or code-switched speech will
  degrade. Production path: fine-tune on Mozilla Common Voice Swahili (CC0) or MMS.
- **The demo voice is synthetic.** A real nurse's voice, clinic background noise,
  and overlapping speech are not represented. Field testing with real audio is the
  first post-hackathon step.
- **No longitudinal data.** Follow-up logic is demonstrated on 3 seeded records, not
  on real patient trajectories.
- **SMS reply intents are keyword-based**, covering a small Swahili vocabulary;
  unseen phrasings fall back to "unclear → ask a person", which is the safe default.

## Data governance (prototype)
- Data sits on the phone (`data/outbox.json`). Read by: the nurse, clinic
  supervisors. Sync target: ministry DHIS2.
- Lost/shared phone plan: records are plain JSON inside the app sandbox — wipe the
  app or factory-reset the phone. No cloud copy exists in the prototype.
- Consent: the demo uses synthetic data; a production pilot needs patient consent
  flows in the local language before any recording.
