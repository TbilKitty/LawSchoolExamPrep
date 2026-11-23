// On-device question builder. Every question comes from a sentence in the
// user's outline: one key term, Code cite or figure is blanked out, and the
// wrong choices are other terms, cites or figures that appear elsewhere in the
// same outline. Nothing is invented; thin sections are skipped with a reason.

const TERMS = [
  'outside basis', 'inside basis', 'book capital account', 'tax capital account', 'capital account',
  'built-in gain', 'built-in loss', 'carryover basis', 'holding period', 'fair market value',
  'recourse', 'nonrecourse', 'economic risk of loss', 'constructive liquidation',
  'partnership minimum gain', 'partner nonrecourse debt minimum gain', 'minimum gain chargeback', 'minimum gain',
  'nonrecourse deductions', 'qualified income offset', 'deficit restoration obligation',
  'substantial economic effect', 'economic effect', 'substantiality', "partner's interest in the partnership",
  'guaranteed payment', 'distributive share', 'unrealized receivables', 'inventory items', 'hot assets',
  'disguised sale', 'ceiling rule', 'traditional method', 'curative method', 'remedial method', 'curative', 'remedial',
  'revaluation', 'book-up', 'deemed contribution', 'deemed distribution',
  'liquidating distribution', 'current distribution', 'nonliquidating distribution', 'marketable securities',
  'mixing bowl', 'substantial built-in loss', 'substantial basis reduction',
  'check-the-box', 'disregarded entity', 'per se corporation', 'publicly traded partnership',
  'profits interest', 'capital interest', 'at-risk', 'passive activity', 'separately stated',
  'ordinary income', 'capital gain', 'capital loss', 'depreciation recapture', 'unrecaptured section 1250 gain',
  'cash method', 'accrual method', 'taxable year', 'tax-exempt income', 'nondeductible expenditures',
  'precontribution gain', 'reverse 704(c)', 'election out', 'investment company', 'syndication costs', 'organization costs'
];

const ABBR = ['Treas.', 'Reg.', 'Regs.', 'Prop.', 'Rev.', 'Rul.', 'Proc.', 'e.g.', 'i.e.', 'v.', 'vs.', 'Inc.', 'No.', 'U.S.', 'Sec.', 'Ex.', 'al.', 'Corp.', 'Co.', 'cf.', 'Cir.', 'Ct.', 'T.C.', 'p.', 'pp.', 'Temp.', 'Para.', 'Art.'];

