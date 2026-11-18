// Delivery Forecast Studio — simulation model (pure, no DOM). FICTIONAL DATA.
// Units: durations in weeks, money in $k. Dates are whole days since 1970-01-01 (UTC).

export const K = 14; // uniforms drawn per run (common random numbers across scenarios)
export const WS = ['dm', 'vi', 'test', 'train'];
export const WS_NAMES = { dm: 'Data migration', vi: 'Vendor integration', test: 'Testing', train: 'Employee training' };

export const SCENARIOS = [
  { id: 'current', name: 'Current Plan', short: 'Current', delay: 'base', contractor: false, phased: false,
    blurb: 'Baseline schedule. The vendor may slip, but no delay has been announced.' },
  { id: 'delay', name: 'Vendor Delay', short: 'Vendor Delay', delay: 'announced', contractor: false, phased: false,
    blurb: 'The vendor has announced a slip. Everything else stays as planned.' },
  { id: 'contractor', name: 'Vendor Delay + Contractor', short: '+ Contractor', delay: 'announced', contractor: true, phased: false,
    blurb: 'A contractor test team shortens testing. Testing still cannot start until the vendor integration is done.' },
  { id: 'phased', name: 'Vendor Delay + Phased Launch', short: '+ Phased', delay: 'announced', contractor: false, phased: true,
    blurb: 'Ship core onboarding first on the vendor’s core APIs; add the delayed modules in a second release.' },
];

export const TASK_LABELS = {
  dm: 'Data migration', vi: 'Vendor integration', test: 'Testing', train: 'Employee training',
  vic: 'Vendor integration · core', vie: 'Vendor integration · extended',
  t1: 'Testing · day-one scope', t2: 'Testing · remaining scope',
  r1: 'Training · day-one users', r2: 'Training · remaining users',
};
export const TASK_WS = { dm: 'dm', vi: 'vi', vic: 'vi', vie: 'vi', test: 'test', t1: 'test', t2: 'test', train: 'train', r1: 'train', r2: 'train' };

export const DEFAULTS = {
  runs: 10000,
  seed: 20270111,
  startDate: '2027-01-11',
  targetDate: '2027-07-05',
  budget: 6200,              // $k
  onTimeBasis: 'dayOne',     // phased scenario: measure "on time" at 'dayOne' or 'full' scope
  overheadPerWeek: 70,       // PMO + legacy carrying cost, $k/week until full scope
  burnEscalation: [0.97, 1.0, 1.15],
  trainOverlap: 0.5,         // training may start when this share of testing is done
  trainTail: 1,              // weeks of final training after testing ends
  streams: {
    dm:    { dur: [8, 10, 16],  burn: 40, fixed: 450, costRisk: [0.95, 1.0, 1.25] },
    vi:    { dur: [10, 12, 18], burn: 55, fixed: 700, costRisk: [0.95, 1.0, 1.30] },
    test:  { dur: [6, 8, 12],   burn: 60, fixed: 150, costRisk: [0.95, 1.0, 1.20] },
    train: { dur: [3, 4, 6],    burn: 35, fixed: 200, costRisk: [0.95, 1.0, 1.15] },
  },
  vendor: {
    baseProb: 0.20,          // chance of a slip in the Current Plan
    announcedProb: 1.0,      // chance of a slip once announced
    delay: [4, 6, 10],       // slip size, weeks
    standbyFactor: 0.6,      // share of vendor-team burn paid while waiting
    changeOrderProb: 0.30,   // chance of a change order given a slip
    changeOrderCost: [80, 150, 400],
  },
  contractor: {
    reduction: [0.15, 0.25, 0.35], // share of testing duration removed
    weeklyRate: 34,          // $k/week during testing
    onboardFee: 40,          // $k one-time
  },
  phased: {
    scope: 0.65,             // share of scope shipped on day one
    coreVendorShare: 0.70,   // share of vendor integration the day-one scope needs
    delayOnCore: 0.20,       // share of the vendor slip that lands on core APIs
    hardening: 0.10,         // extra day-one testing effort
    regressionWeeks: 2,      // phase-2 regression
    stabilizeWeeks: 2,       // hypercare before phase 2 testing begins
    dualRunPerWeek: 30,      // $k/week running both systems between releases
    secondCutoverCost: 90,  // $k one-time
  },
};

export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- randomness ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let uCache = { key: '', U: null };
export function getUniforms(seed, runs) {
  const key = seed + ':' + runs;
  if (uCache.key === key) return uCache.U;
  const rnd = mulberry32(seed);
  const U = new Float64Array(runs * K);
  for (let i = 0; i < U.length; i++) U[i] = rnd();
  uCache = { key, U };
  return U;
}

