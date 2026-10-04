"""Seed 3 demo records into the outbox (one with an overdue follow-up)."""
import json
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "outbox.json"
today = date.today()

records = [
    {
        "id": "demo0001",
        "created_at": (today - timedelta(days=10)).isoformat() + "T09:15:00",
        "confirmed_by_worker": True,
        "sync_status": "pending",
        "patient_name": "Amina Juma",
        "age": "32",
        "visit_date": (today - timedelta(days=10)).isoformat(),
        "summary": "Homa na kikohozi kwa siku tatu.",
        "treatment_given": "dawa ya kupunguza homa kama daktari alivyoagiza",
        "followup_date": (today - timedelta(days=3)).isoformat(),  # OVERDUE
        "referral_needed": False,
        "transcript": "Mgonjwa anaitwa Amina Juma. Ana umri wa miaka thelathini na mbili. Amekuja na homa na kikohozi kwa siku tatu.",
        "extractor": "qwen2.5-0.5b-instruct-q4_k_m",
        "field_confidence": {"patient_name": "high", "age": "high", "visit_date": "high",
                             "summary": "high", "treatment_given": "high",
                             "followup_date": "high", "referral_needed": "high"},
    },
    {
        "id": "demo0002",
        "created_at": (today - timedelta(days=2)).isoformat() + "T11:40:00",
        "confirmed_by_worker": True,
        "sync_status": "pending",
        "patient_name": "Neema Peter",
        "age": "45",
        "visit_date": (today - timedelta(days=2)).isoformat(),
        "summary": "Maumivu ya kichwa kwa siku mbili.",
        "treatment_given": "panadol kama alivyoelekezwa na daktari",
        "followup_date": (today + timedelta(days=1)).isoformat(),  # DUE SOON
        "referral_needed": False,
        "transcript": "Mgonjwa anaitwa Neema Peter, ana miaka 45. Amekuja na maumivu ya kichwa siku mbili.",
        "extractor": "qwen2.5-0.5b-instruct-q4_k_m",
        "field_confidence": {"patient_name": "high", "age": "high", "visit_date": "medium",
                             "summary": "high", "treatment_given": "medium",
                             "followup_date": "high", "referral_needed": "high"},
    },
    {
        "id": "demo0003",
        "created_at": (today - timedelta(days=1)).isoformat() + "T08:05:00",
        "confirmed_by_worker": True,
        "sync_status": "pending",
        "patient_name": "Juma Mwanza",
        "age": None,  # worker did not state age -> low confidence, "not sure" badge
        "visit_date": (today - timedelta(days=1)).isoformat(),
        "summary": "Mtoto ana homa. Mama ameambiwa ampe maji mengi.",
        "treatment_given": None,
        "followup_date": (today + timedelta(days=6)).isoformat(),
        "referral_needed": True,  # referred to district hospital
        "transcript": "Mtoto Juma Mwanza ana homa. Nimemuelekeza mama kwenda hospitali kubwa.",
        "extractor": "heuristic_v1",
        "field_confidence": {"patient_name": "medium", "age": "low", "visit_date": "medium",
                             "summary": "medium", "treatment_given": "low",
                             "followup_date": "medium", "referral_needed": "medium"},
    },
]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(records, ensure_ascii=False, indent=2))
print(f"seeded {len(records)} records -> {OUT}")
