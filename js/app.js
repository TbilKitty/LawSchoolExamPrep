import { parseOutline } from './parse.js';
import { outlinePool, mcFromSection, essayFromSection, keywordCheck } from './gen.js';
import { playCoin, playBonk, moneyRain, inkSplat, speak, stopSpeaking, canSpeak } from './fx.js';
import { testKey, aiMultipleChoice, aiEssayPrompt, aiGradeEssay } from './ai.js';

// ---------------- storage ----------------
const K = { settings: 'lsep.settings', sources: 'lsep.sources', stats: 'lsep.stats', lists: 'lsep.lists', session: 'lsep.session', history: 'lsep.history', seeded: 'lsep.seeded' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('Your phone\'s storage for this app is full. Delete an outline in Home to make room.'); return false; }
};

const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS = { sound: true, wrongSound: false, animations: true, reduceMotion: prefersReduced, text: 'medium', ai: false, aiKey: '', aiModel: 'claude-sonnet-5-5' };
let settings = { ...DEFAULTS, ...load(K.settings, {}) };
let sources = load(K.sources, []);
let stats = load(K.stats, {});
let lists = load(K.lists, { flagged: {}, saved: {}, review: {} });
let session = load(K.session, null);
let history = load(K.history, []);

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
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function go(name, params = {}) {
  stopSpeaking();
  clearInterval(timerHandle);
  view = { name, params };
  render();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  app.focus({ preventScroll: true });
}
const motionOn = () => settings.animations && !settings.reduceMotion;
const topicKey = (sourceId, heading) => sourceId + '::' + heading;
const getSource = id => sources.find(s => s.id === id);
function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

function srcLine(src) {
  if (!src) return '';
  const bits = [src.outline, src.heading, src.page].filter(Boolean).map(esc);
  return `<p class="small muted">Source: ${bits.join(' › ')}${src.quote ? ` — “${esc(src.quote)}”` : ''}</p>`;
}

function dock(html) { return `<div class="dock"><div class="dock-inner">${html}</div></div>`; }

// ---------------- seeding built-in packs ----------------
async function seedPacks() {
  if (load(K.seeded, false)) return;
  for (const f of ['four-accounts', 'section-752']) {
    try {
      const res = await fetch(`packs/${f}.json`);
      const pack = await res.json();
      const src = packToSource(pack, { builtIn: true, id: 'pack_' + f });
      if (!getSource(src.id)) sources.push(src);
    } catch (e) { /* offline on first run: skip */ }
  }
  save(K.sources, sources);
  save(K.seeded, true);
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
    } else {
      out.rubric = out.rubric || { issues: [], keyTerms: [], model: '' };
    }
    out.source = out.source || { outline: pack.title, heading: topic };
    return out;
  });
  const sections = topics.map((t, i) => ({ id: id + '_t' + i, heading: t, level: 1, text: '' }));
  qs.forEach(q => { q.topicId = sections.find(s => s.heading === q.topic).id; });
  return { id, kind: 'pack', title: pack.title || 'Quiz pack', note: pack.note || '', builtIn: !!extra.builtIn, sections, questions: qs, createdAt: Date.now() };
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

// ---------------- session building ----------------
function descendants(source, ids) {
  const set = new Set(ids);
  let grew = true;
  while (grew) { grew = false; source.sections.forEach(s => { if (s.parent && set.has(s.parent) && !set.has(s.id)) { set.add(s.id); grew = true; } }); }
  return source.sections.filter(s => set.has(s.id));
}

async function buildQueue(sourceId, topicIds, mode, count, useAI) {
  const source = getSource(sourceId);
  const secs = descendants(source, topicIds);
  const notes = [];
  let mc = [], essay = [];
  if (source.kind === 'pack') {
    const ids = new Set(secs.map(s => s.id));
    mc = shuffle(source.questions.filter(q => q.type === 'mc' && ids.has(q.topicId)));
    essay = shuffle(source.questions.filter(q => q.type === 'essay' && ids.has(q.topicId)));
  } else if (useAI && settings.ai && settings.aiKey) {
    const withMeta = secs.filter(s => s.text.length > 80).map(s => ({ ...s, sourceId: source.id, sourceTitle: source.title }));
    if (!withMeta.length) notes.push('The topics you picked have too little text to write questions from.');
    if (mode !== 'essay' && withMeta.length) {
      const need = mode === 'mixed' ? Math.ceil(count / 2) : count;
      const r = await aiMultipleChoice(settings, withMeta, need);
      mc = r.questions; if (r.skipped) notes.push(r.skipped);
    }
    if (mode !== 'mc' && withMeta.length) {
      const need = mode === 'mixed' ? Math.floor(count / 2) : count;
      for (const s of shuffle(withMeta).slice(0, Math.max(1, need))) {
        try { essay.push(await aiEssayPrompt(settings, s)); } catch (e) { notes.push(`${s.heading}: ${e.message}`); }
      }
    }
  } else {
    const pool = outlinePool(source);
    const skipped = [];
    secs.forEach(s => {
      if (mode !== 'essay') {
        const r = mcFromSection(source, s, pool, 6);
        mc.push(...r.questions);
        if (r.skipped && s.text) skipped.push(`${s.heading}: ${r.skipped}`);
      }
      if (mode !== 'mc') {
        const e = essayFromSection(source, s);
        if (e.question) essay.push(e.question);
      }
    });
    mc = shuffle(mc); essay = shuffle(essay);
    if (skipped.length) notes.push(...skipped.slice(0, 6), ...(skipped.length > 6 ? [`…and ${skipped.length - 6} more sections.`] : []));
  }
  let queue = [];
  if (mode === 'mc') queue = mc.slice(0, count);
  else if (mode === 'essay') queue = essay.slice(0, count);
  else {
    let i = 0, j = 0;
    while (queue.length < count && (i < mc.length || j < essay.length)) {
      if (queue.length % 2 === 0 ? i < mc.length : j >= essay.length) queue.push(mc[i++]);
      else queue.push(essay[j++]);
    }
  }
  if (queue.length < count) {
    const kind = mode === 'mc' ? 'multiple-choice questions' : mode === 'essay' ? 'written prompts' : 'questions';
    notes.unshift(queue.length ? `Your material supported ${queue.length} ${kind} for these topics, so this session has ${queue.length}.` : `Your material didn't support any ${kind} for these topics.`);
  }
  return { queue, notes };
}