export function splitSentences(text) {
  let t = ' ' + String(text).replace(/\s+/g, ' ') + ' ';
  ABBR.forEach(a => { t = t.split(' ' + a).join(' ' + a.replace(/\./g, '․')); });
  t = t.replace(/(\d)\.(\d)/g, '$1․$2');
  const parts = [];
  let buf = '';
  for (let i = 0; i < t.length; i++) {
    buf += t[i];
    if (/[.?!]/.test(t[i]) && t[i + 1] === ' ' && /[A-Z(§"“0-9]/.test(t[i + 2] || '')) { parts.push(buf); buf = ''; }
  }
  if (buf.trim()) parts.push(buf);
  return parts.map(s => s.replace(/․/g, '.').trim()).filter(Boolean);
}

const CITE_RE = /§§?\s?\d[\d.\-]*[A-Za-z]?(?:\([A-Za-z0-9]+\))*/g;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|k))?/gi;
const PCT_RE = /\b\d+(?:\.\d+)?\s?%/g;

function normCite(c) { return c.replace(/^§§?\s?/, '§ ').replace(/[.\-]$/, ''); }

export function tokensIn(sentence) {
  const out = [];
  const lower = sentence.toLowerCase();
  const takenTerm = [];
  TERMS.forEach(term => {
    const re = new RegExp('(^|[^a-z])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])', 'i');
    const m = lower.match(re);
    if (m) {
      const start = m.index + m[1].length;
      if (takenTerm.some(([s, e]) => start < e && start + term.length > s)) return;
      takenTerm.push([start, start + term.length]);
      out.push({ kind: 'term', value: sentence.substr(start, term.length), key: term, start });
    }
  });
  (sentence.match(CITE_RE) || []).forEach(c => { const v = normCite(c); if (/\d/.test(v)) out.push({ kind: 'cite', value: c.replace(/[.\-]$/, ''), key: v, start: sentence.indexOf(c) }); });
  (sentence.match(MONEY_RE) || []).forEach(c => out.push({ kind: 'money', value: c, key: c.replace(/\s/g, ''), start: sentence.indexOf(c) }));
  (sentence.match(PCT_RE) || []).forEach(c => out.push({ kind: 'pct', value: c, key: c.replace(/\s/g, ''), start: sentence.indexOf(c) }));
  return out;
}

// Pool of tokens across the whole outline, by kind, with where each was seen.
export function outlinePool(source) {
  const pool = { term: new Map(), cite: new Map(), money: new Map(), pct: new Map() };
  source.sections.forEach(sec => {
    splitSentences(sec.text).forEach(s => {
      tokensIn(s).forEach(tok => {
        const m = pool[tok.kind];
        if (!m.has(tok.key.toLowerCase())) m.set(tok.key.toLowerCase(), { value: tok.value, key: tok.key, sections: new Set() });
        m.get(tok.key.toLowerCase()).sections.add(sec.id);
      });
    });
  });
  return pool;
}

function shuffle(a, rnd = Math.random) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

function related(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

function pageRef(sec) {
  if (!sec.page) return '';
  return sec.lastPage && sec.lastPage !== sec.page ? `pp. ${sec.page}–${sec.lastPage}` : `p. ${sec.page}`;
}

export function sourceRef(source, sec) {
  return { outline: source.title, heading: sec.heading, page: pageRef(sec) };
}

// Build up to `max` fill-in-the-blank multiple-choice questions from one section.
export function mcFromSection(source, sec, pool, max = 6) {
  const result = { questions: [], skipped: null };
  const sentences = splitSentences(sec.text).filter(s => s.length >= 40 && s.length <= 360);
  if (sec.text.replace(/\s/g, '').length < 80 || !sentences.length) {
    result.skipped = 'This section has too little text to build a fair question from.';
    return result;
  }
  const secName = id => (source.sections.find(s => s.id === id) || {}).heading || 'another section';
  const priority = { term: 0, cite: 1, money: 2, pct: 3 };
  let noTokens = 0, noDistractors = 0;
  sentences.forEach((s, si) => {
    if (result.questions.length >= max) return;
    const toks = tokensIn(s).sort((a, b) => priority[a.kind] - priority[b.kind]);
    if (!toks.length) { noTokens++; return; }
    for (const tok of toks) {
      const m = pool[tok.kind];
      const cands = [...m.values()].filter(c =>
        !related(c.key, tok.key) &&
        !s.toLowerCase().includes(c.value.toLowerCase()) &&
        !toks.some(t => related(t.key, c.key)));
      const elsewhere = cands.filter(c => ![...c.sections].every(id => id === sec.id));
      const picks = shuffle(elsewhere.length >= 3 ? elsewhere : cands).slice(0, 3);
      if (picks.length < 3) { noDistractors++; continue; }
      const idx = s.indexOf(tok.value, Math.max(0, tok.start - 2)) >= 0 ? s.indexOf(tok.value, Math.max(0, tok.start - 2)) : s.toLowerCase().indexOf(tok.value.toLowerCase());
      if (idx < 0) continue;
      const before = s.slice(0, idx), after = s.slice(idx + tok.value.length);
      const choices = shuffle([{ v: tok.value, ok: true }, ...picks.map(p => ({ v: p.value, ok: false, from: [...p.sections].filter(id => id !== sec.id)[0] || sec.id }))]);
      const correct = choices.findIndex(c => c.ok);
      const next = sentences[si + 1];
      const kindWord = { term: 'term', cite: 'Code or regulation cite', money: 'dollar figure', pct: 'percentage' }[tok.kind];
      result.questions.push({
        id: 'g_' + sec.id + '_' + si + '_' + tok.kind,
        type: 'mc', origin: 'outline', topic: sec.heading, topicId: sec.id, sourceId: source.id,
        prompt: `Fill in the blank from your outline's “${sec.heading}” section:`,
        cloze: { before, after },
        choices: choices.map(c => c.v),
        correct,
        explain: {
          rule: before + '[[' + tok.value + ']]' + after,
          application: `The missing ${kindWord} is “${tok.value}.” That is the word your outline uses in this rule.`,
          takeaway: next ? next : `Tie “${tok.value}” to ${sec.heading} when you see these facts.`
        },
        takeawayIsNext: !!next,
        whyWrong: choices.map(c => c.ok ? null : (c.from === sec.id
          ? `“${c.v}” shows up elsewhere in this section, but not in this rule.`
          : `“${c.v}” comes from your outline's “${secName(c.from)}” section, not this rule.`)),
        source: sourceRef(source, sec)
      });
      break;
    }
  });
  if (!result.questions.length) {
    result.skipped = noDistractors ? 'Your outline doesn\'t have enough similar terms or cites elsewhere to make fair wrong answers for this section.'
      : noTokens ? 'This section has no key terms, Code cites or figures to test on.'
      : 'This section couldn\'t support a reliable question.';
  }
  return result;
}

// Rule-statement drill built from an outline section (no invented facts).
export function essayFromSection(source, sec) {
  const text = sec.text || '';
  if (text.replace(/\s/g, '').length < 120) return { skipped: 'This section is too short for a written drill.' };
  const toks = splitSentences(text).flatMap(tokensIn);
  const seen = new Set();
  const keys = [];
  toks.forEach(t => { const k = t.key.toLowerCase(); if (!seen.has(k)) { seen.add(k); keys.push(t.kind === 'cite' ? normCite(t.value) : t.value); } });
  return {
    question: {
      id: 'e_' + sec.id, type: 'essay', origin: 'outline', topic: sec.heading, topicId: sec.id, sourceId: source.id,
      prompt: `Rule drill: “${sec.heading}.” Without looking at your outline, write out (1) the issue this rule answers, (2) the governing rule and its Code section, (3) how it applies to a short example you make up, and (4) your conclusion.`,
      hypothetical: false,
      rubric: { keyTerms: keys.slice(0, 14), model: null, issues: [] },
      outlineText: text.slice(0, 2400),
      source: sourceRef(source, sec)
    }
  };
}

// Compare a written answer against the key terms the rubric expects.
export function keywordCheck(answer, keyTerms) {
  const a = ' ' + String(answer || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const hit = [], miss = [];
  keyTerms.forEach(k => {
    const variants = [k.toLowerCase()];
    if (/^§/.test(k)) { const bare = k.replace(/^§\s?/, ''); variants.push('§' + bare.toLowerCase(), 'section ' + bare.toLowerCase(), 'sec. ' + bare.toLowerCase(), ' ' + bare.toLowerCase().split('(')[0] + ' '); }
    (variants.some(v => a.includes(v)) ? hit : miss).push(k);
  });
  return { hit, miss };
}
