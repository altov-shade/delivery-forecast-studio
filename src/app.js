import * as M from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const state = { A: M.clone(M.DEFAULTS), sel: 'current', sens: 'launch', overlay: true, whisk: true, selTask: null, sim: null, plan: {} };
const COLORS = { current: 'var(--c-current)', delay: 'var(--c-delay)', contractor: 'var(--c-contractor)', phased: 'var(--c-phased)' };
const WSCOLOR = { dm: 'var(--ws-dm)', vi: 'var(--ws-vi)', test: 'var(--ws-test)', train: 'var(--ws-train)' };
const scn = (id) => M.SCENARIOS.find((s) => s.id === id);

// ---------- formatting ----------
const money = (k) => (Math.abs(k) >= 1000 ? `$${(k / 1000).toFixed(2)}M` : `$${Math.round(k)}k`);
const smoney = (k) => (k < 0 ? '−' : '+') + money(Math.abs(k));
const pct = (p) => (p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : `${Math.round(p * 100)}%`);
const wk1 = (w) => `${w.toFixed(1)} wk`;
const day = (w) => M.wkToDay(state.sim.startDay, w);
const dt = (w) => M.fmtDay(day(w));
const dts = (w) => M.fmtDay(day(w), true);
const relDays = (d) => (d > 0 ? `${d} days after target` : d < 0 ? `${-d} days ahead of target` : 'exactly on target');
const sgn = (n, unit, d = 1) => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(d)}${unit}`;
const level = (p) => (p >= 0.7 ? 'good' : p >= 0.4 ? 'warn' : 'bad');
const levelWord = (p) => (p >= 0.7 ? 'Likely' : p >= 0.4 ? 'Toss-up' : 'Unlikely');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const basisLabel = (s) => (s.phased ? (state.A.onTimeBasis === 'dayOne' ? 'Day-one launch' : 'Full-scope launch') : 'Launch');
const res = (id = state.sel) => state.sim.results[id];

// ---------- orchestration ----------
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(recalc, 90); }
function recalc() {
  const t0 = performance.now();
  state.sim = M.simulate(state.A);
  state.plan = {};
  for (const s of M.SCENARIOS) state.plan[s.id] = M.planCase(s, state.A);
  state.ms = performance.now() - t0;
  renderAll();
}
function renderAll() {
  renderTabs(); renderOverview(); renderCompare(); renderPhased(); renderContractor();
  renderTimeline(); renderDistributions(); renderSensitivity(); renderBrief(); renderMethod();
  document.documentElement.dataset.ready = '1';
}

// ---------- header tabs ----------
function renderTabs() {
  $('#scenarioTabs').innerHTML = M.SCENARIOS.map((s) =>
    `<button class="tab" role="tab" data-scn="${s.id}" aria-selected="${s.id === state.sel}" style="--c:${COLORS[s.id]}" title="${esc(s.blurb)}"><i></i>${s.short}</button>`).join('');
}

// ---------- executive dashboard ----------
function renderOverview() {
  const s = scn(state.sel), r = res(), st = r.stats, A = state.A, sim = state.sim;
  const p50d = day(st.launch.p50) - sim.startDay - sim.targetDays, p90d = day(st.launch.p90) - sim.startDay - sim.targetDays;
  $('#runInfo').textContent = `${sim.N.toLocaleString()} runs · fixed seed ${A.seed} · simulated in ${Math.round(state.ms)} ms · all data fictional`;
  $('#headline').innerHTML = `<b>${s.name}:</b> ${pct(st.pBoth)} chance of hitting both targets. ${basisLabel(s)} P50 <b>${dt(st.launch.p50)}</b>, P90 <b>${dt(st.launch.p90)}</b> (${relDays(p90d)}); cost P50 <b>${money(st.cost.p50)}</b>, 80% interval ${money(st.cost.p10)}–${money(st.cost.p90)} against a ${money(A.budget)} budget.`;
  const prob = (label, p, sub, feature) => `<div class="kpi ${feature ? 'feature' : ''}"><div class="lbl">${label}</div><div class="val">${pct(p)}<span class="pill ${level(p)}">${levelWord(p)}</span></div><div class="sub">${sub}</div><div class="meter ${level(p)}" role="img" aria-label="${pct(p)}"><span style="width:${Math.max(1, p * 100)}%"></span></div></div>`;
  const lo = st.cost.p10, hi = st.cost.p90, mid = st.cost.p50;
  const a = Math.min(lo, A.budget) * 0.96, b = Math.max(hi, A.budget) * 1.03, X = (v) => ((v - a) / (b - a)) * 100;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="lbl">${basisLabel(s)} · P50</div><div class="val">${dt(st.launch.p50)}</div><div class="sub">${wk1(st.launch.p50)} after start · ${relDays(p50d)}</div></div>
    <div class="kpi"><div class="lbl">${basisLabel(s)} · P90</div><div class="val">${dt(st.launch.p90)}<span class="pill ${p90d <= 0 ? 'good' : 'bad'}">${p90d <= 0 ? 'inside target' : '+' + p90d + ' d'}</span></div><div class="sub">9 in 10 runs finish by this date · target ${M.fmtDay(sim.startDay + sim.targetDays)}</div></div>
    <div class="kpi"><div class="lbl">Projected final cost · P50</div><div class="val">${money(mid)}</div><div class="sub">80% interval ${money(lo)} – ${money(hi)} · budget ${money(A.budget)}</div>
      <div class="pi"><svg viewBox="0 0 100 20" preserveAspectRatio="none" role="img" aria-label="80% prediction interval versus budget"><rect x="0" y="8" width="100" height="4" rx="2" fill="var(--surface2)"/><rect x="${X(lo)}" y="5" width="${X(hi) - X(lo)}" height="10" rx="3" fill="${COLORS[s.id]}" opacity=".35"/><rect x="${X(mid) - 0.6}" y="3" width="1.2" height="14" fill="${COLORS[s.id]}"/><line x1="${X(A.budget)}" x2="${X(A.budget)}" y1="0" y2="20" stroke="var(--crit)" stroke-width="1.2" stroke-dasharray="2 1.5" vector-effect="non-scaling-stroke"/></svg></div></div>
    ${prob('Chance of launching on time', st.pOnTime, `by ${M.fmtDay(sim.startDay + sim.targetDays)}${s.phased ? ' (' + basisLabel(s).toLowerCase() + ')' : ''}`)}
    ${prob('Chance of staying within budget', st.pBudget, `final cost ≤ ${money(A.budget)}`)}
    ${prob('Chance of doing both', st.pBoth, `same runs · ${pct(st.pIndep)} if the two were independent`, true)}`;
}

