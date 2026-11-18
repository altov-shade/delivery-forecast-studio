import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';

const fresh = () => M.clone(M.DEFAULTS);
const sim0 = M.simulate(fresh());
const R = (id) => sim0.results[id];

test('fixed seed is deterministic; a different seed is not', () => {
  const a = M.simulate(fresh()), b = M.simulate(fresh());
  for (const s of M.SCENARIOS) {
    assert.deepEqual(Array.from(a.results[s.id].launch.slice(0, 50)), Array.from(b.results[s.id].launch.slice(0, 50)));
    assert.equal(a.results[s.id].stats.pBoth, b.results[s.id].stats.pBoth);
  }
  const A2 = fresh(); A2.seed = 7;
  assert.notEqual(M.simulate(A2).results.current.stats.launch.p50, a.results.current.stats.launch.p50);
});

test('triangular inverse stays in bounds and has the right mean', () => {
  const t = M.triParams([8, 10, 16]);
  assert.equal(M.triInv(0, t), 8);
  assert.ok(Math.abs(M.triInv(1 - 1e-12, t) - 16) < 1e-4);
  let s = 0; const n = 20000;
  for (let i = 0; i < n; i++) s += M.triInv((i + 0.5) / n, t);
  assert.ok(Math.abs(s / n - (8 + 10 + 16) / 3) < 0.01);
});

test('critical path engine: hand-checked plan case', () => {
  const p = M.planCase(M.SCENARIOS[0], fresh());
  // DM 10, VI 12 -> testing starts wk12, ends wk20 -> training starts wk16, ends max(20, 20+1)=21
  assert.equal(p.by.test.start, 12);
  assert.equal(p.by.train.start, 16);
  assert.equal(p.full, 21);
  assert.deepEqual([...p.critical].sort(), ['test', 'train', 'vi']);
  const d = M.planCase(M.SCENARIOS[1], fresh());
  assert.equal(d.full, 27); // + 6 weeks vendor slip
  assert.equal(d.by.vi.delay, 6);
});

test('joint probability comes from the same runs and is consistent', () => {
  for (const s of M.SCENARIOS) {
    const r = R(s.id), A = sim0.A;
    let both = 0, ot = 0, wb = 0;
    for (let i = 0; i < r.N; i++) {
      const o = Math.ceil(r.launch[i] * 7 - 1e-9) <= sim0.targetDays, w = r.cost[i] <= A.budget;
      if (o) ot++; if (w) wb++; if (o && w) both++;
      assert.equal(r.both[i], o && w ? 1 : 0);
    }
    const st = r.stats;
    assert.equal(st.pBoth, both / r.N); assert.equal(st.pOnTime, ot / r.N); assert.equal(st.pBudget, wb / r.N);
    assert.ok(st.pBoth <= Math.min(st.pOnTime, st.pBudget) + 1e-12);
    assert.ok(st.pBoth >= st.pOnTime + st.pBudget - 1 - 1e-12); // Fréchet lower bound
    assert.ok(Math.abs(st.pBoth + st.pOnlyTime + st.pOnlyBudget + st.pNeither - 1) < 1e-12);
  }
});

test('schedule and cost are linked per run (later runs cost more)', () => {
  const r = R('delay');
  const lo = [], hi = [];
  const med = r.stats.launch.p50;
  for (let i = 0; i < r.N; i++) (r.launch[i] <= med ? lo : hi).push(r.cost[i]);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(hi) > mean(lo) + 100);
});

test('vendor delay scenario is never earlier than current plan, run by run', () => {
  for (let i = 0; i < R('current').N; i++) assert.ok(R('delay').launch[i] >= R('current').launch[i] - 1e-9);
  assert.ok(R('delay').stats.launch.p50 > R('current').stats.launch.p50 + 3);
  assert.ok(R('delay').stats.pBoth < R('current').stats.pBoth);
});

test('contractor shortens testing but cannot remove the vendor dependency', () => {
  const d = R('delay'), c = R('contractor');
  for (let i = 0; i < d.N; i++) {
    assert.equal(c.viEnd[i], d.viEnd[i]);                       // vendor finish unchanged
    assert.ok(c.testStart[i] >= c.viEnd[i] - 1e-9);              // testing still waits for the vendor
    assert.equal(c.testStart[i], d.testStart[i]);
    assert.ok(c.taskEnd.test[i] - c.taskStart.test[i] < d.taskEnd.test[i] - d.taskStart.test[i]);
    assert.ok(c.launch[i] <= d.launch[i] + 1e-9);
  }
  assert.ok(c.stats.launch.p50 < d.stats.launch.p50);
  assert.ok(c.stats.launch.p50 > d.stats.launch.p50 - 4); // bounded benefit: testing only
  // zero contractor effect => identical schedule
  const A = fresh(); A.contractor.reduction = [0, 0, 0];
  const z = M.simulate(A).results;
  assert.equal(z.contractor.stats.launch.p50, z.delay.stats.launch.p50);
});

