import { parseOutline } from './parse.js';
import { keywordCheck } from './gen.js';
import { playCoin, playBonk, moneyRain, inkSplat, speak, stopSpeaking, canSpeak } from './fx.js';
import { testKey, aiMultipleChoice, aiEssayPrompt, aiGradeEssay } from './ai.js';
import { DRILL_ID, DRILL_TOPICS, drillQueue, newNumbers, money, runWork, correctSteps } from './math.js';
import { kvGet, kvSet, fileGet, fileSet, fileDel, setPut, setDel, setAll, persist } from './db.js';

// ---------------- storage ----------------
// Small things live in localStorage; the Memory Bank (outlines, question banks,
// original files) and saved practice sets live in IndexedDB.
const K = { settings: 'lsep.settings', sources: 'lsep.sources', stats: 'lsep.stats', lists: 'lsep.lists', session: 'lsep.session', history: 'lsep.history', seeded: 'lsep.seeded', courses: 'lsep.courses' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('This phone\'s storage for the app is full. Delete something from Review or Settings → Reset progress.'); return false; }
};
const DEFAULT_COURSES = ['Partnership Tax', 'Business Organizations', 'Bar Prep'];

const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS = { sound: true, wrongSound: false, animations: true, reduceMotion: prefersReduced, text: 'medium', ai: false, aiKey: '', aiModel: 'claude-sonnet-5-5', lastCourse: '', lastPlan: {} };
let settings = { ...DEFAULTS, ...load(K.settings, {}) };
let sources = [];
let courses = load(K.courses, DEFAULT_COURSES.slice());
let stats = load(K.stats, {});
let lists = load(K.lists, { flagged: {}, saved: {}, review: {} });
let session = load(K.session, null);
let history = load(K.history, []);
let sets = [];
let ready = false;

async function saveSources() {
  try { await kvSet('sources', sources); return true; }
  catch (e) { toast('Couldn\'t save to the Memory Bank. The phone may be out of space.'); return false; }
}
const saveSettings = () => save(K.settings, settings);

const app = document.getElementById('app');
let view = { name: 'home', params: {} };
let timerHandle = null;

function applySettings() {
  document.documentElement.dataset.text = settings.text;
  document.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
}
applySettings();

// ---------------- helpers ----------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = ['A', 'B', 'C', 'D', 'E', 'F'];
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pct = (c, a) => a ? Math.round((100 * c) / a) : 0;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 2800);
}
function go(name, params = {}) {
  stopSpeaking();
  document.body.classList.remove('answered');
  clearInterval(timerHandle);
  view = { name, params };
  render();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  app.focus({ preventScroll: true });
}
const motionOn = () => settings.animations && !settings.reduceMotion;
const topicKey = (sourceId, heading) => sourceId + '::' + heading;
const getSource = id => sources.find(s => s.id === id);
const aiReady = () => !!(settings.ai && settings.aiKey);
function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const dateStr = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const sizeStr = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';

