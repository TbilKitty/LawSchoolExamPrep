// Optional AI mode. Calls the Anthropic API straight from the phone using a key
// the user typed into Settings. The key lives only in this browser's storage.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

async function call(settings, system, user, maxTokens = 2500) {
  if (!settings.aiKey) throw new Error('Add your API key in Settings first.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.aiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.aiModel || 'claude-sonnet-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
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
  const end = text.lastIndexOf(close);
  return JSON.parse(text.slice(start, end + 1));
}

const GROUND = `You write law school study questions strictly from the outline excerpt you are given.
Rules you must follow:
- Use only rules, thresholds, examples and citations that appear in the excerpt. Never add a Code section, regulation, number or rule that the excerpt does not state.
- Any facts you make up for a scenario are a practice hypothetical; mark them with "hypothetical": true.
- Every item must name the exact excerpt heading it relies on in "heading".
- If the excerpt does not support a reliable question, return {"skip": true, "reason": "..."} instead.
- Plain, short sentences. Reply with JSON only.`;

export async function testKey(settings) {
  const out = await call(settings, 'Reply with the single word OK.', 'ping', 10);
  return /ok/i.test(out);
}

export async function aiMultipleChoice(settings, sections, count) {
  const excerpt = sections.map(s => `## ${s.heading}${s.page ? ` (p. ${s.page})` : ''}\n${s.text.slice(0, 5000)}`).join('\n\n').slice(0, 16000);
  const user = `Outline excerpt:\n\n${excerpt}\n\nWrite ${count} multiple-choice questions as a JSON array. Each item:
{"heading": "...", "hypothetical": true|false, "facts": [["label","value"],...] or [], "prompt": "...", "choices": ["","","",""], "correct": 0-3,
 "rule": "the governing rule, restated from the excerpt", "application": "how the rule applies to these facts", "takeaway": "one-line memory hook",
 "whyWrong": ["why choice A fails or null if correct", "...", "...", "..."], "quote": "short phrase copied from the excerpt that supports the answer"}
One best answer; distractors must be plausible mistakes a student would make. If you can write fewer than ${count} reliable questions, write fewer.`;
  const items = extractJSON(await call(settings, GROUND, user, 4000));
  if (!Array.isArray(items)) return { questions: [], skipped: items.reason || 'The AI said the outline didn\'t support questions here.' };
  const qs = [];
  items.forEach((it, i) => {
    const sec = sections.find(s => s.heading.trim().toLowerCase() === String(it.heading || '').trim().toLowerCase()) || (sections.length === 1 ? sections[0] : null);
    if (!sec || !Array.isArray(it.choices) || it.choices.length < 2 || typeof it.correct !== 'number' || !it.choices[it.correct]) return;
    if (it.quote && !sec.text.toLowerCase().includes(String(it.quote).toLowerCase().slice(0, 40))) return; // must be grounded
    qs.push({
      id: 'ai_' + Date.now().toString(36) + '_' + i, type: 'mc', origin: 'ai', topic: sec.heading, topicId: sec.id, sourceId: sec.sourceId,
      prompt: it.prompt, facts: Array.isArray(it.facts) ? it.facts : [], hypothetical: !!it.hypothetical,
      choices: it.choices, correct: it.correct,
      explain: { rule: it.rule || '', application: it.application || '', takeaway: it.takeaway || '' },
      whyWrong: Array.isArray(it.whyWrong) ? it.whyWrong : [],
      source: { outline: sec.sourceTitle, heading: sec.heading, page: sec.page ? 'p. ' + sec.page : '', quote: it.quote || '' }
    });
  });
  return { questions: qs, skipped: qs.length ? null : 'The AI couldn\'t write questions it could tie to your outline text.' };
}

export async function aiEssayPrompt(settings, sec) {
  const user = `Outline excerpt:\n\n## ${sec.heading}\n${sec.text.slice(0, 6000)}\n\nWrite one short issue-spotting practice hypothetical (6-10 sentences of facts, numbers welcome) that can be fully answered using only this excerpt. JSON:
{"heading":"${sec.heading.replace(/"/g, "'")}","hypothetical":true,"facts":"...","call":"the question the student must answer","issues":["issue 1","issue 2"],"keyTerms":["terms or cites from the excerpt a full answer uses"],"model":"a concise model answer using Issue, Rule, Application, Conclusion"}`;
  const it = extractJSON(await call(settings, GROUND, user, 2500));
  if (it.skip) throw new Error(it.reason || 'The AI said this section couldn\'t support an essay prompt.');
  return {
    id: 'aie_' + Date.now().toString(36), type: 'essay', origin: 'ai', topic: sec.heading, topicId: sec.id, sourceId: sec.sourceId,
    hypothetical: true, prompt: `${it.facts}\n\n${it.call}`,
    rubric: { issues: it.issues || [], keyTerms: it.keyTerms || [], model: it.model || '' },
    outlineText: sec.text.slice(0, 2400),
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
