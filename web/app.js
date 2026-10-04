const API = location.origin; // same host as backend (served or proxied)
let draft = null, audioBlob = null, mediaRecorder = null, chunks = [];

const $ = id => document.getElementById(id);
const views = document.querySelectorAll('.view');

function show(name) {
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  if (name === 'home') loadHome();
  if (name === 'outbox') loadOutbox();
  if (name === 'followups') loadFollowups();
}
document.querySelectorAll('nav button').forEach(b =>
  b.addEventListener('click', () => show(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b =>
  b.addEventListener('click', () => show(b.dataset.goto)));

async function loadHome() {
  const r = await (await fetch(API + '/followups')).json();
  const due = r.followups.filter(f => f.status === 'overdue').length;
  const today = r.followups.filter(f => f.status === 'due').length;
  $('home-stats').innerHTML =
    `<div class="stat"><b>${due}</b><small>Zimechelewa<br>Overdue</small></div>` +
    `<div class="stat"><b>${today}</b><small>Leo / hivi karibuni<br>Due soon</small></div>`;
}

// ---- recording ----
$('btn-record').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType });
      $('player').src = URL.createObjectURL(audioBlob);
      $('player').classList.remove('hidden');
      $('btn-transcribe').classList.remove('hidden');
      $('rec-status').textContent = '✔️ Sauti imerekodiwa · Recording ready';
    };
    mediaRecorder.start();
    $('btn-record').disabled = true; $('btn-stop').disabled = false;
    $('rec-status').textContent = '🔴 Inarekodi… · Recording…';
  } catch (e) { $('rec-status').textContent = '❌ ' + e.message; }
});
$('btn-stop').addEventListener('click', () => {
  mediaRecorder && mediaRecorder.stop();
  $('btn-record').disabled = false; $('btn-stop').disabled = true;
});
$('file-audio').addEventListener('change', e => {
  audioBlob = e.target.files[0];
  $('player').src = URL.createObjectURL(audioBlob);
  $('player').classList.remove('hidden');
  $('btn-transcribe').classList.remove('hidden');
  $('rec-status').textContent = '✔️ Faili imepakuliwa · File loaded';
});

// ---- transcribe ----
$('btn-transcribe').addEventListener('click', async () => {
  if (!audioBlob) return;
  $('rec-status').textContent = '⏳ Inanakili… · Transcribing (offline)…';
  const fd = new FormData();
  fd.append('file', audioBlob, 'note.webm');
  const r = await fetch(API + '/transcribe', { method: 'POST', body: fd });
  const j = await r.json();
  $('transcript-text').textContent = j.text || '(hakuna maandishi)';
  $('transcript-box').classList.remove('hidden');
  $('rec-status').textContent = `✔️ Lugha: ${j.language} (${j.language_probability})`;
});