// ---------- scenario comparison ----------
function renderCompare() {
  const cur = res('current').stats, sim = state.sim, A = state.A;
  const bestId = M.SCENARIOS.slice(1).reduce((b, s) => (res(s.id).stats.pBoth > res(b).stats.pBoth ? s.id : b), 'delay');
  const cells = [`<div class="rowlbl">Scenario</div>`];
  const col = (s, html, extra = '') => `<div class="${s.id === state.sel ? 'sel' : ''} ${extra}" style="--c:${COLORS[s.id]}" data-scn="${s.id}">${html}</div>`;
  for (const s of M.SCENARIOS) cells.push(`<div class="colhead ${s.id === state.sel ? 'sel' : ''}" style="--c:${COLORS[s.id]}" data-scn="${s.id}" role="button" tabindex="0"><b>${s.name}</b><span>${esc(s.blurb)}</span></div>`);
  const row = (label, sub, fn) => { cells.push(`<div class="rowlbl">${label}${sub ? `<small>${sub}</small>` : ''}</div>`); for (const s of M.SCENARIOS) cells.push(col(s, fn(s, res(s.id).stats))); };
  const dd = (s, v, base) => { if (s.id === 'current') return '<span class="delta flat">baseline</span>'; const d = v - base; return `<span class="delta ${d > 0 ? 'worse' : d < 0 ? 'better' : 'flat'}">${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} days vs Current</span>`; };
  row('Customer launch · P50', 'first go-live', (s, st) => `<span class="num">${dts(st.launch.p50)}, ${new Date(day(st.launch.p50) * 864e5).getUTCFullYear()}<small>${s.phased ? basisLabel(s) : 'single go-live'}</small></span>${dd(s, day(st.launch.p50), day(cur.launch.p50))}`);
  row('Customer launch · P90', '9 in 10 runs by', (s, st) => `<span class="num">${dts(st.launch.p90)}, ${new Date(day(st.launch.p90) * 864e5).getUTCFullYear()}</span>${dd(s, day(st.launch.p90), day(cur.launch.p90))}`);
  row('Full scope done', 'P50 · P90', (s, st) => `<span class="num">${dts(st.full.p50)}<small>P90 ${dts(st.full.p90)}</small></span>`);
  row('Final cost · P50', '80% prediction interval', (s, st) => `<span class="num">${money(st.cost.p50)}<small>${money(st.cost.p10)} – ${money(st.cost.p90)}</small></span>${s.id === 'current' ? '<span class="delta flat">baseline</span>' : `<span class="delta ${st.cost.p50 > cur.cost.p50 ? 'worse' : 'better'}">${smoney(st.cost.p50 - cur.cost.p50)} vs Current</span>`}`);
  const pr = (key) => (s, st) => `<div class="prow"><span class="num">${pct(st[key])}</span><div class="bar"><span style="width:${st[key] * 100}%"></span></div></div>`;
  row('Launches on time', `by ${M.fmtDay(sim.startDay + sim.targetDays, true)}`, pr('pOnTime'));
  row('Stays within budget', `≤ ${money(A.budget)}`, pr('pBudget'));
  row('Does both', 'same runs', (s, st) => `${pr('pBoth')(s, st)}${s.id === bestId ? '<span class="best">Best mitigation</span>' : ''}`);
  $('#compareTable').innerHTML = cells.join('');
}

function renderPhased() {
  const s = scn('phased'), r = res('phased'), st = r.stats, d = res('delay').stats, A = state.A;
  const gap = st.full.p50 - st.dayOne.p50, pc = A.phased;
  $('#phasedCard').innerHTML = `
    <h3><span style="color:${COLORS.phased}">●</span> Phased launch: what ships on day one</h3>
    <p class="muted small">About ${Math.round(pc.scope * 100)}% of scope goes live on the vendor’s core APIs; the delayed vendor modules follow.</p>
    <div class="stat-row">
      <div>Day one · P50<b>${dt(st.dayOne.p50)}</b></div><div>Day one · P90<b>${dts(st.dayOne.p90)}</b></div>
      <div>Full scope · P50<b>${dt(st.full.p50)}</b></div><div>Full scope · P90<b>${dts(st.full.p90)}</b></div>
    </div>
    <div class="ship">
      <div><h4>Live on day one</h4><ul><li>Digital onboarding for new customers (web and branch)</li><li>Identity and sanctions checks via the vendor’s core APIs</li><li>Migrated records for active customers (last 24 months)</li><li>Standard welcome journeys and e-signature</li><li>Tier-1 support and branch staff trained</li></ul></div>
      <div><h4>Follows by full scope</h4><ul><li>Premium vendor modules: bureau decisioning, KYC refresh</li><li>Historical archive migration (older than 24 months)</li><li>Broker and partner portal</li><li>Regulatory reporting automation</li><li>Tier-2 and back-office training</li></ul></div>
    </div>
    <div class="note">Full scope arrives <b>${sgn(st.full.p50 - d.full.p50, ' wk')}</b> vs. a single vendor-delayed launch, ${wk1(gap)} after day one, for <b>${smoney(st.cost.p50 - d.cost.p50)}</b> (P50 cost) from running two systems and a second cutover.</div>`;
}

function renderContractor() {
  const c = res('contractor'), d = res('delay'), N = c.N;
  let same = 0, waits = 0;
  for (let i = 0; i < N; i++) { if (c.viEnd[i] === d.viEnd[i] && c.testStart[i] === d.testStart[i]) same++; if (c.testStart[i] >= c.viEnd[i] - 1e-9) waits++; }
  const dur = (r) => { let a = 0; for (let i = 0; i < N; i++) a += r.taskEnd.test[i] - r.taskStart.test[i]; return a / N; };
  const gainDays = day(d.stats.launch.p50) - day(c.stats.launch.p50);
  $('#contractorCard').innerHTML = `
    <h3><span style="color:${COLORS.contractor}">●</span> Contractor: shortens testing, not the vendor wait</h3>
    <p class="muted small">Assumes a test team cuts testing effort by ~${Math.round(state.A.contractor.reduction[1] * 100)}% at ${money(state.A.contractor.weeklyRate)}/week plus ${money(state.A.contractor.onboardFee)} onboarding.</p>
    <div class="stat-row">
      <div>Testing, average<b>${wk1(dur(d))} → ${wk1(dur(c))}</b></div>
      <div>Launch P50<b>${gainDays} days earlier</b></div>
      <div>Cost P50<b>${smoney(c.stats.cost.p50 - d.stats.cost.p50)}</b></div>
      <div>Both-target odds<b>${pct(d.stats.pBoth)} → ${pct(c.stats.pBoth)}</b></div>
    </div>
    <ul>
      <li>Vendor integration finishes at the same point in ${same.toLocaleString()} of ${N.toLocaleString()} runs (P50 ${dts(d.taskStats.vi.end.p50)}).</li>
      <li>Testing starts only after it, in ${waits.toLocaleString()} of ${N.toLocaleString()} runs. The dependency can’t be bought out.</li>
    </ul>
    <div class="note">The contractor only attacks the work after the vendor finishes, so the gain is capped by the testing saving, and training (which can only start halfway through testing) soaks up part of it.</div>`;
}

