// Open-Book Sprint: one short fact pattern, three steps (spot the issue, work the
// math, write the exam sentence). Every scenario is plain data so it can be saved
// mid-sprint, replayed, or rebuilt with one fact changed.
import { money, richOf, buildWork, runWork, correctSteps } from './math.js';

const $ = money;
const NAMES = ['Fay', 'Maya', 'Ben', 'Cora', 'Dev', 'Eli', 'Gus', 'Hana', 'Ivan', 'Jada', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia'];
const r = (min, max, step = 1000) => min + step * Math.floor(Math.random() * (Math.floor((max - min) / step) + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const pos = a => `${a}'s`;

// Override the generic Skip/Add/Subtract reasons where a scenario knows better.
function tuneWhys(work, whys) {
  if (!work) return work;
  work.items.forEach(it => { const w = whys.find(x => x.match.test(it.label)); if (w && w[it.op]) it.why = w[it.op]; });
  return work;
}

const ISSUES = {
  debt: 'Change in a partner\'s share of partnership liabilities (§ 752)',
  contribOB: 'Partner\'s outside basis after contributing property (§ 722)',
  contribIB: 'Partnership\'s inside basis in contributed property (§ 723)',
  book: '§ 704(b) book capital account',
  gain721: 'Gain on a contribution of property (§ 721)',
  loss: 'Loss limited to outside basis (§ 704(d))',
  dist: 'Cash distribution greater than outside basis (§ 731(a)(1))',
  atRisk: 'At-risk limit (§ 465)'
};

const S = {};

// 1. A partner's share of partnership debt goes up or down.
S['debt-share'] = {
  title: 'Change in share of partnership debt',
  make(o = {}) {
    const up = o.dir ? o.dir === 'up' : Math.random() < 0.6;
    const n = o.nums || {};
    const a = n.a || pick(NAMES);
    const b = n.b || r(30000, 60000);
    const share = n.share || r(9000, Math.min(25000, b - 6000));
    const loan = share * 3, fmv = n.fmv || r(150000, 300000, 10000), tcap = n.tcap || b - r(6000, 15000);
    const after = up ? b + share : b - share;
    const steps = [['start', b, 'of outside basis'], [up ? 'add' : 'sub', share, `${up ? 'increase' : 'decrease'} in ${pos(a)} share of partnership liabilities`]];
    const facts = [[`${pos(a)} outside basis before`, $(b)], [`${pos(a)} tax basis capital before`, $(tcap)],
      [up ? 'The partnership borrows (recourse debt)' : 'The partnership repays recourse debt', $(loan)],
      ['Partners sharing that debt', `3, equally`], [`So ${pos(a)} share of partnership debt ${up ? 'goes up' : 'goes down'} by`, $(share)],
      ['Fair market value of the partnership\'s building', $(fmv)], ['Other activity this year', 'None']];
    const ask = 'Outside basis';
    const work = tuneWhys(buildWork({ steps, facts }, after, 'debt-share'), [
      { match: /borrows|repays/i, skip: 'Only the partner\'s own share of the debt moves outside basis, not the whole loan.' },
      { match: /tax basis capital/i, skip: 'Tax basis capital doesn\'t include a share of partnership debt, so it isn\'t part of outside basis here.' },
      { match: /fair market value/i, skip: 'Fair market value doesn\'t affect basis.' },
      { match: /share of partnership liabilities/i, add: 'An increase in a partner\'s share of partnership liabilities is treated as a cash contribution, so it adds to outside basis (§ 752(a)).', sub: 'A decrease in a partner\'s share of partnership liabilities is treated as a cash distribution, so it comes off outside basis (§ 752(b)).' }
    ]);
    return {
      key: 'debt-share', opts: { dir: up ? 'up' : 'down' }, nums: { a, b, share, fmv, tcap }, person: a, title: S['debt-share'].title,
      facts, prompt: `What is ${pos(a)} outside basis after the ${up ? 'borrowing' : 'repayment'}?`, ask, answer: after,
      steps, rich: richOf(steps, ask, after), work,
      rule: up ? 'When a partner\'s share of partnership liabilities increases, the partner is treated as contributing that much cash, so outside basis goes up.'
               : 'When a partner\'s share of partnership liabilities decreases, the partner is treated as receiving that much cash, so outside basis goes down (gain only if it exceeds basis).',
      cite: up ? 'IRC §§ 752(a), 722' : 'IRC §§ 752(b), 733, 731(a)',
      issue: {
        choices: [ISSUES.debt, ISSUES.contribOB, ISSUES.dist, ISSUES.loss], correct: 0,
        why: `The facts change how much partnership debt ${a} bears. Section 752 treats that change as a cash ${up ? 'contribution' : 'distribution'}.`,
        search: up ? ['increase in share of liabilities', '752(a)'] : ['decrease in share of liabilities', '752(b)'],
        keywords: ['752', 'liabilit', up ? 'increase' : 'decrease', 'share', 'debt']
      },
      accounts: [
        { name: 'Outside basis', before: b, after, note: up ? `Up by ${pos(a)} ${$(share)} share of the new debt.` : `Down by the ${$(share)} drop in ${pos(a)} debt share (a deemed cash distribution).` },
        { name: 'Tax basis capital', before: tcap, after: tcap, note: 'Unchanged: capital accounts never include a share of partnership debt.' },
        { name: '§ 704(b) book capital', before: null, after: null, same: true, note: 'Unchanged: borrowing or repaying debt doesn\'t change a partner\'s equity.' },
        { name: 'Inside basis', before: null, after: null, change: up ? loan : -loan, note: up ? `The partnership's assets go up by the full ${$(loan)} of cash borrowed, not just ${pos(a)} share.` : `The partnership's assets go down by the ${$(loan)} of cash used to repay the debt.` }
      ],
      sentence: {
        model: `${pos(a)} outside basis ${up ? 'increases' : 'decreases'} from ${$(b)} to ${$(after)} because ${pos(a)} share of partnership liabilities ${up ? 'increased' : 'decreased'} by ${$(share)}${up ? ', which § 752(a) treats as a cash contribution' : ', which § 752(b) treats as a cash distribution'}.`,
        account: ['outside basis'], link: ['liabilit', 'debt', '752'], result: [$(after), String(after / 1000)]
      },
      change: { label: `${pos(a)} share of partnership debt ${up ? 'decreases' : 'increases'} by ${$(share)} instead`, opts: { dir: up ? 'down' : 'up' } },
      predict: {
        q: `Same facts, but ${pos(a)} share of partnership debt ${up ? 'decreases' : 'increases'} by ${$(share)}. Which balance moves, and which way?`,
        choices: [`Outside basis goes ${up ? 'down' : 'up'}`, `Outside basis goes ${up ? 'up' : 'down'}`, `Tax basis capital goes ${up ? 'down' : 'up'}`, 'No balance moves; debt isn\'t equity'],
        correct: 0, why: `A ${up ? 'decrease' : 'increase'} in debt share is a deemed cash ${up ? 'distribution' : 'contribution'}, so outside basis goes ${up ? 'down' : 'up'}. The capital accounts don't move.`
      },
      decisions: { issue: 'Spotting a change in debt share as a § 752 issue', predict: 'Predicting how a change in debt share moves outside basis' }
    };
  }
};

// 2. A partner contributes land; the question asks for outside basis or book capital.
S['contribution'] = {
  title: 'Contribution of property',
  make(o = {}) {
    const n = o.nums || {};
    const a = n.a || pick(NAMES);
    const ask = o.ask || n.ask || pick(['ob', 'book']);
    const ab = n.ab || r(20000, 50000), fmv = n.fmv || ab + r(10000, 40000), cash = n.cash ?? pick([0, r(5000, 15000)]);
    const debt = o.debt ? (n.debt || r(6000, Math.min(20000, ab), 2000)) : 0;
    const ob = cash + ab - debt + debt / 2, book = cash + fmv - debt, tax = cash + ab - debt;
    const ans = ask === 'ob' ? ob : book;
    const steps = [];
    if (cash) steps.push(['start', cash, 'of cash contributed'], ['add', ask === 'ob' ? ab : fmv, ask === 'ob' ? 'adjusted basis of the land' : 'fair market value of the land']);
    else steps.push(['start', ask === 'ob' ? ab : fmv, ask === 'ob' ? 'adjusted basis of the land' : 'fair market value of the land']);
    if (debt) { steps.push(['sub', debt, 'debt the partnership took over']); if (ask === 'ob') steps.push(['add', debt / 2, `${pos(a)} half share of that debt as a partner`]); }
    const facts = [...(cash ? [[`${a} contributes cash`, $(cash)]] : []), [`${a} contributes land, adjusted basis`, $(ab)], ['Land fair market value', $(fmv)],
      ['Debt on the land', debt ? $(debt) : 'None'], ...(debt ? [['Partners sharing debt', '2, equally']] : []), ['Other adjustments', 'None']];
    const label = ask === 'ob' ? 'Outside basis' : '§ 704(b) book capital';
    const work = tuneWhys(buildWork({ steps, facts }, ans, 'contribution'), [
      { match: /adjusted basis/i, add: 'Outside basis carries over the partner\'s adjusted basis in the land (§ 722).', skip: 'Book capital uses fair market value, so the adjusted basis is left out.' },
      { match: /fair market value/i, add: 'Book capital records contributed property at fair market value.', skip: 'Outside basis uses the land\'s adjusted basis, not its value.' },
      { match: /half share/i, add: 'As a partner, the contributor still bears half the debt, which adds back to outside basis.' }
    ]);
    return {
      key: 'contribution', opts: { ask, debt: !!o.debt }, nums: { a, ask, ab, fmv, cash, debt }, person: a, title: S['contribution'].title,
      facts, prompt: `What is ${pos(a)} ${ask === 'ob' ? 'outside basis' : '§ 704(b) book capital account'} right after the contribution?`, ask: label, answer: ans,
      steps, rich: richOf(steps, label, ans), work,
      rule: ask === 'ob' ? `A contributing partner's outside basis is the cash plus the adjusted basis of the property${debt ? ', less the debt shifted to the other partners' : ''}. Fair market value doesn't count.`
                         : `The § 704(b) book capital account records cash plus the fair market value of contributed property${debt ? ', less debt the partnership assumes' : ''}.`,
      cite: ask === 'ob' ? 'IRC §§ 722, 752' : 'Treas. Reg. § 1.704-1(b)(2)(iv)(b)',
      issue: {
        choices: ask === 'ob' ? [ISSUES.contribOB, ISSUES.contribIB, ISSUES.book, ISSUES.gain721] : [ISSUES.book, ISSUES.contribOB, ISSUES.contribIB, ISSUES.gain721], correct: 0,
        why: ask === 'ob' ? `The question asks for ${pos(a)} basis in the partnership interest after contributing land: § 722.` : `The question asks for ${pos(a)} book capital, which uses fair market value.`,
        search: ask === 'ob' ? ['basis of contributing partner', '722'] : ['book capital account', '704(b)'],
        keywords: ask === 'ob' ? ['722', 'contribut', 'outside basis', 'basis of partner'] : ['704(b)', 'capital account', 'book']
      },
      accounts: [
        { name: 'Outside basis', before: 0, after: ob, note: 'Starts from adjusted basis' + (debt ? ', net of the debt shifted to the other partner.' : '.') },
        { name: 'Inside basis', before: 0, after: ab, note: 'The partnership takes the land at the partner\'s adjusted basis (§ 723).' + (cash ? ` Plus ${$(cash)} of cash.` : '') },
        { name: '§ 704(b) book capital', before: 0, after: book, note: 'Records the land at fair market value' + (debt ? ', net of the debt.' : '.') },
        { name: 'Tax basis capital', before: 0, after: tax, note: 'Adjusted basis' + (debt ? ', net of the debt, with no debt share added back.' : '.') }
      ],
      sentence: {
        model: ask === 'ob'
          ? `${pos(a)} outside basis is ${$(ob)} because a contributing partner takes the land's ${$(ab)} adjusted basis${cash ? ` plus the ${$(cash)} of cash` : ''}${debt ? `, less the ${$(debt / 2)} of debt shifted to the other partner` : ''}, not its ${$(fmv)} value.`
          : `${pos(a)} § 704(b) book capital account is ${$(book)} because book capital records the land at its ${$(fmv)} fair market value${cash ? ` plus the ${$(cash)} of cash` : ''}${debt ? `, less the ${$(debt)} of debt` : ''}.`,
        account: ask === 'ob' ? ['outside basis'] : ['book capital', '704(b)'], link: ask === 'ob' ? ['adjusted basis', 'basis'] : ['fair market', 'fmv', 'value'], result: [$(ans), String(ans / 1000)]
      },
      change: o.debt ? null : { label: `the land carries debt the partnership takes over`, opts: { ask, debt: true } },
      predict: {
        q: `Same facts, but the land carries debt that the partnership takes over, and the two partners share debt equally. Which balance moves, and which way?`,
        choices: ask === 'ob'
          ? [`Outside basis goes down by half the debt`, `Outside basis goes down by the whole debt`, `Outside basis goes up by half the debt`, `Outside basis doesn't change`]
          : [`Book capital goes down by the whole debt`, `Book capital goes down by half the debt`, `Book capital goes up by the debt`, `Book capital doesn't change`],
        correct: 0,
        why: ask === 'ob' ? 'The partnership takes over the whole debt (a decrease), but the contributor still bears half as a partner (an increase), so outside basis drops by half.'
                          : 'Book capital is the contributor\'s equity: property value minus the debt the partnership assumes, with no debt share added back.'
      },
      decisions: { issue: ask === 'ob' ? 'Spotting outside basis on a contribution (§ 722)' : 'Spotting § 704(b) book capital', predict: 'Predicting how debt on contributed property moves the balances' }
    };
  }
};

// 3. An allocated loss, with or without the § 704(d) limit.
S['loss-limit'] = {
  title: 'Loss and the § 704(d) limit',
  make(o = {}) {
    const big = o.big ?? Math.random() < 0.65;
    const n = o.nums || {};
    const a = n.a || pick(NAMES);
    const b = n.b || r(10000, 40000);
    const gap = n.gap || r(4000, Math.min(20000, b - 3000));
    const loss = big ? b + gap : b - gap;
    const allowed = Math.min(loss, b), after = b - allowed, susp = loss - allowed;
    const steps = [['start', b, 'of outside basis'], ['subcap', loss, 'the allocated loss']];
    const facts = [[`${pos(a)} outside basis before the loss`, $(b)], [`${pos(a)} share of the partnership's loss`, $(loss)], ['Partnership\'s land, fair market value', $(r(80000, 200000, 10000))], ['Other activity this year', 'None']];
    const ask = 'Ending outside basis';
    const work = tuneWhys(buildWork({ steps, facts }, after, 'loss-limit'), [
      { match: /loss/i, sub: 'The loss reduces outside basis, but never below zero.', cap: big ? 'The loss is bigger than basis, so only the smaller amount (all of the basis) comes off; the rest is suspended (§ 704(d)).' : 'Use the smaller of the loss and basis. Here the loss is smaller, so it all comes off.' },
      { match: /fair market/i, skip: 'Fair market value doesn\'t affect outside basis.' }
    ]);
    return {
      key: 'loss-limit', opts: { big }, nums: { a, b, gap }, person: a, title: S['loss-limit'].title,
      facts, prompt: `What is ${pos(a)} outside basis after the loss?`, ask, answer: after,
      steps, rich: richOf(steps, ask, after), work,
      rule: 'A partner deducts partnership losses only up to outside basis. The loss reduces basis, but not below zero; any excess is suspended until the partner has basis again.',
      cite: 'IRC § 704(d); Treas. Reg. § 1.704-1(d)',
      issue: {
        choices: [ISSUES.loss, ISSUES.atRisk, ISSUES.dist, ISSUES.debt], correct: 0,
        why: big ? `${pos(a)} share of the loss is larger than ${pos(a)} outside basis, which is exactly what § 704(d) limits.` : `The question is whether the § 704(d) limit bites. Here the loss fits within basis, so it is fully deductible.`,
        search: ['loss limited to basis', '704(d)'], keywords: ['704(d)', 'loss', 'limit']
      },
      accounts: [
        { name: 'Outside basis', before: b, after, note: big ? `Down to $0; ${$(susp)} of loss is suspended.` : `Down by the full ${$(loss)} loss.` },
        { name: 'Tax basis capital', before: null, after: null, change: -loss, note: `Down by the full ${$(loss)} allocated loss; capital accounts can go negative. Only the deduction is limited.` },
        { name: '§ 704(b) book capital', before: null, after: null, change: -loss, note: `Down by the ${$(loss)} book loss (assuming book and tax loss match).` },
        { name: 'Inside basis', before: null, after: null, same: true, note: 'The allocation itself doesn\'t change it; whatever caused the loss (spent cash, depreciation) already did.' }
      ],
      sentence: {
        model: big ? `${pos(a)} outside basis falls from ${$(b)} to $0 because § 704(d) lets a partner deduct losses only up to basis; the other ${$(susp)} of the ${$(loss)} loss is suspended.`
                   : `${pos(a)} outside basis falls from ${$(b)} to ${$(after)} because the ${$(loss)} loss is less than basis, so § 704(d) doesn't limit it and it is fully deductible.`,
        account: ['outside basis'], link: ['704(d)', 'loss', 'limit'], result: big ? ['$0', 'zero', $(susp)] : [$(after), String(after / 1000)]
      },
      change: { label: big ? `the loss is ${$(b - gap)}, less than basis` : `the loss is ${$(b + gap)}, more than basis`, opts: { big: !big } },
      predict: {
        q: `Same facts, but ${pos(a)} share of the loss is ${big ? $(b - gap) : $(b + gap)}. Which balance moves, and how far?`,
        choices: big ? ['Outside basis drops by the full loss; nothing is suspended', 'Outside basis drops to $0; part of the loss is suspended', 'Outside basis doesn\'t change', 'Outside basis goes up']
                     : ['Outside basis drops to $0; part of the loss is suspended', 'Outside basis drops by the full loss, below zero', 'Outside basis doesn\'t change', 'Outside basis goes up'],
        correct: 0, why: big ? 'The new loss fits within basis, so it all comes off basis and is fully deductible.' : 'The new loss exceeds basis, so basis stops at $0 and the excess is suspended under § 704(d).'
      },
      decisions: { issue: 'Spotting the § 704(d) loss limit', predict: 'Predicting whether the § 704(d) limit applies' }
    };
  }
};

// 4. A cash distribution, more or less than outside basis.
S['cash-dist'] = {
  title: 'Cash distribution',
  make(o = {}) {
    const over = o.over ?? Math.random() < 0.6;
    const n = o.nums || {};
    const a = n.a || pick(NAMES);
    const b = n.b || r(10000, 40000);
    const gap = n.gap || r(3000, Math.min(15000, b - 2000));
    const cash = over ? b + gap : b - gap;
    const after = Math.max(0, b - cash), gain = Math.max(0, cash - b);
    const steps = [['start', b, 'of outside basis'], ['subcap', cash, 'the cash distribution']];
    const facts = [[`${pos(a)} outside basis`, $(b)], ['Cash distributed to ' + a, $(cash)], [`${pos(a)} § 704(b) book capital`, $(b + r(5000, 20000))], ['Other activity', 'None']];
    const ask = 'Ending outside basis';
    const work = tuneWhys(buildWork({ steps, facts }, after, 'distribution-over-basis'), [
      { match: /cash distribut/i, sub: 'Cash distributed reduces outside basis, but not below zero.', cap: over ? 'The cash is more than basis, so only the smaller amount (all of the basis) comes off; the rest is gain (§ 731(a)(1)).' : 'Use the smaller of the cash and basis. Here the cash is smaller, so it all comes off.' },
      { match: /book capital/i, skip: 'Book capital doesn\'t measure outside basis.' }
    ]);
    return {
      key: 'cash-dist', opts: { over }, nums: { a, b, gap }, person: a, title: S['cash-dist'].title,
      facts, prompt: `What is ${pos(a)} outside basis after the distribution?`, ask, answer: after,
      steps, rich: richOf(steps, ask, after), work,
      rule: 'Cash distributed to a partner reduces outside basis, but not below zero. Cash beyond basis is gain.',
      cite: 'IRC §§ 731(a)(1), 733',
      issue: {
        choices: [ISSUES.dist, ISSUES.loss, ISSUES.debt, ISSUES.gain721], correct: 0,
        why: over ? `${a} receives more cash than ${pos(a)} outside basis: § 731(a)(1).` : `The question is whether the cash exceeds basis under § 731(a)(1). Here it doesn't, so it just reduces basis.`,
        search: ['distribution in excess of basis', '731(a)'], keywords: ['731', 'distribut', 'cash']
      },
      accounts: [
        { name: 'Outside basis', before: b, after, note: over ? `Down to $0; ${$(gain)} is gain.` : `Down by the ${$(cash)} distributed; no gain.` },
        { name: 'Tax basis capital', before: null, after: null, change: -cash, note: `Down by the ${$(cash)} distributed.` },
        { name: '§ 704(b) book capital', before: null, after: null, change: -cash, note: `Down by the ${$(cash)} distributed.` },
        { name: 'Inside basis', before: null, after: null, change: -cash, note: `The partnership's cash, and so its asset basis, goes down by ${$(cash)}.` }
      ],
      sentence: {
        model: over ? `${pos(a)} outside basis falls from ${$(b)} to $0 and ${a} recognizes ${$(gain)} of gain because the ${$(cash)} cash distribution exceeds basis under § 731(a)(1).`
                    : `${pos(a)} outside basis falls from ${$(b)} to ${$(after)} because the ${$(cash)} cash distribution is less than basis, so it reduces basis without gain under § 731(a)(1).`,
        account: ['outside basis'], link: ['731', 'distribut', 'cash'], result: over ? ['$0', $(gain)] : [$(after), String(after / 1000)]
      },
      change: { label: over ? `the cash distributed is ${$(b - gap)}, less than basis` : `the cash distributed is ${$(b + gap)}, more than basis`, opts: { over: !over } },
      predict: {
        q: `Same facts, but the cash distributed is ${over ? $(b - gap) : $(b + gap)}. Which balance moves, and how far?`,
        choices: over ? ['Outside basis drops by the cash; no gain', 'Outside basis drops to $0 with gain', 'Outside basis doesn\'t change', 'Outside basis goes up']
                      : ['Outside basis drops to $0 and the excess is gain', 'Outside basis drops by all the cash, below zero', 'Outside basis drops by the cash; no gain', 'Outside basis doesn\'t change'],
        correct: 0, why: over ? 'The new distribution is under basis, so it simply reduces basis and there is no gain.' : 'The new distribution exceeds basis, so basis stops at $0 and the excess is gain under § 731(a)(1).'
      },
      decisions: { issue: 'Spotting a cash distribution over basis (§ 731)', predict: 'Predicting whether a distribution exceeds basis' }
    };
  }
};

export const SCENARIOS = Object.keys(S);
export const scenarioTitle = k => (S[k] || {}).title || k;

function shuffleChoices(choices, correct) {
  const order = choices.map((c, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { choices: order.map(i => choices[i]), correct: order.indexOf(correct) };
}

// Build a checked scenario. opts may fix the variant or the numbers (for Change One Fact).
export function makeScenario(key, opts = {}) {
  for (let tries = 0; tries < 40; tries++) {
    const s = S[key].make(opts);
    if (!s || !s.work) continue;
    const run = runWork(s.work, correctSteps(s.work));
    if (Math.round(run.total) !== Math.round(s.answer)) continue;              // the math must check out
    if (s.answer < 0) continue;
    const amts = s.facts.map(f => String(f[1])).filter(v => /^\$/.test(v));
    if (new Set(amts).size !== amts.length) continue;                          // every given amount distinct
    s.id = 'sprint_' + key + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    s.sourceId = 'sprint'; s.topic = s.title;
    const ic = shuffleChoices(s.issue.choices, s.issue.correct); s.issue.choices = ic.choices; s.issue.correct = ic.correct;
    const pc = shuffleChoices(s.predict.choices, s.predict.correct); s.predict.choices = pc.choices; s.predict.correct = pc.correct;
    return s;
  }
  return null;
}
export function randomScenario(preferKeys) {
  const keys = preferKeys && preferKeys.length ? preferKeys : SCENARIOS;
  return makeScenario(pick(keys));
}
// Same scenario and numbers, one fact changed.
export function changeOneFact(s) {
  if (!s.change) return null;
  return makeScenario(s.key, { ...s.change.opts, nums: s.nums });
}

// Find the heading in the user's saved outline that best matches a scenario.
export function findHeading(outlines, keywords, phrases) {
  let best = null;
  for (const o of outlines) for (const sec of o.sections) {
    const h = sec.heading.toLowerCase(), t = (sec.text || '').toLowerCase();
    let score = 0;
    keywords.forEach(k => { const kk = k.toLowerCase(); if (h.includes(kk)) score += 4; if (t.includes(kk)) score += 1; });
    phrases.forEach(p => { const pp = p.toLowerCase(); if (h.includes(pp)) score += 6; else if (t.includes(pp)) score += 3; });
    if ((sec.text || '').length < 40) score -= 2;
    if (score > 3 && (!best || score > best.score)) best = { score, sourceId: o.id, sectionId: sec.id, heading: sec.heading, page: sec.page, outline: o.title };
  }
  return best;
}
// Plain search across outline sections for the in-sprint lookup.
export function searchOutline(outlines, query, limit = 8) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9§().-]+/).filter(t => t.length > 1);
  if (!terms.length) return [];
  const hits = [];
  for (const o of outlines) for (const sec of o.sections) {
    const h = sec.heading.toLowerCase(), t = (sec.text || '').toLowerCase();
    let score = 0;
    terms.forEach(k => { if (h.includes(k)) score += 3; if (t.includes(k)) score += 1; });
    if (t.includes(terms.join(' '))) score += 4;
    if (score) hits.push({ score, o, sec });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Exam sentence: simple automatic hints for the three checklist items.
export function checkSentence(s, text) {
  const t = String(text || '').toLowerCase();
  const has = list => list.some(x => t.includes(String(x).toLowerCase()));
  return { account: has(s.sentence.account), link: has(s.sentence.link) && /because|since|under|so|as/.test(t), result: has(s.sentence.result) };
}