function srcLine(src) {
  if (!src) return '';
  const bits = [src.outline, src.heading, src.page].filter(Boolean).map(esc);
  return bits.length ? `<p class="small muted">From: ${bits.join(' › ')}${src.quote ? ` — “${esc(src.quote)}”` : ''}</p>` : '';
}
function dock(html) { return `<div class="dock"><div class="dock-inner">${html}</div></div>`; }
function courseOptions(selected) {
  return courses.map(c => `<option${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">+ New course…</option>';
}
function addCourse(name) {
  name = String(name || '').trim();
  if (!name) return null;
  if (!courses.includes(name)) { courses.push(name); save(K.courses, courses); }
  return name;
}

// Every multiple-choice question carries one explanation per choice. Older pack
// questions use "whyWrong"; this fills in the same shape for them.
function notesOf(q) {
  if (Array.isArray(q.notes) && q.notes.length === q.choices.length) return q.notes;
  return q.choices.map((c, i) => ({
    why: i === q.correct ? (q.explain && (q.explain.application || q.explain.takeaway)) || 'This is the best answer under the rule above.' : ((q.whyWrong || [])[i] || 'This doesn\'t match the rule above.'),
    when: ''
  }));
}
// Shuffle choices, keeping each explanation attached to its choice.
function shuffleChoices(q) {
  if (q.type !== 'mc') return q;
  const notes = notesOf(q);
  const order = shuffle(q.choices.map((c, i) => i));
  return { ...q, choices: order.map(i => q.choices[i]), notes: order.map(i => notes[i]), correct: order.indexOf(q.correct), whyWrong: undefined };
}

// ---------------- built-in packs & migration ----------------
async function seedPacks() {
  if (load(K.seeded, false)) return;
  for (const f of ['four-accounts', 'section-752']) {
    try {
      const res = await fetch(`packs/${f}.json`);
      const pack = await res.json();
      const src = packToSource(pack, { builtIn: true, id: 'pack_' + f, course: 'Partnership Tax' });
      if (!getSource(src.id)) sources.push(src);
    } catch (e) { return; } // offline on first run: try again next time
  }
  await saveSources();
  save(K.seeded, true);
}

async function loadAll() {
  try {
    const stored = await kvGet('sources');
    if (Array.isArray(stored)) sources = stored;
    else {
      sources = load(K.sources, []);           // move anything saved by the earlier version
      await saveSources();
      try { localStorage.removeItem(K.sources); } catch (e) { /* ignore */ }
    }
    sets = (await setAll()) || [];
  } catch (e) {
    sources = load(K.sources, []);
    toast('This browser blocked the Memory Bank storage, so saving may not last.');
  }
  let changed = false;
  sources.forEach(s => { if (!s.course) { s.course = s.builtIn ? 'Partnership Tax' : 'Partnership Tax'; changed = true; } addCourse(s.course); });
  if (changed) saveSources();
  persist();
}

function packToSource(pack, extra = {}) {
  if (!pack || !Array.isArray(pack.questions)) throw new Error('This quiz file has no "questions" list.');
  const id = extra.id || uid('pack_');
  const topics = [];
  const qs = pack.questions.map((q, i) => {
    const topic = String(q.topic || 'General').trim();
    if (!topics.includes(topic)) topics.push(topic);
    const out = { ...q, id: id + '_' + (q.id || i), topic, sourceId: id, origin: 'pack' };
    if (out.type !== 'essay') {
      out.type = 'mc';
      if (!Array.isArray(out.choices) || out.choices.length < 2) throw new Error(`Question ${i + 1} needs at least two choices.`);
      if (typeof out.correct === 'string') out.correct = L.indexOf(out.correct.trim().toUpperCase());
      if (!(out.correct >= 0 && out.correct < out.choices.length)) throw new Error(`Question ${i + 1} has no valid "correct" answer.`);
      out.explain = out.explain || { rule: out.explanation || '', application: '', takeaway: '' };
      out.notes = notesOf(out);
    } else {
      out.rubric = out.rubric || { issues: [], keyTerms: [], model: '' };
    }
    out.source = out.source || { outline: pack.title, heading: topic };
    return out;
  });
  const sections = topics.map((t, i) => ({ id: id + '_t' + i, heading: t, level: 1, text: '' }));
  qs.forEach(q => { q.topicId = sections.find(s => s.heading === q.topic).id; });
  return { id, kind: 'pack', title: pack.title || 'Question bank', note: pack.note || '', builtIn: !!extra.builtIn, course: extra.course || '', sections, questions: qs, createdAt: Date.now() };
}

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim().toLowerCase());
  const col = (r, n) => { const i = head.indexOf(n); return i >= 0 ? (r[i] || '').trim() : ''; };
  const questions = rows.filter(r => r.some(c => c.trim())).map((r, i) => {
    const choices = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => col(r, x)).filter(Boolean);
    return {
      id: 'csv' + i, type: 'mc', topic: col(r, 'topic') || 'General', hypothetical: true,
      facts: col(r, 'facts') ? col(r, 'facts').split(';').map(f => { const m = f.trim().match(/^(.*?)\s*(\$[\d,]+(?:\.\d+)?|\d+%?)$/); return m ? [m[1], m[2]] : [f.trim(), '']; }) : [],
      assumption: col(r, 'assumption'), prompt: col(r, 'question'), choices, correct: col(r, 'correct'),
      explain: { rule: col(r, 'rule') || col(r, 'explanation'), application: col(r, 'application'), takeaway: col(r, 'takeaway') },
      whyWrong: ['whya', 'whyb', 'whyc', 'whyd', 'whye', 'whyf'].slice(0, choices.length).map(x => col(r, x) || null),
      source: { outline: 'CSV quiz', heading: col(r, 'source_heading') || col(r, 'topic'), page: col(r, 'source_page') }
    };
  });
  return { format: 'lsep-pack-1', title: 'CSV quiz', questions };
}

// Read any supported file into either an outline or a question bank (not yet saved).
async function readUpload(f) {
  const lower = f.name.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.csv')) {
    const text = await f.text();
    const pack = lower.endsWith('.csv') ? parseCSV(text) : JSON.parse(text);
    if (lower.endsWith('.csv')) pack.title = f.name.replace(/\.csv$/i, '');
    const src = packToSource(pack);
    return { src, summary: `${src.questions.length} questions with answers across ${src.sections.length} topics` };
  }
  const parsed = await parseOutline(f);
  const chars = parsed.sections.reduce((n, s) => n + (s.text || '').length, 0);
  if (chars < 200) throw new Error('This file has almost no readable text. If it is a scanned PDF (pictures of pages), it can\'t be read.');
  return {
    src: { id: uid('out_'), kind: 'outline', title: parsed.title, sections: parsed.sections, createdAt: Date.now() },
    summary: parsed.headingCount ? `${parsed.headingCount} headings, ${Math.round(chars / 1000)}k characters of text` : `No headings found, so it will be one topic (${Math.round(chars / 1000)}k characters)`
  };
}

// ---------------- stats & lists ----------------
function record(q, correct) {
  const key = topicKey(q.sourceId, q.topic);
  const s = stats[key] || { label: q.topic, sourceId: q.sourceId, attempts: 0, correct: 0 };
  s.attempts++; if (correct) s.correct++; s.last = Date.now();
  stats[key] = s; save(K.stats, stats);
  if (!correct) { lists.review[q.id] = q; save(K.lists, lists); }
}
function toggleList(name, q) {
  if (lists[name][q.id]) delete lists[name][q.id]; else lists[name][q.id] = q;
  save(K.lists, lists);
  return !!lists[name][q.id];
}

// ---------------- building practice ----------------
function descendants(source, ids) {
  const set = new Set(ids);
  let grew = true;
  while (grew) { grew = false; source.sections.forEach(s => { if (s.parent && set.has(s.parent) && !set.has(s.id)) { set.add(s.id); grew = true; } }); }
  return source.sections.filter(s => set.has(s.id));
}
function sectionsFor(plan) {
  const out = [];
  (plan.sourceIds || []).forEach(id => {
    const src = getSource(id);
    if (!src || src.kind !== 'outline') return;
    const secs = plan.topicId && plan.topicId !== 'mix' && plan.topicId.startsWith(id + '|')
      ? descendants(src, [plan.topicId.slice(id.length + 1)])
      : (plan.topicId && plan.topicId !== 'mix' ? [] : src.sections);
    secs.forEach(s => out.push({ ...s, sourceId: src.id, sourceTitle: src.title, course: src.course }));
  });
  if (plan.topicId && plan.topicId !== 'mix' && out.length > 1) {
    // One topic: give the AI the heading with all its subsections as one passage.
    const head = out[0];
    return [{ ...head, text: out.map(s => (s === head ? '' : s.heading + ': ') + (s.text || '')).join('\n').trim() }];
  }
  return plan.topicId === 'mix' || !plan.topicId ? shuffle(out) : out;
}
function interleave(main, other) {
  const out = []; let i = 0, j = 0;
  const every = other.length ? Math.max(1, Math.floor((main.length + other.length) / other.length)) : 0;
  while (i < main.length || j < other.length) {
    if (j < other.length && (i >= main.length || (out.length + 1) % every === 0)) out.push(other[j++]);
    else out.push(main[i++]);
  }
  return out;
}

// plan: { course, mode: 'mc'|'basis'|'essay'|'mixed'|'pack', sourceIds, topicId ('mix' or 'sourceId|sectionId'), basisTopic, count, packMode }
async function buildPlan(plan, onStatus = () => {}) {
  const count = plan.count || 5;
  const notes = [];
  let queue = [];
  if (plan.mode === 'pack') {
    const src = getSource(plan.sourceIds[0]);
    if (!src) throw new Error('That question bank was removed.');
    const ids = plan.topicIds && plan.topicIds.length ? new Set(plan.topicIds) : null;
    const pool = src.questions.filter(q => !ids || ids.has(q.topicId));
    const pm = plan.packMode || 'mc';
    const mc = shuffle(pool.filter(q => q.type === 'mc')), es = shuffle(pool.filter(q => q.type === 'essay'));
    queue = pm === 'mc' ? mc.slice(0, count) : pm === 'essay' ? es.slice(0, count) : interleave(mc.slice(0, Math.ceil(count * 0.7)), es.slice(0, Math.floor(count * 0.3))).slice(0, count);
    if (queue.length < count) notes.push(queue.length ? `This bank has ${queue.length} matching questions, so this set has ${queue.length}.` : 'This bank has no matching questions.');
    return { queue, notes };
  }
  if (plan.mode === 'basis') {
    queue = drillQueue(plan.basisTopic && plan.basisTopic !== 'mix' ? [plan.basisTopic] : [], count);
    return { queue, notes };
  }
  if (!aiReady()) throw new Error('Multiple Choice, Short Essay and Mixed Practice are written by AI. Turn on AI mode and add your API key in Settings. Basis Math works without it.');
  const secs = sectionsFor(plan);
  const usable = secs.filter(s => (s.text || '').replace(/\s/g, '').length >= 250);
  if (!usable.length) throw new Error('The selected outline text is too thin to write reliable questions from. Pick “Mix topics,” a fuller heading, or another outline.');
  const focus = plan.topicId && plan.topicId !== 'mix' ? usable[0].heading : '';
  let nBasis = 0, nEssay = 0, nMC = count;
  if (plan.mode === 'essay') { nEssay = count; nMC = 0; }
  if (plan.mode === 'mixed') {
    const pt = (plan.sourceIds || []).some(id => (getSource(id) || {}).course === 'Partnership Tax') || plan.course === 'Partnership Tax';
    nBasis = pt ? Math.max(1, Math.round(count * 0.3)) : 0;
    nEssay = Math.max(1, Math.round(count * 0.2));
    nMC = count - nBasis - nEssay;
  }
  const jobs = [];
  if (nMC) { onStatus(`Writing ${nMC} multiple-choice question${nMC > 1 ? 's' : ''}…`); jobs.push(aiMultipleChoice(settings, usable, nMC, focus)); } else jobs.push(Promise.resolve({ questions: [], skipped: [] }));
  const essayJobs = [];
  const essaySecs = usable.filter(s => s.text.replace(/\s/g, '').length >= 400);
  for (let k = 0; k < nEssay; k++) {
    if (!essaySecs.length) break;
    essayJobs.push(aiEssayPrompt(settings, essaySecs[k % essaySecs.length]));
  }
  if (nEssay && !essaySecs.length) notes.push('No section was long enough for a reliable essay question, so essays were skipped.');
  const [mcR, ...esR] = await Promise.allSettled([jobs[0], ...essayJobs]);
  if (mcR.status === 'rejected' && !esR.some(r => r.status === 'fulfilled')) throw mcR.reason;
  const mc = mcR.status === 'fulfilled' ? mcR.value.questions : [];
  if (mcR.status === 'fulfilled') notes.push(...mcR.value.skipped);
  else notes.push('Multiple-choice questions couldn\'t be written: ' + mcR.reason.message);
  const essays = esR.filter(r => r.status === 'fulfilled').map(r => r.value);
  const esFail = esR.filter(r => r.status === 'rejected');
  if (esFail.length) notes.push(`${esFail.length} essay question${esFail.length > 1 ? 's were' : ' was'} skipped: ${esFail[0].reason.message}`);
  const basis = nBasis ? drillQueue([], nBasis) : [];
  queue = interleave(interleave(mc, basis), essays);
  if (queue.length < count) notes.unshift(`Your material supported ${queue.length} reliable question${queue.length === 1 ? '' : 's'}, so this set has ${queue.length}.`);
  return { queue, notes };
}

function planTitle(plan) {
  const modeName = { mc: 'Multiple Choice', basis: 'Basis Math', essay: 'Short Essay', mixed: 'Mixed Practice', pack: 'Existing Questions' }[plan.mode];
  if (plan.mode === 'basis') {
    const t = plan.basisTopic && plan.basisTopic !== 'mix' ? DRILL_TOPICS.find(x => x.key === plan.basisTopic) : null;
    return `Basis Math · ${t ? t.title : 'Mix topics'}`;
  }
  const names = (plan.sourceIds || []).map(id => (getSource(id) || {}).title).filter(Boolean);
  let topic = 'Mix topics';
  if (plan.topicId && plan.topicId !== 'mix') {
    const [sid, secId] = plan.topicId.split('|');
    const sec = (getSource(sid) || { sections: [] }).sections.find(s => s.id === secId);
    if (sec) topic = sec.heading;
  }
  return `${modeName} · ${names.length > 1 ? names.length + ' outlines' : names[0] || plan.course} · ${topic}`;
}

async function runPlan(plan, onStatus) {
  const { queue, notes } = await buildPlan(plan, onStatus);
  if (!queue.length) throw new Error(notes.join(' ') || 'Nothing to practice for that choice.');
  settings.lastCourse = plan.course; settings.lastPlan = { ...(settings.lastPlan || {}), [plan.course]: { ...plan } }; saveSettings();
  let setId = null;
  if (plan.mode !== 'pack') {
    setId = uid('set_');
    const rec = { id: setId, title: planTitle(plan), course: plan.course, mode: plan.mode, createdAt: Date.now(), questions: queue };
    try { await setPut(rec); sets.unshift(rec); } catch (e) { notes.push('This set couldn\'t be saved for replay (storage full).'); setId = null; }
  }
  startSession(queue, { title: planTitle(plan), course: plan.course, sourceId: (plan.sourceIds || [])[0] || DRILL_ID, mode: plan.mode, timer: plan.timer || 0, notes, setId });
}

function startSession(queue, meta) {
  session = { id: uid('ses_'), ...meta, queue: queue.map(shuffleChoices), idx: 0, answers: [], status: 'active', startedAt: Date.now() };
  save(K.session, session);
  go('question');
}

async function quick5() {
  const course = settings.lastCourse || 'Partnership Tax';
  let plan = settings.lastPlan && settings.lastPlan[course] ? { ...settings.lastPlan[course], count: 5 } : null;
  if (!plan) {
    const bank = sources.find(s => s.course === course && s.kind === 'pack');
    const outs = sources.filter(s => s.course === course && s.kind === 'outline');
    if (course === 'Partnership Tax' && !(outs.length && aiReady())) plan = { course, mode: 'basis', basisTopic: 'mix', count: 5 };
    else if (outs.length && aiReady()) plan = { course, mode: 'mc', sourceIds: outs.map(s => s.id), topicId: 'mix', count: 5 };
    else if (bank) plan = { course, mode: 'pack', sourceIds: [bank.id], packMode: 'mc', count: 5 };
    else plan = { course: 'Partnership Tax', mode: 'basis', basisTopic: 'mix', count: 5 };
  }
  const st = document.getElementById('home-status');
  const btn = document.getElementById('quick5');
  if (btn) { btn.disabled = true; btn.textContent = 'Getting 5 questions…'; }
  try { await runPlan(plan, m => { if (btn) btn.textContent = m; }); }
  catch (err) {
    if (plan.mode !== 'basis' && course === 'Partnership Tax') {
      toast('AI questions unavailable, so here are 5 Basis Math problems.');
      return runPlan({ course, mode: 'basis', basisTopic: 'mix', count: 5 });
    }
    if (st) st.innerHTML = `<div class="card bad"><p><b>Quick 5 didn't start.</b> ${esc(err.message)}</p></div>`;
    if (btn) { btn.disabled = false; btn.textContent = `Quick 5 · ${course}`; }
  }
}

// ---------------- screens ----------------
function render() {
  if (!ready) { app.innerHTML = '<div class="screen"><p class="muted">Opening your Memory Bank…</p></div>'; return; }
  const r = { home, upload, item, generate, topics, setup, question, summary, review, settingsScreen, viewq, practiceSets, setView }[view.name] || home;
  app.innerHTML = `<div class="screen">${r(view.params)}</div>`;
  bind[view.name] && bind[view.name](view.params);
}
const bind = {};