// ---------- timeline ----------
const SEC_LABEL = { FS: 'finish → start', SS: 'start → start' };
function renderTimeline() {
  const s = scn(state.sel), plan = state.plan[s.id], r = res(), tasks = plan.tasks, crit = plan.critical, sim = state.sim;
  const targetW = sim.targetDays / 7;
  const maxW = Math.ceil(Math.max(...tasks.map((t) => r.taskStats[t.id].end.p90), plan.full, targetW) + 1.5);
  const W = 1120, L = 250, R = 80, top = 52, rowH = 54, H = top + tasks.length * rowH + 26;
  const x = (w) => L + (w / maxW) * (W - L - R);
  const rowY = (i) => top + i * rowH;
  const idx = Object.fromEntries(tasks.map((t, i) => [t.id, i]));
  const step = maxW > 30 ? 4 : 2;
  let g = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(0,0,0,.18)"/><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-width="2.4" opacity=".7"/></pattern>
    <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="var(--ink3)"/></marker>
    <marker id="ahc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="var(--crit)"/></marker></defs>`;
  for (let w = 0; w <= maxW; w += step) g += `<line class="grid" x1="${x(w)}" x2="${x(w)}" y1="${top - 8}" y2="${H - 22}"/><text x="${x(w)}" y="${top - 26}" text-anchor="middle" class="t-strong">W${w}</text><text x="${x(w)}" y="${top - 12}" text-anchor="middle" style="font-size:11px">${dts(w)}</text>`;
  tasks.forEach((t, i) => { if (i % 2 === 0) g += `<rect x="0" y="${rowY(i)}" width="${W}" height="${rowH}" fill="var(--surface2)" opacity=".5"/>`; });
  // dependency arrows first (under bars)
  for (const t of tasks) for (const p of t.preds || []) {
    const q = plan.by[p.id], yi = rowY(idx[t.id]) + rowH / 2, yp = rowY(idx[p.id]) + rowH / 2;
    const x1 = x(p.type === 'SS' ? q.start + p.frac * q.dur : q.end), x2 = x(t.start);
    const isCrit = crit.has(t.id) && crit.has(p.id) && t.drive === p.id;
    const xm = Math.max(x1 + 7, Math.min(x2 - 7, (x1 + x2) / 2));
    const d = p.type === 'SS' ? `M${x1} ${yp + 11} V${yi - 6} H${x2 - 1}` : `M${x1} ${yp} H${xm} V${yi} H${x2 - 1}`;
    g += `<path d="${d}" fill="none" stroke="${isCrit ? 'var(--crit)' : 'var(--ink3)'}" stroke-width="${isCrit ? 2 : 1.2}" stroke-dasharray="${p.type === 'SS' ? '4 3' : ''}" marker-end="url(#${isCrit ? 'ahc' : 'ah'})" opacity="${isCrit ? 1 : .7}"/>`;
  }
  tasks.forEach((t, i) => {
    const y = rowY(i), by = y + 10, bh = 24, isC = crit.has(t.id), ts = r.taskStats[t.id], ws = M.TASK_WS[t.id];
    const ci = r.crit[t.id];
    g += `<g class="bar-g ${state.selTask === t.id ? 'on' : ''}" data-task="${t.id}" tabindex="0" role="button" aria-label="${esc(M.TASK_LABELS[t.id])}, plan ${dts(t.start)} to ${dts(t.end)}${isC ? ', critical path' : ''}">`;
    g += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    g += `<circle cx="14" cy="${y + 22}" r="5" fill="${WSCOLOR[ws]}"/><text x="26" y="${y + 20}" class="t-strong" style="font-size:13px">${esc(M.TASK_LABELS[t.id])}</text>`;
    g += `<text x="26" y="${y + 37}" style="font-size:11.5px" fill="${isC ? 'var(--crit)' : ''}" class="${isC ? 'crit-tag' : ''}">${isC ? 'Critical path · ' : ''}critical in ${Math.round(ci * 100)}% of runs</text>`;
    g += `<rect class="main" x="${x(t.start)}" y="${by}" width="${Math.max(2, x(t.end) - x(t.start))}" height="${bh}" rx="5" fill="${WSCOLOR[ws]}" stroke="${isC ? 'var(--crit)' : 'none'}" stroke-width="${isC ? 3 : 0}"/>`;
    if (t.delay > 0.01) g += `<rect x="${x(t.end - t.delay)}" y="${by}" width="${x(t.end) - x(t.end - t.delay)}" height="${bh}" rx="5" fill="url(#hatch)"/>`;
    const wpx = x(t.end) - x(t.start);
    if (wpx > 70) g += `<text x="${x(t.start) + 8}" y="${by + 16}" style="font-size:11.5px;fill:#fff;font-weight:700">${wk1(t.end - t.start).replace(' wk', ' wk')}</text>`;
    if (state.whisk) {
      const wy = by + bh + 8;
      g += `<line x1="${x(ts.end.p10)}" x2="${x(ts.end.p90)}" y1="${wy}" y2="${wy}" stroke="var(--ink2)" stroke-width="1.6"/><line x1="${x(ts.end.p10)}" x2="${x(ts.end.p10)}" y1="${wy - 4}" y2="${wy + 4}" stroke="var(--ink2)" stroke-width="1.6"/><line x1="${x(ts.end.p90)}" x2="${x(ts.end.p90)}" y1="${wy - 4}" y2="${wy + 4}" stroke="var(--ink2)" stroke-width="1.6"/><circle cx="${x(ts.end.p50)}" cy="${wy}" r="3.2" fill="var(--ink)"/>`;
    }
    g += `</g>`;
  });
  // target + milestones
  const tx = x(targetW);
  g += `<line x1="${tx}" x2="${tx}" y1="${top - 8}" y2="${H - 22}" stroke="var(--crit)" stroke-width="1.6" stroke-dasharray="6 4"/><text x="${tx + 5}" y="${H + 8}" fill="var(--crit)" style="fill:var(--crit);font-weight:700">Target ${M.fmtDay(sim.startDay + sim.targetDays, true)}</text>`;
  const ms = s.phased ? [{ w: plan.dayOne, l: 'Day one' }, { w: plan.full, l: 'Full scope' }] : [{ w: plan.full, l: 'Launch' }];
  ms.forEach((m, k) => { const mx = x(m.w), my = top + tasks.length * rowH + 2; g += `<path d="M${mx} ${my - 8} l7 7 l-7 7 l-7 -7z" fill="var(--ink)"/><text x="${mx + 11}" y="${my + 4 + (k ? 0 : 0)}" class="t-strong">${m.l} ${dts(m.w)}</text>`; });
  $('#gantt').innerHTML = `<svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Gantt chart of workstreams with critical path">${g}</svg>
    <div class="legend"><span><i style="background:transparent;border:3px solid var(--crit)"></i>Critical path</span><span><i style="background:repeating-linear-gradient(45deg,#777 0 3px,#ddd 3px 6px)"></i>Vendor slip (plan case)</span><span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" stroke="var(--ink2)" stroke-width="1.6"/><circle cx="13" cy="5" r="3" fill="var(--ink)"/></svg>Simulated finish P10 · P50 · P90</span><span><svg width="26" height="10"><path d="M0 5 H20" stroke="var(--ink3)" stroke-width="1.4"/></svg>Finish → start dependency</span><span><svg width="26" height="10"><path d="M0 5 H20" stroke="var(--ink3)" stroke-width="1.4" stroke-dasharray="4 3"/></svg>Starts when part of the predecessor is done</span></div>`;
  const chain = [...crit].filter((id) => !s.phased || true).sort((a, b) => plan.by[a].start - plan.by[b].start).map((id) => M.TASK_LABELS[id]);
  $('#timelineNote').textContent = `Plan case uses most-likely durations${s.delay === 'announced' ? ' and the most-likely vendor slip' : ''}. Critical path: ${chain.join(' → ')}. ${s.phased ? `Day one ${dt(plan.dayOne)}; full scope ${dt(plan.full)}.` : `Launch ${dt(plan.full)} vs target ${M.fmtDay(sim.startDay + sim.targetDays)}.`} Percentages show how often each task sits on the critical path across all simulated runs. Click a bar for detail.`;
  if (!state.selTask || !idx.hasOwnProperty(state.selTask)) state.selTask = Object.keys(r.crit).sort((a, b) => r.crit[b] - r.crit[a] || idx[a] - idx[b])[0];
  renderTaskDetail();
}
function renderTaskDetail() {
  const s = scn(state.sel), plan = state.plan[s.id], r = res(), id = state.selTask, t = plan.by[id], ts = r.taskStats[id], A = state.A;
  if (!t) return;
  const ws = M.TASK_WS[id], S = A.streams[ws];
  const succ = plan.tasks.filter((u) => (u.preds || []).some((p) => p.id === id)).map((u) => M.TASK_LABELS[u.id]);
  const preds = (t.preds || []).map((p) => `${M.TASK_LABELS[p.id]} (${p.type === 'SS' ? 'after ' + Math.round(p.frac * 100) + '% done' : 'finish → start' + (p.lag ? ' +' + p.lag + ' wk' : '')})`);
  const isC = plan.critical.has(id);
  document.querySelectorAll('.bar-g').forEach((e) => e.classList.toggle('on', e.dataset.task === id));
  $('#taskDetail').innerHTML = `
    <div><h3>${esc(M.TASK_LABELS[id])} ${isC ? '<span class="crit-tag">· critical path</span>' : ''}</h3><p class="muted small">${M.WS_NAMES[ws]} workstream${M.SCENARIOS && s.phased && ['vic', 'vie', 't1', 't2', 'r1', 'r2'].includes(id) ? ' (phased split)' : ''}</p>
      <dl style="margin-top:10px"><dt>Base duration</dt><dd>${S.dur[0]} / ${S.dur[1]} / ${S.dur[2]} wk (min / likely / max)</dd><dt>Team burn</dt><dd>${money(S.burn)} per week</dd><dt>Fixed cost</dt><dd>${money(S.fixed)}</dd></dl></div>
    <div><h3>Plan case vs simulation</h3><dl style="margin-top:10px"><dt>Plan case</dt><dd>${dts(t.start)} → ${dts(t.end)} (${wk1(t.end - t.start)})</dd><dt>Finish P10</dt><dd>${dts(ts.end.p10)}</dd><dt>Finish P50</dt><dd>${dts(ts.end.p50)}</dd><dt>Finish P90</dt><dd>${dts(ts.end.p90)}</dd><dt>On critical path</dt><dd>${Math.round(r.crit[id] * 100)}% of runs</dd></dl></div>
    <div><h3>Dependencies</h3><dl style="margin-top:10px"><dt>Waits for</dt><dd>${preds.length ? preds.map(esc).join('<br>') : 'Nothing — starts at kickoff'}</dd><dt>Unblocks</dt><dd>${succ.length ? succ.map(esc).join('<br>') : 'Launch'}</dd></dl></div>`;
}

