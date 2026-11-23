// Basis Math: partnership tax calculations generated on the phone with fresh numbers.
// Each problem lists its math as steps. Before a question is shown, the steps are run
// and checked against a direct formula, every wrong choice must differ from the answer
// and from each other, and each choice carries its own explanation.

export const DRILL_ID = 'drill_basis_math';

const NAMES = ['Ana', 'Ben', 'Cora', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jada', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia'];
const r = (min, max, step = 1000) => min + step * Math.floor(Math.random() * (Math.floor((max - min) / step) + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const name = () => pick(NAMES);
export const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const $ = money;
const share = n => n === 2 ? 'half' : n === 3 ? 'one-third' : 'one-quarter';

// ---------- step runner ----------
// ['start', v, label] ['add', v, label] ['sub', v, label] ['subcap', v, label] (subtract up to the running amount)
export function runSteps(steps) {
  let t = 0; const lines = [];
  for (const [op, v, label] of steps) {
    if (op === 'start') { t = v; lines.push(`Start with ${$(v)}${label ? ' ' + label : ''}.`); }
    else if (op === 'add') { t += v; lines.push(`Add ${$(v)} ${label} → ${$(t)}.`); }
    else if (op === 'sub') { t -= v; lines.push(`Subtract ${$(v)} ${label} → ${$(t)}.`); }
    else if (op === 'subcap') {
      const used = Math.min(v, Math.max(t, 0));
      lines.push(used < v
        ? `Subtract ${label}, but only up to the basis left: the lesser of ${$(v)} and ${$(t)} is ${$(used)} → ${$(t - used)}.`
        : `Subtract ${$(v)} ${label} → ${$(t - used)}.`);
      t -= used;
    }
  }
  return { total: t, lines };
}

// ---------- templates ----------
// Each returns { facts, prompt, ask, steps, expect, wrong:[{v, why, when}], right, rule, keyFact, takeaway, cite } or null to retry.
const T = {};

T['initial-outside-basis'] = {
  title: 'Initial outside basis', level: 1,
  make() {
    const a = name(), ab = r(10000, 60000), fmv = ab + r(5000, 40000), c = r(5000, 30000);
    return {
      ask: 'Outside basis',
      facts: [[`${a} contributes cash`, $(c)], ['and land with an adjusted basis of', $(ab)], ['Land fair market value', $(fmv)], ['Debt', 'None']],
      prompt: `What is ${a}'s outside basis in the partnership right after the contribution?`,
      steps: [['start', c, 'of cash contributed'], ['add', ab, 'adjusted basis of the land']],
      expect: c + ab,
      right: `Outside basis carries over the partner's own basis: the cash plus the land's adjusted basis.`,
      wrong: [
        { v: c + fmv, why: 'Uses the land\'s fair market value instead of its adjusted basis.', when: 'Cash plus FMV is the partner\'s § 704(b) book capital account, not outside basis.' },
        { v: ab, why: 'Leaves out the cash contributed.', when: 'It would be right if only the land went in.' },
        { v: fmv, why: 'Uses FMV and leaves out the cash.' },
        { v: fmv - ab, why: 'That is the built-in gain on the land, not a basis figure.' }
      ],
      rule: 'A partner\'s outside basis starts with the cash contributed plus the adjusted basis of any property contributed. Fair market value does not matter for outside basis.',
      keyFact: `The land's adjusted basis is ${$(ab)}. Its ${$(fmv)} FMV doesn't count here.`,
      takeaway: 'Outside basis = cash + adjusted basis.',
      cite: 'IRC § 722'
    };
  }
};

T['inside-basis'] = {
  title: 'Inside basis in contributed property', level: 1,
  make() {
    const a = name(), ab = r(10000, 60000), fmv = ab + r(5000, 40000), c = r(5000, 20000);
    return {
      ask: 'Inside basis (the partnership\'s basis in the property)',
      facts: [[`${a} contributes equipment with an adjusted basis of`, $(ab)], ['Equipment fair market value', $(fmv)], [`${a} also contributes cash`, $(c)]],
      prompt: `What is the partnership's inside basis in the equipment?`,
      steps: [['start', ab, `(${a}'s adjusted basis in the equipment carries over to the partnership)`]],
      expect: ab,
      right: `The partnership takes the equipment with ${a}'s adjusted basis. Cash isn't part of the equipment's basis.`,
      wrong: [
        { v: fmv, why: 'Uses fair market value. The partnership does not get a stepped-up basis on a contribution.', when: 'FMV is the equipment\'s § 704(b) book value.' },
        { v: ab + c, why: 'Adds the cash. That is closer to the partner\'s outside basis, a different number.', when: 'Cash plus adjusted basis is the partner\'s outside basis.' },
        { v: fmv - ab, why: 'That is the built-in gain the § 704(c) rules track, not a basis.' }
      ],
      rule: 'The partnership\'s basis in contributed property is the contributing partner\'s adjusted basis, carried over.',
      keyFact: `${a}'s adjusted basis in the equipment is ${$(ab)}.`,
      takeaway: 'Inside basis carries over; FMV is only for the book account.',
      cite: 'IRC § 723'
    };
  }
};

T['debt-increase'] = {
  title: 'Increase in share of debt', level: 1,
  make() {
    const a = name(), b = r(10000, 60000), d = r(2000, 30000);
    return {
      ask: 'Outside basis',
      facts: [[`${a}'s outside basis`, $(b)], ['The partnership borrows; ' + a + '\'s share of the new debt', $(d)], ['Other adjustments', 'None']],
      prompt: `What is ${a}'s outside basis after the borrowing?`,
      steps: [['start', b, 'of outside basis'], ['add', d, `increase in ${a}'s share of partnership debt (treated as a cash contribution)`]],
      expect: b + d,
      right: 'An increase in a partner\'s share of partnership liabilities is treated as a cash contribution, so basis goes up.',
      wrong: [
        { v: b, why: 'Ignores the debt. A partner\'s share of partnership liabilities is part of outside basis.' },
        { v: b - d, why: 'Treats the new debt as a decrease. Taking on a share of debt increases basis.', when: 'Subtracting is right when a partner\'s share of debt goes down.' },
        { v: d, why: 'Uses only the debt share and drops the starting basis.' }
      ],
      rule: 'When a partner\'s share of partnership debt goes up, the partner is treated as contributing that much cash, which increases outside basis.',
      keyFact: `${a}'s share of partnership debt went up by ${$(d)}.`,
      takeaway: 'More debt share, more basis.',
      cite: 'IRC §§ 752(a), 722'
    };
  }
};

T['debt-decrease'] = {
  title: 'Decrease in share of debt', level: 1,
  make() {
    const a = name(), b = r(20000, 70000), d = r(2000, b - 5000);
    return {
      ask: 'Outside basis',
      facts: [[`${a}'s outside basis`, $(b)], ['The partnership pays down debt; ' + a + '\'s share drops by', $(d)], ['Other adjustments', 'None']],
      prompt: `What is ${a}'s outside basis after the paydown?`,
      steps: [['start', b, 'of outside basis'], ['sub', d, `decrease in ${a}'s share of partnership debt (treated as a cash distribution)`]],
      expect: b - d,
      right: 'A drop in a partner\'s share of partnership debt is treated as a cash distribution, which reduces basis.',
      wrong: [
        { v: b, why: 'Ignores the change in debt share.' },
        { v: b + d, why: 'Adds the paydown. A smaller debt share reduces basis.', when: 'Adding is right when the partner\'s debt share increases.' },
        { v: d, why: 'Uses only the change and drops the starting basis.' }
      ],
      rule: 'When a partner\'s share of partnership debt goes down, the partner is treated as receiving that much cash, which reduces outside basis.',
      keyFact: `${a}'s share of partnership debt fell by ${$(d)}.`,
      takeaway: 'Less debt share = deemed cash out.',
      cite: 'IRC §§ 752(b), 733'
    };
  }
};

T['cash-distribution'] = {
  title: 'Cash distribution', level: 1,
  make() {
    const a = name(), b = r(15000, 70000), d = r(2000, b - 3000);
    return {
      ask: 'Outside basis',
      facts: [[`${a}'s outside basis`, $(b)], ['Cash distributed to ' + a, $(d)], ['Other adjustments', 'None']],
      prompt: `What is ${a}'s outside basis after the distribution?`,
      steps: [['start', b, 'of outside basis'], ['sub', d, 'cash distribution']],
      expect: b - d,
      right: 'A cash distribution reduces outside basis dollar for dollar (no gain, because it\'s less than basis).',
      wrong: [
        { v: b, why: 'Leaves out the cash distribution.' },
        { v: b + d, why: 'Adds the distribution. Cash coming out reduces basis.', when: 'Adding is right for a cash contribution.' },
        { v: d, why: 'That is the distribution itself, not the basis left.' }
      ],
      rule: 'Cash distributed to a partner reduces outside basis, but not below zero.',
      keyFact: `${$(d)} is less than ${a}'s ${$(b)} basis, so it just reduces basis.`,
      takeaway: 'Cash out, basis down.',
      cite: 'IRC §§ 731(a), 733'
    };
  }
};

T['income-and-distribution'] = {
  title: 'Income and a distribution', level: 2,
  make() {
    const a = name(), b = r(10000, 50000), i = r(2000, 20000), d = r(1000, b + i - 2000);
    return {
      ask: 'Ending outside basis',
      facts: [['Beginning outside basis', $(b)], ['Allocated taxable income', $(i)], ['Cash distribution', $(d)], ['Other adjustments', 'None']],
      prompt: `${a} starts with ${$(b)} of outside basis, is allocated ${$(i)} of taxable income, and receives a ${$(d)} cash distribution. There are no other adjustments. What is ${a}'s ending outside basis?`,
      steps: [['start', b, 'of beginning outside basis'], ['add', i, 'of allocated taxable income'], ['sub', d, 'cash distribution']],
      expect: b + i - d,
      right: 'Basis goes up by the income allocated and down by the cash distributed.',
      wrong: [
        { v: b - d, why: 'Leaves out the allocated income, which increases basis even if no cash came with it.' },
        { v: b, why: 'Leaves out both the income and the distribution.' },
        { v: b + i, why: 'Leaves out the cash distribution.' },
        { v: b - i - d, why: 'Subtracts the income. Allocated income increases basis.', when: 'Subtracting is right for an allocated loss.' }
      ],
      rule: 'A partner\'s outside basis increases by the partner\'s share of partnership income and decreases by cash distributed to the partner.',
      keyFact: `${a} was allocated ${$(i)} of income and received ${$(d)} in cash.`,
      takeaway: 'Income up, distributions down.',
      cite: 'IRC §§ 705, 733'
    };
  }
};

const FOUR = {
  ob: 'outside basis', ib: 'partnership\'s inside basis in the land', book: '§ 704(b) book capital account', tax: 'tax basis capital account'
};
T['four-numbers'] = {
  title: 'Outside basis, inside basis, book and tax capital', level: 2,
  make(opt = {}) {
    const a = name(), n = pick([2, 4]), ab = r(20000, 60000), fmv = ab + r(10000, 40000), c = r(5000, 20000), L = r(4000, 20000, 2000);
    const sh = L / n;
    const v = { ob: c + ab - L + sh, ib: ab, book: c + fmv - L, tax: c + ab - L };
    if (v.tax <= 0 || c === L || new Set(Object.values(v)).size < 4) return null;
    const ask = opt.variant || pick(Object.keys(FOUR));
    const steps = {
      ob: [['start', c, 'of cash'], ['add', ab, 'adjusted basis of the land'], ['sub', L, 'debt the partnership took over'], ['add', sh, `${a}'s ${share(n)} share of that debt as a partner`]],
      ib: [['start', ab, `(${a}'s adjusted basis in the land carries over)`]],
      book: [['start', c, 'of cash'], ['add', fmv, 'fair market value of the land'], ['sub', L, 'debt the partnership took over']],
      tax: [['start', c, 'of cash'], ['add', ab, 'adjusted basis of the land'], ['sub', L, 'debt the partnership took over']]
    }[ask];
    const why = {
      ob: { why: 'That is outside basis. It includes the partner\'s share of partnership debt; the capital accounts don\'t.', when: 'Right if the question asked for outside basis.' },
      ib: { why: 'That is the partnership\'s inside basis in the land only. It leaves out the cash and the debt.', when: 'Right if the question asked for the partnership\'s basis in the land.' },
      book: { why: 'That is the § 704(b) book capital account, which uses fair market value.', when: 'Right if the question asked for book capital.' },
      tax: { why: 'That is the tax basis capital account: adjusted basis, net of debt, with no debt share added back.', when: 'Right if the question asked for tax capital.' }
    };
    const rules = {
      ob: 'Outside basis = cash + adjusted basis of property − debt the partnership takes over + the partner\'s share of that debt.',
      ib: 'The partnership\'s basis in contributed property is the partner\'s adjusted basis, carried over.',
      book: 'The § 704(b) book capital account = cash + fair market value of property − liabilities the partnership assumes. No debt share is added.',
      tax: 'Tax basis capital = cash + adjusted basis of property − liabilities the partnership assumes. It equals outside basis minus the partner\'s share of debt.'
    };
    const cites = { ob: 'IRC §§ 722, 752', ib: 'IRC § 723', book: 'Treas. Reg. § 1.704-1(b)(2)(iv)(b)', tax: 'IRC §§ 705, 722; Form 1065 Schedule K-1 instructions (tax basis method)' };
    const keyFacts = {
      ob: `The question asks for outside basis, so it uses adjusted basis (${$(ab)}) and counts ${a}'s ${$(sh)} share of the debt.`,
      ib: `The question asks for the partnership's basis in the land, which is ${a}'s adjusted basis of ${$(ab)}.`,
      book: `The question asks for book capital, so it uses the land's FMV (${$(fmv)}) and nets the ${$(L)} debt.`,
      tax: `The question asks for tax capital, so it uses adjusted basis (${$(ab)}) and nets the ${$(L)} debt, with no debt share added.`
    };
    return {
      variant: ask, ask: FOUR[ask][0].toUpperCase() + FOUR[ask].slice(1),
      facts: [[`${a} contributes cash`, $(c)], ['and land with an adjusted basis of', $(ab)], ['Land fair market value', $(fmv)], ['Recourse debt on the land, assumed by the partnership', $(L)], ['Partners', `${n}, sharing losses and debt equally`]],
      prompt: ask === 'ib' ? `What is the partnership's inside basis in the land right after the contribution?` : `What is ${a}'s ${FOUR[ask]} right after the contribution?`,
      steps, expect: v[ask],
      right: rules[ask],
      wrong: Object.keys(FOUR).filter(k => k !== ask).map(k => ({ v: v[k], ...why[k] })).concat([
        { v: c + fmv, why: 'Uses FMV and ignores the debt.' }, { v: c + ab, why: 'Ignores the debt entirely.' }
      ]),
      rule: rules[ask], keyFact: keyFacts[ask],
      takeaway: 'Outside basis = tax capital + debt share. Book uses FMV. Inside basis is the asset\'s own basis.',
      cite: cites[ask]
    };
  }
};

T['loss-limit'] = {
  title: '§ 704(d) loss limit', level: 2,
  make(opt = {}) {
    const a = name(), b = r(5000, 40000), loss = b + r(2000, 30000);
    const ask = opt.variant || pick(['allowed', 'suspended', 'ending']);
    const base = { allowed: b, suspended: loss - b, ending: 0 };
    const steps = {
      allowed: [['start', b, 'of outside basis (the most loss that can be deducted)']],
      suspended: [['start', loss, 'allocated loss'], ['sub', b, 'deductible this year (limited to basis)']],
      ending: [['start', b, 'of outside basis'], ['subcap', loss, 'the allocated loss']]
    }[ask];
    const label = { allowed: 'Loss ' + a + ' can deduct this year', suspended: 'Suspended loss carried forward', ending: 'Ending outside basis' }[ask];
    return {
      variant: ask, ask: label,
      facts: [[`${a}'s outside basis before the loss`, $(b)], ['Allocated partnership loss', $(loss)], ['Other adjustments', 'None']],
      prompt: { allowed: `How much of the loss can ${a} deduct this year?`, suspended: `How much of the loss is suspended and carried forward?`, ending: `What is ${a}'s outside basis at year-end?` }[ask],
      steps, expect: base[ask],
      right: 'A partner can deduct losses only up to outside basis. The rest is suspended until the partner has basis again, and basis never goes below zero.',
      wrong: {
        allowed: [
          { v: loss, why: 'Allows the whole loss. Losses are capped at outside basis.', when: 'Right if basis were at least as large as the loss.' },
          { v: loss - b, why: 'That is the suspended part, not the deductible part.' },
          { v: 0, why: 'Some of the loss is deductible: up to the basis available.' },
          { v: b - loss, why: 'Subtracts the loss from basis; the question asks how much loss is deductible.' }
        ],
        suspended: [
          { v: 0, why: 'The loss is bigger than basis, so part of it must be suspended.', when: 'Right if basis were at least as large as the loss.' },
          { v: b, why: 'That is the deductible part (equal to basis), not the suspended part.' },
          { v: loss, why: 'Suspends the whole loss. The part up to basis is deductible now.' },
          { v: b - loss, why: 'Lets basis go negative instead of carrying the excess forward.' }
        ],
        ending: [
          { v: b - loss, why: 'Lets basis go negative. Basis stops at zero.' },
          { v: b, why: 'Leaves out the loss.' },
          { v: loss - b, why: 'That is the suspended loss, not basis.' },
          { v: loss, why: 'That is the full allocated loss, not basis.' }
        ]
      }[ask],
      rule: 'Losses are deductible only up to the partner\'s outside basis at year-end. Any excess carries forward until there is basis to absorb it.',
      keyFact: `The ${$(loss)} loss is larger than ${a}'s ${$(b)} basis.`,
      takeaway: 'Loss is capped at basis; the rest waits.',
      cite: 'IRC § 704(d); Treas. Reg. § 1.704-1(d)'
    };
  }
};

T['distribution-over-basis'] = {
  title: 'Cash distribution greater than basis', level: 2,
  make(opt = {}) {
    const a = name(), b = r(5000, 40000), d = b + r(2000, 25000);
    const ask = opt.variant || pick(['gain', 'ending']);
    return {
      variant: ask, ask: ask === 'gain' ? 'Gain recognized' : 'Ending outside basis',
      facts: [[`${a}'s outside basis`, $(b)], ['Cash distributed to ' + a, $(d)], ['Other adjustments', 'None']],
      prompt: ask === 'gain' ? `How much gain does ${a} recognize on the distribution?` : `What is ${a}'s outside basis after the distribution?`,
      steps: ask === 'gain' ? [['start', d, 'of cash distributed'], ['sub', b, 'outside basis']] : [['start', b, 'of outside basis'], ['subcap', d, 'the cash distribution']],
      expect: ask === 'gain' ? d - b : 0,
      right: 'Cash beyond outside basis is taxed as gain, and basis drops to zero.',
      wrong: ask === 'gain' ? [
        { v: 0, why: 'Distributions are tax-free only up to basis; the excess is gain.', when: 'Right if the cash were no more than basis.' },
        { v: d, why: 'Treats all the cash as gain without first recovering basis.' },
        { v: b, why: 'That is the basis recovered tax-free, not the gain.' },
        { v: b - d, why: 'Subtracts the wrong way; gain is cash minus basis.' }
      ] : [
        { v: b - d, why: 'Lets basis go negative. Basis stops at zero; the excess is gain instead.' },
        { v: d - b, why: 'That is the gain, not basis.' },
        { v: b, why: 'Leaves out the distribution.' },
        { v: d, why: 'That is the cash distributed, not basis.' }
      ],
      rule: 'A partner recognizes gain only when cash distributed is more than the partner\'s outside basis. Basis can\'t go below zero.',
      keyFact: `The ${$(d)} distribution exceeds ${a}'s ${$(b)} basis.`,
      takeaway: 'Cash over basis = gain.',
      cite: 'IRC §§ 731(a)(1), 733'
    };
  }
};

T['year-end'] = {
  title: 'Year-end outside basis, start to finish', level: 3,
  make(opt = {}) {
    const a = name(), beg = r(10000, 40000), inc = r(2000, 25000), ex = pick([0, r(1000, 5000)]), up = pick([0, r(3000, 15000)]);
    const dist = r(2000, 20000), loss = r(5000, 60000);
    const pre = beg + inc + ex + up;
    if (dist >= pre) return null;
    const afterDist = pre - dist, allowed = Math.min(loss, afterDist), end = afterDist - allowed, susp = loss - allowed;
    const ask = opt.variant || (susp > 0 ? pick(['ending', 'suspended']) : 'ending');
    if (ask === 'suspended' && susp <= 0) return null;
    const steps = [['start', beg, 'of beginning outside basis'], ['add', inc, 'allocated taxable income']];
    if (ex) steps.push(['add', ex, 'allocated tax-exempt income']);
    if (up) steps.push(['add', up, 'increase in share of partnership debt']);
    steps.push(['sub', dist, 'cash distribution (distributions come off before losses)']);
    if (ask === 'ending') steps.push(['subcap', loss, 'the allocated loss']);
    else steps.push(['start', loss, 'allocated loss, then compare to basis'], ['sub', afterDist, 'deductible (the basis left after the distribution)']);
    const wrongEnd = [
      { v: afterDist - loss, why: 'Lets basis go negative. The loss is allowed only up to basis.' },
      { v: Math.max(0, pre - loss) - dist, why: 'Takes the loss before the distribution. Distributions come off first.' },
      { v: ex ? Math.max(0, afterDist - ex - loss) : null, why: 'Leaves out tax-exempt income, which also increases basis.' },
      { v: up ? Math.max(0, afterDist - up - loss) : null, why: 'Leaves out the increase in debt share, a deemed contribution.' },
      { v: Math.max(0, pre - loss), why: 'Leaves out the cash distribution.' },
      { v: afterDist, why: 'Leaves out the loss.' }
    ];
    const wrongSusp = [
      { v: loss, why: 'Treats the whole loss as suspended. The part up to basis is deductible.' },
      { v: Math.max(0, loss - pre), why: 'Ignores the distribution, which reduces basis before the loss is tested.', when: 'Right if there were no distribution this year.' },
      { v: afterDist, why: 'That is the deductible part, not the suspended part.' },
      { v: 0, why: 'The loss exceeds the basis left, so some is suspended.' }
    ];
    return {
      variant: ask, ask: ask === 'ending' ? 'Ending outside basis' : 'Suspended loss',
      facts: [['Beginning outside basis', $(beg)], ['Allocated taxable income', $(inc)], ...(ex ? [['Allocated tax-exempt income', $(ex)]] : []), ...(up ? [['Increase in ' + a + '\'s share of partnership debt', $(up)]] : []), ['Cash distribution', $(dist)], ['Allocated loss', $(loss)], ['Order', 'Increases, then distributions, then losses']],
      prompt: ask === 'ending' ? `What is ${a}'s outside basis at year-end?` : `How much of ${a}'s loss is suspended?`,
      steps, expect: ask === 'ending' ? end : susp,
      right: 'Add all the increases first, subtract distributions, then take losses only up to the basis left.',
      wrong: (ask === 'ending' ? wrongEnd : wrongSusp).filter(w => w.v !== null),
      rule: 'Each year, outside basis goes up for income (taxable and tax-exempt) and debt increases, then down for distributions, then down for losses, but losses can\'t take basis below zero.',
      keyFact: susp > 0 ? `After the distribution, only ${$(afterDist)} of basis is left for a ${$(loss)} loss.` : `The ${$(loss)} loss fits within the ${$(afterDist)} of basis left after the distribution.`,
      takeaway: 'Up, then distributions, then losses.',
      cite: 'IRC §§ 705, 733, 752, 704(d); Treas. Reg. § 1.704-1(d)(2)'
    };
  }
};

T['debt-relief-gain'] = {
  title: 'Gain when debt relief exceeds basis', level: 3,
  make() {
    const a = name(), n = pick([2, 4]), ab = r(5000, 30000), L = ab + r(20000, 80000, 4000), fmv = L + r(10000, 60000);
    const kept = L / n, relief = L - kept, gain = relief - ab;
    if (gain <= 0) return null;
    return {
      ask: 'Gain recognized',
      facts: [[`${a} contributes a building with an adjusted basis of`, $(ab)], ['Building fair market value', $(fmv)], ['Recourse mortgage the partnership takes over', $(L)], ['Partners', `${n}, sharing losses and debt equally`]],
      prompt: `How much gain does ${a} recognize on the contribution?`,
      steps: [['start', L, 'mortgage the partnership took over'], ['sub', kept, `${a}'s ${share(n)} share, which ${a} still bears as a partner`], ['sub', ab, `${a}'s basis from the contribution (net relief beyond this is gain)`]],
      expect: gain,
      right: 'The net debt shifted to the other partners is treated as cash to the contributor. Cash beyond basis is gain.',
      wrong: [
        { v: L - ab, why: `Treats the whole mortgage as relief and forgets ${a}'s ${share(n)} share.`, when: 'Right only if the contributor kept no share of the debt.' },
        { v: 0, why: 'Contributions are usually tax-free, but not when net debt relief exceeds basis.', when: 'Right if net relief were no more than basis.' },
        { v: fmv - ab, why: 'That is the built-in gain on the building, which isn\'t taxed on contribution.' },
        { v: relief, why: 'Forgets to offset the contributor\'s basis first.' }
      ],
      rule: 'When a partnership takes over a contributor\'s debt, the debt shifted to the other partners is treated as a cash distribution. If it is more than the contributor\'s basis, the excess is gain.',
      keyFact: `Net relief of ${$(relief)} is more than ${a}'s ${$(ab)} basis.`,
      takeaway: 'Gain only when net relief beats basis.',
      cite: 'IRC §§ 752(b), 731(a)(1); Treas. Reg. § 1.752-1(f)'
    };
  }
};

T['distribution-with-debt-drop'] = {
  title: 'Cash plus debt relief over basis', level: 3,
  make() {
    const a = name(), b = r(10000, 40000), d = r(2000, b - 2000), drop = r(3000, 30000);
    const gain = d + drop - b;
    if (gain <= 0) return null;
    return {
      ask: 'Gain recognized',
      facts: [[`${a}'s outside basis`, $(b)], ['Cash distributed', $(d)], [`Decrease in ${a}'s share of partnership debt (same year)`, $(drop)]],
      prompt: `How much gain does ${a} recognize?`,
      steps: [['start', d, 'cash distributed'], ['add', drop, 'drop in debt share (treated as cash)'], ['sub', b, 'outside basis']],
      expect: gain,
      right: 'The drop in debt share counts as cash. Together the cash and deemed cash exceed basis, and the excess is gain.',
      wrong: [
        { v: 0, why: `The cash alone is under basis, but the ${$(drop)} debt decrease counts as cash too.`, when: 'Right if the debt share hadn\'t changed.' },
        { v: d + drop, why: 'Forgets to recover basis first.' },
        { v: b - d, why: 'That is the basis left after the actual cash only.' },
        { v: drop, why: 'Treats only the debt drop as gain.' }
      ],
      rule: 'A decrease in a partner\'s share of partnership debt is treated as a cash distribution. Cash and deemed cash beyond outside basis are gain.',
      keyFact: `${$(d)} cash + ${$(drop)} deemed cash = ${$(d + drop)}, more than the ${$(b)} basis.`,
      takeaway: 'Debt relief is cash.',
      cite: 'IRC §§ 752(b), 731(a)(1)'
    };
  }
};

T['contribution-then-year'] = {
  title: 'Contribution with debt, then a year of activity', level: 3,
  make() {
    const a = name(), n = pick([2, 4]), ab = r(20000, 60000), fmv = ab + r(10000, 40000), c = r(0, 20000, 5000), L = r(4000, 24000, 4000);
    const sh = L / n, init = c + ab - L + sh, inc = r(2000, 20000), d = r(1000, 15000);
    const end = init + inc - d;
    if (init <= 0 || end <= 0) return null;
    const steps = [];
    if (c) steps.push(['start', c, 'of cash contributed'], ['add', ab, 'adjusted basis of the property']);
    else steps.push(['start', ab, 'adjusted basis of the property']);
    steps.push(['sub', L, 'debt the partnership took over'], ['add', sh, `${a}'s ${share(n)} share of that debt`], ['add', inc, 'allocated taxable income'], ['sub', d, 'cash distribution']);
    return {
      ask: 'Year-end outside basis',
      facts: [...(c ? [[`${a} contributes cash`, $(c)]] : []), [`${a} contributes property, adjusted basis`, $(ab)], ['Property fair market value', $(fmv)], ['Recourse debt on the property, assumed by the partnership', $(L)], ['Partners', `${n}, sharing losses and debt equally`], ['Allocated taxable income for the year', $(inc)], ['Cash distributed during the year', $(d)]],
      prompt: `What is ${a}'s outside basis at the end of the first year?`,
      steps, expect: end,
      right: 'Start with the contribution basis (net of debt shifted to others), add income, subtract the distribution.',
      wrong: [
        { v: end - ab + fmv, why: 'Uses fair market value instead of adjusted basis.', when: 'FMV belongs in the § 704(b) book capital account.' },
        { v: end - sh, why: `Forgets ${a}'s share of the debt the partnership took over.`, when: 'Leaving out the debt share gives tax basis capital, not outside basis.' },
        { v: end + d, why: 'Leaves out the cash distribution.' },
        { v: end + L - sh, why: 'Never subtracts the debt the partnership took over.' },
        { v: end - inc, why: 'Leaves out the allocated income.' }
      ],
      rule: 'Contribution basis is cash + adjusted basis, minus the debt the other partners take over. During the year, add income and subtract distributions.',
      keyFact: `${a} still bears ${$(sh)} of the ${$(L)} debt as a partner.`,
      takeaway: 'Net the debt, then income up and distributions down.',
      cite: 'IRC §§ 722, 752, 705, 733'
    };
  }
};

export const TEMPLATES = Object.keys(T);
export const DRILL_TOPICS = TEMPLATES.map(k => ({ key: k, title: T[k].title, level: T[k].level }));

function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Build one checked question. Returns null only if 60 tries all fail the checks.
export function makeQuestion(key, opt = {}) {
  for (let tries = 0; tries < 60; tries++) {
    const g = T[key].make(opt);
    if (!g) continue;
    const { total, lines } = runSteps(g.steps);
    if (Math.round(total) !== Math.round(g.expect)) continue;                  // the math shown must equal the answer
    const ans = Math.round(g.expect);
    const used = new Set([ans]);
    const wrong = [];
    for (const w of g.wrong) {
      if (w.v === null || w.v === undefined || !isFinite(w.v) || !w.why) continue;
      const k = Math.round(w.v);
      if (used.has(k)) continue;
      used.add(k); wrong.push({ ...w, v: k });
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) continue;                                             // need exactly four distinct choices
    const opts = shuffle([{ v: ans, why: g.right, ok: true }, ...wrong]);
    const correct = opts.findIndex(o => o.ok);
    if (opts.filter(o => Math.round(o.v) === ans).length !== 1) continue;       // exactly one correct choice
    return {
      id: `${DRILL_ID}_${key}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      type: 'mc', origin: 'drill', template: key, variant: g.variant || null, level: T[key].level,
      topic: T[key].title, sourceId: DRILL_ID, ask: g.ask, hypothetical: true,
      facts: g.facts, prompt: g.prompt,
      choices: opts.map(o => money(o.v)),
      notes: opts.map(o => ({ why: o.why, when: o.when || '' })),
      correct,
      explain: { rule: g.rule, keyFact: g.keyFact, steps: [...lines, `${g.ask} is ${money(ans)}.`], takeaway: g.takeaway },
      source: { outline: 'Basis Math', heading: g.cite }, cite: g.cite
    };
  }
  return null;
}

// A session: easier problems first, building to multistep ones.
export function drillQueue(keys, count) {
  const pool = (keys && keys.length ? keys : TEMPLATES).filter(k => T[k]);
  const picks = [];
  let bag = [];
  while (picks.length < count) { if (!bag.length) bag = shuffle(pool); picks.push(bag.pop()); }
  return picks.map(k => makeQuestion(k)).filter(Boolean).sort((a, b) => a.level - b.level);
}

export function newNumbers(q) { return q.template && T[q.template] ? makeQuestion(q.template, { variant: q.variant || undefined }) : null; }