function home() {
  const active = session && session.status !== 'done' && session.queue && session.idx < session.queue.length;
  const course = settings.lastCourse || 'Partnership Tax';
  const allCourses = [...new Set([...courses, ...sources.map(s => s.course)])];
  const itemCard = s => {
    const meta = s.kind === 'pack' ? `Question bank · ${s.questions.length} questions with answers` : `Outline · ${s.sections.length} headings`;
    return `<div class="item">
      <button class="item-open" data-open="${esc(s.id)}"><span class="t-title">${esc(s.title)}</span><span class="t-meta">${meta}${s.builtIn ? ' · starter' : ''}</span></button>
      <div class="item-actions">
        ${s.kind === 'outline' ? `<button class="btn primary sm" data-gen="${esc(s.id)}">Generate Practice</button>` : `<button class="btn primary sm" data-bank="${esc(s.id)}">Practice Existing Questions</button>`}
        <button class="btn sm" data-open="${esc(s.id)}">Open</button>
      </div></div>`;
  };
  const groups = allCourses.map(c => {
    const items = sources.filter(s => s.course === c);
    const basis = c === 'Partnership Tax' ? `<div class="item builtin">
        <button class="item-open" data-basis="1"><span class="t-title">Basis Math</span><span class="t-meta">Built in · outside &amp; inside basis, capital accounts, debt, § 704(d), distributions · works offline</span></button>
        <div class="item-actions"><button class="btn primary sm" data-basis="1">Practice Basis Math</button></div></div>` : '';
    if (!items.length && !basis && !DEFAULT_COURSES.includes(c)) return '';
    return `<section class="course"><h2 class="course-head">${esc(c)}</h2>${basis}${items.map(itemCard).join('') || (basis ? '' : '<p class="small muted">Nothing saved here yet.</p>')}</section>`;
  }).join('');
  return `
    <h1>Ready to practice?</h1>
    ${active ? `<div class="card gold"><h2>Pick up where you left off</h2><p class="muted">${esc(session.title)} · question ${session.idx + 1} of ${session.queue.length}</p><button class="btn primary" id="resume">Continue</button><button class="btn ghost" id="discard">End it and see results</button></div>` : ''}
    <button class="btn primary big" id="quick5">Quick 5 · ${esc(course)}</button>
    <div id="home-status" role="status" aria-live="polite"></div>
    <div class="row"><button class="btn" data-go="practiceSets">Saved sets (${sets.length})</button><button class="btn" data-go="review">Review</button></div>
    <h2 style="margin-top:14px">Memory Bank</h2>
    ${groups}
    ${dock(`<button class="btn primary" data-go="upload">Add to Memory Bank</button>`)}
  `;
}
bind.home = () => {
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('item', { id: b.dataset.open }));
  app.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => go('generate', { sourceIds: [b.dataset.gen] }));
  app.querySelectorAll('[data-bank]').forEach(b => b.onclick = () => go('topics', { sourceId: b.dataset.bank }));
  app.querySelectorAll('[data-basis]').forEach(b => b.onclick = () => go('generate', { mode: 'basis', course: 'Partnership Tax' }));
  document.getElementById('quick5').onclick = quick5;
  const r = document.getElementById('resume'); if (r) r.onclick = () => { session.status = 'active'; save(K.session, session); go('question'); };
  const d = document.getElementById('discard'); if (d) d.onclick = () => finishSession();
};

// ---------- Add to Memory Bank (also used to replace a saved file) ----------
let pendingUpload = null;
function upload({ replaceId } = {}) {
  const rep = replaceId && getSource(replaceId);
  return `
    <h1>${rep ? 'Replace file' : 'Add to Memory Bank'}</h1>
    ${rep ? `<p class="muted">Replacing “${esc(rep.title)}.” Its course and title stay unless you change them.</p>` : ''}
    <div class="card">
      <p>Outline: PDF, Word (.docx), Markdown (.md) or text.<br>Question bank with an answer key: .json or .csv.</p>
      <label class="btn" for="file" style="cursor:pointer">Choose a file</label>
      <input id="file" type="file" accept=".pdf,.docx,.md,.markdown,.txt,.json,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json,text/csv" hidden>
      <p class="small muted">Everything stays on this phone. Scanned PDFs (pictures of pages) have no text to read. Question bank templates: <a href="packs/template.json" download>template.json</a> · <a href="packs/template.csv" download>template.csv</a></p>
    </div>
    <div id="upload-status" role="status" aria-live="polite"></div>
    <div id="save-form"></div>
    ${dock(`<button class="btn primary" id="save-mb" disabled>${rep ? 'Replace file' : 'Save to Memory Bank'}</button><button class="btn ghost" id="cancel">Cancel</button>`)}
  `;
}
bind.upload = ({ replaceId } = {}) => {
  pendingUpload = null;
  const rep = replaceId && getSource(replaceId);
  const status = document.getElementById('upload-status');
  const form = document.getElementById('save-form');
  const saveBtn = document.getElementById('save-mb');
  document.getElementById('cancel').onclick = () => go(rep ? 'item' : 'home', rep ? { id: rep.id } : {});
  document.getElementById('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    status.innerHTML = `<div class="card info"><p>Reading “${esc(f.name)}”…</p></div>`; form.innerHTML = ''; saveBtn.disabled = true;
    try {
      const { src, summary } = await readUpload(f);
      if (rep && rep.kind !== src.kind) throw new Error(rep.kind === 'pack' ? 'This saved item is a question bank. Pick a .json or .csv file to replace it.' : 'This saved item is an outline. Pick a PDF, Word or Markdown file to replace it.');
      pendingUpload = { src, file: f };
      const course = rep ? rep.course : (settings.lastCourse || courses[0]);
      status.innerHTML = `<div class="card ok"><p><b>Read “${esc(f.name)}.”</b> ${esc(summary)}.</p></div>`;
      form.innerHTML = `<div class="card">
        <label class="field" for="mb-course">Course</label>
        <select id="mb-course">${courseOptions(course)}</select>
        <input id="mb-newcourse" type="text" placeholder="New course name" hidden>
        <label class="field" for="mb-title">Title</label>
        <input id="mb-title" type="text" value="${esc(rep ? rep.title : src.title)}">
      </div>`;
      const sel = document.getElementById('mb-course'), nc = document.getElementById('mb-newcourse');
      sel.onchange = () => { nc.hidden = sel.value !== '__new'; if (!nc.hidden) nc.focus(); };
      saveBtn.disabled = false;
    } catch (err) { status.innerHTML = `<div class="card bad"><p><b>Couldn't read that file.</b></p><p>${esc(err.message)}</p></div>`; }
  };
  saveBtn.onclick = async () => {
    if (!pendingUpload) return;
    const sel = document.getElementById('mb-course');
    const course = sel.value === '__new' ? addCourse(document.getElementById('mb-newcourse').value) : sel.value;
    if (!course) { toast('Type a name for the new course.'); return; }
    const title = document.getElementById('mb-title').value.trim() || pendingUpload.src.title;
    const { src, file } = pendingUpload;
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    let rec;
    if (rep) {
      rec = { ...rep, title, course, sections: src.sections, updatedAt: Date.now(), fileName: file.name, fileType: file.type, size: file.size };
      if (src.kind === 'pack') { rec.questions = src.questions.map(q => ({ ...q, sourceId: rep.id, id: q.id.replace(src.id, rep.id), topicId: q.topicId.replace(src.id, rep.id) })); rec.sections = src.sections.map(s => ({ ...s, id: s.id.replace(src.id, rep.id) })); }
      sources = sources.map(s => s.id === rep.id ? rec : s);
    } else {
      rec = { ...src, title, course, fileName: file.name, fileType: file.type, size: file.size, createdAt: Date.now() };
      sources.push(rec);
    }
    const ok = await saveSources();
    if (!ok) { if (!rep) sources.pop(); saveBtn.disabled = false; saveBtn.textContent = 'Save to Memory Bank'; return; }
    try { await fileSet(rec.id, { blob: file, name: file.name, type: file.type, savedAt: Date.now() }); }
    catch (e) { toast('Saved the text, but the original file was too large to keep.'); }
    settings.lastCourse = course; saveSettings();
    pendingUpload = null;
    toast(rep ? 'File replaced' : `Saved to ${course}`);
    go(rep ? 'item' : 'home', rep ? { id: rec.id } : {});
  };
};

// ---------- a saved item ----------
function item({ id }) {
  const s = getSource(id);
  if (!s) return `<p>That item was removed.</p>${dock('<button class="btn" data-go="home">Home</button>')}`;
  const text = s.kind === 'outline'
    ? s.sections.map(sec => `<details class="txt"><summary>${esc(sec.heading)}${sec.page ? ` <span class="muted small">p. ${sec.page}</span>` : ''}</summary><p class="small" style="white-space:pre-wrap">${esc(sec.text || '(heading only)')}</p></details>`).join('')
    : s.sections.map(sec => `<p class="small">${esc(sec.heading)} <span class="muted">· ${s.questions.filter(q => q.topicId === sec.id).length} questions</span></p>`).join('');
  return `
    <span class="tag">${esc(s.course)}</span><span class="tag src">${s.kind === 'pack' ? 'Question bank' : 'Outline'}</span>
    <h1>${esc(s.title)}</h1>
    <p class="small muted">${s.fileName ? esc(s.fileName) + ' · ' : ''}${s.size ? sizeStr(s.size) + ' · ' : ''}saved ${dateStr(s.updatedAt || s.createdAt || Date.now())}</p>
    ${s.kind === 'outline' ? `<button class="btn primary" id="gen">Generate Practice</button>` : `<button class="btn primary" id="bank">Practice Existing Questions</button>`}
    <div id="orig"></div>
    <div class="card"><h2>${s.kind === 'outline' ? 'Readable text' : 'Topics'}</h2>${text}</div>
    <div class="card">
      <label class="field" for="rn">Title</label>
      <input id="rn" type="text" value="${esc(s.title)}">
      <label class="field" for="mv">Course</label>
      <select id="mv">${courseOptions(s.course)}</select>
      <input id="mv-new" type="text" placeholder="New course name" hidden>
      <button class="btn" id="save-meta">Save title and course</button>
      <button class="btn" id="replace">Replace file</button>
      <button class="btn danger" id="del">Delete from Memory Bank</button>
    </div>
    ${dock(`<button class="btn ghost" data-go="home">Back</button>`)}
  `;
}
bind.item = ({ id }) => {
  const s = getSource(id); if (!s) return;
  const g = document.getElementById('gen'); if (g) g.onclick = () => go('generate', { sourceIds: [id] });
  const b = document.getElementById('bank'); if (b) b.onclick = () => go('topics', { sourceId: id });
  fileGet(id).then(f => {
    if (!f || !f.blob || !document.getElementById('orig')) return;
    const url = URL.createObjectURL(f.blob);
    document.getElementById('orig').innerHTML = `<a class="btn" href="${url}" target="_blank" rel="noopener" download="${esc(f.name)}">Open original file</a>`;
  }).catch(() => {});
  const mv = document.getElementById('mv'), mvn = document.getElementById('mv-new');
  mv.onchange = () => { mvn.hidden = mv.value !== '__new'; };
  document.getElementById('save-meta').onclick = async () => {
    const course = mv.value === '__new' ? addCourse(mvn.value) : mv.value;
    if (!course) { toast('Type a name for the new course.'); return; }
    s.title = document.getElementById('rn').value.trim() || s.title; s.course = course; s.updatedAt = Date.now();
    await saveSources(); toast('Saved'); go('item', { id });
  };
  document.getElementById('replace').onclick = () => go('upload', { replaceId: id });
  document.getElementById('del').onclick = async () => {
    if (!confirm(`Delete “${s.title}” from the Memory Bank? Saved practice sets and your scores stay.`)) return;
    sources = sources.filter(x => x.id !== id); await saveSources();
    fileDel(id).catch(() => {});
    toast('Deleted'); go('home');
  };
};