function startSession(queue, meta) {
  session = { id: uid('ses_'), ...meta, queue, idx: 0, answers: [], status: 'active', startedAt: Date.now() };
  save(K.session, session);
  go('question');
}

// ---------------- screens ----------------
function render() {
  const r = { home, upload, topics, setup, question, summary, review, settingsScreen, viewq }[view.name] || home;
  app.innerHTML = `<div class="screen">${r(view.params)}</div>`;
  bind[view.name] && bind[view.name](view.params);
}
const bind = {};

function home() {
  const active = session && session.status !== 'done' && session.queue && session.idx < session.queue.length;
  const weak = Object.entries(stats).filter(([, s]) => s.attempts >= 2).sort((a, b) => (a[1].correct / a[1].attempts) - (b[1].correct / b[1].attempts)).slice(0, 2);
  const outlines = sources.filter(s => s.kind === 'outline');
  const packs = sources.filter(s => s.kind === 'pack');
  const srcCard = s => {
    const n = s.kind === 'pack' ? `${s.questions.length} questions · ${s.sections.length} topics` : `${s.sections.length} headings`;
    return `<button class="topic" data-open="${esc(s.id)}"><span class="t-main"><span class="t-title">${esc(s.title)}</span><span class="t-meta">${n}${s.builtIn ? ' · starter pack' : ''}</span></span><span aria-hidden="true">›</span></button>`;
  };
  return `
    <h1>Ready to practice?</h1>
    <p class="muted">Pick an outline or a quiz pack, choose a topic, and go.</p>
    ${active ? `<div class="card gold"><h2>Continue your session</h2><p class="muted">${esc(session.title)} · question ${session.idx + 1} of ${session.queue.length}</p><button class="btn primary" id="resume">Continue</button><button class="btn ghost" id="discard">End it and see results</button></div>` : ''}
    ${weak.length ? `<div class="card"><h2>Worth another pass</h2>${weak.map(([k, s]) => `<p><b>${esc(s.label)}</b><br><span class="muted small">${s.correct} of ${s.attempts} correct so far. One more round usually moves this up.</span></p>`).join('')}<button class="btn" data-go="review">See all topics</button></div>` : ''}
    <h2>Your outlines</h2>
    ${outlines.length ? outlines.map(srcCard).join('') : `<div class="card empty"><div class="big" aria-hidden="true">📄</div><p>Upload a PDF or Word outline to practice from your own notes.</p></div>`}
    <h2 style="margin-top:18px">Quiz packs</h2>
    ${packs.length ? packs.map(srcCard).join('') : '<p class="muted">No packs yet.</p>'}
    <div style="height:8px"></div>
    <button class="btn" data-go="review">Review and progress</button>
    ${dock(`<button class="btn primary" data-go="upload">Upload outline or quiz</button>`)}
  `;
}
bind.home = () => {
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('topics', { sourceId: b.dataset.open }));
  const r = document.getElementById('resume'); if (r) r.onclick = () => go('question');
  const d = document.getElementById('discard'); if (d) d.onclick = () => { finishSession(); };
};