test('contractor cost: rate × testing weeks + onboarding fee is added', () => {
  const A = fresh(); A.contractor.reduction = [0, 0, 0];
  const z = M.simulate(A).results;
  const mean = (r) => r.stats.cost.mean;
  const extra = mean(z.contractor) - mean(z.delay);
  const expected = A.contractor.weeklyRate * 8.67 + A.contractor.onboardFee; // mean testing weeks of tri(6,8,12)
  assert.ok(Math.abs(extra - expected) < 8, `extra ${extra} vs ${expected}`);
});

test('phased launch: day one precedes full scope and beats unphased launch', () => {
  const p = R('phased');
  for (let i = 0; i < p.N; i++) assert.ok(p.dayOne[i] + 2 <= p.full[i] + 1e-9); // at least stabilization gap
  assert.ok(p.stats.dayOne.p50 < R('delay').stats.launch.p50 - 5);
  assert.ok(p.stats.full.p50 > p.stats.dayOne.p50 + 3);
  // reported launch = day one by default, full scope when switched
  const A = fresh(); A.onTimeBasis = 'full';
  const f = M.simulate(A).results.phased;
  assert.equal(f.stats.launch.p50, f.stats.full.p50);
  assert.ok(f.stats.pOnTime < p.stats.pOnTime);
  const plan = M.planCase(M.SCENARIOS[3], fresh());
  assert.ok(plan.dayOne < plan.full);
});

test('assumption edits move outputs in the expected direction', () => {
  const base = R('delay').stats;
  let A = fresh(); A.vendor.delay = [8, 12, 16];
  assert.ok(M.simulate(A).results.delay.stats.launch.p50 > base.launch.p50 + 4);
  A = fresh(); A.targetDate = '2027-09-30';
  assert.ok(M.simulate(A).results.delay.stats.pOnTime > base.pOnTime + 0.5);
  A = fresh(); A.budget = 9000;
  const r = M.simulate(A).results.delay.stats;
  assert.ok(r.pBudget > 0.99); assert.ok(Math.abs(r.pBoth - r.pOnTime) < 1e-12);
  A = fresh(); A.contractor.reduction = [0.4, 0.5, 0.6];
  assert.ok(M.simulate(A).results.contractor.stats.launch.p50 < R('contractor').stats.launch.p50 - 1);
  A = fresh(); A.phased.scope = 0.85;
  assert.ok(M.simulate(A).results.phased.stats.dayOne.p50 > R('phased').stats.dayOne.p50);
  A = fresh(); A.vendor.baseProb = 0;
  const z = M.simulate(A).results;
  assert.ok(z.current.stats.launch.p90 < R('current').stats.launch.p90);
});

test('percentiles are ordered and the 80% interval holds 80% of runs', () => {
  for (const s of M.SCENARIOS) {
    const c = R(s.id).stats.cost, r = R(s.id);
    assert.ok(c.p10 < c.p50 && c.p50 < c.p90);
    let inside = 0;
    for (let i = 0; i < r.N; i++) if (r.cost[i] >= c.p10 && r.cost[i] <= c.p90) inside++;
    assert.ok(Math.abs(inside / r.N - 0.8) < 0.002);
    assert.ok(r.stats.launch.p50 <= r.stats.launch.p90);
  }
});

test('sensitivity ranks the vendor inputs first for the delayed plan', () => {
  const s = M.sensitivity(R('delay'), 'launch');
  assert.ok(['vi', 'delay'].includes(s[0].key));
  assert.ok(s[0].rho > 0.4 && s[0].swing > 1);
  const c = M.sensitivity(R('contractor'), 'launch');
  assert.ok(c.some((x) => x.key === 'effect' && x.rho < 0)); // better contractor => earlier
  assert.ok(M.sensitivity(R('current'), 'cost').length > 5);
  assert.ok(M.sensitivity(R('delay'), 'launch').every((x) => x.key !== 'effect')); // not varying here
});

test('simulation is fast enough for live editing', () => {
  const t = performance.now(); M.simulate(fresh());
  assert.ok(performance.now() - t < 1500);
});