// ---------- Generate Practice ----------
function generate({ sourceIds = [], mode, course } = {}) {
  const outlines = sources.filter(s => s.kind === 'outline');
  const pre = new Set(sourceIds);
  const st = { mode: mode || (aiReady() ? 'mc' : 'basis') };
  const byCourse = [...new Set(outlines.map(s => s.course))].map(c => `<p class="small muted" style="margin:10px 0 4px">${esc(c)}</p>` + outlines.filter(s => s.course === c).map(s =>
    `<button class="topic" data-src="${esc(s.id)}" aria-pressed="${pre.has(s.id)}"><span class="check" aria-hidden="true">✓</span><span class="t-main"><span class="t-title">${esc(s.title)}</span><span class="t-meta">${s.sections.length} headings</span></span></button>`).join('')).join('');
  return `
    <h1>Generate Practice</h1>
    <div class="card">
      <h2>Mode</h2>
      <div class="seg" id="mode" role="group" aria-label="Mode">
        ${[['mc', 'Multiple Choice'], ['basis', 'Basis Math'], ['essay', 'Short Essay'], ['mixed', 'Mixed Practice']].map(([v, l]) => `<button data-v="${v}" aria-pressed="${st.mode === v}">${l}</button>`).join('')}
      </div>
      <p class="small muted" id="mode-help"></p>
      <h2>How many?</h2>
      <div class="seg" id="count" role="group" aria-label="Number of questions">${[5, 10, 15].map(n => `<button data-v="${n}" aria-pressed="${n === 5}">${n}</button>`).join('')}</div>
    </div>
    <div class="card" id="src-card">
      <h2>Outlines</h2>
      ${outlines.length ? byCourse : '<p class="muted">No outlines saved yet. Add one to the Memory Bank first.</p>'}
    </div>
    <div class="card">
      <h2>Topic</h2>
      <div id="topic-list"></div>
    </div>
    <div id="gen-status" role="status" aria-live="polite"></div>
    ${dock(`<button class="btn primary" id="start">Start</button><button class="btn ghost" data-go="home">Back</button>`)}
  `;
}
bind.generate = ({ sourceIds = [], mode, course } = {}) => {
  const st = { mode: mode || (aiReady() ? 'mc' : 'basis'), count: 5, picked: new Set(sourceIds), topic: 'mix', basisTopic: 'mix' };
  if (!st.picked.size && st.mode !== 'basis') { const last = sources.find(s => s.kind === 'outline' && s.course === (course || settings.lastCourse)); if (last) st.picked.add(last.id); }
  app.querySelectorAll('[data-src]').forEach(b => b.setAttribute('aria-pressed', st.picked.has(b.dataset.src)));
  const help = {
    mc: 'Four choices, one best answer, a full explanation for every choice. Written by AI from your outline; needs AI mode.',
    basis: 'Partnership tax calculations with fresh numbers, easiest first. Works offline; no AI needed.',
    essay: 'A short fact pattern with a model answer and a scoring checklist. Written by AI; needs AI mode.',
    mixed: 'Multiple choice and a short essay, plus Basis Math for Partnership Tax outlines. Needs AI mode.'
  };
  const topicList = () => {
    const el = document.getElementById('topic-list');
    document.getElementById('src-card').hidden = st.mode === 'basis';
    document.getElementById('mode-help').textContent = help[st.mode] + (st.mode !== 'basis' && !aiReady() ? ' AI mode is off: turn it on in Settings.' : '');
    let opts;
    if (st.mode === 'basis') opts = [['mix', 'Mix topics (easy to hard)']].concat(DRILL_TOPICS.map(t => [t.key, `${t.title}`, ['', 'One step', 'A few steps', 'Multistep'][t.level]]));
    else {
      opts = [['mix', 'Mix topics']];
      [...st.picked].forEach(id => { const s = getSource(id); if (s) s.sections.forEach(sec => opts.push([`${id}|${sec.id}`, sec.heading, (st.picked.size > 1 ? s.title + ' · ' : '') + (sec.text.length < 250 && !s.sections.some(c => c.parent === sec.id) ? 'light on text' : `level ${sec.level || 1}`), sec.level || 1])); });
    }
    const cur = st.mode === 'basis' ? st.basisTopic : st.topic;
    el.innerHTML = opts.map(([v, l, meta, lvl]) => `<button class="topic${lvl > 1 ? ' lvl-' + lvl : ''}" data-topic="${esc(v)}" aria-pressed="${v === cur}"><span class="check" aria-hidden="true">✓</span><span class="t-main"><span class="t-title">${esc(l)}</span>${meta ? `<span class="t-meta">${esc(meta)}</span>` : ''}</span></button>`).join('');
    el.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
      if (st.mode === 'basis') st.basisTopic = b.dataset.topic; else st.topic = b.dataset.topic;
      el.querySelectorAll('[data-topic]').forEach(x => x.setAttribute('aria-pressed', x === b));
    });
  };
  const seg = (id, key, after) => document.getElementById(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b));
    after && after();
  });
  seg('mode', 'mode', topicList); seg('count', 'count');
  app.querySelectorAll('[data-src]').forEach(b => b.onclick = () => {
    const id = b.dataset.src; st.picked.has(id) ? st.picked.delete(id) : st.picked.add(id);
    b.setAttribute('aria-pressed', st.picked.has(id));
    if (st.topic !== 'mix' && !st.picked.has(st.topic.split('|')[0])) st.topic = 'mix';
    topicList();
  });
  topicList();
  document.getElementById('start').onclick = async () => {
    const status = document.getElementById('gen-status');
    const btn = document.getElementById('start');
    if (st.mode !== 'basis' && !st.picked.size) { status.innerHTML = '<div class="card info"><p>Pick at least one outline.</p></div>'; return; }
    const ids = [...st.picked];
    const crs = st.mode === 'basis' ? 'Partnership Tax' : (getSource(ids[0]) || {}).course || 'Partnership Tax';
    const plan = { course: crs, mode: st.mode, sourceIds: st.mode === 'basis' ? [] : ids, topicId: st.topic, basisTopic: st.basisTopic, count: st.count };
    btn.disabled = true; btn.textContent = st.mode === 'basis' ? 'Building…' : 'Writing questions… (about 20–60 seconds)';
    try { await runPlan(plan, m => { btn.textContent = m; }); }
    catch (err) {
      status.innerHTML = `<div class="card bad"><p><b>That didn't work.</b> ${esc(err.message)}</p></div>`;
      btn.disabled = false; btn.textContent = 'Start';
    }
  };
};

// ---------- question banks: pick topics, then practice ----------
function topics({ sourceId }) {
  const s = getSource(sourceId);
  if (!s) return `<p>That item was removed.</p>${dock('<button class="btn" data-go="home">Home</button>')}`;
  const counts = {};
  s.questions.forEach(q => { counts[q.topicId] = counts[q.topicId] || { mc: 0, essay: 0 }; counts[q.topicId][q.type]++; });
  const rows = s.sections.map(sec => {
    const st = stats[topicKey(s.id, sec.heading)];
    const acc = st ? `${pct(st.correct, st.attempts)}% of ${st.attempts}` : 'Not practiced yet';
    return `<button class="topic" data-topic="${esc(sec.id)}" aria-pressed="false"><span class="check" aria-hidden="true">✓</span><span class="t-main"><span class="t-title">${esc(sec.heading)}</span><span class="t-meta">${counts[sec.id]?.mc || 0} MC · ${counts[sec.id]?.essay || 0} written · ${esc(acc)}</span></span></button>`;
  }).join('');
  return `
    <h1>${esc(s.title)}</h1>
    ${s.note ? `<p class="small muted">${esc(s.note)}</p>` : ''}
    <p class="muted">Practice the questions in this bank with its own answer key. Pick topics, or none for all.</p>
    <div class="row" style="margin-bottom:10px"><button class="btn" id="all">Select all</button><button class="btn" id="none">Clear</button></div>
    ${rows}
    ${dock(`<button class="btn primary" id="next">Practice all topics</button><button class="btn ghost" data-go="home">Back</button>`)}
  `;
}
bind.topics = ({ sourceId }) => {
  const picked = new Set();
  const next = document.getElementById('next');
  if (!next) return;
  const upd = () => { next.textContent = picked.size ? `Practice ${picked.size} topic${picked.size > 1 ? 's' : ''}` : 'Practice all topics'; };
  app.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
    const id = b.dataset.topic; picked.has(id) ? picked.delete(id) : picked.add(id);
    b.setAttribute('aria-pressed', picked.has(id)); upd();
  });
  document.getElementById('all').onclick = () => { app.querySelectorAll('[data-topic]').forEach(b => { picked.add(b.dataset.topic); b.setAttribute('aria-pressed', 'true'); }); upd(); };
  document.getElementById('none').onclick = () => { picked.clear(); app.querySelectorAll('[data-topic]').forEach(b => b.setAttribute('aria-pressed', 'false')); upd(); };
  next.onclick = () => go('setup', { sourceId, topicIds: [...picked] });
};

function setup({ sourceId, topicIds }) {
  const s = getSource(sourceId);
  return `
    <h1>Practice Existing Questions</h1>
    <p class="muted">${esc(s.title)} · ${topicIds.length ? topicIds.length + ' topic' + (topicIds.length > 1 ? 's' : '') : 'all topics'}</p>
    <div class="card">
      <h2>Type</h2>
      <div class="seg" id="mode" role="group" aria-label="Session type">
        <button data-v="mc" aria-pressed="true">Multiple Choice</button><button data-v="essay" aria-pressed="false">Essay</button><button data-v="mixed" aria-pressed="false">Mixed</button>
      </div>
      <h2>How many?</h2>
      <div class="seg" id="count" role="group" aria-label="Number of questions">${[5, 10, 15].map(n => `<button data-v="${n}" aria-pressed="${n === 5}">${n}</button>`).join('')}</div>
      <div id="timer-wrap" hidden>
        <h2>Timer per essay</h2>
        <div class="seg" id="timer" role="group" aria-label="Timer">
          <button data-v="0" aria-pressed="true">Off</button><button data-v="5" aria-pressed="false">5 min</button><button data-v="10" aria-pressed="false">10 min</button><button data-v="15" aria-pressed="false">15 min</button>
        </div>
      </div>
    </div>
    <div id="setup-status" role="status" aria-live="polite"></div>
    ${dock(`<button class="btn primary" id="go">Start</button><button class="btn ghost" data-back>Back</button>`)}
  `;
}
bind.setup = ({ sourceId, topicIds }) => {
  const s = getSource(sourceId);
  const state = { mode: 'mc', count: 5, timer: 0 };
  const seg = (id, key, after) => document.getElementById(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b));
    after && after();
  });
  seg('mode', 'mode', () => { document.getElementById('timer-wrap').hidden = state.mode === 'mc'; }); seg('count', 'count'); seg('timer', 'timer');
  app.querySelector('[data-back]').onclick = () => go('topics', { sourceId });
  document.getElementById('go').onclick = async () => {
    const plan = { course: s.course, mode: 'pack', packMode: state.mode, sourceIds: [sourceId], topicIds, count: state.count, timer: state.timer };
    try { await runPlan(plan); }
    catch (err) { document.getElementById('setup-status').innerHTML = `<div class="card info"><p>${esc(err.message)}</p></div>`; }
  };
};