// ---- extract ----
$('btn-extract').addEventListener('click', async () => {
  const text = $('transcript-text').textContent;
  $('review-status').textContent = '';
  const r = await fetch(API + '/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  draft = await r.json();
  renderReview();
  show('review');
});

const LABELS = {
  patient_name: 'Jina la mgonjwa · Patient name',
  age: 'Umri · Age',
  visit_date: 'Tarehe ya ziara · Visit date',
  summary: 'Muhtasari · Summary',
  treatment_given: 'Matibabu yaliyotolewa (nukuu) · Treatment given (verbatim)',
  followup_date: 'Tarehe ya kurudi · Follow-up date',
  referral_needed: 'Rufaa inahitajika? · Referral needed?',
};
function renderReview() {
  const box = $('review-fields'); box.innerHTML = '';
  const conf = draft.field_confidence || {};
  for (const k of Object.keys(LABELS)) {
    const c = conf[k] || 'low';
    const badge = c === 'high' ? '✅' : c === 'medium' ? '⚠️' : '❓ <i>sina uhakika — tafadhali angalia · not sure — please check</i>';
    let input;
    if (k === 'referral_needed') {
      input = `<select id="f-${k}"><option value="false">Hapana · No</option><option value="true">Ndiyo · Yes</option></select>`;
    } else if (k === 'summary' || k === 'treatment_given') {
      input = `<textarea id="f-${k}" rows="2"></textarea>`;
    } else if (k.includes('date')) {
      input = `<input id="f-${k}" type="date">`;
    } else {
      input = `<input id="f-${k}" type="text">`;
    }
    box.innerHTML += `<label class="field conf-${c}"><span>${LABELS[k]}</span>${input}<em class="badge">${badge}</em></label>`;
  }
  for (const k of Object.keys(LABELS)) {
    const el = $('f-' + k), v = draft[k];
    if (k === 'referral_needed') el.value = String(!!v);
    else if (v != null) el.value = v;
  }
}

$('btn-confirm').addEventListener('click', async () => {
  const rec = { transcript: $('transcript-text').textContent, extractor: draft.extractor, field_confidence: draft.field_confidence };
  for (const k of Object.keys(LABELS)) {
    const el = $('f-' + k);
    rec[k] = k === 'referral_needed' ? el.value === 'true' : (el.value || null);
  }
  const r = await fetch(API + '/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec)
  });
  const j = await r.json();
  $('review-status').textContent = j.ok ? '✅ Imehifadhiwa · Saved to outbox' : '❌ Hitilafu';
  setTimeout(() => show('outbox'), 900);
});

// ---- outbox ----
async function loadOutbox() {
  const r = await (await fetch(API + '/records')).json();
  $('outbox-list').innerHTML = r.records.map(x =>
    `<div class="rec"><b>${x.patient_name || '—'}</b> <small>${x.visit_date || ''}</small><br>
     <small>${(x.summary || '').slice(0, 90)}…</small><br>
     <small class="muted">miadi: ${x.followup_date || '—'} · ${x.extractor || ''}</small></div>`
  ).join('') || '<p class="muted">Hakuna rekodi · No records yet</p>';
}
$('btn-sync').addEventListener('click', async () => {
  const r = await fetch(API + '/sync', { method: 'POST' });
  const j = await r.json();
  $('sync-preview').textContent = JSON.stringify(j, null, 2).slice(0, 3000);
  $('sync-preview').classList.remove('hidden');
});

// ---- followups ----
let currentFollowup = null;
async function loadFollowups() {
  const r = await (await fetch(API + '/followups')).json();
  $('followup-list').innerHTML = r.followups.map(f => {
    const cls = f.status === 'overdue' ? 'overdue' : f.status === 'due' ? 'due' : '';
    const sw = { overdue: 'IMECHELEWA', due: 'INAKARIBIA', upcoming: 'inakuja' }[f.status] || f.status;
    return `<div class="rec ${cls}"><b>${f.patient_name || '—'}</b> · ${f.followup_date}
      <span class="pill">${sw}</span><br>
      <button class="ghost small" onclick='draftSms(${JSON.stringify(f)})'>✉️ Andika SMS · Draft SMS</button></div>`;
  }).join('') || '<p class="muted">Hakuna miadi · No follow-ups</p>';
}
window.draftSms = async function (f) {
  currentFollowup = f;
  const r = await fetch(API + '/sms-draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_name: f.patient_name, followup_date: f.followup_date, overdue: f.status === 'overdue' })
  });
  const j = await r.json();
  $('sms-text').textContent = j.text;
  $('sms-link').href = 'sms:?body=' + encodeURIComponent(j.text);
  $('sms-box').classList.remove('hidden');
  $('reply-result').textContent = '';
};
$('btn-classify').addEventListener('click', async () => {
  const text = $('reply-input').value.trim();
  if (!text) return;
  const r = await fetch(API + '/reply-classify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const j = await r.json();
  $('reply-result').textContent = `→ ${j.intent}: ${j.suggested_action}`;
});

show('home');
