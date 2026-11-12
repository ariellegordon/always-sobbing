'use strict';

// ---------- Storage ----------
const STORAGE_KEY = 'sob-data-v1';

// Data shape:
// {
//   substances: [{ id, name, unit, archived? }],
//   entries:    [{ id, date: 'YYYY-MM-DD', substanceId, amount, createdAt }],
//   trackingSince: 'YYYY-MM-DD'
// }
let data = load();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValidData(parsed)) return parsed;
  } catch (_) { /* fall through */ }
  return { substances: [], entries: [], trackingSince: dateStr(new Date()) };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function isValidData(d) {
  return d && Array.isArray(d.substances) && Array.isArray(d.entries) &&
    typeof d.trackingSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trackingSince);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Date helpers (local time, YYYY-MM-DD strings) ----------
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
const today = () => dateStr(new Date());
function prettyDate(s) {
  if (s === today()) return 'Today';
  if (s === addDays(today(), -1)) return 'Yesterday';
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const fmtNum = (n) => Number(n.toFixed(2)).toString();

// ---------- Derived data ----------
const substanceById = (id) => data.substances.find((s) => s.id === id);
const activeSubstances = () => data.substances.filter((s) => !s.archived);

// Days since last use (or since trackingSince if never used). A blank day counts as free.
function streak(substanceId) {
  const relevant = substanceId ? data.entries.filter((e) => e.substanceId === substanceId) : data.entries;
  const lastUse = relevant.reduce((max, e) => (e.date > max ? e.date : max), '');
  const from = lastUse || data.trackingSince;
  return { days: Math.max(0, daysBetween(from, today())), since: from, everUsed: !!lastUse };
}

function totalsByDate(date) {
  const totals = new Map();
  for (const e of data.entries) {
    if (e.date !== date) continue;
    totals.set(e.substanceId, (totals.get(e.substanceId) || 0) + e.amount);
  }
  return totals;
}

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

// ---------- State ----------
let currentView = 'log';
let logDate = today();

// ---------- Rendering ----------
function render() {
  renderHeader();
  if (currentView === 'log') renderLog();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
}

function renderHeader() {
  const s = streak();
  $('#overall-days').textContent = s.days;
  $('#overall-label').textContent =
    `${s.days === 1 ? 'day' : 'days'} free · ${s.everUsed ? 'last use' : 'since'} ${prettyDate(s.since)}`;

  const chips = $('#substance-streaks');
  chips.replaceChildren(
    ...activeSubstances().map((sub) => {
      const st = streak(sub.id);
      return h('span', { class: 'chip' }, `${sub.name} `, h('b', {}, String(st.days)), 'd');
    })
  );
}

function renderLog() {
  const t = today();
  $('#log-date').value = logDate;
  $('#log-date').max = t;
  $('#next-day').disabled = logDate >= t;

  // Substance picker
  const subs = activeSubstances();
  const select = $('#entry-substance');
  const prev = select.value;
  select.replaceChildren(...subs.map((s) => h('option', { value: s.id }, s.name)));
  if (subs.some((s) => s.id === prev)) select.value = prev;
  $('#entry-form').hidden = subs.length === 0;
  $('#no-substances').hidden = subs.length > 0;
  updateUnit();

  // Summary for the day
  const totals = totalsByDate(logDate);
  const summary = $('#day-summary');
  if (totals.size === 0) {
    summary.replaceChildren(h('div', { class: 'free-day' }, '✓ No use logged — free day'));
  } else {
    const parts = [...totals].map(([id, amt]) => {
      const sub = substanceById(id);
      return `${sub ? sub.name : '?'}: ${fmtNum(amt)} ${sub ? sub.unit : ''}`;
    });
    summary.replaceChildren(h('div', { class: 'used-day' }, parts.join(' · ')));
  }

  // Individual entries
  const entries = data.entries
    .filter((e) => e.date === logDate)
    .sort((a, b) => a.createdAt - b.createdAt);
  $('#day-entries').replaceChildren(
    ...entries.map((e) => {
      const sub = substanceById(e.substanceId);
      const time = new Date(e.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return h('li', {},
        h('span', {}, `${sub ? sub.name : '?'} — ${fmtNum(e.amount)} ${sub ? sub.unit : ''} `,
          logDate === t ? h('span', { class: 'meta' }, time) : null),
        h('button', { class: 'danger', 'aria-label': 'Delete entry', onclick: () => deleteEntry(e.id) }, '✕'));
    })
  );
}

function updateUnit() {
  const sub = substanceById($('#entry-substance').value);
  $('#entry-unit').textContent = sub ? sub.unit : '';
}

function renderHistory() {
  const dates = [...new Set(data.entries.map((e) => e.date))].sort().reverse();
  const items = [];
  const t = today();

  if (dates.length === 0) {
    items.push(h('li', { class: 'gap' }, 'Nothing logged yet — every day so far is a free day.'));
  } else {
    // Free stretch from the most recent use up to today
    const lead = daysBetween(dates[0], t);
    if (lead > 0) items.push(gapItem(lead));

    dates.forEach((date, i) => {
      const totals = totalsByDate(date);
      const desc = [...totals].map(([id, amt]) => {
        const sub = substanceById(id);
        return `${sub ? sub.name : '?'} ${fmtNum(amt)} ${sub ? sub.unit : ''}`;
      }).join(' · ');
      items.push(h('li', { class: 'clickable', onclick: () => openDay(date) },
        h('span', {}, prettyDate(date)),
        h('span', { class: 'meta used-day' }, desc)));

      const next = dates[i + 1];
      if (next) {
        const gap = daysBetween(next, date) - 1;
        if (gap > 0) items.push(gapItem(gap));
      }
    });
  }
  $('#history-list').replaceChildren(...items);
}

const gapItem = (n) => h('li', { class: 'gap' }, `${n} free ${n === 1 ? 'day' : 'days'}`);

function renderSettings() {
  $('#tracking-since').value = data.trackingSince;
  $('#tracking-since').max = today();
  $('#substance-list').replaceChildren(
    ...activeSubstances().map((s) =>
      h('li', {},
        h('span', {}, s.name, ' ', h('span', { class: 'meta' }, `(${s.unit})`)),
        h('button', { class: 'danger', onclick: () => removeSubstance(s.id) }, 'Remove')))
  );
}

// ---------- Actions ----------
function showView(view) {
  currentView = view;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  render();
}

function openDay(date) {
  logDate = date;
  showView('log');
}

function deleteEntry(id) {
  data.entries = data.entries.filter((e) => e.id !== id);
  save();
  render();
}

function removeSubstance(id) {
  const sub = substanceById(id);
  const used = data.entries.some((e) => e.substanceId === id);
  if (used) {
    // Keep it (archived) so history still shows its name.
    if (!confirm(`Remove "${sub.name}"? Past entries are kept in history.`)) return;
    sub.archived = true;
  } else {
    data.substances = data.substances.filter((s) => s.id !== id);
  }
  save();
  render();
}

// ---------- Event wiring ----------
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((a) =>
  a.addEventListener('click', (ev) => { ev.preventDefault(); showView(a.dataset.goto); }));

$('#prev-day').addEventListener('click', () => { logDate = addDays(logDate, -1); render(); });
$('#next-day').addEventListener('click', () => { if (logDate < today()) { logDate = addDays(logDate, 1); render(); } });
$('#log-date').addEventListener('change', (e) => {
  if (e.target.value) logDate = e.target.value > today() ? today() : e.target.value;
  render();
});
$('#entry-substance').addEventListener('change', updateUnit);

$('#entry-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const amount = parseFloat($('#entry-amount').value);
  const substanceId = $('#entry-substance').value;
  if (!substanceId || !(amount > 0)) return;
  data.entries.push({ id: uid(), date: logDate, substanceId, amount, createdAt: Date.now() });
  save();
  $('#entry-amount').value = '';
  render();
});

$('#substance-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('#sub-name').value.trim();
  const unit = $('#sub-unit').value.trim();
  if (!name || !unit) return;
  data.substances.push({ id: uid(), name, unit });
  save();
  $('#sub-name').value = '';
  $('#sub-unit').value = '';
  render();
});

$('#tracking-since').addEventListener('change', (e) => {
  if (!e.target.value) return;
  data.trackingSince = e.target.value > today() ? today() : e.target.value;
  save();
  render();
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `sober-log-${today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!isValidData(parsed)) throw new Error('Unrecognized file format');
    if (!confirm('Replace all current data with this file?')) return;
    data = parsed;
    save();
    render();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// Re-render when returning to the app (e.g. the date rolled over overnight).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (logDate > today()) logDate = today();
    render();
  }
});

// ---------- Offline support ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