// ---------- question screen ----------
function toolsBar(q) {
  return `<div class="tools">
    ${canSpeak() ? `<button class="tool" id="t-read" aria-pressed="false">🔊 Read aloud</button>` : ''}
    <button class="tool" id="t-flag" aria-pressed="${!!lists.flagged[q.id]}">⚑ Flag</button>
    <button class="tool" id="t-review" aria-pressed="${!!lists.review[q.id]}">↻ Save for Review</button>
  </div>`;
}
function bindTools(q, readText) {
  const t = id => document.getElementById(id);
  if (t('t-read')) t('t-read').onclick = e => {
    const b = e.currentTarget;
    if (b.getAttribute('aria-pressed') === 'true') { stopSpeaking(); b.setAttribute('aria-pressed', 'false'); b.textContent = '🔊 Read aloud'; return; }
    b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop';
    speak(readText(), () => { b.setAttribute('aria-pressed', 'false'); b.textContent = '🔊 Read aloud'; });
  };
  [['t-flag', 'flagged', 'Flagged', 'Unflagged'], ['t-review', 'review', 'Saved for Review', 'Removed from Review']].forEach(([id, list, on, off]) => {
    if (t(id)) t(id).onclick = e => { const v = toggleList(list, q); e.currentTarget.setAttribute('aria-pressed', v); syncReviewButtons(v); toast(v ? on : off); };
  });
}
function syncReviewButtons(v) {
  ['t-review', 'fb-review'].forEach(id => { const b = document.getElementById(id); if (b) { b.setAttribute('aria-pressed', v); if (id === 'fb-review') b.textContent = v ? '✓ Saved for Review' : 'Save for Review'; } });
}