function upload() {
  return `
    <h1>Add material</h1>
    <div class="card">
      <h2>Your outline</h2>
      <p>PDF or Word (.docx). The app finds the headings and builds questions from your text, right on this phone. Nothing is uploaded.</p>
      <label class="btn primary" for="file-outline" style="cursor:pointer">Choose outline file</label>
      <input id="file-outline" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden>
      <p class="small muted">Scanned PDFs (photos of pages) have no text layer, so they can't be read. Old .doc files need to be saved as .docx.</p>
    </div>
    <div class="card">
      <h2>A quiz pack</h2>
      <p>A .json or .csv quiz file, such as one Claude writes from your outline. Packs can include practice hypotheticals and essay prompts.</p>
      <label class="btn" for="file-pack" style="cursor:pointer">Choose quiz file</label>
      <input id="file-pack" type="file" accept=".json,.csv,application/json,text/csv" hidden>
      <p class="small muted">Templates: <a href="packs/template.json" download>template.json</a> · <a href="packs/template.csv" download>template.csv</a></p>
    </div>
    <div id="upload-status" role="status" aria-live="polite"></div>
    ${dock(`<button class="btn ghost" data-go="home">Back</button>`)}
  `;
}
bind.upload = () => {
  const status = document.getElementById('upload-status');
  const busy = m => { status.innerHTML = `<div class="card info"><p>${esc(m)}</p></div>`; };
  document.getElementById('file-outline').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    busy(`Reading “${f.name}”…`);
    try {
      const parsed = await parseOutline(f);
      const src = { id: uid('out_'), kind: 'outline', title: parsed.title, sections: parsed.sections, createdAt: Date.now() };
      sources.push(src);
      if (!save(K.sources, sources)) { sources.pop(); throw new Error('Not enough storage to keep this outline.'); }
      toast(parsed.headingCount ? `Found ${parsed.headingCount} headings` : 'No headings found; using the whole outline as one topic');
      go('topics', { sourceId: src.id });
    } catch (err) { status.innerHTML = `<div class="card bad"><p><b>Couldn't read that file.</b></p><p>${esc(err.message)}</p></div>`; }
  };
  document.getElementById('file-pack').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    busy(`Loading “${f.name}”…`);
    try {
      const text = await f.text();
      const pack = f.name.toLowerCase().endsWith('.csv') ? parseCSV(text) : JSON.parse(text);
      if (f.name.toLowerCase().endsWith('.csv')) pack.title = f.name.replace(/\.csv$/i, '');
      const src = packToSource(pack);
      sources.push(src); save(K.sources, sources);
      toast(`Loaded ${src.questions.length} questions`);
      go('topics', { sourceId: src.id });
    } catch (err) { status.innerHTML = `<div class="card bad"><p><b>That quiz file didn't load.</b></p><p>${esc(err.message)}</p></div>`; }
  };
};

function topics({ sourceId }) {
  const s = getSource(sourceId);
  if (!s) return `<p>That source was removed.</p>${dock('<button class="btn" data-go="home">Home</button>')}`;
  const counts = {};
  if (s.kind === 'pack') s.questions.forEach(q => { counts[q.topicId] = counts[q.topicId] || { mc: 0, essay: 0 }; counts[q.topicId][q.type]++; });
  const rows = s.sections.map(sec => {
    const st = stats[topicKey(s.id, sec.heading)];
    const acc = st ? `${pct(st.correct, st.attempts)}% of ${st.attempts}` : 'Not practiced yet';
    const meta = s.kind === 'pack'
      ? `${counts[sec.id]?.mc || 0} MC · ${counts[sec.id]?.essay || 0} written · ${acc}`
      : `${sec.page ? 'p. ' + sec.page + ' · ' : ''}${sec.text.length < 120 && !s.sections.some(c => c.parent === sec.id) ? 'light on text · ' : ''}${acc}`;
    return `<button class="topic lvl-${sec.level || 1}" data-topic="${esc(sec.id)}" aria-pressed="false"><span class="check" aria-hidden="true">✓</span><span class="t-main"><span class="t-title">${esc(sec.heading)}</span><span class="t-meta">${esc(meta)}</span></span></button>`;
  }).join('');
  return `
    <h1>${esc(s.title)}</h1>
    ${s.note ? `<p class="small muted">${esc(s.note)}</p>` : ''}
    <p class="muted">Pick one or more topics. Picking a heading includes everything under it.</p>
    <div class="row" style="margin-bottom:10px"><button class="btn" id="all">Select all</button><button class="btn" id="none">Clear</button></div>
    ${rows}
    <div style="height:10px"></div>
    <button class="btn danger" id="del">${s.builtIn ? 'Remove this starter pack' : 'Delete this ' + (s.kind === 'pack' ? 'quiz pack' : 'outline')}</button>
    ${dock(`<button class="btn primary" id="next" disabled>Choose topics to continue</button>`)}
  `;
}
bind.topics = ({ sourceId }) => {
  const picked = new Set();
  const next = document.getElementById('next');
  if (!next) return;
  const upd = () => { next.disabled = !picked.size; next.textContent = picked.size ? `Practice ${picked.size} topic${picked.size > 1 ? 's' : ''}` : 'Choose topics to continue'; };
  app.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
    const id = b.dataset.topic; picked.has(id) ? picked.delete(id) : picked.add(id);
    b.setAttribute('aria-pressed', picked.has(id)); upd();
  });
  document.getElementById('all').onclick = () => { app.querySelectorAll('[data-topic]').forEach(b => { picked.add(b.dataset.topic); b.setAttribute('aria-pressed', 'true'); }); upd(); };
  document.getElementById('none').onclick = () => { picked.clear(); app.querySelectorAll('[data-topic]').forEach(b => b.setAttribute('aria-pressed', 'false')); upd(); };
  next.onclick = () => picked.size && go('setup', { sourceId, topicIds: [...picked] });
  document.getElementById('del').onclick = () => {
    if (!confirm('Delete this from the app? Your progress stats stay.')) return;
    sources = sources.filter(x => x.id !== sourceId); save(K.sources, sources); go('home');
  };
};

