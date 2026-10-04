const API = location.origin; // same host as backend (served or proxied)
let draft = null, audioBlob = null, mediaRecorder = null, chunks = [];

const $ = id => document.getElementById(id);
// authed API wrapper: attaches the worker session token to every call
const api = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { ...(opts.headers || {}), 'X-Token': sessionStorage.getItem('rekodi_token') || '' },
});
const views = document.querySelectorAll('.view');

function show(name) {
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  if (!sessionStorage.getItem('rekodi_token')) return; // data loads after login
  if (name === 'home') loadHome();
  if (name === 'outbox') loadOutbox();
  if (name === 'followups') loadFollowups();
  if (name === 'chat') loadChatPatients();
}
document.querySelectorAll('nav button').forEach(b =>
  b.addEventListener('click', () => show(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b =>
  b.addEventListener('click', () => show(b.dataset.goto)));

async function loadHome() {
  const r = await (await api('/followups')).json();
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
  const r = await api('/transcribe', { method: 'POST', body: fd });
  const j = await r.json();
  $('transcript-text').textContent = j.text || '(hakuna maandishi)';
  $('transcript-box').classList.remove('hidden');
  $('rec-status').textContent = `✔️ Lugha: ${j.language} (${j.language_probability})`;
});

// ---- extract ----
$('btn-extract').addEventListener('click', async () => {
  const text = $('transcript-text').textContent;
  $('review-status').textContent = '';
  const r = await api('/extract', {
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
  phone: 'Namba ya simu · Phone number',
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
  const rec = { transcript: $('transcript-text').textContent, extractor: draft.extractor, field_confidence: draft.field_confidence,
                confirmed_by: (window.rekodiWorker ? window.rekodiWorker() : null) };
  for (const k of Object.keys(LABELS)) {
    const el = $('f-' + k);
    rec[k] = k === 'referral_needed' ? el.value === 'true' : (el.value || null);
  }
  const r = await api('/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec)
  });
  const j = await r.json();
  $('review-status').textContent = j.ok ? '✅ Imehifadhiwa · Saved to outbox' : '❌ Hitilafu';
  if (j.ok) tryAutoSync(true); // send immediately if internet + ministry are available
  setTimeout(() => show('outbox'), 900);
});

// ---- outbox ----
async function loadOutbox() {
  const r = await (await api('/records')).json();
  $('outbox-list').innerHTML = r.records.map(x =>
    `<div class="rec"><b>${escapeHtml(x.patient_name || '—')}</b> <small>${escapeHtml(x.visit_date || '')}</small><br>
     <small>${escapeHtml((x.summary || '').slice(0, 90))}…</small><br>
     <small class="muted">miadi: ${escapeHtml(x.followup_date || '—')}</small></div>`
  ).join('') || '<p class="muted">Hakuna rekodi · No records yet</p>';
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// ---- automatic DHIS2 sync -----------------------------------------------
// Whenever internet AND ministry are both available, pending records are sent
// by themselves: on login, after each confirmed record, when connectivity
// returns, and every 60s. Never errors; no-ops gracefully when not possible.
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.querySelector('.phone').appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 4500);
}
async function tryAutoSync(notify) {
  if (!navigator.onLine) return 0;
  try {
    const pre = await (await api('/sync', { method: 'POST' })).json();
    if (!pre.ministry_connected || !(pre.record_count > 0)) return 0;
    const sr = await (await api('/sync-send', { method: 'POST' })).json();
    const sent = sr.sent || 0;
    if (sent > 0) {
      if (notify) toast(`✓ ${sent} rekodi zimetumwa wizara · ${sent} synced to ministry`);
      if ($('view-outbox').classList.contains('active')) loadOutbox();
      if ($('view-home').classList.contains('active')) loadHome();
    }
    return sent;
  } catch (e) { return 0; }
}
window.addEventListener('online', () => tryAutoSync(true));
setInterval(() => tryAutoSync(false), 60000);

$('btn-sync').addEventListener('click', async () => {
  const box = $('sync-preview');
  const online = navigator.onLine;
  let j, justSent = 0;
  try {
    justSent = await tryAutoSync(false); // send first if possible, then show fresh state
    j = await (await api('/sync', { method: 'POST' })).json();
  } catch (e) {
    // server unreachable: never show an error, just explain the state
    j = { preview: true, ministry_connected: false, record_count: 0, events: [] };
  }
  const evts = j.events || [];
  const n = j.record_count || evts.length;
  const plural = n === 1 ? '' : 's';
  let head, sub;
  if (justSent > 0) {
    const sp = justSent === 1 ? '' : 's';
    head = `✓ ${justSent} rekodi zimetumwa wizara · ${justSent} record${sp} sent to ministry`;
    sub = 'Wizara imepokea rekodi. Zimehifadhiwa kama "zimetumwa" — hazitatumwa tena.<br>' +
          'The ministry has received the records. They are marked as sent and will not be re-sent.';
  } else if (!j.ministry_connected) {
    head = `✓ ${n} rekodi ziko salama · ${n} record${plural} safe on this phone`;
    sub = 'Mfumo wa wizara haujaunganishwa bado. Rekodi zitatumwa wizara itakapounganisha mfumo. Hakuna kilichopotea.<br>' +
          'The ministry system is not connected yet. Records will sync once the ministry connects it. Nothing is lost.';
  } else if (!online) {
    head = `✓ ${n} rekodi zinasubiri intaneti · ${n} record${plural} waiting for internet`;
    sub = 'Hauna intaneti sasa. Rekodi zitatumwa zenyewe utakaporudi mtandaoni. Hakuna kilichopotea.<br>' +
          'You are offline right now. Records will sync by themselves when you are back online. Nothing is lost.';
  } else {
    head = `✓ ${n} rekodi ziko tayari kutumwa · ${n} record${plural} ready to send`;
    sub = 'Zimeandaliwa kwa muundo wa wizara (DHIS2).<br>' +
          'Prepared in the ministry (DHIS2) format.';
  }
  const rows = evts.map(e => {
    const dv = {};
    (e.dataValues || []).forEach(d => { dv[d.dataElement] = d.value; });
    return `<li><b>${escapeHtml(dv.REKODI_PATIENT_NAME || '?')}</b> · visit ${escapeHtml(e.eventDate || '')} · follow-up ${escapeHtml(dv.REKODI_FOLLOWUP_DATE || '—')}</li>`;
  }).join('');
  box.innerHTML =
    `<div class="sync-summary">` +
    `<div class="sync-head">${head}</div>` +
    `<p class="muted">${sub}</p>` +
    (rows ? `<ul class="sync-list">${rows}</ul>` : '') +
    `<button class="ghost small" id="btn-tech-toggle">Onyesha muundo wa kiufundi · Show technical format</button>` +
    `<pre id="sync-tech" class="hidden code"></pre></div>`;
  box.classList.remove('hidden');
  $('sync-tech').textContent = JSON.stringify(j, null, 2).slice(0, 3000);
  $('btn-tech-toggle').addEventListener('click', () => {
    const t = $('sync-tech');
    t.classList.toggle('hidden');
    $('btn-tech-toggle').textContent = t.classList.contains('hidden')
      ? 'Onyesha muundo wa kiufundi · Show technical format'
      : 'Ficha muundo wa kiufundi · Hide technical format';
  });
});

// ---- followups ----

let currentFollowup = null;
let lastFollowups = [];
async function loadFollowups() {
  const r = await (await api('/followups')).json();
  lastFollowups = r.followups;
  $('followup-list').innerHTML = r.followups.map((f, i) => {
    const cls = f.status === 'overdue' ? 'overdue' : f.status === 'due' ? 'due' : '';
    const sw = { overdue: 'IMECHELEWA', due: 'INAKARIBIA', upcoming: 'inakuja' }[f.status] || f.status;
    return `<div class="rec ${cls}"><b>${escapeHtml(f.patient_name || '—')}</b> · ${escapeHtml(f.followup_date)}
      <span class="pill">${sw}</span><br>
      <button class="ghost small" onclick='draftSmsIdx(${i})'>✉️ Andika SMS · Draft SMS</button>
      <button class="ghost small" onclick='openChatIdx(${i})'>💬 Ujumbe · Chat</button></div>`;
  }).join('') || '<p class="muted">Hakuna miadi · No follow-ups</p>';
}
window.openChatIdx = i => {
  const f = lastFollowups[i];
  if (!f) return;
  openThread(patientKey(f.patient_name, f.phone), f.patient_name || '?', (f.phone || '').trim());
  show('chat');
};
function patientKey(name, phone) {
  return ((phone || '').trim() || (name || '').trim().toLowerCase());
}
window.draftSmsIdx = i => {
  const f = lastFollowups[i];
  if (f) draftSms(f);
};
window.draftSms = async function (f) {
  currentFollowup = f;
  const r = await api('/sms-draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_name: f.patient_name, followup_date: f.followup_date, overdue: f.status === 'overdue' })
  });
  const j = await r.json();
  $('sms-text').textContent = j.text;
  const to = (f.phone || '').trim();
  $('sms-to').textContent = to ? `Kwa · To: ${to}` : '';
  $('sms-link').href = to
    ? 'sms:' + encodeURIComponent(to) + '?body=' + encodeURIComponent(j.text)
    : 'sms:?body=' + encodeURIComponent(j.text);
  $('sms-box').classList.remove('hidden');
  $('reply-result').textContent = '';
  // log to the patient chat thread so the conversation history is complete
  const pkey = patientKey(f.patient_name, f.phone);
  if (pkey && j.text) {
    api('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_key: pkey, dir: 'out', text: j.text }) }).catch(() => {});
  }
};
$('btn-classify').addEventListener('click', async () => {
  const text = $('reply-input').value.trim();
  if (!text) return;
  const r = await api('/reply-classify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const j = await r.json();
  $('reply-result').textContent = `→ ${j.intent}: ${j.suggested_action}`;
});

show('home');


// ---- Worker login (backend accounts + token sessions) ----
// Passwords are PBKDF2-hashed server-side; patient data files are encrypted
// at rest; every patient-data API call needs the session token.
let authMode = 'login';
function showLock(mode) {
  authMode = mode;
  $('lock-screen').classList.remove('hidden');
  ['lock-name', 'lock-user', 'lock-pass', 'lock-pass2'].forEach(id => { $(id).value = ''; });
  $('lock-err').textContent = '';
  const isReg = mode === 'register';
  $('lock-title').textContent = isReg ? 'Sajili mfanyakazi · Register worker' : 'Ingia · Worker login';
  $('lock-sub').innerHTML = isReg
    ? 'Tengeneza akaunti ya mfanyakazi wa kliniki.<br>Create a clinic worker account.'
    : 'Ingia kuona rekodi za wagonjwa.<br>Log in to access patient records.';
  $('lock-name').classList.toggle('hidden', !isReg);
  $('lock-pass2').classList.toggle('hidden', !isReg);
  $('lock-btn').innerHTML = isReg ? 'Sajili<br><small>Register</small>' : 'Ingia<br><small>Log in</small>';
  $('lock-toggle').textContent = isReg ? 'Nina akaunti · I have an account' : 'Mpya hapa? Jisajili · New? Register';
  setTimeout(() => $(isReg ? 'lock-name' : 'lock-user').focus(), 50);
}
function loginAs(sess) {
  sessionStorage.setItem('rekodi_token', sess.token);
  sessionStorage.setItem('rekodi_user', sess.username);
  $('worker-name').textContent = (sess.name || sess.username).split(' ')[0];
  $('lock-screen').classList.add('hidden');
  show('home');
}
window.rekodiWorker = () => sessionStorage.getItem('rekodi_user');
async function initAuth() {
  showLock('login');
  $('lock-toggle').addEventListener('click', e => {
    e.preventDefault();
    showLock(authMode === 'login' ? 'register' : 'login');
  });
  const submit = async () => {
    const uname = $('lock-user').value.trim().toLowerCase();
    const pass = $('lock-pass').value;
    $('lock-err').textContent = '';
    const path = authMode === 'register' ? '/register' : '/login';
    const body = authMode === 'register'
      ? { name: $('lock-name').value.trim(), username: uname, password: pass }
      : { username: uname, password: pass };
    if (authMode === 'register' && !$('lock-name').value.trim()) {
      $('lock-err').textContent = 'Weka jina · Enter your name'; return;
    }
    if (authMode === 'register' && pass !== $('lock-pass2').value) {
      $('lock-err').textContent = 'Nywila hazifanani · Passwords do not match'; return;
    }
    try {
      const r = await fetch(API + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { $('lock-err').textContent = j.detail || 'Hitilafu · Error'; return; }
      loginAs(j);
      tryAutoSync(false);
    } catch (e) { $('lock-err').textContent = '❌ ' + e.message; }
  };
  $('lock-btn').addEventListener('click', submit);
  ['lock-name', 'lock-user', 'lock-pass', 'lock-pass2'].forEach(id =>
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  $('btn-lock').addEventListener('click', () => {
    sessionStorage.removeItem('rekodi_token');
    sessionStorage.removeItem('rekodi_user');
    $('worker-name').textContent = '';
    showLock('login');
  });
}
initAuth();

// ---- patient chat (WhatsApp-like, offline) ----
let chatKey = null, chatName = null, chatPhone = null;

async function loadChatPatients() {
  const r = await (await api('/patients')).json();
  $('chat-thread').classList.add('hidden');
  $('chat-patients').classList.remove('hidden');
  $('chat-patients').innerHTML = r.patients.map(p =>
    `<button class="card" data-key="${encodeURIComponent(p.key)}" data-name="${escapeHtml(p.patient_name || '?')}" data-phone="${escapeHtml(p.phone || '')}">` +
    `💬<b>${escapeHtml(p.patient_name || '?')}</b><small>${escapeHtml(p.phone || 'hakuna namba · no number')}</small></button>`
  ).join('') || '<p class="muted">Hakuna wagonjwa · No patients yet</p>';
  $('chat-patients').querySelectorAll('[data-key]').forEach(b =>
    b.addEventListener('click', () => openThread(
      decodeURIComponent(b.dataset.key), b.dataset.name, b.dataset.phone)));
}

async function openThread(key, name, phone) {
  chatKey = key; chatName = name; chatPhone = phone || '';
  $('chat-name').textContent = name + (chatPhone ? ' · ' + chatPhone : '');
  $('chat-patients').classList.add('hidden');
  $('chat-thread').classList.remove('hidden');
  $('chat-reply-box').classList.add('hidden');
  await loadThread();
}

const INTENT_SW = {
  came: '✅ amekuja · came', cant_come: '⚠️ hawezi kuja · can\'t come',
  needs_help: '🆘 anahitaji msaada · needs help', unclear: '❓ haijaeleweka · unclear'
};

async function loadThread() {
  if (!chatKey) return;
  const r = await (await api('/messages?patient_key=' + encodeURIComponent(chatKey))).json();
  $('chat-msgs').innerHTML = r.messages.map(m =>
    `<div class="msg ${m.dir}"><div class="bubble">${escapeHtml(m.text)}</div>` +
    (m.intent && m.intent !== 'unclear' ? `<span class="intent">${INTENT_SW[m.intent] || escapeHtml(m.intent)}</span>` : '') +
    `<small class="muted">${(m.ts || '').slice(0, 16).replace('T', ' ')}</small></div>`
  ).join('') || '<p class="muted">Hakuna ujumbe bado · No messages yet</p>';
  $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
}

$('chat-back').addEventListener('click', loadChatPatients);

// nurse sends a message: opens the phone SMS app (number prefilled) + logs to thread
$('chat-send').addEventListener('click', async () => {
  const text = $('chat-input').value.trim();
  if (!text || !chatKey) return;
  await api('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_key: chatKey, dir: 'out', text }) });
  $('chat-input').value = '';
  await loadThread();
  location.href = chatPhone
    ? 'sms:' + encodeURIComponent(chatPhone) + '?body=' + encodeURIComponent(text)
    : 'sms:?body=' + encodeURIComponent(text);
});
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('chat-send').click(); });

// log a patient reply (typed, or voice-transcribed): classify + save with intent chip
$('chat-type').addEventListener('click', () => {
  $('chat-reply-box').classList.toggle('hidden');
  $('chat-reply-text').focus();
});
let chatRec = null, chatChunks = [];
$('chat-voice').addEventListener('click', async () => {
  if (chatRec) { chatRec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chatRec = new MediaRecorder(stream);
    chatChunks = [];
    chatRec.ondataavailable = e => chatChunks.push(e.data);
    chatRec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      chatRec = null;
      $('chat-voice').innerHTML = '🎤 Jibu la sauti · Voice reply';
      $('chat-rec-status').textContent = '⏳ Inanakili… · Transcribing…';
      const blob = new Blob(chatChunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('file', blob, 'reply.webm');
      try {
        const r = await api('/transcribe', { method: 'POST', body: fd });
        const j = await r.json();
        $('chat-reply-text').value = j.text || '';
      } catch (e) { $('chat-rec-status').textContent = '❌ ' + e.message; return; }
      $('chat-rec-status').textContent = '';
    };
    chatRec.start();
    $('chat-voice').innerHTML = '⏹️ Maliza · Stop';
    $('chat-reply-box').classList.remove('hidden');
  } catch (e) { $('chat-rec-status').textContent = '❌ ' + e.message; }
});
$('chat-reply-save').addEventListener('click', async () => {
  const text = $('chat-reply-text').value.trim();
  if (!text || !chatKey) return;
  $('chat-rec-status').textContent = '⏳ Inabainisha… · Classifying…';
  const rc = await (await api('/reply-classify', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
  await api('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_key: chatKey, dir: 'in', text, intent: rc.intent }) });
  $('chat-reply-text').value = '';
  $('chat-reply-box').classList.add('hidden');
  $('chat-rec-status').textContent = '';
  await loadThread();
  toast(`→ ${INTENT_SW[rc.intent] || rc.intent}: ${rc.suggested_action}`);
});