function mcBody(q) {
  const facts = q.facts && q.facts.length ? `<table class="facts">${q.facts.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] ?? '')}</td></tr>`).join('')}</table>` : '';
  const cloze = q.cloze ? `<p style="font-size:1.05em">“${esc(q.cloze.before)}<span class="blank" aria-label="blank"></span>${esc(q.cloze.after)}”</p>` : '';
  return `
    ${q.ask ? `<p class="asks">Asks for: <b>${esc(q.ask)}</b></p>` : ''}
    ${facts}
    ${q.assumption ? `<p class="small muted">${esc(q.assumption)}</p>` : ''}
    <p style="font-weight:700;font-size:1.08em">${esc(q.prompt)}</p>
    ${cloze}
    ${q.work ? '<div id="work"></div>' : ''}
    <div id="choices">${q.choices.map((c, i) => `<button class="choice" data-i="${i}"><span class="choice-inner"><span class="letter">${L[i]}</span><span>${esc(c)}</span></span></button>`).join('')}</div>
    <div id="feedback" tabindex="-1"></div>`;
}

function ruleHTML(text) { return esc(text).replace(/\[\[(.*?)\]\]/g, '<mark>$1</mark>'); }

function reference(q) {
  const cite = q.cite || (q.origin === 'pack' && q.source && q.source.heading && /§|Reg\.|IRC|v\./.test(q.source.heading) ? q.source.heading : '');
  const src = q.origin === 'drill' ? '' : srcLine(q.source);
  if (!cite && !src) return '';
  return `<div class="ref">${cite ? `<p class="small"><b>Reference:</b> ${esc(cite)}</p>` : ''}${src}</div>`;
}

// Full answer: used after answering, in Review, and in saved-set review.
function answerHTML(q, chosen, { live = false } = {}) {
  const notes = notesOf(q);
  const ok = chosen === q.correct;
  const ex = q.explain || {};
  const steps = ex.steps && ex.steps.length ? ex.steps : null;
  const others = q.choices.map((c, i) => (i === q.correct || i === chosen) ? '' : `<li><b>${L[i]}. ${esc(c)}</b><br>${esc(notes[i].why)}${notes[i].when ? `<br><span class="small muted">When that would work: ${esc(notes[i].when)}</span>` : ''}</li>`).join('');
  const head = chosen === null || chosen === undefined
    ? `<div class="card ok"><p class="answer-full">Answer: <b>${L[q.correct]}. ${esc(q.choices[q.correct])}</b></p></div>`
    : `<div class="card ${ok ? 'ok' : 'bad'}"><h2>${ok ? 'Correct!' : 'Not quite.'}</h2><p class="answer-full">Answer: <b>${L[q.correct]}. ${esc(q.choices[q.correct])}</b></p>${q.ask ? `<p class="small">This question asked for the ${esc(q.ask.toLowerCase())}.</p>` : ''}</div>`;
  return `${head}
    <div class="card">
      ${chosen !== null && chosen !== undefined && !ok ? `<div class="section-block mine"><h3>Your choice: ${L[chosen]}. ${esc(q.choices[chosen])}</h3><p>${esc(notes[chosen].why)}</p>${notes[chosen].when ? `<p class="small"><b>When that reasoning would work:</b> ${esc(notes[chosen].when)}</p>` : ''}</div>` : ''}
      <div class="section-block take"><h3>Why ${L[q.correct]} is right</h3><p>${esc(notes[q.correct].why)}</p></div>
      ${ex.rule ? `<div class="section-block rule"><h3>The rule</h3><p>${ruleHTML(ex.rule)}</p></div>` : ''}
      ${ex.keyFact ? `<div class="section-block"><h3>The fact that makes it apply</h3><p>${esc(ex.keyFact)}</p></div>` : ''}
      ${steps ? `<div class="section-block app"><h3>The math</h3><ol class="steps${live && motionOn() ? ' reveal' : ''}">${steps.map((s, i) => `<li style="--d:${i}">${esc(s)}</li>`).join('')}</ol></div>`
        : ex.application ? `<div class="section-block app"><h3>How it applies</h3><p>${esc(ex.application)}</p></div>` : ''}
      ${ex.takeaway ? `<div class="section-block"><h3>${q.takeawayIsNext ? 'Next line in your outline' : 'Takeaway'}</h3><p>${esc(ex.takeaway)}</p></div>` : ''}
      ${others ? `<details class="others"><summary>Why the other choices are wrong</summary><ul class="why-list">${others}</ul></details>` : ''}
      ${reference(q)}
      ${live ? `<div class="fb-actions">${q.template ? '<button class="btn" id="newnums">Try With New Numbers</button>' : ''}<button class="btn" id="fb-review" aria-pressed="${!!lists.review[q.id]}">${lists.review[q.id] ? '✓ Saved for Review' : 'Save for Review'}</button>${canSpeak() ? '<button class="btn ghost" id="read-exp">🔊 Read explanation</button>' : ''}</div>` : ''}
    </div>`;
}

function essayAnswerHTML(q) {
  const r = q.rubric || {};
  const checklist = (r.checklist && r.checklist.length ? r.checklist : r.issues && r.issues.length ? r.issues : (r.keyTerms || []).map(t => `Uses “${t}”`));
  return `
    ${r.model ? `<div class="card ok"><h2>Model answer</h2><p style="white-space:pre-wrap">${esc(r.model)}</p></div>` : ''}
    <div class="card">
      ${checklist.length ? `<div class="section-block rule"><h3>Scoring checklist</h3>${checklist.map((t, i) => `<label class="check-row"><input type="checkbox" data-sc="${i}"><span>${esc(t)}</span></label>`).join('')}</div>` : ''}
      ${!r.model && q.outlineText ? `<details open><summary>This section of your outline</summary><p style="white-space:pre-wrap" class="small">${esc(q.outlineText)}</p></details>` : ''}
      ${reference(q)}
    </div>`;
}

function essayBody(q) {
  return `
    <p style="white-space:pre-wrap;font-size:1.04em">${esc(q.prompt)}</p>
    ${session.timer ? `<p>Time left: <span class="timer" id="timer">${session.timer}:00</span></p>` : ''}
    <label class="field" for="essay">Your answer</label>
    <p class="small muted">Issue → Rule → Application → Conclusion. Short paragraphs are fine.</p>
    <textarea id="essay" placeholder="Issue: …&#10;Rule: …&#10;Application: …&#10;Conclusion: …">${esc((session.drafts || {})[q.id] || '')}</textarea>
    <p id="essay-err" class="small" style="color:var(--bad)" hidden>Write something first, or tap Reveal Answer.</p>
    <div id="feedback" tabindex="-1"></div>`;
}

// ---------- Work the Math ----------
// Optional scratch pad for calculation questions. It runs the steps you choose
// and shows the running total, but never says whether they're right until you answer.
const OPNAME = { add: '+ Add', sub: '− Subtract', skip: 'Skip', cap: 'Use the Smaller Amount' };
function workState(q) {
  session.work = session.work || {};
  return (session.work[q.id] = session.work[q.id] || { steps: [], hist: [], editing: -1, open: false });
}
function workPanelHTML(q, w, locked) {
  const work = q.work;
  const run = runWork(work, w.steps);
  const usedIds = new Set(w.steps.map(x => x.id));
  const capHelp = work.capMode === 'min'
    ? 'Use the Smaller Amount keeps whichever is smaller: your running total or this amount.'
    : 'Use the Smaller Amount subtracts this amount or your running total, whichever is smaller, so the total stops at zero.';
  const opBtns = (attr, id) => `<div class="wbtns">
      <button class="wbtn add" ${attr}="add" data-id="${id}">+ Add</button>
      <button class="wbtn sub" ${attr}="sub" data-id="${id}">− Subtract</button>
      <button class="wbtn skp" ${attr}="skip" data-id="${id}">Skip</button>
      ${work.capMode ? `<button class="wbtn cap" ${attr}="cap" data-id="${id}">Use the Smaller Amount</button>` : ''}
    </div>`;
  const items = work.items.map(it => {
    const idx = w.steps.findIndex(x => x.id === it.id);
    return `<div class="witem${idx >= 0 ? ' used' : ''}">
      <div class="wtop"><span class="wlabel">${esc(it.label)}</span><span class="wamt">${money(it.v)}</span></div>
      ${idx >= 0 ? `<p class="wchosen small">Step ${idx + 1}: ${OPNAME[w.steps[idx].op]}</p>` : locked ? '<p class="wchosen small muted">Not used</p>' : opBtns('data-op', it.id)}
    </div>`;
  }).join('');
  const steps = run.lines.map((ln, i) => {
    const k = work.start ? i - 1 : i;          // index into w.steps (the start line isn't a step)
    if (k < 0) return `<li class="wstep start"><span>${esc(ln.text)}</span><b>${money(ln.total)}</b></li>`;
    return `<li class="wstep${ln.skip ? ' skipped' : ''}"><span>${esc(ln.text)}</span><b>${ln.skip ? '' : '= ' + money(ln.total)}</b>
      ${locked ? '' : (w.editing === k ? `<div class="wedit">${opBtns('data-chg', k)}<button class="btn ghost sm" data-rm="${k}">Remove this step</button></div>`
        : `<button class="wlink" data-edit="${k}">Change</button>`)}</li>`;
  }).join('');
  const left = work.items.length - usedIds.size;
  return `<details class="work"${w.open || w.steps.length ? ' open' : ''}>
    <summary>Work the Math <span class="muted small">(optional)</span></summary>
    <p class="small muted">Tap an amount's button in the order you'd do the math. The total updates as you go; you'll see how it compares after you answer.${work.capMode ? ' ' + capHelp : ''}</p>
    ${work.start ? `<div class="wstart"><span>Starting balance: ${esc(work.start.label)}</span><b>${money(work.start.v)}</b></div>` : ''}
    <div class="witems">${items}</div>
    <div class="wsteps"><h3>My steps</h3>${steps ? `<ol>${steps}</ol>` : '<p class="small muted">No steps yet.</p>'}</div>
    <div class="wtotal"><span>Running total</span><b>${money(run.total)}</b></div>
    ${locked ? '' : `<div class="row wctl"><button class="btn sm" id="w-undo" ${w.hist.length ? '' : 'disabled'}>↶ Undo</button><button class="btn sm" id="w-reset" ${w.steps.length ? '' : 'disabled'}>Reset</button></div>`}
    ${!locked && left === 0 && w.steps.length ? '<p class="small muted">Every amount is used. Pick your answer below.</p>' : ''}
  </details>`;
}
function renderWork(q, locked) {
  const box = document.getElementById('work'); if (!box || !q.work) return;
  const w = workState(q);
  box.innerHTML = workPanelHTML(q, w, locked);
  const det = box.querySelector('details');
  det.addEventListener('toggle', () => { w.open = det.open; save(K.session, session); });
  if (locked) return;
  const commit = fn => { w.hist.push(JSON.stringify(w.steps)); if (w.hist.length > 40) w.hist.shift(); fn(); w.editing = -1; save(K.session, session); renderWork(q, false); };
  box.querySelectorAll('[data-op]').forEach(b => b.onclick = () => commit(() => w.steps.push({ id: b.dataset.id, op: b.dataset.op })));
  box.querySelectorAll('[data-chg]').forEach(b => b.onclick = () => commit(() => { w.steps[+b.dataset.id].op = b.dataset.chg; }));
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => commit(() => { w.steps.splice(+b.dataset.rm, 1); }));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { w.editing = +b.dataset.edit; renderWork(q, false); });
  const u = document.getElementById('w-undo'); if (u) u.onclick = () => { if (!w.hist.length) return; w.steps = JSON.parse(w.hist.pop()); w.editing = -1; save(K.session, session); renderWork(q, false); };
  const r = document.getElementById('w-reset'); if (r) r.onclick = () => commit(() => { w.steps = []; });
}
// After answering: My Calculation vs Correct Calculation and the first place they differ.
function workCompareHTML(q) {
  const w = session.work && session.work[q.id];
  if (!q.work || !w || !w.steps.length) return '';
  const work = q.work;
  const mine = runWork(work, w.steps), right = runWork(work, correctSteps(work));
  const same = Math.round(mine.total) === Math.round(right.total);
  const userOp = id => (w.steps.find(x => x.id === id) || {}).op || 'none';
  let diff = null;
  for (const id of work.order) {
    const it = work.items.find(i => i.id === id), u = userOp(id), c = it.op;
    if (u === c || (c === 'skip' && u === 'none')) continue;
    if (same && ((u === 'sub' && c === 'cap') || (u === 'cap' && c === 'sub'))) continue;
    diff = { it, u, c }; break;
  }
  const did = { add: 'added it', sub: 'subtracted it', skip: 'skipped it', cap: 'used the smaller amount', none: 'didn\'t use it' };
  const calls = { add: 'adding it', sub: 'subtracting it', skip: 'leaving it out', cap: 'using the smaller amount' };
  let verdict;
  if (diff) verdict = `<p><b>First difference: ${esc(diff.it.label)} (${money(diff.it.v)}).</b> You ${did[diff.u]}; the rule calls for ${calls[diff.c]}.</p><p>${esc(diff.it.why)}</p>`;
  else if (!same) verdict = '<p><b>Same amounts and operations, different order.</b> The order changes the result here: the Use the Smaller Amount step has to come last, after every increase and distribution, because the limit is measured against what\'s left at that point.</p>';
  else verdict = '<p><b>Your calculation matches.</b></p>';
  const list = (r, mark) => `<ol class="wcalc">${r.lines.map(l => `<li class="${l.skip ? 'skipped' : ''}${mark && diff && l.id === diff.it.id ? ' hit' : ''}"><span>${esc(l.text)}</span><b>${l.skip ? '' : money(l.total)}</b></li>`).join('')}</ol><p class="wsum">= <b>${money(r.total)}</b></p>`;
  return `<div class="card work-compare">
    <h2>Your math</h2>
    <div class="wcols">
      <div><h3>My Calculation</h3>${list(mine, true)}</div>
      <div><h3>Correct Calculation</h3>${list({ ...right, lines: right.lines.concat(work.items.filter(i => i.op === 'skip').map(i => ({ text: `Skip ${money(i.v)} ${i.label.toLowerCase()}`, skip: true, id: i.id }))) }, true)}</div>
    </div>
    ${verdict}
  </div>`;
}

function question() {
  if (!session || !session.queue || session.idx >= session.queue.length) { return `<p>No active session.</p>${dock('<button class="btn primary" data-go="home">Home</button>')}`; }
  const q = session.queue[session.idx];
  const n = session.queue.length;
  const answered = session.answers.find(a => a.idx === session.idx);
  return `
    ${session.idx === 0 && !answered && session.notes && session.notes.length ? `<div class="card info"><p class="small"><b>About this set</b></p>${session.notes.map(t => `<p class="small">${esc(t)}</p>`).join('')}</div>` : ''}
    <div class="qhead"><span class="muted small">Question ${session.idx + 1} of ${n}</span><span class="small muted">${session.answers.filter(a => a.correct).length} correct</span></div>
    <div class="progress" aria-hidden="true"><span style="width:${pct(session.idx, n)}%"></span></div>
    <div>
      <span class="tag">${esc(q.topic)}</span>
      ${q.type === 'essay' ? '<span class="tag">Short essay</span>' : ''}
      ${q.origin === 'drill' ? `<span class="tag src">Basis Math · ${['', 'one step', 'a few steps', 'multistep'][q.level] || ''}</span>` : q.origin === 'ai' ? '<span class="tag src">AI · from your outline</span>' : q.origin === 'pack' ? '<span class="tag src">Answer key</span>' : ''}
    </div>
    ${toolsBar(q)}
    <div class="card" id="qcard">${q.type === 'essay' ? essayBody(q) : mcBody(q)}</div>
    ${dock(`<div id="dock-main"></div><div class="row"><button class="btn ghost" id="pause">Save and leave</button><button class="btn ghost" id="end">End set</button></div>`)}
  `;
}
bind.question = () => {
  if (!session || session.idx >= session.queue.length) return;
  const q = session.queue[session.idx];
  const dockMain = document.getElementById('dock-main');
  document.getElementById('pause').onclick = () => { session.status = 'paused'; save(K.session, session); toast('Saved. Pick up from Home anytime.'); go('home'); };
  document.getElementById('end').onclick = () => finishSession();
  // After feedback: one Next button under the explanation and the same button in the
  // sticky bottom bar. Nothing advances until it's tapped; the next question opens at the top.
  const nextBtn = () => {
    const label = session.idx + 1 < session.queue.length ? 'Next Question' : 'See Results';
    const advance = () => { session.idx++; save(K.session, session); session.idx >= session.queue.length ? finishSession() : go('question'); };
    dockMain.innerHTML = `<button class="btn primary" id="next">${label}</button>`;
    document.getElementById('next').onclick = advance;
    const fb = document.getElementById('feedback');
    if (fb && !document.getElementById('next-inline')) {
      fb.insertAdjacentHTML('beforeend', `<button class="btn primary big" id="next-inline">${label}</button>`);
      document.getElementById('next-inline').onclick = advance;
    }
    document.body.classList.add('answered');
  };
  const readQ = () => q.type === 'essay' ? q.prompt : [
    ...(q.facts || []).map(f => `${f[0]}: ${f[1]}.`), q.assumption || '', q.prompt,
    q.cloze ? `${q.cloze.before} blank ${q.cloze.after}` : '',
    ...q.choices.map((c, i) => `${L[i]}. ${c}.`)].join(' ');
  bindTools(q, readQ);

  if (q.type === 'mc') {
    const prior = session.answers.find(a => a.idx === session.idx);
    const lock = chosen => {
      app.querySelectorAll('.choice').forEach(b => {
        const i = +b.dataset.i; b.disabled = true;
        if (i === q.correct) b.classList.add('correct');
        else if (i === chosen) b.classList.add('wrong');
      });
      renderWork(q, true);
      document.getElementById('feedback').innerHTML = answerHTML(q, chosen, { live: true });
      const cmp = workCompareHTML(q);
      if (cmp) document.querySelector('#feedback > .card').insertAdjacentHTML('afterend', cmp);
      const notes = notesOf(q);
      const re = document.getElementById('read-exp');
      if (re) re.onclick = () => speak([`The answer is ${L[q.correct]}. ${q.choices[q.correct]}.`, notes[q.correct].why, (q.explain.rule || '').replace(/\[\[|\]\]/g, ''), ...(q.explain.steps || [q.explain.application || ''])].join(' '));
      const nn = document.getElementById('newnums');
      if (nn) nn.onclick = () => {
        const fresh = newNumbers(q);
        if (!fresh) { toast('Couldn\'t build new numbers for this one.'); return; }
        session.queue.splice(session.idx + 1, 0, fresh); session.idx++; save(K.session, session); go('question');
      };
      const fr = document.getElementById('fb-review');
      if (fr) fr.onclick = () => { const v = toggleList('review', q); syncReviewButtons(v); toast(v ? 'Saved for Review' : 'Removed from Review'); };
      nextBtn();
    };
    if (prior) { lock(prior.chosen); return; }
    renderWork(q, false);
    app.querySelectorAll('.choice').forEach(b => b.onclick = () => {
      const chosen = +b.dataset.i;
      const ok = chosen === q.correct;
      session.answers.push({ idx: session.idx, qid: q.id, topic: q.topic, sourceId: q.sourceId, chosen, correct: ok, type: 'mc' });
      save(K.session, session);
      record(q, ok);
      lock(chosen);
      const card = document.getElementById('qcard');
      if (ok) { if (settings.animations) moneyRain(card, { motion: motionOn() }); if (settings.sound) playCoin(); }
      else { if (settings.animations) inkSplat(card, { motion: motionOn() }); if (settings.sound && settings.wrongSound) playBonk(); }
      setTimeout(() => { const f = document.getElementById('feedback'); if (f) f.scrollIntoView({ behavior: motionOn() ? 'smooth' : 'auto', block: 'start' }); }, motionOn() ? 650 : 0);
    });
  } else {
    const ta = document.getElementById('essay');
    const prior = session.answers.find(a => a.idx === session.idx);
    ta.oninput = () => { session.drafts = session.drafts || {}; session.drafts[q.id] = ta.value; document.getElementById('essay-err').hidden = true; save(K.session, session); };
    if (session.timer && !prior) {
      const key = 'timerEnd_' + session.idx;
      session[key] = session[key] || Date.now() + session.timer * 60000; save(K.session, session);
      const tick = () => {
        const left = Math.max(0, session[key] - Date.now());
        const el = document.getElementById('timer'); if (!el) return clearInterval(timerHandle);
        el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        if (!left) { el.classList.add('out'); el.textContent = 'Time — finish your thought and submit'; clearInterval(timerHandle); }
      };
      tick(); timerHandle = setInterval(tick, 1000);
    }
    const showFeedback = async (answer, priorRecord) => {
      ta.readOnly = true;
      clearInterval(timerHandle);
      const fb = document.getElementById('feedback');
      const useAI = answer && aiReady() && !priorRecord;
      let aiHTML = '';
      if (priorRecord && priorRecord.ai) aiHTML = aiFeedbackHTML(priorRecord.ai);
      else if (useAI) {
        fb.innerHTML = `${essayAnswerHTML(q)}<div class="card info"><p>Grading your answer against your outline…</p></div>`;
        try {
          const g = await aiGradeEssay(settings, { ...q, outlineText: q.outlineText || (q.rubric && q.rubric.model) || '' }, answer);
          aiHTML = aiFeedbackHTML(g);
          const rec = session.answers.find(a => a.idx === session.idx); if (rec) { rec.ai = g; save(K.session, session); }
        } catch (err) { aiHTML = `<div class="card bad"><p class="small">AI grading didn't work (${esc(err.message)}). Use the checklist instead.</p></div>`; }
      }
      const kc = answer ? keywordCheck(answer, (q.rubric && q.rubric.keyTerms) || []) : { hit: [], miss: [] };
      fb.innerHTML = `
        ${essayAnswerHTML(q)}
        ${aiHTML}
        ${kc.hit.length + kc.miss.length ? `<div class="card"><div class="section-block app"><h3>Key terms</h3>
            ${kc.hit.length ? `<p>You used: ${kc.hit.map(t => `<span class="tag" style="color:var(--ok)">✓ ${esc(t)}</span>`).join('')}</p>` : ''}
            ${kc.miss.length ? `<p>Worth adding: ${kc.miss.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : '<p>You hit every key term.</p>'}
          </div></div>` : ''}
        ${priorRecord ? '' : `<div class="card"><h2>How did it go?</h2><p class="small muted">Your call. This only sets what shows up for review.</p>
          <div class="grid-3"><button class="btn" data-rate="2">Nailed it</button><button class="btn" data-rate="1">Partly</button><button class="btn" data-rate="0">Review later</button></div></div>`}`;
      if (priorRecord) { nextBtn(); return; }
      fb.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => {
        const rate = +b.dataset.rate;
        const rec = session.answers.find(a => a.idx === session.idx);
        rec.rate = rate; rec.correct = rate === 2; save(K.session, session);
        record(q, rate === 2);
        if (rate === 2) { if (settings.animations) moneyRain(document.getElementById('qcard'), { motion: motionOn() }); if (settings.sound) playCoin(); }
        fb.querySelectorAll('[data-rate]').forEach(x => { x.disabled = true; if (x === b) x.classList.add('primary'); });
        nextBtn();
      });
      fb.scrollIntoView({ behavior: motionOn() ? 'smooth' : 'auto', block: 'start' });
    };
    if (prior) { showFeedback(prior.text, prior); return; }
    dockMain.innerHTML = `<div class="row"><button class="btn primary" id="submit">Submit answer</button><button class="btn" id="reveal">Reveal Answer</button></div>`;
    const submit = reveal => {
      const answer = ta.value.trim();
      if (!answer && !reveal) { document.getElementById('essay-err').hidden = false; ta.focus(); return; }
      session.answers.push({ idx: session.idx, qid: q.id, topic: q.topic, sourceId: q.sourceId, text: answer, revealed: !!reveal, correct: false, type: 'essay' });
      save(K.session, session);
      dockMain.innerHTML = '';
      showFeedback(answer, null);
    };
    document.getElementById('submit').onclick = () => submit(false);
    document.getElementById('reveal').onclick = () => submit(true);
  }
};

function aiFeedbackHTML(g) {
  const step = (name, s) => s ? `<div class="section-block ${name === 'Rule' ? 'rule' : name === 'Conclusion' ? 'take' : 'app'}"><h3>${name} · ${'●'.repeat(s.score || 0)}${'○'.repeat(3 - (s.score || 0))}</h3><p>${esc(s.note)}</p></div>` : '';
  return `<div class="card info"><h2>Feedback on your answer</h2>
    ${g.encouragement ? `<p>${esc(g.encouragement)}</p>` : ''}
    ${step('Issue', g.issue)}${step('Rule', g.rule)}${step('Application', g.application)}${step('Conclusion', g.conclusion)}
    ${g.missed && g.missed.length ? `<h3>Missed</h3><ul class="why-list">${g.missed.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${g.outlinePointers && g.outlinePointers.length ? `<h3>Reread in your outline</h3><ul class="why-list">${g.outlinePointers.map(m => `<li>“${esc(m)}”</li>`).join('')}</ul>` : ''}
    ${g.nextStep ? `<p><b>Next:</b> ${esc(g.nextStep)}</p>` : ''}</div>`;
}

