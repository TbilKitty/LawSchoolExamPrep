// Optional AI mode. Calls the Anthropic API straight from the phone using a key
// the user typed into Settings. The key lives only in this browser's storage.
// Everything the AI writes is checked here before it is shown.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

async function call(settings, system, user, maxTokens = 2500) {
  if (!settings.aiKey) throw new Error('Add your API key in Settings first.');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.aiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: settings.aiModel || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    });
  } catch (e) { throw new Error('Couldn\'t reach the AI service. Check your connection; saved sets and Basis Math work offline.'); }
  if (!res.ok) {
    let msg = `The AI service returned an error (${res.status}).`;
    try { const j = await res.json(); if (j.error && j.error.message) msg += ' ' + j.error.message; } catch (e) { /* ignore */ }
    if (res.status === 401) msg = 'That API key was rejected. Check it in Settings.';
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

function extractJSON(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('The AI reply had no data in it.');
  const open = text[start], close = open === '[' ? ']' : '}';
  return JSON.parse(text.slice(start, text.lastIndexOf(close) + 1));
}

// ---------- checks ----------
const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

// Section/regulation numbers mentioned in a piece of text, e.g. "704(d)", "1.752-2".
function citeNumbers(text) {
  const out = [];
  const t = String(text || '');
  for (const m of t.matchAll(/(?:§§?|sec(?:tion)?\.?|irc|i\.r\.c\.)\s*(\d{1,4}[a-z]?(?:\([a-z0-9]+\))*)/gi)) out.push(m[1].toLowerCase());
  for (const m of t.matchAll(/\b(1\.\d{3,4}[a-z]?-\d+[a-z]?)/gi)) out.push(m[1].toLowerCase());
  for (const m of t.matchAll(/rev\.?\s*rul\.?\s*(\d{2,4}-\d+)/gi)) out.push(m[1].toLowerCase());
  return out;
}
function supported(numbers, excerpt) {
  const ex = norm(excerpt).replace(/\s+/g, '');
  return numbers.every(n => ex.includes(n.replace(/\s+/g, '')) || ex.includes(n.split('(')[0]));
}
// A choice that is only a citation ("§ 752(b)", "Treas. Reg. § 1.704-1") isn't an answer.
function bareCite(text) {
  if (!/(§|\bsec(tion)?\.?\s*\d|\birc\b|i\.r\.c\.|\breg(ulation)?s?\.?\s*§?\s*\d|rev\.?\s*rul|treas\.)/i.test(String(text))) return false;
  const rest = String(text).replace(/(§§?|irc|i\.r\.c\.|treas\.?|reg(ulation)?s?\.?|section|sec\.|rev\.?\s*rul\.?|code)/gi, ' ').replace(/[\d().,;:\-–§&]+/g, ' ');
  return rest.split(/\s+/).filter(w => /[a-z]{3,}/i.test(w)).length < 2;
}
const moneyVal = s => { const m = String(s).trim().match(/^(−|-)?\$\s?([\d,]+(?:\.\d+)?)\s?(k\b)?/i); return m ? (m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * (m[3] ? 1000 : 1) : null; };
function evalCalc(expr) {
  const e = String(expr || '').replace(/\$?(\d+(?:\.\d+)?)k\b/gi, (m, n) => String(parseFloat(n) * 1000)).replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\$/g, '').replace(/−/g, '-').replace(/\bmin\b/gi, 'Math.min').replace(/\bmax\b/gi, 'Math.max');
  if (!/^[\d\s+\-*/().,]*$/.test(e.replace(/Math\.(min|max)/g, ''))) return null;
  try { const v = Function('"use strict";return (' + e + ')')(); return isFinite(v) ? v : null; } catch (x) { return null; }
}

const GROUND = `You write law school practice questions from a student's outline so they can learn on their phone without looking anything up.
Rules:
- Test rules the excerpt states. Write a short fact pattern and ask what happens. Every answer choice must be an outcome the student reasons to: a result, an amount, which party, yes or no with the reason, the character or timing of income. Never make a choice that is only a statute or section number. No "all of the above" or "none of the above".
- Exactly one best answer and three plausible wrong answers that reflect real mistakes students make.
- Explain every choice. Correct choice: why it is right. Wrong choice: what it gets wrong, and in "whenRight" the different facts under which that reasoning would work, or "" if none.
- "rule": the governing rule in plain English a student understands without the statute in front of them. "keyFact": the specific fact in the question that makes the rule apply. "application": how the rule applies to these facts.
- "cite": only a statute, regulation, case, or heading that appears in the excerpt, written as it appears there; otherwise "". Never cite anything the excerpt doesn't contain, in any field.
- If the answer is a dollar amount, include "steps" (each calculation line in words and numbers) and "calc" (one arithmetic expression using only numbers, + - * / ( ), min(a,b), max(a,b) that equals the correct amount).
- If the excerpt is too thin to support a question with a definite, reliable answer, return {"skip": true, "reason": "..."} for that item instead.
- Write dollar amounts in short form: $57k, $2.5k, $500 (not $57,000).
- Reply with JSON only.`;

export async function testKey(settings) {
  const out = await call(settings, 'Reply with the single word OK.', 'ping', 10);
  return /ok/i.test(out);
}

function excerptOf(sections, per = 3500, total = 15000) {
  return sections.map(s => `## ${s.heading}${s.page ? ` (p. ${s.page})` : ''}\n${s.text.slice(0, per)}`).join('\n\n').slice(0, total);
}

function buildMC(it, sections, excerpt, i) {
  const sec = sections.find(s => norm(s.heading) === norm(it.heading)) || sections.find(s => norm(it.heading).includes(norm(s.heading)) || norm(s.heading).includes(norm(it.heading))) || (sections.length === 1 ? sections[0] : null);
  if (!sec || it.skip) return { reason: it.reason || 'not tied to a heading' };
  const ch = Array.isArray(it.choices) ? it.choices.filter(c => c && String(c.text || '').trim()) : [];
  if (ch.length !== 4) return { reason: 'needs four choices' };
  if (ch.filter(c => c.correct === true).length !== 1) return { reason: 'needs exactly one correct choice' };
  if (new Set(ch.map(c => norm(c.text))).size !== 4) return { reason: 'duplicate choices' };
  if (ch.some(c => bareCite(c.text))) return { reason: 'a choice was only a citation' };
  if (ch.some(c => !String(c.explanation || '').trim())) return { reason: 'a choice had no explanation' };
  if (!it.rule || !it.prompt) return { reason: 'missing rule or question' };
  if (it.quote && !norm(sec.text).includes(norm(it.quote).slice(0, 40))) return { reason: 'its supporting quote isn\'t in your outline' };
  const allText = [it.prompt, it.rule, it.application, it.keyFact, it.takeaway, ...(it.steps || []), ...ch.flatMap(c => [c.text, c.explanation, c.whenRight])].join(' ');
  if (!supported(citeNumbers(allText), excerpt)) return { reason: 'it cited something your outline doesn\'t contain' };
  const right = ch.find(c => c.correct);
  const amt = moneyVal(right.text);
  if (amt !== null) {
    const v = evalCalc(it.calc);
    if (v === null || Math.abs(v - amt) > 0.5) return { reason: 'its arithmetic didn\'t check out' };
  }
  let cite = String(it.cite || '').trim();
  if (cite && !(supported(citeNumbers(cite), excerpt) && (citeNumbers(cite).length || norm(excerpt).includes(norm(cite))))) cite = '';
  const order = ch.map((c, k) => k);
  for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
  const sc = order.map(k => ch[k]);
  return {
    q: {
      id: 'ai_' + Date.now().toString(36) + '_' + i + Math.random().toString(36).slice(2, 5), type: 'mc', origin: 'ai',
      topic: sec.heading, topicId: sec.id, sourceId: sec.sourceId, course: sec.course,
      prompt: it.prompt, facts: Array.isArray(it.facts) ? it.facts.filter(f => Array.isArray(f)) : [], hypothetical: true,
      choices: sc.map(c => String(c.text)), correct: sc.findIndex(c => c.correct === true),
      notes: sc.map(c => ({ why: String(c.explanation || ''), when: String(c.whenRight || '') })),
      explain: { rule: it.rule, keyFact: it.keyFact || '', application: it.application || '', steps: Array.isArray(it.steps) && amt !== null ? it.steps.map(String) : [], takeaway: it.takeaway || '' },
      cite, source: { outline: sec.sourceTitle, heading: sec.heading, page: sec.page ? 'p. ' + sec.page : '', quote: it.quote || '' }
    }
  };
}

async function mcBatch(settings, sections, n, focus) {
  const excerpt = excerptOf(sections);
  const user = `Outline excerpt:\n\n${excerpt}\n\nWrite ${n} multiple-choice questions${focus ? ` about "${focus}"` : ' spread across these headings'}. Mix rule-application questions with calculation questions where the excerpt has numbers or formulas. JSON array; each item:
{"heading":"exact heading from the excerpt","facts":[["label","value"]],"prompt":"...",
 "choices":[{"text":"...","correct":true,"explanation":"why it is right","whenRight":""},{"text":"...","correct":false,"explanation":"what it gets wrong","whenRight":"facts under which it would be right, or empty"}, ...4 total],
 "rule":"plain English","keyFact":"...","application":"...","takeaway":"one-line memory hook","cite":"","quote":"short phrase copied from the excerpt","steps":[],"calc":""}`;
  const items = extractJSON(await call(settings, GROUND, user, 7000));
  return Array.isArray(items) ? items : [items];
}

// sections: [{id, heading, text, page, sourceId, sourceTitle, course}]
export async function aiMultipleChoice(settings, sections, count, focus) {
  const usable = sections.filter(s => (s.text || '').replace(/\s/g, '').length >= 250);
  if (!usable.length) return { questions: [], skipped: ['The selected material is too thin to support reliable questions. Pick a fuller topic or more outlines.'] };
  const batches = [];
  for (let left = count, b = 0; left > 0; left -= 5, b++) {
    const rot = usable.slice((b * 3) % usable.length).concat(usable.slice(0, (b * 3) % usable.length));
    batches.push(mcBatch(settings, rot.slice(0, 6), Math.min(5, left) + 1, focus));
  }
  const results = await Promise.allSettled(batches);
  const qs = [], skipped = [];
  let firstErr = null;
  results.forEach((r, b) => {
    if (r.status === 'rejected') { firstErr = firstErr || r.reason; return; }
    const rot = usable.slice((b * 3) % usable.length).concat(usable.slice(0, (b * 3) % usable.length)).slice(0, 6);
    const excerpt = excerptOf(rot);
    r.value.forEach((it, i) => {
      const out = buildMC(it || {}, rot, excerpt, b * 10 + i);
      if (out.q) qs.push(out.q); else skipped.push(out.reason);
    });
  });
  if (!qs.length && firstErr) throw firstErr;
  const uniq = []; const seen = new Set();
  qs.forEach(q => { const k = norm(q.prompt).slice(0, 80); if (!seen.has(k)) { seen.add(k); uniq.push(q); } });
  const notes = skipped.length ? [`Skipped ${skipped.length} question${skipped.length > 1 ? 's' : ''} that didn't pass the checks (${[...new Set(skipped)].slice(0, 3).join('; ')}).`] : [];
  return { questions: uniq.slice(0, count), skipped: notes };
}

export async function aiEssayPrompt(settings, sec) {
  if ((sec.text || '').replace(/\s/g, '').length < 400) throw new Error('This section is too thin for a reliable essay prompt.');
  const user = `Outline excerpt:\n\n## ${sec.heading}\n${sec.text.slice(0, 6000)}\n\nWrite one short essay practice question (5-8 sentences of facts) fully answerable from this excerpt. JSON:
{"facts":"...","call":"the question the student must answer","issues":["issue 1","issue 2"],"checklist":["each point a full answer must make, as a checkable line"],"keyTerms":["terms from the excerpt a full answer uses"],"model":"a short model answer (120-200 words) in Issue, Rule, Application, Conclusion form","cite":"only a citation that appears in the excerpt, else empty"}`;
  const it = extractJSON(await call(settings, GROUND, user, 2500));
  if (it.skip) throw new Error(it.reason || 'The AI said this section couldn\'t support an essay prompt.');
  const all = [it.facts, it.call, it.model, ...(it.checklist || []), ...(it.issues || [])].join(' ');
  if (!supported(citeNumbers(all), sec.text)) throw new Error('The draft essay cited something your outline doesn\'t contain, so it was skipped.');
  let cite = String(it.cite || '').trim();
  if (cite && !supported(citeNumbers(cite), sec.text)) cite = '';
  return {
    id: 'aie_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'essay', origin: 'ai',
    topic: sec.heading, topicId: sec.id, sourceId: sec.sourceId, course: sec.course,
    hypothetical: true, prompt: `${it.facts}\n\n${it.call}`,
    rubric: { issues: it.issues || [], checklist: it.checklist || it.issues || [], keyTerms: it.keyTerms || [], model: it.model || '' },
    outlineText: sec.text.slice(0, 2400), cite,
    source: { outline: sec.sourceTitle, heading: sec.heading, page: sec.page ? 'p. ' + sec.page : '' }
  };
}

export async function aiGradeEssay(settings, q, answer) {
  const user = `Outline excerpt (the only authority you may use):\n## ${q.source.heading}\n${q.outlineText}\n\nQuestion:\n${q.prompt}\n\nStudent answer:\n${answer}\n\nGrade the answer on four steps. JSON:
{"issue":{"score":0-3,"note":"..."},"rule":{"score":0-3,"note":"..."},"application":{"score":0-3,"note":"..."},"conclusion":{"score":0-3,"note":"..."},
"missed":["specific issues or rules from the excerpt the student left out"],"outlinePointers":["short phrases from the excerpt to reread"],"encouragement":"one specific, kind sentence","nextStep":"one concrete thing to do next"}
Only point to rules that appear in the excerpt. Be specific and encouraging.`;
  return extractJSON(await call(settings, GROUND, user, 2000));
}

// exposed for tests
export const _checks = { bareCite, citeNumbers, supported, evalCalc, buildMC, moneyVal };