function setup({ sourceId, topicIds }) {
  const s = getSource(sourceId);
  const aiReady = settings.ai && settings.aiKey && s.kind === 'outline';
  return `
    <h1>Set up your session</h1>
    <p class="muted">${esc(s.title)} · ${topicIds.length} topic${topicIds.length > 1 ? 's' : ''}</p>
    <div class="card">
      <h2>Type</h2>
      <div class="seg" id="mode" role="group" aria-label="Session type">
        <button data-v="mc" aria-pressed="true">Quick MC</button><button data-v="essay" aria-pressed="false">Essay</button><button data-v="mixed" aria-pressed="false">Mixed</button>
      </div>
      <h2>How many?</h2>
      <div class="seg" id="count" role="group" aria-label="Number of questions"></div>
      <div id="timer-wrap" hidden>
        <h2>Timer per prompt</h2>
        <div class="seg" id="timer" role="group" aria-label="Timer">
          <button data-v="0" aria-pressed="true">Off</button><button data-v="5" aria-pressed="false">5 min</button><button data-v="10" aria-pressed="false">10 min</button><button data-v="15" aria-pressed="false">15 min</button>
        </div>
      </div>
      ${s.kind === 'outline' ? `
      <h2>Questions from</h2>
      <div class="seg" id="engine" role="group" aria-label="Question source">
        <button data-v="local" aria-pressed="${aiReady ? 'false' : 'true'}">Outline sentences</button>
        <button data-v="ai" aria-pressed="${aiReady ? 'true' : 'false'}" ${aiReady ? '' : 'disabled'}>AI from outline</button>
      </div>
      <p class="small muted">${aiReady ? 'AI mode writes practice hypotheticals grounded in your outline and grades essays. It uses your API key.' : 'Outline sentences work offline. Turn on AI mode in Settings for hypotheticals and essay grading.'}</p>` : ''}
    </div>
    <div id="setup-status" role="status" aria-live="polite"></div>
    ${dock(`<button class="btn primary" id="go">Start</button><button class="btn ghost" data-back>Back</button>`)}
  `;
}
bind.setup = ({ sourceId, topicIds }) => {
  const s = getSource(sourceId);
  const state = { mode: 'mc', count: 5, timer: 0, engine: settings.ai && settings.aiKey && s.kind === 'outline' ? 'ai' : 'local' };
  const seg = (id, key, after) => document.getElementById(id) && document.getElementById(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    state[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b));
    after && after();
  });
  const counts = () => {
    const opts = state.mode === 'essay' ? [1, 2, 3] : [5, 10, 15];
    if (!opts.includes(state.count)) state.count = opts[0];
    document.getElementById('count').innerHTML = opts.map(n => `<button data-v="${n}" aria-pressed="${n === state.count}">${n}</button>`).join('');
    document.getElementById('timer-wrap').hidden = state.mode === 'mc';
  };
  counts();
  seg('mode', 'mode', counts); seg('count', 'count'); seg('timer', 'timer'); seg('engine', 'engine');
  app.querySelector('[data-back]').onclick = () => go('topics', { sourceId });
  document.getElementById('go').onclick = async () => {
    const st = document.getElementById('setup-status');
    const btn = document.getElementById('go');
    btn.disabled = true; btn.textContent = state.engine === 'ai' ? 'Writing questions…' : 'Building…';
    try {
      const { queue, notes } = await buildQueue(sourceId, topicIds, state.mode, state.count, state.engine === 'ai');
      if (!queue.length) {
        st.innerHTML = `<div class="card info"><p><b>Nothing to practice here yet.</b></p>${notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}<p class="small">Try more topics, a different session type, or load a quiz pack for this topic.</p></div>`;
        btn.disabled = false; btn.textContent = 'Start'; return;
      }
      startSession(queue, { title: s.title, sourceId, topicIds, mode: state.mode, timer: state.timer, notes });
    } catch (err) {
      st.innerHTML = `<div class="card bad"><p><b>That didn't work.</b> ${esc(err.message)}</p><p class="small">You can switch to “Outline sentences,” which works offline.</p></div>`;
      btn.disabled = false; btn.textContent = 'Start';
    }
  };
};

// ---------- question screen ----------
function toolsBar(q) {
  return `<div class="tools">
    ${canSpeak() ? `<button class="tool" id="t-read" aria-pressed="false">🔊 Read aloud</button>` : ''}
    <button class="tool" id="t-flag" aria-pressed="${!!lists.flagged[q.id]}">⚑ Flag</button>
    <button class="tool" id="t-save" aria-pressed="${!!lists.saved[q.id]}">★ Save</button>
    <button class="tool" id="t-review" aria-pressed="${!!lists.review[q.id]}">↻ Review again</button>
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
  [['t-flag', 'flagged', 'Flagged', 'Unflagged'], ['t-save', 'saved', 'Saved', 'Removed from saved'], ['t-review', 'review', 'Added to Review again', 'Removed from Review again']].forEach(([id, list, on, off]) => {
    if (t(id)) t(id).onclick = e => { const v = toggleList(list, q); e.currentTarget.setAttribute('aria-pressed', v); toast(v ? on : off); };
  });
}

function mcBody(q) {
  const facts = q.facts && q.facts.length ? `<table class="facts">${q.facts.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] ?? '')}</td></tr>`).join('')}</table>` : '';
  const cloze = q.cloze ? `<p style="font-size:1.05em">“${esc(q.cloze.before)}<span class="blank" aria-label="blank"></span>${esc(q.cloze.after)}”</p>` : '';
  return `
    ${facts}
    ${q.assumption ? `<p class="small muted">${esc(q.assumption)}</p>` : ''}
    <p style="font-weight:700;font-size:1.08em">${esc(q.prompt)}</p>
    ${cloze}
    <div id="choices">${q.choices.map((c, i) => `<button class="choice" data-i="${i}"><span class="choice-inner"><span class="letter">${L[i]}</span><span>${esc(c)}</span></span></button>`).join('')}</div>
    <div id="feedback" tabindex="-1"></div>`;
}