function finishSession() {
  if (!session) return go('home');
  session.status = 'done'; session.endedAt = Date.now();
  const s = { id: session.id, title: session.title, course: session.course, sourceId: session.sourceId, mode: session.mode, at: session.endedAt, answers: session.answers, setId: session.setId };
  history.unshift(s); history = history.slice(0, 50); save(K.history, history);
  save(K.session, session);
  go('summary', { sid: session.id });
}

function summary({ sid }) {
  const h = history.find(x => x.id === sid) || history[0];
  if (!h) return `<p>No results yet.</p>${dock('<button class="btn primary" data-go="home">Home</button>')}`;
  const att = h.answers.length, cor = h.answers.filter(a => a.correct).length;
  const byTopic = {};
  h.answers.forEach(a => { byTopic[a.topic] = byTopic[a.topic] || { a: 0, c: 0 }; byTopic[a.topic].a++; if (a.correct) byTopic[a.topic].c++; });
  const weakest = Object.entries(byTopic).sort((x, y) => (x[1].c / x[1].a) - (y[1].c / y[1].a))[0];
  const allGood = weakest && weakest[1].c === weakest[1].a;
  const nextTip = !att ? 'Try a Quick 5 from Home.'
    : allGood ? `Strong round. Try a short essay on “${weakest[0]}” to make sure you can explain it, not just spot it.`
    : `Next: more on “${weakest[0]}.” You got ${weakest[1].c} of ${weakest[1].a} there; missed questions are saved in Review.`;
  return `
    <h1>${att && cor === att ? 'Clean sweep!' : 'Set done'}</h1>
    <div class="stat-grid"><div class="stat"><b>${att}</b><span>attempted</span></div><div class="stat"><b>${cor}</b><span>correct</span></div><div class="stat"><b>${pct(cor, att)}%</b><span>accuracy</span></div></div>
    <div class="card"><h2>Topics practiced</h2>${Object.entries(byTopic).map(([t, v]) => `<p style="margin-bottom:6px">${esc(t)} <span class="muted small">· ${v.c}/${v.a}</span></p><div class="meter ${v.c / v.a < .6 ? 'low' : v.c / v.a < .85 ? 'mid' : 'high'}"><span style="width:${pct(v.c, v.a)}%"></span></div><div style="height:8px"></div>`).join('') || '<p class="muted">None.</p>'}</div>
    <div class="card gold"><h2>Next step</h2><p>${esc(nextTip)}</p></div>
    ${dock(`${h.setId ? `<button class="btn primary" data-setview="${esc(h.setId)}">Review this set's answers</button>` : ''}<div class="row"><button class="btn ghost" data-go="review">Review</button><button class="btn ghost" data-go="home">Home</button></div>`)}
  `;
}
bind.summary = () => { app.querySelectorAll('[data-setview]').forEach(b => b.onclick = () => go('setView', { id: b.dataset.setview })); };

