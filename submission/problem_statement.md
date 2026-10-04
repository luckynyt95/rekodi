# Problem statement — Rekodi

**One-liner (required):** Because of this tool, a rural frontline nurse will finish a
complete visit record and schedule the patient's follow-up within two minutes of the
visit ending — work she would otherwise do hours late, incompletely, or not at all;
we know because WHO projects a shortfall of 10 million health workers by 2030
(mostly in low- and lower-middle-income countries), a time-motion study in the
Annals of Internal Medicine found clinicians spend nearly 2 hours on EHR/desk work
for every 1 hour of direct patient face time (27% face time vs >49% desk work), and
our working prototype turns a 60-second Swahili voice note into a confirmed,
structured record plus a follow-up task entirely offline (see `evidence/`).

## Who
Noor — a frontline health worker / clinic nurse serving a rural catchment. Basic
phone, no wifi, 3G bundles she pays for herself, speaks the local language
(Swahili in our prototype), an overcrowded clinic, doctors with no time, and a
record-keeping burden that steals hours from patients every day.

## What breaks today
1. **Documentation eats patient time.** Notes are written by hand, hours later, from
   memory — or not at all. The 2:1 desk-to-face-time ratio from the literature is
   worse in understaffed rural clinics.
2. **Follow-up dies in a paper book.** Return dates are scribbled in a register nobody
   re-opens. Patients who should come back don't; nobody reminds them; nobody knows.
3. **Continuity breaks at referral.** When a patient is sent to the district hospital,
   the paper trail ends.

## What Rekodi changes
The nurse taps "New visit", speaks for ~60 seconds in Swahili, reviews an AI-drafted
record (fixing anything the AI flags as unsure), confirms — and the record is saved,
the follow-up is scheduled, and an SMS reminder draft is ready. When she has
connectivity, records sync to the ministry system (DHIS2) in one batch.

## What it deliberately does NOT do
It never suggests a diagnosis, condition, or treatment. It only records what the
worker said — verbatim where it matters. The health annex lists no imaging or
diagnosis datasets, and we treat diagnosis as out of bounds for this tool.