function ruleHTML(text) { return esc(text).replace(/\[\[(.*?)\]\]/g, '<mark>$1</mark>'); }

function mcFeedback(q, chosen) {
  const ok = chosen === q.correct;
  const why = (q.whyWrong || []).map((w, i) => (i === q.correct || !w) ? '' : `<li><b>${L[i]}.</b> ${esc(w)}</li>`).join('');
  return `
    <div class="card ${ok ? 'ok' : 'bad'}">
      <h2>${ok ? 'Correct! ' + L[q.correct] + ' is right.' : `Not quite. The answer is ${L[q.correct]}.`}</h2>
      ${!ok ? `<p class="small">You picked ${L[chosen]}. Here's the rule, calmly:</p>` : ''}
    </div>
    <div class="card">
      <div class="section-block rule"><h3>Rule</h3><p>${ruleHTML(q.explain.rule)}</p></div>
      ${q.explain.application ? `<div class="section-block app"><h3>Application</h3><p>${esc(q.explain.application)}</p></div>` : ''}
      ${q.explain.takeaway ? `<div class="section-block take"><h3>${q.takeawayIsNext ? 'Next line in your outline' : 'Takeaway'}</h3><p>${esc(q.explain.takeaway)}</p></div>` : ''}
      ${why ? `<h3 style="margin-top:12px">Why the other choices fail</h3><ul class="why-list">${why}</ul>` : ''}
      ${srcLine(q.source)}
      ${canSpeak() ? `<button class="tool" id="read-exp">🔊 Read explanation</button>` : ''}
    </div>`;
}

function essayBody(q) {
  return `
    <p style="white-space:pre-wrap;font-size:1.04em">${esc(q.prompt)}</p>
    ${session.timer ? `<p>Time left: <span class="timer" id="timer">${session.timer}:00</span></p>` : ''}
    <label class="field" for="essay">Your answer</label>
    <p class="small muted">Issue → Rule → Application → Conclusion. Short paragraphs are fine.</p>
    <textarea id="essay" placeholder="Issue: …&#10;Rule: …&#10;Application: …&#10;Conclusion: …">${esc((session.drafts || {})[q.id] || '')}</textarea>
    <p id="essay-err" class="small" style="color:var(--bad)" hidden>Write something first, even a rough outline.</p>
    <div id="feedback" tabindex="-1"></div>`;
}

function question() {
  if (!session || !session.queue || session.idx >= session.queue.length) { return `<p>No active session.</p>${dock('<button class="btn primary" data-go="home">Home</button>')}`; }
  const q = session.queue[session.idx];
  const n = session.queue.length;
  const answered = session.answers.find(a => a.idx === session.idx);
  return `
    ${session.idx === 0 && !answered && session.notes && session.notes.length ? `<div class="card info"><p class="small"><b>About this session</b></p>${session.notes.map(t => `<p class="small">${esc(t)}</p>`).join('')}</div>` : ''}
    <div class="qhead"><span class="muted small">Question ${session.idx + 1} of ${n}</span><span class="small muted">${session.answers.filter(a => a.correct).length} correct</span></div>
    <div class="progress" aria-hidden="true"><span style="width:${pct(session.idx, n)}%"></span></div>
    <div>
      <span class="tag">${esc(q.topic)}</span>
      ${q.type === 'essay' ? '<span class="tag">Written</span>' : ''}
      ${q.hypothetical ? '<span class="tag hypo">Practice hypothetical</span>' : ''}
      ${q.origin === 'outline' ? '<span class="tag src">From your outline</span>' : q.origin === 'ai' ? '<span class="tag src">AI · from your outline</span>' : ''}
    </div>
    ${toolsBar(q)}
    <div class="card" id="qcard">${q.type === 'essay' ? essayBody(q) : mcBody(q)}</div>
    ${dock(`<div id="dock-main"></div><div class="row"><button class="btn ghost" id="pause">Pause</button><button class="btn ghost" id="end">End session</button></div>`)}
  `;
}
bind.question = () => {
  if (!session || session.idx >= session.queue.length) return;
  const q = session.queue[session.idx];
  const dockMain = document.getElementById('dock-main');
  document.getElementById('pause').onclick = () => { session.status = 'paused'; save(K.session, session); toast('Paused. Continue from Home anytime.'); go('home'); };
  document.getElementById('end').onclick = () => finishSession();
  const nextBtn = () => {
    dockMain.innerHTML = `<button class="btn primary" id="next">${session.idx + 1 < session.queue.length ? 'Next question' : 'See results'}</button>`;
    document.getElementById('next').onclick = () => { session.idx++; save(K.session, session); session.idx >= session.queue.length ? finishSession() : go('question'); };
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
      const fb = document.getElementById('feedback');
      fb.innerHTML = mcFeedback(q, chosen);
      const re = document.getElementById('read-exp');
      if (re) re.onclick = () => speak([`The answer is ${L[q.correct]}. ${q.choices[q.correct]}.`, q.explain.rule.replace(/\[\[|\]\]/g, ''), q.explain.application, q.explain.takeaway].join(' '));
      nextBtn();
    };
    if (prior) { lock(prior.chosen); return; }
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
      setTimeout(() => document.getElementById('feedback').scrollIntoView({ behavior: motionOn() ? 'smooth' : 'auto', block: 'start' }), motionOn() ? 650 : 0);
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
      const useAI = settings.ai && settings.aiKey && (q.origin === 'ai' || q.origin === 'outline' || q.origin === 'pack') && !priorRecord;
      let aiHTML = '';
      if (priorRecord && priorRecord.ai) aiHTML = aiFeedbackHTML(priorRecord.ai);
      else if (useAI) {
        fb.innerHTML = `<div class="card info"><p>Grading against your outline…</p></div>`;
        try {
          const g = await aiGradeEssay(settings, { ...q, outlineText: q.outlineText || (q.rubric && q.rubric.model) || '' }, answer);
          aiHTML = aiFeedbackHTML(g);
          const rec = session.answers.find(a => a.idx === session.idx); if (rec) { rec.ai = g; save(K.session, session); }
        } catch (err) { aiHTML = `<div class="card bad"><p class="small">AI grading didn't work (${esc(err.message)}). Here's the self-check instead.</p></div>`; }
      }
      const kc = keywordCheck(answer, (q.rubric && q.rubric.keyTerms) || []);
      fb.innerHTML = `
        ${aiHTML}
        <div class="card">
          <h2>Check your answer</h2>
          ${kc.hit.length + kc.miss.length ? `
          <div class="section-block app"><h3>Key terms and cites</h3>
            ${kc.hit.length ? `<p>You used: ${kc.hit.map(t => `<span class="tag" style="color:var(--ok)">✓ ${esc(t)}</span>`).join('')}</p>` : ''}
            ${kc.miss.length ? `<p>Worth adding: ${kc.miss.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : '<p>You hit every key term. Nice.</p>'}
          </div>` : ''}
          <div class="section-block rule"><h3>Self-check</h3>
            ${['I named the issue', 'I stated the rule and its Code section', 'I applied the rule to the facts (with numbers)', 'I reached a conclusion: amount, character, timing, who'].map((t, i) => `<label class="check-row"><input type="checkbox" data-sc="${i}"><span>${t}</span></label>`).join('')}
          </div>
          ${q.rubric && q.rubric.issues && q.rubric.issues.length ? `<div class="section-block"><h3>Issues a full answer covers</h3><ul class="why-list">${q.rubric.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
          ${q.rubric && q.rubric.model ? `<details><summary style="min-height:44px;font-weight:700;cursor:pointer">Show model answer</summary><p style="white-space:pre-wrap">${esc(q.rubric.model)}</p></details>` : ''}
          ${q.outlineText ? `<details><summary style="min-height:44px;font-weight:700;cursor:pointer">Show this section of your outline</summary><p style="white-space:pre-wrap" class="small">${esc(q.outlineText)}</p></details>` : ''}
          ${srcLine(q.source)}
        </div>
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
    dockMain.innerHTML = `<button class="btn primary" id="submit">Submit answer</button>`;
    document.getElementById('submit').onclick = () => {
      const answer = ta.value.trim();
      if (!answer) { document.getElementById('essay-err').hidden = false; ta.focus(); return; }
      session.answers.push({ idx: session.idx, qid: q.id, topic: q.topic, sourceId: q.sourceId, text: answer, correct: false, type: 'essay' });
      save(K.session, session);
      dockMain.innerHTML = '';
      showFeedback(answer, null);
    };
  }
};

function aiFeedbackHTML(g) {
  const step = (name, s) => s ? `<div class="section-block ${name === 'Rule' ? 'rule' : name === 'Conclusion' ? 'take' : 'app'}"><h3>${name} · ${'●'.repeat(s.score || 0)}${'○'.repeat(3 - (s.score || 0))}</h3><p>${esc(s.note)}</p></div>` : '';
  return `<div class="card info"><h2>Feedback</h2>
    ${g.encouragement ? `<p>${esc(g.encouragement)}</p>` : ''}
    ${step('Issue', g.issue)}${step('Rule', g.rule)}${step('Application', g.application)}${step('Conclusion', g.conclusion)}
    ${g.missed && g.missed.length ? `<h3>Missed</h3><ul class="why-list">${g.missed.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${g.outlinePointers && g.outlinePointers.length ? `<h3>Reread in your outline</h3><ul class="why-list">${g.outlinePointers.map(m => `<li>“${esc(m)}”</li>`).join('')}</ul>` : ''}
    ${g.nextStep ? `<p><b>Next:</b> ${esc(g.nextStep)}</p>` : ''}</div>`;
}

function finishSession() {
  if (!session) return go('home');
  session.status = 'done'; session.endedAt = Date.now();
  const s = { id: session.id, title: session.title, sourceId: session.sourceId, topicIds: session.topicIds, mode: session.mode, at: session.endedAt, answers: session.answers };
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
  const nextTip = !att ? 'Start with five quick questions on one topic.'
    : allGood ? `Strong round. Try a written prompt on “${weakest[0]}” to make sure you can explain it, not just spot it.`
    : `Next: five more on “${weakest[0]}.” You got ${weakest[1].c} of ${weakest[1].a} there, and a second pass right away tends to lock it in.`;
  return `
    <h1>${att && cor === att ? 'Clean sweep!' : 'Session done'}</h1>
    <div class="stat-grid"><div class="stat"><b>${att}</b><span>attempted</span></div><div class="stat"><b>${cor}</b><span>correct</span></div><div class="stat"><b>${pct(cor, att)}%</b><span>accuracy</span></div></div>
    <div class="card"><h2>Topics practiced</h2>${Object.entries(byTopic).map(([t, v]) => `<p style="margin-bottom:6px">${esc(t)} <span class="muted small">· ${v.c}/${v.a}</span></p><div class="meter ${v.c / v.a < .6 ? 'low' : v.c / v.a < .85 ? 'mid' : 'high'}"><span style="width:${pct(v.c, v.a)}%"></span></div><div style="height:8px"></div>`).join('') || '<p class="muted">None.</p>'}</div>
    <div class="card gold"><h2>Next step</h2><p>${esc(nextTip)}</p></div>
    ${dock(`${weakest && getSource(h.sourceId) ? `<button class="btn primary" id="again">Practice that next</button>` : ''}<div class="row"><button class="btn ghost" data-go="review">Review</button><button class="btn ghost" data-go="home">Home</button></div>`)}
  `;
}
bind.summary = ({ sid }) => {
  const h = history.find(x => x.id === sid) || history[0];
  const b = document.getElementById('again');
  if (!b || !h) return;
  const byTopic = {};
  h.answers.forEach(a => { byTopic[a.topic] = byTopic[a.topic] || { a: 0, c: 0 }; byTopic[a.topic].a++; if (a.correct) byTopic[a.topic].c++; });
  const weakest = Object.entries(byTopic).sort((x, y) => (x[1].c / x[1].a) - (y[1].c / y[1].a))[0];
  b.onclick = () => {
    const src = getSource(h.sourceId);
    const sec = src.sections.find(s => s.heading === weakest[0]);
    go('setup', { sourceId: src.id, topicIds: sec ? [sec.id] : h.topicIds });
  };
};

function review() {
  const rows = Object.entries(stats).sort((a, b) => (a[1].correct / a[1].attempts) - (b[1].correct / b[1].attempts));
  const msg = r => r < .6 ? 'Worth another pass. Every miss here is a rule you\'ll recognize next time.' : r < .85 ? 'Getting there. A few more rounds will make this automatic.' : 'Strong. Keep it warm with a written prompt now and then.';
  const listCard = (name, label, help) => {
    const items = Object.values(lists[name]);
    return `<div class="card"><h2>${label} <span class="muted small">(${items.length})</span></h2>
      ${items.length ? items.slice(0, 30).map(q => `<button class="topic" data-viewq="${esc(name)}|${esc(q.id)}"><span class="t-main"><span class="t-title">${esc(q.prompt.length > 90 ? q.prompt.slice(0, 90) + '…' : q.prompt)}</span><span class="t-meta">${esc(q.topic)}</span></span><span aria-hidden="true">›</span></button>`).join('') + `<button class="btn primary" data-practice="${name}">Practice these</button>` : `<p class="muted small">${help}</p>`}</div>`;
  };
  return `
    <h1>Review and progress</h1>
    <div class="card"><h2>Accuracy by topic</h2>
      ${rows.length ? rows.map(([k, s]) => { const r = s.correct / s.attempts; return `<p style="margin:8px 0 0"><b>${esc(s.label)}</b> <span class="muted small">· ${s.correct}/${s.attempts} (${pct(s.correct, s.attempts)}%)</span></p><div class="meter ${r < .6 ? 'low' : r < .85 ? 'mid' : 'high'}"><span style="width:${pct(s.correct, s.attempts)}%"></span></div><p class="small muted" style="margin:4px 0 8px">${msg(r)}</p>`; }).join('') : '<p class="muted">Answer a few questions and your topics show up here.</p>'}
    </div>
    ${listCard('review', 'Review again', 'Missed questions land here automatically. You can also add any question with ↻.')}
    ${listCard('flagged', 'Flagged', 'Flag a question with ⚑ to come back to it.')}
    ${listCard('saved', 'Saved', 'Save favorites with ★.')}
    ${dock(`<button class="btn ghost" data-go="home">Home</button>`)}
  `;
}
bind.review = () => {
  app.querySelectorAll('[data-viewq]').forEach(b => b.onclick = () => { const [list, id] = b.dataset.viewq.split('|'); go('viewq', { list, id }); });
  app.querySelectorAll('[data-practice]').forEach(b => b.onclick = () => {
    const qs = shuffle(Object.values(lists[b.dataset.practice])).slice(0, 15);
    startSession(qs, { title: b.dataset.practice === 'review' ? 'Review again' : b.dataset.practice === 'flagged' ? 'Flagged questions' : 'Saved questions', sourceId: qs[0].sourceId, topicIds: [], mode: 'mixed', timer: 0, notes: [] });
  });
};

function viewq({ list, id }) {
  const q = lists[list] && lists[list][id];
  if (!q) return `<p>That question was removed.</p>${dock('<button class="btn" data-go="review">Back</button>')}`;
  return `<span class="tag">${esc(q.topic)}</span>${q.hypothetical ? '<span class="tag hypo">Practice hypothetical</span>' : ''}
    <div class="card"><p style="white-space:pre-wrap;font-weight:700">${esc(q.prompt)}</p>
    ${q.cloze ? `<p>“${esc(q.cloze.before)}<span class="blank"></span>${esc(q.cloze.after)}”</p>` : ''}
    ${q.type === 'mc' ? `<p>Answer: <b>${L[q.correct]}. ${esc(q.choices[q.correct])}</b></p><p>${ruleHTML(q.explain.rule)}</p>` : (q.rubric && q.rubric.model ? `<p>${esc(q.rubric.model)}</p>` : '')}
    ${srcLine(q.source)}</div>
    ${dock(`<button class="btn primary" id="try">Try it now</button><div class="row"><button class="btn danger" id="rm">Remove from list</button><button class="btn ghost" data-go="review">Back</button></div>`)}`;
}
bind.viewq = ({ list, id }) => {
  const q = lists[list] && lists[list][id]; if (!q) return;
  document.getElementById('try').onclick = () => startSession([q], { title: 'Single question', sourceId: q.sourceId, topicIds: [], mode: q.type, timer: 0, notes: [] });
  document.getElementById('rm').onclick = () => { delete lists[list][id]; save(K.lists, lists); go('review'); };
};

function settingsScreen() {
  const sw = (key, label, help) => `<label class="switch"><span><b>${label}</b>${help ? `<br><span class="small muted">${help}</span>` : ''}</span><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}></label>`;
  return `
    <h1>Settings</h1>
    <div class="card">
      ${sw('sound', 'Sound', 'Coin chime for correct answers. Nothing plays when a session starts.')}
      ${sw('wrongSound', 'Wrong-answer sound', 'Off by default.')}
      ${sw('animations', 'Animations', 'Money rain and ink splat.')}
      ${sw('reduceMotion', 'Reduced motion', 'Swaps falling coins for a gentle glow.')}
    </div>
    <div class="card"><h2>Text size</h2>
      <div class="seg" id="text-size">${[['small', 'A−'], ['medium', 'A'], ['large', 'A+'], ['xl', 'A++']].map(([v, l]) => `<button data-v="${v}" aria-pressed="${settings.text === v}">${l}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>AI mode (optional)</h2>
      <p class="small">Writes practice hypotheticals from your outline and grades written answers. It needs your own Anthropic API key, which is billed to your account. The key is stored only in this browser on this phone. It is never put in the app's code or on GitHub. Your outline text for the topics you pick is sent to the API when you use AI mode.</p>
      ${sw('ai', 'Use AI mode', '')}
      <label class="field" for="ai-key">API key</label>
      <input id="ai-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.aiKey)}">
      <label class="field" for="ai-model">Model</label>
      <input id="ai-model" type="text" autocapitalize="off" value="${esc(settings.aiModel)}">
      <button class="btn" id="ai-test">Test connection</button>
      <div id="ai-status" role="status" aria-live="polite"></div>
    </div>
    <div class="card"><h2>Your data</h2>
      <p class="small muted">Everything is saved on this phone. Back it up before clearing Safari data.</p>
      <button class="btn" id="export">Download backup</button>
      <label class="btn" for="import" style="cursor:pointer">Restore backup</label><input id="import" type="file" accept=".json,application/json" hidden>
      <button class="btn danger" id="reset">Reset progress</button>
    </div>
    <p class="small muted">LawSchoolExamPrep · works offline · PDF reading by pdf.js (Apache 2.0)</p>
    ${dock(`<button class="btn ghost" data-go="home">Done</button>`)}
  `;
}
bind.settingsScreen = () => {
  app.querySelectorAll('[data-set]').forEach(i => i.onchange = () => { settings[i.dataset.set] = i.checked; save(K.settings, settings); applySettings(); });
  document.getElementById('text-size').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.text = b.dataset.v; save(K.settings, settings); applySettings();
    document.querySelectorAll('#text-size button').forEach(x => x.setAttribute('aria-pressed', x === b));
  };
  document.getElementById('ai-key').onchange = e => { settings.aiKey = e.target.value.trim(); save(K.settings, settings); };
  document.getElementById('ai-model').onchange = e => { settings.aiModel = e.target.value.trim() || DEFAULTS.aiModel; save(K.settings, settings); };
  document.getElementById('ai-test').onclick = async () => {
    const st = document.getElementById('ai-status');
    settings.aiKey = document.getElementById('ai-key').value.trim(); save(K.settings, settings);
    st.innerHTML = '<p class="small">Testing…</p>';
    try { await testKey(settings); st.innerHTML = '<p class="small" style="color:var(--ok)">Connected.</p>'; }
    catch (err) { st.innerHTML = `<p class="small" style="color:var(--bad)">${esc(err.message)}</p>`; }
  };
  document.getElementById('export').onclick = () => {
    const data = { settings: { ...settings, aiKey: '' }, sources, stats, lists, history, session };
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
      settings = { ...settings, ...(d.settings || {}), aiKey: settings.aiKey };
      [[K.sources, sources], [K.stats, stats], [K.lists, lists], [K.history, history], [K.session, session], [K.settings, settings]].forEach(([k, v]) => save(k, v));
      applySettings(); toast('Backup restored'); go('home');
    } catch (err) { toast(err.message); }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('Clear your scores, lists and session history? Outlines and packs stay.')) return;
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
  await seedPacks();
  if (view.name === 'home') render();
})();

// expose for tests
window.__lsep = { get state() { return { sources, stats, lists, session, settings }; } };