// ---------- saved practice sets ----------
function practiceSets() {
  const byCourse = {};
  sets.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(s => { (byCourse[s.course || 'Other'] = byCourse[s.course || 'Other'] || []).push(s); });
  const groups = Object.entries(byCourse).map(([c, list]) => `<h2 class="course-head">${esc(c)}</h2>` + list.map(s => `
    <div class="item"><div class="item-open static"><span class="t-title">${esc(s.title)}</span><span class="t-meta">${s.questions.length} questions · ${dateStr(s.createdAt)}</span></div>
      <div class="item-actions"><button class="btn primary sm" data-replay="${esc(s.id)}">Replay</button><button class="btn sm" data-setview="${esc(s.id)}">Answers</button><button class="btn ghost sm" data-setdel="${esc(s.id)}" aria-label="Delete set">Delete</button></div></div>`).join('')).join('');
  return `
    <h1>Saved practice sets</h1>
    <p class="muted">Every set you generate is saved here with its answers and explanations, so you can replay or review it offline.</p>
    ${groups || '<div class="card empty"><p>No sets yet. Generate Practice or tap Quick 5 to make one.</p></div>'}
    ${dock(`<button class="btn ghost" data-go="home">Home</button>`)}
  `;
}
bind.practiceSets = () => {
  app.querySelectorAll('[data-replay]').forEach(b => b.onclick = () => {
    const s = sets.find(x => x.id === b.dataset.replay); if (!s) return;
    startSession(s.questions, { title: s.title + ' (replay)', course: s.course, sourceId: s.questions[0] && s.questions[0].sourceId, mode: s.mode, timer: 0, notes: [], setId: s.id });
  });
  app.querySelectorAll('[data-setview]').forEach(b => b.onclick = () => go('setView', { id: b.dataset.setview }));
  app.querySelectorAll('[data-setdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this saved set?')) return;
    await setDel(b.dataset.setdel).catch(() => {}); sets = sets.filter(x => x.id !== b.dataset.setdel); go('practiceSets');
  });
};
function questionReviewHTML(q, n) {
  const facts = q.facts && q.facts.length ? `<table class="facts">${q.facts.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] ?? '')}</td></tr>`).join('')}</table>` : '';
  return `<div class="card"><p class="small muted">${n ? n + ' · ' : ''}${esc(q.topic)}</p>${q.ask ? `<p class="asks">Asks for: <b>${esc(q.ask)}</b></p>` : ''}${facts}<p style="white-space:pre-wrap;font-weight:700">${esc(q.prompt)}</p>
    ${q.type === 'mc' ? `<ol class="choice-list" type="A">${q.choices.map((c, i) => `<li class="${i === q.correct ? 'ok' : ''}">${esc(c)}${i === q.correct ? ' ✓' : ''}</li>`).join('')}</ol>` : ''}</div>
    ${q.type === 'mc' ? answerHTML(q, null) : essayAnswerHTML(q)}`;
}
function setView({ id }) {
  const s = sets.find(x => x.id === id);
  if (!s) return `<p>That set was deleted.</p>${dock('<button class="btn" data-go="practiceSets">Back</button>')}`;
  return `<h1>${esc(s.title)}</h1><p class="muted small">${s.questions.length} questions · ${dateStr(s.createdAt)}</p>
    ${s.questions.map((q, i) => questionReviewHTML(q, `Question ${i + 1}`)).join('<hr class="sep">')}
    ${dock(`<button class="btn primary" id="replay">Replay this set</button><button class="btn ghost" data-go="practiceSets">Back</button>`)}`;
}
bind.setView = ({ id }) => {
  const s = sets.find(x => x.id === id); if (!s) return;
  document.getElementById('replay').onclick = () => startSession(s.questions, { title: s.title + ' (replay)', course: s.course, sourceId: s.questions[0] && s.questions[0].sourceId, mode: s.mode, timer: 0, notes: [], setId: s.id });
};

function review() {
  const rows = Object.entries(stats).sort((a, b) => (a[1].correct / a[1].attempts) - (b[1].correct / b[1].attempts));
  const msg = r => r < .6 ? 'Worth another pass. Every miss here is a rule you\'ll recognize next time.' : r < .85 ? 'Getting there. A few more rounds will make this automatic.' : 'Strong. Keep it warm with a short essay now and then.';
  const listCard = (name, label, help) => {
    const items = Object.values(lists[name]);
    return `<div class="card"><h2>${label} <span class="muted small">(${items.length})</span></h2>
      ${items.length ? items.slice(0, 40).map(q => `<button class="topic" data-viewq="${esc(name)}|${esc(q.id)}"><span class="t-main"><span class="t-title">${esc(q.prompt.length > 90 ? q.prompt.slice(0, 90) + '…' : q.prompt)}</span><span class="t-meta">${esc(q.topic)}</span></span><span aria-hidden="true">›</span></button>`).join('') + `<button class="btn primary" data-practice="${name}">Practice these</button>` : `<p class="muted small">${help}</p>`}</div>`;
  };
  return `
    <h1>Review and progress</h1>
    ${listCard('review', 'Saved for Review', 'Missed questions land here automatically. Tap “Save for Review” on any question to add it.')}
    ${listCard('flagged', 'Flagged', 'Flag a question with ⚑ to come back to it.')}
    <div class="card"><h2>Accuracy by topic</h2>
      ${rows.length ? rows.map(([k, s]) => { const r = s.correct / s.attempts; return `<p style="margin:8px 0 0"><b>${esc(s.label)}</b> <span class="muted small">· ${s.correct}/${s.attempts} (${pct(s.correct, s.attempts)}%)</span></p><div class="meter ${r < .6 ? 'low' : r < .85 ? 'mid' : 'high'}"><span style="width:${pct(s.correct, s.attempts)}%"></span></div><p class="small muted" style="margin:4px 0 8px">${msg(r)}</p>`; }).join('') : '<p class="muted">Answer a few questions and your topics show up here.</p>'}
    </div>
    ${dock(`<button class="btn ghost" data-go="home">Home</button>`)}
  `;
}
bind.review = () => {
  app.querySelectorAll('[data-viewq]').forEach(b => b.onclick = () => { const [list, id] = b.dataset.viewq.split('|'); go('viewq', { list, id }); });
  app.querySelectorAll('[data-practice]').forEach(b => b.onclick = () => {
    const qs = shuffle(Object.values(lists[b.dataset.practice])).slice(0, 15);
    startSession(qs, { title: b.dataset.practice === 'review' ? 'Saved for Review' : 'Flagged questions', sourceId: qs[0].sourceId, mode: 'mixed', timer: 0, notes: [] });
  });
};

function viewq({ list, id }) {
  const q = lists[list] && lists[list][id];
  if (!q) return `<p>That question was removed.</p>${dock('<button class="btn" data-go="review">Back</button>')}`;
  return `${questionReviewHTML(q)}
    ${dock(`<button class="btn primary" id="try">Try it now</button>${q.template ? '<button class="btn" id="fresh">Try With New Numbers</button>' : ''}<div class="row"><button class="btn danger" id="rm">Remove from list</button><button class="btn ghost" data-go="review">Back</button></div>`)}`;
}
bind.viewq = ({ list, id }) => {
  const q = lists[list] && lists[list][id]; if (!q) return;
  document.getElementById('try').onclick = () => startSession([q], { title: 'Single question', sourceId: q.sourceId, mode: q.type, timer: 0, notes: [] });
  const f = document.getElementById('fresh');
  if (f) f.onclick = () => { const n = newNumbers(q); if (n) startSession([n], { title: 'New numbers', sourceId: q.sourceId, mode: 'basis', timer: 0, notes: [] }); };
  document.getElementById('rm').onclick = () => { delete lists[list][id]; save(K.lists, lists); go('review'); };
};

function settingsScreen() {
  const sw = (key, label, help) => `<label class="switch"><span><b>${label}</b>${help ? `<br><span class="small muted">${help}</span>` : ''}</span><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}></label>`;
  return `
    <h1>Settings</h1>
    <div class="card">
      ${sw('sound', 'Sound', 'Coin chime for correct answers.')}
      ${sw('wrongSound', 'Wrong-answer sound', 'Off by default.')}
      ${sw('animations', 'Animations', 'Money rain and ink splat.')}
      ${sw('reduceMotion', 'Reduced motion', 'Swaps falling coins for a gentle glow.')}
    </div>
    <div class="card"><h2>Text size</h2>
      <div class="seg" id="text-size">${[['small', 'A−'], ['medium', 'A'], ['large', 'A+'], ['xl', 'A++']].map(([v, l]) => `<button data-v="${v}" aria-pressed="${settings.text === v}">${l}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>AI mode</h2>
      <p class="small">Writes Multiple Choice and Short Essay questions from your saved outlines, with a full answer and an explanation for every choice, and grades essays. It needs your own Anthropic API key, billed to your account. The key is stored only in this browser on this phone, never in the app's code or on GitHub. The outline text for the topics you pick is sent to the API when you generate. Basis Math and saved sets don't need it.</p>
      ${sw('ai', 'Use AI mode', '')}
      <label class="field" for="ai-key">API key</label>
      <input id="ai-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.aiKey)}">
      <label class="field" for="ai-model">Model</label>
      <input id="ai-model" type="text" autocapitalize="off" value="${esc(settings.aiModel)}">
      <button class="btn" id="ai-test">Test connection</button>
      <div id="ai-status" role="status" aria-live="polite"></div>
    </div>
    <div class="card"><h2>Your data</h2>
      <p class="small muted">Your Memory Bank, saved sets and scores stay on this phone. A backup includes the readable text of your outlines and your sets, but not the original files.</p>
      <button class="btn" id="export">Download backup</button>
      <label class="btn" for="import" style="cursor:pointer">Restore backup</label><input id="import" type="file" accept=".json,application/json" hidden>
      <button class="btn danger" id="reset">Reset progress</button>
    </div>
    <p class="small muted">LawSchoolExamPrep · works offline · PDF reading by pdf.js (Apache 2.0)</p>
    ${dock(`<button class="btn ghost" data-go="home">Done</button>`)}
  `;
}
bind.settingsScreen = () => {
  app.querySelectorAll('[data-set]').forEach(i => i.onchange = () => { settings[i.dataset.set] = i.checked; saveSettings(); applySettings(); });
  document.getElementById('text-size').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.text = b.dataset.v; saveSettings(); applySettings();
    document.querySelectorAll('#text-size button').forEach(x => x.setAttribute('aria-pressed', x === b));
  };
  document.getElementById('ai-key').onchange = e => { settings.aiKey = e.target.value.trim(); saveSettings(); };
  document.getElementById('ai-model').onchange = e => { settings.aiModel = e.target.value.trim() || DEFAULTS.aiModel; saveSettings(); };
  document.getElementById('ai-test').onclick = async () => {
    const st = document.getElementById('ai-status');
    settings.aiKey = document.getElementById('ai-key').value.trim(); saveSettings();
    st.innerHTML = '<p class="small">Testing…</p>';
    try { await testKey(settings); st.innerHTML = '<p class="small" style="color:var(--ok)">Connected.</p>'; }
    catch (err) { st.innerHTML = `<p class="small" style="color:var(--bad)">${esc(err.message)}</p>`; }
  };
  document.getElementById('export').onclick = () => {
    const data = { format: 'lsep-backup-2', settings: { ...settings, aiKey: '' }, courses, sources, sets, stats, lists, history, session };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `examprep-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  document.getElementById('import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.sources)) throw new Error('Not a backup file.');
      sources = d.sources; stats = d.stats || {}; lists = d.lists || { flagged: {}, saved: {}, review: {} }; history = d.history || []; session = d.session || null;
      courses = d.courses || courses; settings = { ...settings, ...(d.settings || {}), aiKey: settings.aiKey };
      await saveSources();
      for (const s of (d.sets || [])) { try { await setPut(s); } catch (x) { /* skip */ } }
      sets = await setAll();
      [[K.stats, stats], [K.lists, lists], [K.history, history], [K.session, session], [K.settings, settings], [K.courses, courses]].forEach(([k, v]) => save(k, v));
      applySettings(); toast('Backup restored'); go('home');
    } catch (err) { toast(err.message); }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('Clear your scores, Review list and history? The Memory Bank and saved sets stay.')) return;
    stats = {}; lists = { flagged: {}, saved: {}, review: {} }; history = []; session = null;
    [[K.stats, stats], [K.lists, lists], [K.history, history], [K.session, session]].forEach(([k, v]) => save(k, v));
    toast('Progress cleared'); go('home');
  };
};

// ---------------- global wiring ----------------
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go === 'settings' ? 'settingsScreen' : g.dataset.go); }
});
document.getElementById('nav-home').onclick = () => go('home');
document.getElementById('nav-settings').onclick = () => go('settingsScreen');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

(async () => {
  render();
  await loadAll();
  ready = true;
  render();
  await seedPacks();
  if (view.name === 'home') render();
})();

// exposed for tests
window.__lsep = { get state() { return { sources, stats, lists, session, settings, sets, courses }; } };