export function triParams(p) {
  const [a, m, b] = [...p].map(Number).sort((x, y) => x - y);
  return { a, m, b, fc: b > a ? (m - a) / (b - a) : 0 };
}
export function triInv(u, t) {
  if (t.b <= t.a) return t.a;
  return u < t.fc
    ? t.a + Math.sqrt(u * (t.b - t.a) * (t.m - t.a))
    : t.b - Math.sqrt((1 - u) * (t.b - t.a) * (t.b - t.m));
}

// ---------- dates ----------
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
export const wkToDay = (startDay, w) => startDay + Math.ceil(w * 7 - 1e-9);
export function fmtDay(day, short = false) {
  return new Date(day * 86400000).toLocaleDateString('en-US',
    short ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---------- schedule engine (critical path method) ----------
// preds: {id,type:'FS',lag} start after pred ends | {id,type:'SS',frac} start after frac of pred's duration
// finishAfter: [{id,lag}] task cannot end before pred.end+lag
export function schedule(tasks) {
  const by = {};
  for (const t of tasks) {
    let start = 0, drive = null;
    for (const p of t.preds || []) {
      const q = by[p.id];
      const v = p.type === 'SS' ? q.start + p.frac * q.dur : q.end + (p.lag || 0);
      if (v > start) { start = v; drive = p.id; }
    }
    let end = start + t.dur;
    for (const f of t.finishAfter || []) {
      const v = by[f.id].end + (f.lag || 0);
      if (v > end) { end = v; drive = f.id; }
    }
    t.start = start; t.end = end; t.drive = drive;
    by[t.id] = t;
  }
  return by;
}
export function criticalChain(by, terminalId) {
  const ids = [];
  for (let id = terminalId; id; id = by[id].drive) ids.push(id);
  return ids;
}

export function buildTasks(scn, A, s) {
  const FS = (id, lag = 0) => ({ id, type: 'FS', lag });
  if (!scn.phased) {
    const testDur = s.test * (1 - (scn.contractor ? s.effect : 0));
    return [
      { id: 'dm', dur: s.dm, preds: [] },
      { id: 'vi', dur: s.vi + s.delay, delay: s.delay, preds: [] },
      // The vendor dependency is hard: testing always waits for vendor integration, contractor or not.
      { id: 'test', dur: testDur, preds: [FS('dm'), FS('vi')] },
      { id: 'train', dur: s.train, preds: [{ id: 'test', type: 'SS', frac: A.trainOverlap }], finishAfter: [{ id: 'test', lag: A.trainTail }] },
    ];
  }
  const ph = A.phased, sc = ph.scope;
  const dCore = s.delay * ph.delayOnCore, dExt = s.delay - dCore;
  return [
    { id: 'dm', dur: s.dm, preds: [] },
    { id: 'vic', dur: s.vi * ph.coreVendorShare + dCore, delay: dCore, preds: [] },
    { id: 'vie', dur: s.vi * (1 - ph.coreVendorShare) + dExt, delay: dExt, preds: [FS('vic')] },
    { id: 't1', dur: s.test * sc * (1 + ph.hardening), preds: [FS('dm'), FS('vic')] },
    { id: 'r1', dur: Math.max(1.5, s.train * sc), preds: [{ id: 't1', type: 'SS', frac: A.trainOverlap }], finishAfter: [{ id: 't1', lag: A.trainTail }] },
    { id: 't2', dur: s.test * (1 - sc) + ph.regressionWeeks, preds: [FS('vie'), FS('r1', ph.stabilizeWeeks)] },
    { id: 'r2', dur: Math.max(1, s.train * (1 - sc)), preds: [{ id: 't2', type: 'SS', frac: A.trainOverlap }], finishAfter: [{ id: 't2', lag: A.trainTail }] },
  ];
}
export const terminals = (scn) => (scn.phased ? ['r1', 'r2'] : ['train']);

function prepare(A) {
  const S = A.streams;
  return {
    dm: triParams(S.dm.dur), vi: triParams(S.vi.dur), test: triParams(S.test.dur), train: triParams(S.train.dur),
    delay: triParams(A.vendor.delay), eff: triParams(A.contractor.reduction),
    cdm: triParams(S.dm.costRisk), cvi: triParams(S.vi.costRisk), ctest: triParams(S.test.costRisk), ctrain: triParams(S.train.costRisk),
    esc: triParams(A.burnEscalation), co: triParams(A.vendor.changeOrderCost),
  };
}

// Cost for one run given the sampled inputs and the scheduled tasks. Shared by simulation and tests.
export function runCost(scn, A, s, tasks, full, dayOne) {
  const S = A.streams;
  const weeks = { dm: 0, vi: 0, test: 0, train: 0 };
  let testDur = 0;
  for (const t of tasks) {
    weeks[TASK_WS[t.id]] += t.dur - (t.delay || 0);
    if (TASK_WS[t.id] === 'test') testDur += t.dur;
  }
  const mult = { dm: s.cdm, vi: s.cvi, test: s.ctest, train: s.ctrain };
  let cost = 0;
  for (const w of WS) cost += S[w].fixed * mult[w] + S[w].burn * s.esc * weeks[w];
  cost += S.vi.burn * s.esc * A.vendor.standbyFactor * s.delay; // vendor team waiting
  cost += s.co;                                                  // change orders
  cost += A.overheadPerWeek * full;                              // PMO + legacy until full scope
  if (scn.contractor) cost += A.contractor.weeklyRate * testDur + A.contractor.onboardFee;
  if (scn.phased) cost += A.phased.dualRunPerWeek * Math.max(0, full - dayOne) + A.phased.secondCutoverCost;
  return cost;
}

// ---------- deterministic plan case (most-likely durations) ----------
export function planCase(scn, A) {
  const P = prepare(A);
  const s = { dm: P.dm.m, vi: P.vi.m, test: P.test.m, train: P.train.m,
    delay: scn.delay === 'announced' ? P.delay.m : 0, effect: scn.contractor ? P.eff.m : 0 };
  const tasks = buildTasks(scn, A, s);
  const by = schedule(tasks);
  const critical = new Set();
  for (const tid of terminals(scn)) criticalChain(by, tid).forEach((id) => critical.add(id));
  const full = scn.phased ? by.r2.end : by.train.end;
  const dayOne = scn.phased ? by.r1.end : full;
  return { tasks, by, critical, dayOne, full };
}

// ---------- Monte Carlo ----------
export function simulate(A) {
  const N = A.runs, U = getUniforms(A.seed, N), P = prepare(A);
  const startDay = parseDate(A.startDate);
  const targetDays = parseDate(A.targetDate) - startDay;
  const results = {};
  for (const scn of SCENARIOS) results[scn.id] = runScenario(scn, A, U, N, P, targetDays);
  return { A, N, startDay, targetDays, results };
}

function runScenario(scn, A, U, N, P, targetDays) {
  const ids = scn.phased ? ['dm', 'vic', 'vie', 't1', 'r1', 't2', 'r2'] : ['dm', 'vi', 'test', 'train'];
  const f64 = () => new Float64Array(N);
  const out = {
    scn, N, launch: f64(), full: f64(), dayOne: f64(), cost: f64(), viEnd: f64(), testStart: f64(),
    onTime: new Uint8Array(N), within: new Uint8Array(N), both: new Uint8Array(N),
    taskStart: {}, taskEnd: {}, crit: {}, drivers: {},
  };
  ids.forEach((id) => { out.taskStart[id] = f64(); out.taskEnd[id] = f64(); out.crit[id] = 0; });
  ['dm', 'vi', 'delay', 'test', 'train', 'effect', 'cdm', 'cvi', 'ctest', 'ctrain', 'esc', 'co'].forEach((n) => { out.drivers[n] = f64(); });
  const pDelay = scn.delay === 'announced' ? A.vendor.announcedProb : A.vendor.baseProb;
  const basisDayOne = scn.phased && A.onTimeBasis === 'dayOne';
  const terms = terminals(scn);
  const D = out.drivers;
  for (let i = 0; i < N; i++) {
    const o = i * K;
    const s = {
      dm: triInv(U[o], P.dm), vi: triInv(U[o + 1], P.vi), test: triInv(U[o + 2], P.test), train: triInv(U[o + 3], P.train),
      delay: U[o + 4] < pDelay ? triInv(U[o + 5], P.delay) : 0,
      cdm: triInv(U[o + 6], P.cdm), cvi: triInv(U[o + 7], P.cvi), ctest: triInv(U[o + 8], P.ctest), ctrain: triInv(U[o + 9], P.ctrain),
      esc: triInv(U[o + 10], P.esc),
      effect: scn.contractor ? triInv(U[o + 13], P.eff) : 0,
    };
    s.co = s.delay > 0 && U[o + 11] < A.vendor.changeOrderProb ? triInv(U[o + 12], P.co) : 0;
    const tasks = buildTasks(scn, A, s);
    const by = schedule(tasks);
    const full = scn.phased ? by.r2.end : by.train.end;
    const dayOne = scn.phased ? by.r1.end : full;
    const launch = basisDayOne ? dayOne : full;
    const cost = runCost(scn, A, s, tasks, full, dayOne);
    out.launch[i] = launch; out.full[i] = full; out.dayOne[i] = dayOne; out.cost[i] = cost;
    const ot = Math.ceil(launch * 7 - 1e-9) <= targetDays ? 1 : 0;
    const wb = cost <= A.budget ? 1 : 0;
    out.onTime[i] = ot; out.within[i] = wb; out.both[i] = ot & wb; // same run decides all three
    for (const id of ids) { out.taskStart[id][i] = by[id].start; out.taskEnd[id][i] = by[id].end; }
    out.viEnd[i] = scn.phased ? by.vie.end : by.vi.end;
    out.testStart[i] = scn.phased ? by.t1.start : by.test.start;
    const seen = new Set();
    for (const tid of terms) criticalChain(by, tid).forEach((id) => seen.add(id));
    seen.forEach((id) => { out.crit[id]++; });
    D.dm[i] = s.dm; D.vi[i] = s.vi; D.delay[i] = s.delay; D.test[i] = s.test; D.train[i] = s.train; D.effect[i] = s.effect;
    D.cdm[i] = s.cdm; D.cvi[i] = s.cvi; D.ctest[i] = s.ctest; D.ctrain[i] = s.ctrain; D.esc[i] = s.esc; D.co[i] = s.co;
  }
  for (const id of ids) out.crit[id] /= N;
  out.taskStats = {};
  for (const id of ids) out.taskStats[id] = { start: summarize(out.taskStart[id]), end: summarize(out.taskEnd[id]) };
  const bothN = sum(out.both), otN = sum(out.onTime), wbN = sum(out.within);
  out.stats = {
    launch: summarize(out.launch), full: summarize(out.full), dayOne: summarize(out.dayOne), cost: summarize(out.cost),
    pOnTime: otN / N, pBudget: wbN / N, pBoth: bothN / N, pIndep: (otN / N) * (wbN / N),
    pOnlyTime: (otN - bothN) / N, pOnlyBudget: (wbN - bothN) / N, pNeither: (N - otN - wbN + bothN) / N,
  };
  return out;
}

const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

export function quantile(sorted, p) {
  const x = p * (sorted.length - 1), lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
export function summarize(arr) {
  const s = Float64Array.from(arr).sort();
  return { p5: quantile(s, 0.05), p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), p95: quantile(s, 0.95),
    mean: sum(arr) / arr.length, min: s[0], max: s[s.length - 1] };
}
export function histogram(arr, lo, step, bins) {
  const c = new Float64Array(bins);
  for (let i = 0; i < arr.length; i++) {
    let b = Math.floor((arr[i] - lo) / step);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    c[b]++;
  }
  for (let b = 0; b < bins; b++) c[b] /= arr.length;
  return c;
}

// ---------- sensitivity (Spearman rank correlation, same runs) ----------
export const DRIVER_LABELS = {
  vi: 'Vendor integration duration', delay: 'Vendor slip (occurrence × size)', dm: 'Data migration duration',
  test: 'Testing duration', train: 'Training duration', effect: 'Contractor effectiveness',
  cvi: 'Vendor cost overrun', cdm: 'Migration cost overrun', ctest: 'Testing cost overrun', ctrain: 'Training cost overrun',
  esc: 'Labor-rate escalation', co: 'Vendor change orders',
};
function ranks(arr) {
  const n = arr.length, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => arr[a] - arr[b]);
  const r = new Float64Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
export function sensitivity(res, metric) {
  const y = metric === 'launch' ? res.launch : metric === 'cost' ? res.cost : res.both;
  const ry = ranks(y), rows = [];
  for (const key of Object.keys(res.drivers)) {
    const x = res.drivers[key];
    const s = Float64Array.from(x).sort();
    if (s[0] === s[s.length - 1]) continue; // input never varies in this scenario
    const rho = pearson(ranks(x), ry);
    const v20 = quantile(s, 0.2), v80 = quantile(s, 0.8);
    let lo = 0, nl = 0, hi = 0, nh = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] <= v20) { lo += y[i]; nl++; }
      if (x[i] >= v80 && x[i] > v20) { hi += y[i]; nh++; }
    }
    rows.push({ key, label: DRIVER_LABELS[key], rho, swing: nl && nh ? hi / nh - lo / nl : 0 });
  }
  return rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