// ---------- distributions ----------
function niceStep(range, ticks) { const raw = range / ticks, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function histChart({ series, lo, step, bins, fmtX, tickStep, markers, shade, W = 560, H = 310 }) {
  const pad = { l: 46, r: 14, t: 56, b: 34 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, span = bins * step;
  const X = (v) => pad.l + ((v - lo) / span) * iw;
  const ymax = Math.max(...series.flatMap((s) => Array.from(s.c))) * 1.12, Y = (p) => pad.t + ih - (p / ymax) * ih;
  let g = '';
  const yt = niceStep(ymax, 4);
  for (let v = 0; v <= ymax; v += yt) g += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" style="font-size:11px">${(v * 100).toFixed(v * 100 < 1 ? 1 : 0)}%</text>`;
  if (shade) g += `<rect x="${X(shade.from)}" y="${pad.t}" width="${Math.max(0, W - pad.r - X(shade.from))}" height="${ih}" fill="var(--crit)" opacity=".07"/><text x="${W - pad.r - 6}" y="${pad.t + 14}" text-anchor="end" style="fill:var(--crit);font-size:11px;font-weight:700">${shade.label}</text>`;
  const bw = iw / bins;
  for (const s of series.filter((q) => q.main)) s.c.forEach((p, b) => { if (p > 0) g += `<rect x="${pad.l + b * bw + 0.5}" y="${Y(p)}" width="${Math.max(1, bw - 1)}" height="${pad.t + ih - Y(p)}" fill="${s.color}" opacity=".78" rx="1.5"><title>${s.name}: ${(p * 100).toFixed(1)}% of runs · ${fmtX(lo + b * step)}${step ? ' to ' + fmtX(lo + (b + 1) * step) : ''}</title></rect>`; });
  for (const s of series.filter((q) => !q.main)) g += `<path d="${Array.from(s.c).map((p, b) => `${b ? 'L' : 'M'}${pad.l + (b + 0.5) * bw} ${Y(p)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="1.8" opacity=".85" stroke-linejoin="round"/>`;
  g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= lo + span; v += tickStep) g += `<line class="axis" x1="${X(v)}" x2="${X(v)}" y1="${pad.t + ih}" y2="${pad.t + ih + 4}"/><text x="${X(v)}" y="${H - 12}" text-anchor="middle" style="font-size:11px">${fmtX(v)}</text>`;
  markers.forEach((m, k) => { const mx = X(m.v); if (mx < pad.l || mx > W - pad.r) return; const anchor = mx > W - 130 ? 'end' : 'start'; g += `<line x1="${mx}" x2="${mx}" y1="${pad.t - 8 - 0}" y2="${pad.t + ih}" stroke="${m.color}" stroke-width="1.8" stroke-dasharray="${m.dash || ''}"/><text x="${mx + (anchor === 'end' ? -4 : 4)}" y="${14 + k * 13}" text-anchor="${anchor}" style="fill:${m.color};font-weight:700;font-size:11px;paint-order:stroke;stroke:var(--surface);stroke-width:3px">${m.label}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function renderDistributions() {
  const s = scn(state.sel), r = res(), st = r.stats, A = state.A, sim = state.sim;
  const shown = (state.overlay ? M.SCENARIOS : [s]).map((q) => res(q.id));
  const lo = Math.floor(Math.min(...shown.map((q) => q.stats.launch.min))), hi = Math.ceil(Math.max(...shown.map((q) => q.stats.launch.max))) + 1;
  const bins = hi - lo;
  const mk = (q) => ({ c: M.histogram(q.launch, lo, 1, bins), color: COLORS[q.scn.id], main: q.scn.id === s.id, name: q.scn.name });
  const targetW = sim.targetDays / 7;
  const tick = bins > 22 ? 4 : 2;
  const markers = [{ v: st.launch.p50, label: `P50 ${dts(st.launch.p50)}`, color: 'var(--ink)' }, { v: st.launch.p90, label: `P90 ${dts(st.launch.p90)}`, color: 'var(--ink)', dash: '5 4' }, { v: targetW, label: `Target ${M.fmtDay(sim.startDay + sim.targetDays, true)}`, color: 'var(--crit)', dash: '2 3' }];
  if (s.phased) markers.push({ v: st.full.p50, label: `Full scope P50 ${dts(st.full.p50)}`, color: COLORS.phased, dash: '6 3' });
  const order = [...shown.filter((q) => q.scn.id !== s.id), r];
  const legend = state.overlay ? `<div class="legend">${M.SCENARIOS.map((q) => `<span><i style="background:${COLORS[q.id]};${q.id === s.id ? '' : 'height:3px'}"></i>${q.name}${q.id === s.id ? ' (selected)' : ''}</span>`).join('')}</div>` : '';
  $('#histDate').innerHTML = `<p class="muted small">${basisLabel(s)} · share of runs per week</p>` + histChart({ series: order.map(mk).sort((a, b) => a.main - b.main), lo, step: 1, bins, fmtX: (w) => dts(w), tickStep: tick, markers, shade: { from: targetW, label: 'Late' } }) + legend;
  const clo = Math.min(...shown.map((q) => q.stats.cost.min)), chi = Math.max(...shown.map((q) => q.stats.cost.max), A.budget * 1.02);
  const cstep = niceStep((chi - clo) / 36, 1), c0 = Math.floor(clo / cstep) * cstep, cb = Math.ceil((chi - c0) / cstep) + 1;
  const mkc = (q) => ({ c: M.histogram(q.cost, c0, cstep, cb), color: COLORS[q.scn.id], main: q.scn.id === s.id, name: q.scn.name });
  const cm = [{ v: st.cost.p50, label: `P50 ${money(st.cost.p50)}`, color: 'var(--ink)' }, { v: st.cost.p10, label: `P10 ${money(st.cost.p10)}`, color: 'var(--ink3)', dash: '5 4' }, { v: st.cost.p90, label: `P90 ${money(st.cost.p90)}`, color: 'var(--ink3)', dash: '5 4' }, { v: A.budget, label: `Budget ${money(A.budget)}`, color: 'var(--crit)', dash: '2 3' }];
  $('#histCost').innerHTML = `<p class="muted small">Final cost · share of runs per ${money(cstep)}</p>` + histChart({ series: order.map(mkc).sort((a, b) => a.main - b.main), lo: c0, step: cstep, bins: cb, fmtX: (v) => money(v), tickStep: niceStep(cb * cstep, 6), markers: cm, shade: { from: A.budget, label: 'Over budget' } }) + legend;
  renderScatter();
}
function renderScatter() {
  const s = scn(state.sel), r = res(), st = r.stats, A = state.A, sim = state.sim;
  const W = 1100, H = 420, pad = { l: 64, r: 20, t: 22, b: 44 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const tW = sim.targetDays / 7;
  const x0 = Math.floor(Math.min(st.launch.min, tW) - 1), x1 = Math.ceil(Math.max(st.launch.max, tW) + 1);
  const y0 = Math.floor(Math.min(st.cost.min, A.budget) / 100) * 100 - 100, y1 = Math.ceil(Math.max(st.cost.max, A.budget) / 100) * 100 + 100;
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * iw, Y = (v) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;
  let g = '';
  const ys = niceStep(y1 - y0, 6), xs = niceStep(x1 - x0, 8);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) g += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 8}" y="${Y(v) + 4}" text-anchor="end">${money(v)}</text>`;
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) g += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${pad.t + ih}"/><text x="${X(v)}" y="${H - 22}" text-anchor="middle">${dts(v)}</text>`;
  g += `<text x="${pad.l + iw / 2}" y="${H - 4}" text-anchor="middle" style="font-size:11px">${basisLabel(s)} date</text>`;
  g += `<rect x="${pad.l}" y="${Y(A.budget)}" width="${X(tW) - pad.l}" height="${pad.t + ih - Y(A.budget)}" fill="var(--good)" opacity=".07"/>`;
  const stride = Math.max(1, Math.floor(r.N / 1500));
  let dots = '';
  for (let i = 0; i < r.N; i += stride) {
    const cls = r.both[i] ? 'q-both' : r.onTime[i] ? 'q-time' : r.within[i] ? 'q-bud' : 'q-none';
    dots += `<circle class="${cls}" cx="${X(r.launch[i]).toFixed(1)}" cy="${Y(r.cost[i]).toFixed(1)}" r="2.6"/>`;
  }
  g += dots;
  g += `<line x1="${X(tW)}" x2="${X(tW)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--crit)" stroke-width="1.6" stroke-dasharray="6 4"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(A.budget)}" y2="${Y(A.budget)}" stroke="var(--crit)" stroke-width="1.6" stroke-dasharray="6 4"/>`;
  const lab = (px, py, anchor, t1, t2) => `<text x="${px}" y="${py}" text-anchor="${anchor}" class="t-strong" style="font-size:13px">${t1}</text><text x="${px}" y="${py + 15}" text-anchor="${anchor}" style="font-size:11.5px">${t2}</text>`;
  g += lab(pad.l + 10, pad.t + ih - 24, 'start', `${pct(st.pBoth)} both`, 'on time and within budget');
  g += lab(W - pad.r - 10, pad.t + ih - 24, 'end', `${pct(st.pBudget - st.pBoth)} budget only`, 'late but within budget');
  g += lab(pad.l + 10, pad.t + 18, 'start', `${pct(st.pOnTime - st.pBoth)} on time only`, 'over budget');
  g += lab(W - pad.r - 10, pad.t + 18, 'end', `${pct(st.pNeither)} neither`, 'late and over budget');
  $('#scatter').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of finish date versus cost">${g}</svg>
    <div class="legend"><span><i class="q-both" style="border-radius:50%"></i>Both met</span><span><i class="q-time" style="border-radius:50%"></i>On time, over budget</span><span><i class="q-bud" style="border-radius:50%"></i>Within budget, late</span><span><i class="q-none" style="border-radius:50%"></i>Neither</span></div>`;
}

// ---------- sensitivity ----------
function renderSensitivity() {
  const s = scn(state.sel), r = res(), m = state.sens;
  document.querySelectorAll('#sensSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  const rows = M.sensitivity(r, m).slice(0, 8);
  const W = 1100, L = 250, R = 330, rowH = 40, top = 34, H = top + rows.length * rowH + 28, cx = L + (W - L - R) / 2, half = (W - L - R) / 2 - 10;
  const maxRho = Math.max(0.3, ...rows.map((q) => Math.abs(q.rho)));
  const pos = m === 'both' ? 'var(--good)' : 'var(--c-delay)', neg = m === 'both' ? 'var(--bad)' : 'var(--c-current)';
  let g = `<text x="${cx}" y="16" text-anchor="middle" class="t-strong">Rank correlation with ${m === 'launch' ? 'launch date' : m === 'cost' ? 'final cost' : 'meeting both targets'}</text>`;
  [-1, -0.5, 0, 0.5, 1].forEach((f) => { const gx = cx + (f * maxRho / maxRho) * half * (Math.abs(f) === 1 ? 1 : 0.5); g += `<line class="${f === 0 ? 'axis' : 'grid'}" x1="${gx}" x2="${gx}" y1="${top - 6}" y2="${H - 24}"/>`; });
  rows.forEach((q, i) => {
    const y = top + i * rowH, w = (Math.abs(q.rho) / maxRho) * half, bx = q.rho >= 0 ? cx : cx - w;
    const sw = m === 'launch' ? sgn(q.swing, ' wks') : m === 'cost' ? (q.swing < 0 ? '−' : '+') + money(Math.abs(q.swing)) : sgn(q.swing * 100, ' pts', 0);
    g += `<g><title>${q.label}: ρ = ${q.rho.toFixed(2)}</title><text x="0" y="${y + 24}" class="t-strong" style="font-size:13px">${esc(q.label)}</text>
      <rect x="${bx}" y="${y + 8}" width="${Math.max(2, w)}" height="22" rx="4" fill="${q.rho >= 0 ? pos : neg}" opacity=".85"/>
      <text x="${q.rho >= 0 ? bx + w + 8 : bx - 8}" y="${y + 24}" text-anchor="${q.rho >= 0 ? 'start' : 'end'}" style="font-variant-numeric:tabular-nums;font-weight:700;fill:var(--ink)">${q.rho >= 0 ? '+' : '−'}${Math.abs(q.rho).toFixed(2)}</text>
      <text x="${W}" y="${y + 24}" text-anchor="end" style="font-size:12px">High vs low fifth: <tspan class="t-strong">${sw}</tspan></text></g>`;
  });
  const note = m === 'both' ? 'Right (green): higher values raise the odds of meeting both targets. Left (red): they lower them.' : `Right: higher values push ${m === 'launch' ? 'launch later' : 'cost up'}. Left: higher values pull it ${m === 'launch' ? 'earlier' : 'down'}.`;
  const top1 = rows[0];
  $('#sensChart').innerHTML = `<p class="small" style="margin-bottom:6px"><b>${esc(top1.label)}</b> moves the ${s.name} forecast most. ${note} Computed from the same ${state.sim.N.toLocaleString()} runs; inputs that don’t vary in this scenario are omitted.</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sensitivity bars">${g}</svg>`;
}

// ---------- executive brief ----------
function renderBrief() {
  const A = state.A, sim = state.sim, S = M.SCENARIOS.map((s) => ({ s, st: res(s.id).stats }));
  const cur = res('current').stats, d = res('delay').stats, c = res('contractor').stats, p = res('phased').stats;
  const tgt = M.fmtDay(sim.startDay + sim.targetDays), best = S.slice(1).reduce((b, x) => (x.st.pBoth > b.st.pBoth ? x : b));
  const line = ({ s, st }) => `• ${s.name}: ${basisLabel(s).toLowerCase()} P50 ${dt(st.launch.p50)}, P90 ${dt(st.launch.p90)}; cost P50 ${money(st.cost.p50)} (80% interval ${money(st.cost.p10)}–${money(st.cost.p90)}); on time ${pct(st.pOnTime)}, within budget ${pct(st.pBudget)}, both ${pct(st.pBoth)}.`;
  const dd = day(d.launch.p50) - day(cur.launch.p50), cg = day(d.launch.p50) - day(c.launch.p50);
  const ph = A.phased;
  const txt = `DELIVERY FORECAST BRIEF — Customer onboarding system replacement
Brightwater Financial · FICTIONAL DATA, for portfolio demonstration only
Model: ${sim.N.toLocaleString()}-run Monte Carlo, fixed seed ${A.seed}; schedule and cost computed together in every run.
Program start ${M.fmtDay(sim.startDay)} · target launch ${tgt} · budget ${money(A.budget)}

BOTTOM LINE
Without intervention, the announced vendor delay takes the chance of meeting both targets from ${pct(cur.pBoth)} to ${pct(d.pBoth)} and moves the P50 launch ${dd} days to ${dt(d.launch.p50)}. Among the delay options, ${best.s.name} gives the best odds of meeting both targets (${pct(best.st.pBoth)}); no option fully restores the original ${pct(cur.pBoth)}.

SCENARIOS
${S.map(line).join('\n')}

TRADE-OFFS
1. Vendor delay: +${dd} days at P50 and ${smoney(d.cost.p50 - cur.cost.p50)} P50 cost (standby labor, change orders, extra program overhead). Late projects are also expensive projects: both targets together are met in ${pct(d.pBoth)} of runs versus ${pct(d.pIndep)} if date and cost were independent.
2. Contractor: shortens testing by about ${Math.round(A.contractor.reduction[1] * 100)}% and pulls P50 launch ${cg} days earlier (${dt(c.launch.p50)}), for ${smoney(c.cost.p50 - d.cost.p50)} P50 cost. It cannot remove the vendor dependency: testing still starts only after vendor integration finishes. On-time odds move ${pct(d.pOnTime)} → ${pct(c.pOnTime)}.
3. Phased launch: about ${Math.round(ph.scope * 100)}% of scope ships on day one (new-customer onboarding, identity checks on the vendor core APIs, active-customer records, Tier-1 training) at P50 ${dt(p.dayOne.p50)} (P90 ${dt(p.dayOne.p90)}). Remaining vendor modules, archive migration, partner portal and Tier-2 training follow, with full scope at P50 ${dt(p.full.p50)} (P90 ${dt(p.full.p90)}). Cost: ${smoney(p.cost.p50 - d.cost.p50)} P50 vs. Vendor Delay from running two systems and a second cutover. "On time" for this scenario is measured at ${A.onTimeBasis === 'dayOne' ? 'day one' : 'full scope'}; full scope completes ${wk1(p.full.p50 - p.dayOne.p50)} after day one.

DECISIONS REQUESTED
• Confirm whether a day-one launch of partial scope satisfies the ${tgt} commitment, or whether the commitment is full scope.
• ${A.budget < p.cost.p50 ? `Budget of ${money(A.budget)} sits below the phased P50 cost of ${money(p.cost.p50)}; approve more budget or accept lower odds.` : `Budget of ${money(A.budget)} covers the phased P50 cost of ${money(p.cost.p50)}.`}
• Decide on the contractor only as a complement to another lever; on its own it cannot recover the vendor slip.

KEY ASSUMPTIONS (all fictional, editable in the app)
Durations (weeks, min/likely/max): migration ${A.streams.dm.dur.join('/')}, vendor integration ${A.streams.vi.dur.join('/')}, testing ${A.streams.test.dur.join('/')}, training ${A.streams.train.dur.join('/')}. Vendor slip ${A.vendor.delay.join('/')} wks (${Math.round(A.vendor.baseProb * 100)}% chance in Current Plan, ${Math.round(A.vendor.announcedProb * 100)}% once announced). Program overhead ${money(A.overheadPerWeek)}/week. Training may begin when ${Math.round(A.trainOverlap * 100)}% of testing is done.`;
  $('#briefText').value = txt;
}

function renderMethod() {
  const A = state.A;
  $('#method').innerHTML = `<h3>How the numbers are made</h3><ul>
    <li><b>One run = one possible project.</b> Each run draws every uncertain input once (durations, vendor slip, cost overruns, labor-rate escalation, change orders), schedules the tasks with a critical-path engine, then prices that exact schedule. Finish date, final cost, “on time”, “within budget” and “both” all come from the same run.</li>
    <li><b>Fixed seed ${A.seed}, ${A.runs.toLocaleString()} runs.</b> Re-running gives identical results. All four scenarios reuse the same random draws (common random numbers), so scenario differences are not sampling noise.</li>
    <li><b>Cost</b> = fixed costs × overrun factor + team burn × weeks × rate escalation + vendor standby during slips + change orders + program overhead until full scope (+ contractor or dual-run costs where they apply). Longer projects therefore cost more.</li>
    <li><b>P50 / P90</b> are the median and 90th-percentile outcomes. The 80% prediction interval for cost is P10 to P90.</li>
    <li><b>Sensitivity</b> is Spearman rank correlation between each sampled input and the outcome, with the average outcome gap between the highest and lowest fifth of that input.</li>
    <li><b>Limits:</b> triangular distributions, independent inputs apart from the shared schedule, no scope change, no calendar holidays. It is a demonstration model on invented numbers.</li></ul>`;
}

// ---------- editable assumptions ----------
const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
function setPath(o, p, v) {
  const parts = p.split('.'), last = parts.pop(), parent = parts.reduce((a, k) => a[k], o);
  parent[last] = v;
  if (Array.isArray(parent) && parent.length === 3) { // keep min ≤ likely ≤ max
    const i = +last;
    if (i === 0) { if (parent[1] < v) parent[1] = v; if (parent[2] < parent[1]) parent[2] = parent[1]; }
    if (i === 1) { if (parent[0] > v) parent[0] = v; if (parent[2] < v) parent[2] = v; }
    if (i === 2) { if (parent[1] > v) parent[1] = v; if (parent[0] > parent[1]) parent[0] = parent[1]; }
  }
}
const FMT = { pct: (v) => `${Math.round(v * 100)}%`, wk: (v) => `${(+v.toFixed(1))} wk`, usd: (v) => money(v), num: (v) => String(v) };
function slider(path, label, { min, max, step, scale = 1, fmt = 'num', hint = '' }) {
  const id = 'f_' + path.replace(/\./g, '_');
  return `<div class="field"><label for="${id}">${label}</label><output data-out="${path}" data-fmt="${fmt}"></output><input id="${id}" type="range" data-path="${path}" data-scale="${scale}" min="${+(min * scale).toFixed(4)}" max="${+(max * scale).toFixed(4)}" step="${+(step * scale).toFixed(4)}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
function numField(path, label, { step = 1, scale = 1, unit = '', min = 0 } = {}) {
  const id = 'n_' + path.replace(/\./g, '_');
  return `<div class="field"><label for="${id}">${label}${unit ? ` <span class="muted">(${unit})</span>` : ''}</label><input id="${id}" type="number" data-path="${path}" data-scale="${scale}" step="${step}" min="${min}"></div>`;
}
function renderLevers() {
  $('#leverGrid').innerHTML = `
    <div class="card lever-group"><h3><i style="--c:var(--ink3)"></i>Targets</h3>
      <div class="field"><label for="f_targetDate">Target launch date</label><input id="f_targetDate" type="date" data-path="targetDate" data-str="1"></div>
      ${slider('budget', 'Budget', { min: 4500, max: 8000, step: 50, fmt: 'usd' })}
      <div class="field"><label for="f_basis">Phased “on time” means</label><select id="f_basis" data-path="onTimeBasis" data-str="1"><option value="dayOne">Day-one launch</option><option value="full">Full scope</option></select></div></div>
    <div class="card lever-group" style="--c:var(--c-delay)"><h3><i></i>Vendor slip</h3>
      ${slider('vendor.delay.1', 'Most-likely slip', { min: 0, max: 16, step: 0.5, fmt: 'wk', hint: 'Min and max stretch to include it' })}
      ${slider('vendor.baseProb', 'Chance of slip in Current Plan', { min: 0, max: 1, step: 0.05, scale: 100, fmt: 'pct' })}
      ${slider('vendor.standbyFactor', 'Vendor-team cost while waiting', { min: 0, max: 1, step: 0.05, scale: 100, fmt: 'pct', hint: 'Share of normal weekly burn' })}</div>
    <div class="card lever-group" style="--c:var(--c-contractor)"><h3><i></i>Contractor</h3>
      ${slider('contractor.reduction.1', 'Testing time removed', { min: 0, max: 0.6, step: 0.01, scale: 100, fmt: 'pct', hint: 'Testing only — vendor dependency stays' })}
      ${slider('contractor.weeklyRate', 'Weekly rate', { min: 10, max: 80, step: 1, fmt: 'usd' })}
      ${slider('contractor.onboardFee', 'Onboarding fee', { min: 0, max: 150, step: 5, fmt: 'usd' })}</div>
    <div class="card lever-group" style="--c:var(--c-phased)"><h3><i></i>Phased launch</h3>
      ${slider('phased.scope', 'Scope shipped on day one', { min: 0.3, max: 0.9, step: 0.01, scale: 100, fmt: 'pct' })}
      ${slider('phased.coreVendorShare', 'Vendor work needed for day one', { min: 0.3, max: 1, step: 0.01, scale: 100, fmt: 'pct' })}
      ${slider('phased.dualRunPerWeek', 'Dual-running cost', { min: 0, max: 100, step: 5, fmt: 'usd', hint: 'Per week between releases' })}</div>`;
}
const tri = (path, o = {}) => `<span class="tri">${[0, 1, 2].map((i) => `<input type="number" aria-label="${path} ${['min', 'likely', 'max'][i]}" data-path="${path}.${i}" data-scale="${o.scale || 1}" step="${o.step || 1}" min="0">`).join('')}</span>`;
function renderAssumptions() {
  const A = state.A;
  const rows = M.WS.map((w) => `<tr><td>${M.WS_NAMES[w]}</td><td>${tri(`streams.${w}.dur`, { step: 0.5 })}</td><td><input type="number" data-path="streams.${w}.burn" step="1" min="0" aria-label="${w} burn"></td><td><input type="number" data-path="streams.${w}.fixed" step="10" min="0" aria-label="${w} fixed"></td><td>${tri(`streams.${w}.costRisk`, { step: 0.01 })}</td></tr>`).join('');
  const fg = (label, html) => `<label>${label}</label><div>${html}</div>`;
  const n = (path, step = 1, scale = 1) => `<input type="number" data-path="${path}" data-scale="${scale}" step="${step}" min="0">`;
  $('#assumpBody').innerHTML = `
    <div class="card" style="margin-bottom:14px"><h3>Workstreams</h3>
      <table class="at"><thead><tr><th>Workstream</th><th>Duration, weeks<br><span style="text-transform:none;font-weight:400">min · likely · max</span></th><th>Team burn<br>$k/wk</th><th>Fixed cost<br>$k</th><th>Cost-overrun factor<br><span style="text-transform:none;font-weight:400">min · likely · max</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="assump-grid">
      <div class="card"><h3>Dependencies and program</h3><div class="fgrid">
        ${fg('Program start', '<input type="date" data-path="startDate" data-str="1">')}
        ${fg('Target launch', '<input type="date" data-path="targetDate" data-str="1">')}
        ${fg('Budget, $k', n('budget', 50))}
        ${fg('PMO + legacy carrying cost, $k/wk', n('overheadPerWeek', 5))}
        ${fg('Training starts when testing is …% done', n('trainOverlap', 5, 100))}
        ${fg('Final training weeks after testing ends', n('trainTail', 0.5))}
        ${fg('Labor-rate escalation (min · likely · max)', tri('burnEscalation', { step: 0.01 }))}
        ${fg('Testing waits for', '<span class="muted small">Data migration AND vendor integration</span>')}
        ${fg('Simulation runs', `<select data-path="runs"><option>5000</option><option>10000</option><option>25000</option></select>`)}
        ${fg('Random seed (fixed)', `<span class="muted">${A.seed}</span>`)}</div></div>
      <div class="card"><h3>Vendor slip</h3><div class="fgrid">
        ${fg('Chance in Current Plan, %', n('vendor.baseProb', 5, 100))}
        ${fg('Chance once announced, %', n('vendor.announcedProb', 5, 100))}
        ${fg('Slip size, weeks (min · likely · max)', tri('vendor.delay', { step: 0.5 }))}
        ${fg('Vendor-team cost while waiting, %', n('vendor.standbyFactor', 5, 100))}
        ${fg('Change-order chance if slipping, %', n('vendor.changeOrderProb', 5, 100))}
        ${fg('Change-order cost, $k (min · likely · max)', tri('vendor.changeOrderCost', { step: 10 }))}</div>
        <h3 style="margin-top:18px">Contractor</h3><div class="fgrid">
        ${fg('Testing time removed, % (min · likely · max)', tri('contractor.reduction', { step: 1, scale: 100 }))}
        ${fg('Weekly rate, $k', n('contractor.weeklyRate', 1))}
        ${fg('Onboarding fee, $k', n('contractor.onboardFee', 5))}</div></div>
    </div>
    <div class="card"><h3>Phased launch</h3><div class="fgrid" style="grid-template-columns:repeat(2,1fr 150px);gap:8px 18px">
        ${fg('Scope shipped on day one, %', n('phased.scope', 1, 100))}
        ${fg('Vendor work needed for day one, %', n('phased.coreVendorShare', 1, 100))}
        ${fg('Share of vendor slip on core APIs, %', n('phased.delayOnCore', 5, 100))}
        ${fg('Extra day-one testing (hardening), %', n('phased.hardening', 5, 100))}
        ${fg('Phase-2 regression, weeks', n('phased.regressionWeeks', 0.5))}
        ${fg('Hypercare before phase 2, weeks', n('phased.stabilizeWeeks', 0.5))}
        ${fg('Dual-running cost, $k/wk', n('phased.dualRunPerWeek', 5))}
        ${fg('Second cutover, $k', n('phased.secondCutoverCost', 10))}
        ${fg('“On time” for phased measured at', '<select data-path="onTimeBasis" data-str="1"><option value="dayOne">Day-one launch</option><option value="full">Full scope</option></select>')}</div></div>`;
}
function syncInputs() {
  document.querySelectorAll('[data-path]').forEach((el) => {
    if (el === document.activeElement) return;
    const v = getPath(state.A, el.dataset.path);
    el.value = el.dataset.str ? v : +(v * (+el.dataset.scale || 1)).toFixed(3);
  });
  document.querySelectorAll('[data-out]').forEach((o) => { o.textContent = FMT[o.dataset.fmt](getPath(state.A, o.dataset.out)); });
}
function onEdit(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.path) return;
  const v = el.dataset.str ? el.value : parseFloat(el.value) / (+el.dataset.scale || 1);
  if (!el.dataset.str && !Number.isFinite(v)) return;
  if (el.dataset.str && !el.value) return;
  setPath(state.A, el.dataset.path, el.dataset.path === 'runs' ? Math.round(v) : v);
  syncInputs();
  schedule();
}

// ---------- tooltips & events ----------
function tipFor(id) {
  const plan = state.plan[state.sel], t = plan.by[id], ts = res().taskStats[id];
  return `<b>${esc(M.TASK_LABELS[id])}</b>Plan: ${dts(t.start)} → ${dts(t.end)} (${wk1(t.end - t.start)})<br>Finish P10–P90: ${dts(ts.end.p10)} – ${dts(ts.end.p90)}<br>Critical in ${Math.round(res().crit[id] * 100)}% of runs`;
}
function bind() {
  document.addEventListener('input', onEdit);
  document.addEventListener('change', onEdit);
  document.addEventListener('click', (e) => {
    const sc = e.target.closest('[data-scn]');
    if (sc) { state.sel = sc.dataset.scn; state.selTask = null; renderAll(); return; }
    const tk = e.target.closest('[data-task]');
    if (tk) { state.selTask = tk.dataset.task; renderTaskDetail(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest && e.target.closest('[data-task],.colhead[data-scn]');
    if (t) { e.preventDefault(); t.click(); }
  });
  const tip = $('#tip');
  document.addEventListener('pointermove', (e) => {
    const tk = e.target.closest && e.target.closest('[data-task]');
    if (!tk || !state.sim) { tip.hidden = true; return; }
    tip.innerHTML = tipFor(tk.dataset.task); tip.hidden = false;
    tip.style.left = Math.min(window.innerWidth - 300, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 16 + 'px';
  });
  $('#whiskToggle').addEventListener('change', (e) => { state.whisk = e.target.checked; renderTimeline(); });
  $('#overlayToggle').addEventListener('change', (e) => { state.overlay = e.target.checked; renderDistributions(); });
  $('#sensSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.sens = b.dataset.m; renderSensitivity(); } });
  $('#resetBtn').addEventListener('click', () => { state.A = M.clone(M.DEFAULTS); syncInputs(); recalc(); });
  $('#copyBtn').addEventListener('click', async () => {
    const ta = $('#briefText'), msg = $('#copyMsg');
    try { await navigator.clipboard.writeText(ta.value); msg.textContent = 'Copied to clipboard'; }
    catch { ta.select(); try { document.execCommand('copy'); msg.textContent = 'Copied to clipboard'; } catch { msg.textContent = 'Select the text and copy manually'; } }
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });
}

renderLevers();
renderAssumptions();
bind();
syncInputs();
recalc();
window.__studio = { state, M, recalc };
