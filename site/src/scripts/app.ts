// Everything interactive on the page. The data comes from the notebooks
// (scripts/export_data.py); the maths lives in src/lib/quant.ts.

import seriesJson from "../data/series.json";
import pre from "../data/precomputed.json";
import {
  type Series, dateOf, indexOf, range, std, riskStats, rollingVar, ewmaVar, qlike,
  backtest, metrics, trainVol, vtWeight, blockBootstrap,
} from "../lib/quant.ts";

const S = seriesJson as Series;
const N = S.ret.length;
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
const out = (name: string) => $(`[data-out="${name}"]`);
const plotEl = (name: string) => $(`[data-plot="${name}"]`);

// ---------- formatting ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const minus = (s: string) => s.replace(/^-/, "−");
const pct = (x: number, d = 2) => minus((x * 100).toFixed(d) + "%");
const num = (x: number, d = 4) => minus(x.toFixed(d));
const usd = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: x < 100 ? 2 : 0 });
const dayName = (i: number) => { const d = dateOf(S.start, i); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const isoOf = (i: number) => dateOf(S.start, i).toISOString().slice(0, 10);
const R = (i: number) => S.ret[i] as number;

// ---------- shared calculations (the notebooks' settings) ----------
const MIN_DAY = indexOf(S.start, "2018-01-01");
const MAX_DAY = indexOf(S.start, "2025-12-30");
const BT_START = indexOf(S.start, "2022-01-01");
const BT_END = indexOf(S.start, "2025-12-31");
const roll = rollingVar(S, 30);
const ew97 = ewmaVar(S, 0.97);
const TRAIN_VOL = trainVol(S);
const full = riskStats(S, "2018", "2025");

const state = { day: indexOf(S.start, "2022-11-09"), lam: 0.97, target: 0.3, cost: 25, align: "aligned", period: "2018,2025" };

// ---------- tiny SVG chart helpers ----------
type Line = { y: (number | null)[]; color: string; width?: number; dash?: string };
type ChartOpts = {
  x0: number; lines: Line[]; height?: number; log?: boolean; yFmt: (v: number) => string;
  ticks: "years" | "months"; marker?: number | null; markers?: number[]; zeroLine?: boolean; fill?: boolean;
  yMin?: number; yMax?: number;
};

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const t: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) t.push(+v.toFixed(12));
  return t;
}
function logTicks(lo: number, hi: number): number[] {
  const t: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo && v <= hi) t.push(v); }
  return t.length > 6 ? t.filter((v) => /^1/.test(String(v))) : t;
}

function lineChart(el: HTMLElement, o: ChartOpts) {
  const W = Math.max(280, el.clientWidth), H = o.height ?? (el.clientHeight || 240);
  const m = { l: 56, r: 14, t: 12, b: 26 };
  const n = Math.max(...o.lines.map((l) => l.y.length));
  let lo = Infinity, hi = -Infinity;
  for (const l of o.lines) for (const v of l.y) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (o.yMin != null) lo = o.yMin;
  if (o.yMax != null) hi = o.yMax;
  if (!o.log) { const pad = (hi - lo) * 0.06 || 0.01; lo -= o.yMin != null ? 0 : pad; hi += o.yMax != null ? 0 : pad; }
  const f = (v: number) => (o.log ? Math.log(v) : v);
  const X = (k: number) => m.l + (k / Math.max(1, n - 1)) * (W - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (f(v) - f(lo)) / (f(hi) - f(lo) || 1)) * (H - m.t - m.b);
  const clip = `c${Math.random().toString(36).slice(2, 8)}`;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="${clip}"><rect x="${m.l}" y="${m.t - 6}" width="${W - m.l - m.r + 6}" height="${H - m.t - m.b + 6}"/></clipPath></defs><g class="axis">`;
  for (const v of o.log ? logTicks(lo, hi) : niceTicks(lo, hi)) {
    const y = Y(v);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${o.yFmt(v)}</text>`;
  }
  let lastX = -99;
  for (let k = 0; k < n; k++) {
    const d = dateOf(S.start, o.x0 + k);
    const isTick = o.ticks === "years" ? d.getUTCMonth() === 0 && d.getUTCDate() === 1 : d.getUTCDate() === 1;
    if (!isTick) continue;
    const x = X(k);
    if (x - lastX < 44) continue;
    lastX = x;
    const label = o.ticks === "years" ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()];
    s += `<line x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 4}" style="stroke:var(--line3)"/><text x="${x}" y="${H - 6}" text-anchor="middle">${label}</text>`;
  }
  s += `</g>`;
  if (o.zeroLine && lo < 0 && hi > 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--muted);stroke-width:1"/>`;
  s += `<g clip-path="url(#${clip})">`;
  for (const l of o.lines) {
    let d = "", pen = false;
    l.y.forEach((v, k) => {
      if (v == null || !isFinite(v) || (o.log && v <= 0)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
    });
    if (o.fill) {
      const base = Y(Math.min(0, hi));
      s += `<path d="${d}L${X(l.y.length - 1)},${base}L${X(0)},${base}Z" style="fill:${l.color};opacity:0.12;stroke:none"/>`;
    }
    s += `<path d="${d}" style="fill:none;stroke:${l.color};stroke-width:${l.width ?? 1.6};stroke-linejoin:round${l.dash ? ";stroke-dasharray:" + l.dash : ""}"/>`;
  }
  s += `</g>`;
  for (const mk of o.markers ?? []) {
    const k = mk - o.x0, v = o.lines[0].y[k];
    if (v != null && k >= 0 && k < n) s += `<circle cx="${X(k)}" cy="${Y(v)}" r="3.5" style="fill:var(--surface);stroke:var(--muted);stroke-width:1.5"/>`;
  }
  if (o.marker != null) {
    const k = o.marker - o.x0;
    if (k >= 0 && k < n) {
      const x = X(k);
      s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" style="stroke:var(--rust);stroke-width:1.5;stroke-dasharray:4 3"/>`;
      for (const l of o.lines) { const v = l.y[k]; if (v != null && isFinite(v) && v >= lo && v <= hi) s += `<circle cx="${x}" cy="${Y(v)}" r="4.5" style="fill:var(--rust);stroke:var(--surface);stroke-width:2"/>`; }
    }
  }
  el.innerHTML = s + "</svg>";
  return { X, W, m };
}

// ---------- day selection ----------
const listeners: (() => void)[] = [];
const onDay = (fn: () => void) => { listeners.push(fn); };

function setDay(i: number) {
  state.day = Math.max(MIN_DAY, Math.min(MAX_DAY, Math.round(i)));
  const iso = isoOf(state.day);
  ($("#day-input") as HTMLInputElement).value = iso;
  $$("[data-day-label]").forEach((e) => (e.textContent = dayName(state.day)));
  $$<HTMLButtonElement>(".chip[data-day]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.day === iso)));
  listeners.forEach((fn) => fn());
}

// ---------- hero price chart ----------
const pricePlot = $("#price-plot");
const presetIdx = $$<HTMLButtonElement>(".chip[data-day]").map((b) => indexOf(S.start, b.dataset.day!));
let priceGeom: { X: (k: number) => number; W: number; m: { l: number; r: number } } | null = null;
function drawPrice() {
  priceGeom = lineChart(pricePlot, {
    x0: 0, lines: [{ y: S.price, color: "var(--blue)", width: 1.6 }], log: true, ticks: "years",
    yFmt: (v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`), marker: state.day, markers: presetIdx,
  });
}
function dayFromPointer(e: PointerEvent) {
  if (!priceGeom) return;
  const r = pricePlot.getBoundingClientRect();
  const k = ((e.clientX - r.left - priceGeom.m.l) / (priceGeom.W - priceGeom.m.l - priceGeom.m.r)) * (N - 1);
  setDay(k);
}
let dragging = false;
pricePlot.addEventListener("pointerdown", (e) => { dragging = true; pricePlot.setPointerCapture(e.pointerId); dayFromPointer(e); });
pricePlot.addEventListener("pointermove", (e) => { if (dragging) dayFromPointer(e); });
pricePlot.addEventListener("pointerup", () => (dragging = false));
pricePlot.addEventListener("pointercancel", () => (dragging = false));
onDay(drawPrice);

$$<HTMLButtonElement>(".chip[data-day]").forEach((b) => b.addEventListener("click", () => setDay(indexOf(S.start, b.dataset.day!))));
$("#day-input").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value;
  if (v) setDay(indexOf(S.start, v));
});

// ---------- theme ----------
$("[data-theme-toggle]").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch { /* private mode: the choice just isn't remembered */ }
});

// ---------- rail scroll-spy ----------
const railLinks = $$<HTMLAnchorElement>(".rail a");
const narrow = window.matchMedia("(max-width: 860px)");
const stepEls = $$(".step");
let spyFrame = 0, currentStep = "";
function spy() {
  spyFrame = 0;
  const line = window.innerHeight * 0.3;
  let id = stepEls[0].id;
  for (const s of stepEls) if (s.getBoundingClientRect().top <= line) id = s.id;
  if (id === currentStep) return;
  currentStep = id;
  railLinks.forEach((a) => {
    const on = a.getAttribute("href") === `#${id}`;
    a.setAttribute("aria-current", String(on));
    if (on && narrow.matches) a.parentElement!.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
  });
}
window.addEventListener("scroll", () => { if (!spyFrame) spyFrame = requestAnimationFrame(spy); }, { passive: true });
spy();

// ---------- line examples for the explanation panels ----------
function backtestVT() {
  return backtest(S, vtWeight(ew97, state.target), state.cost / 1e4);
}
let vtRunCache: { key: string; run: ReturnType<typeof backtest> } | null = null;
function vtRun() {
  const key = `${state.target}|${state.cost}`;
  if (!vtRunCache || vtRunCache.key !== key) vtRunCache = { key, run: backtestVT() };
  return vtRunCache.run;
}
const settings = () => `target ${Math.round(state.target * 100)}%, cost ${state.cost} bp`;

function example(key: string, i: number): string {
  const d = dayName(i), dPrev = dayName(i - 1), dNext = dayName(i + 1);
  switch (key) {
    case "ret":
      return `<p class="k">On ${d}</p><p class="calc">${usd(S.price[i]!)} ÷ ${usd(S.price[i - 1]!)} − 1 = <b>${pct(R(i))}</b></p>`;
    case "dd": {
      const k = i - full.a;
      const w = full.wealth[k], peak = Math.max(...full.wealth.slice(0, k + 1));
      return `<p class="k">On ${d}, 1 USD from 1 Jan 2018 was worth</p><p class="calc">${num(w, 3)} USD; highest so far ${num(peak, 3)}; ${num(w, 3)} ÷ ${num(peak, 3)} − 1 = <b>${pct(full.dd[k], 1)}</b></p>`;
    }
    case "rf": {
      const rd = S.rf[i]!, ann = (1 + rd) ** 365 - 1;
      return `<p class="k">On ${d} (yesterday's T-bill rate, because of shift(1))</p><p class="calc">(1 + ${pct(ann, 2)}) ^ (1/365) − 1 = <b>${pct(rd, 4)}</b> a day</p>`;
    }
    case "y":
      return `<p class="k">The row for ${d} stores the return of the next day, ${dNext}</p><p class="calc">y = <b>${pct(R(i + 1))}</b></p>`;
    case "mom":
      return `<p class="k">On ${d}, against the price 30 days earlier (${dayName(i - 30)})</p><p class="calc">${usd(S.price[i]!)} ÷ ${usd(S.price[i - 30]!)} − 1 = <b>${pct(S.price[i]! / S.price[i - 30]! - 1)}</b></p>`;
    case "vol30": {
      const v = std(S.ret.slice(i - 29, i + 1) as number[]);
      return `<p class="k">Standard deviation of the 30 daily returns from ${dayName(i - 29)} to ${d}</p><p class="calc"><b>${pct(v)}</b> a day, about ${pct(v * Math.sqrt(365), 0)} a year</p>`;
    }
    case "roll":
      return `<p class="k">Average of the 30 squared returns up to ${d}</p><p class="calc">${num(roll[i]!, 6)}; as annual volatility √(${num(roll[i]!, 6)} × 365) = <b>${pct(Math.sqrt(roll[i]! * 365), 1)}</b></p>`;
    case "ewma": {
      const v0 = ew97[i - 1]!, x = R(i), v1 = ew97[i]!;
      return `<p class="k">On ${d}, with λ = 0.97 and today's return ${pct(x)}</p><p class="calc">0.97 × ${num(v0, 6)} + 0.03 × (${num(x, 4)})² = <b>${num(v1, 6)}</b></p><p class="note">As annual volatility: ${pct(Math.sqrt(v0 * 365), 1)} the day before, ${pct(Math.sqrt(v1 * 365), 1)} now.</p>`;
    }
    case "sig":
      return `<p class="k">EWMA forecast made on ${d}, for ${dNext}</p><p class="calc">√(${num(ew97[i]!, 6)} × 365) = <b>${pct(Math.sqrt(ew97[i]! * 365), 1)}</b></p>`;
    case "wvt": {
      const sg = Math.sqrt(ew97[i]! * 365), w = Math.min(1, state.target / sg);
      return `<p class="k">Weight decided on ${d}, held on ${dNext}</p><p class="calc">min(1, ${pct(state.target, 0)} ÷ ${pct(sg, 1)}) = <b>${pct(w, 1)}</b> in Bitcoin</p>`;
    }
    case "gross": case "net": case "drift": {
      if (i < BT_START || i > BT_END) return `<p class="note">The backtest runs from 1 Jan 2022. Pick a later day to see this line worked through.</p>`;
      const run = vtRun(), k = i - run.start, w = run.w[k], r = R(i), f = S.rf[i]!;
      const gross = w * r + (1 - w) * f;
      if (key === "gross") return `<p class="k">Volatility target on ${d} (${settings()})</p><p class="calc">${num(w, 3)} × ${pct(r)} + ${num(1 - w, 3)} × ${pct(f, 4)} = <b>${pct(gross, 3)}</b></p>`;
      if (key === "net") return `<p class="k">Volatility target on ${d} (${settings()})</p><p class="calc">${pct(gross, 3)} − ${num(state.cost / 1e4, 4)} × ${num(run.to[k], 4)} = <b>${pct(run.ret[k], 3)}</b></p>`;
      const drift = (w * (1 + r)) / (w * (1 + r) + (1 - w) * (1 + f));
      return `<p class="k">After ${d}'s move of ${pct(r)}, the ${pct(w, 1)} Bitcoin share drifts to</p><p class="calc"><b>${pct(drift, 1)}</b>, so tomorrow's trade is the gap between this and the new target.</p>`;
    }
  }
  return "";
}

// Explanation panels: click a line to show its explanation; on narrow screens the panel moves under the line.
$$(".nb").forEach((nb) => {
  const panel = $(".nb-explain", nb);
  const home = nb;
  const lines = $$<HTMLButtonElement>("button.line", nb);
  const show = (b: HTMLButtonElement) => {
    lines.forEach((l) => l.setAttribute("aria-pressed", String(l === b)));
    $("[data-ex-cell]", panel).textContent = b.dataset.cell!;
    $("[data-ex-line]", panel).textContent = b.dataset.line!;
    $("[data-ex-src]", panel).textContent = b.dataset.src!.trim();
    $("[data-ex-text]", panel).textContent = b.dataset.e!;
    const ex = $("[data-ex-example]", panel);
    ex.dataset.exKey = b.dataset.ex ?? "";
    ex.innerHTML = b.dataset.ex ? example(b.dataset.ex, state.day) : "";
    if (narrow.matches) b.after(panel);
    else if (panel.parentElement !== home) home.append(panel);
  };
  lines.forEach((b) => b.addEventListener("click", () => show(b)));
  narrow.addEventListener("change", () => {
    if (!narrow.matches && panel.parentElement !== home) home.append(panel);
  });
});
onDay(() => $$("[data-ex-example]").forEach((ex) => (ex.innerHTML = ex.dataset.exKey ? example(ex.dataset.exKey, state.day) : "")));

// ---------- segmented buttons ----------
function seg(name: string, fn: (v: string) => void) {
  const g = $(`[data-seg="${name}"]`);
  $$<HTMLButtonElement>("button", g).forEach((b) => b.addEventListener("click", () => {
    $$("button", g).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    fn(b.dataset.v!);
  }));
}
const stat = (k: string, v: string) => `<div class="stat"><p class="k">${k}</p><p class="v">${v}</p></div>`;

// ---------- step 1 ----------
onDay(() => {
  const i = state.day;
  out("s1-calc").innerHTML = `${dayName(i)}: ${usd(S.price[i]!)} ÷ ${usd(S.price[i - 1]!)} (${dayName(i - 1)}) − 1 = <b>${pct(R(i))}</b>`;
});
out("s1-stats").innerHTML =
  stat("Days loaded", "3,044") + stat("Average daily return", pct(full.mean, 3)) +
  stat("Daily standard deviation", pct(full.std, 2)) + stat("Worst day, 12 Mar 2020", pct(Math.min(...(S.ret.slice(MIN_DAY) as number[])), 1));

// ---------- step 2 ----------
function drawStats() {
  const [a, b] = state.period.split(",");
  const s = riskStats(S, a, b);
  out("s2-stats").innerHTML =
    stat("Annual volatility", num(s.annualVol)) + stat("CAGR", num(s.cagr)) + stat("Max drawdown", num(s.maxDD)) +
    stat("VaR 95%", num(s.var95)) + stat("CVaR 95%", num(s.cvar95)) + stat("Skew", num(s.skew)) + stat("Excess kurtosis", num(s.kurt));
}
seg("period", (v) => { state.period = v; drawStats(); });
drawStats();
function drawDD() {
  lineChart(plotEl("dd"), {
    x0: full.a, lines: [{ y: full.dd, color: "var(--rust)", width: 1.4 }], height: 220, ticks: "years", fill: true,
    yFmt: (v) => pct(v, 0), marker: state.day, yMax: 0,
  });
  const i = state.day, k = i - full.a;
  out("s2-calc").innerHTML = `On ${dayName(i)}, 1 USD invested on 1 Jan 2018 was worth ${num(full.wealth[k], 3)} USD, <b>${pct(-full.dd[k], 1)}</b> below its highest value so far. The worst point was ${dayName(full.troughI)}: ${pct(full.maxDD, 1)}.`;
  const rd = S.rf[i]!;
  out("s2-rf").innerHTML = `Cash on ${dayName(i)}: T-bill ${pct((1 + rd) ** 365 - 1, 2)} a year, so <b>${pct(rd, 4)}</b> a day.`;
}
onDay(drawDD);

// ---------- step 3 ----------
onDay(() => {
  const i = state.day;
  const mom = S.price[i]! / S.price[i - 30]! - 1, vol = std(S.ret.slice(i - 29, i + 1) as number[]);
  out("s3-row").innerHTML =
    `<thead><tr><th>Column</th><th style="text-align:left">Meaning</th><th>Value on ${dayName(i)}</th></tr></thead><tbody>` +
    `<tr><td>mom</td><td style="text-align:left;font-family:var(--font-text)">price ÷ price 30 days ago − 1, known today</td><td>${pct(mom)}</td></tr>` +
    `<tr><td>vol</td><td style="text-align:left;font-family:var(--font-text)">std of the last 30 returns, known today</td><td>${pct(vol)}</td></tr>` +
    `<tr><td>y</td><td style="text-align:left;font-family:var(--font-text)">return on ${dayName(i + 1)}, tomorrow</td><td>${pct(R(i + 1))}</td></tr>` +
    `<tr><td>today's return</td><td style="text-align:left;font-family:var(--font-text)">what y would be without shift(-1)</td><td>${pct(R(i))}</td></tr></tbody>`;
});
function drawMomentum() {
  const m = (pre.momentum as Record<string, { t: Record<string, number>; r2: number; scatter: { x: number[]; y: number[] } }>)[state.align];
  out("s3-t").textContent = minus(m.t.mom.toFixed(2));
  out("s3-r2").textContent = `R² ${pct(m.r2, 2)} on the training years`;
  out("s3-msg").textContent = state.align === "aligned"
    ? "Below 1.96: momentum today says nothing about tomorrow. This is the honest result."
    : "Far above 1.96, but only because the 30-day momentum already contains today's return. Nobody could trade on this.";
  const el = plotEl("scatter"), W = Math.max(260, el.clientWidth), H = 240, ml = 52, mr = 12, mt = 10, mb = 34;
  const X = (v: number) => ml + ((v + 0.6) / 1.4) * (W - ml - mr);
  const Y = (v: number) => mt + (1 - (v + 0.2) / 0.4) * (H - mt - mb);
  let s = `<svg width="${W}" height="${H}" aria-hidden="true"><g class="axis">`;
  for (const v of [-0.2, -0.1, 0, 0.1, 0.2]) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${pct(v, 0)}</text>`;
  for (const v of [-0.5, 0, 0.5]) s += `<text x="${X(v)}" y="${H - 16}" text-anchor="middle">${pct(v, 0)}</text>`;
  s += `<text x="${(W + ml) / 2}" y="${H - 2}" text-anchor="middle">30-day momentum</text></g>`;
  m.scatter.x.forEach((x, k) => {
    const y = m.scatter.y[k];
    if (x < -0.6 || x > 0.8 || Math.abs(y) > 0.2) return;
    s += `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.2" style="fill:var(--blue);opacity:0.45"/>`;
  });
  el.innerHTML = s + "</svg>";
}
seg("align", (v) => { state.align = v; drawMomentum(); });
drawMomentum();

// ---------- step 4 ----------
const oos = pre.oos as { start: string; model: number[]; bench: number[]; actual: number[] };
const OOS0 = indexOf(S.start, oos.start);
const r2run: number[] = [];
{
  let se = 0, sb = 0;
  oos.actual.forEach((a, k) => { se += (a - oos.model[k]) ** 2; sb += (a - oos.bench[k]) ** 2; r2run.push((1 - se / sb) * 100); });
}
function drawR2() {
  lineChart(plotEl("r2"), {
    x0: OOS0, lines: [{ y: r2run, color: "var(--blue)" }], height: 220, ticks: "years", zeroLine: true,
    yFmt: (v) => minus(v.toFixed(2)) + "%", marker: state.day, yMin: -0.6, yMax: 0.6,
  });
  const i = state.day, k = i - OOS0;
  if (k < 0 || k >= oos.model.length) {
    out("s4-calc").innerHTML = `The out-of-sample forecasts start on 1 Jan 2022. Pick a day from 2022 onwards to see one.`;
    return;
  }
  const mo = oos.model[k], be = oos.bench[k], ac = oos.actual[k];
  out("s4-calc").innerHTML =
    `On ${dayName(i)}, for ${dayName(i + 1)}: momentum model ${pct(mo, 3)}, benchmark ${pct(be, 3)}, actual <b>${pct(ac)}</b>. ` +
    `Squared errors: model ${num((ac - mo) ** 2, 6)}, benchmark ${num((ac - be) ** 2, 6)}. Running R² out of sample since 1 Jan 2022: <b>${minus(r2run[k].toFixed(3))}%</b>.`;
}
onDay(drawR2);

// ---------- step 5 ----------
const FTX = [indexOf(S.start, "2022-10-15"), indexOf(S.start, "2022-12-31")];
let ewLam = ew97;
const qRollVal = qlike(S, roll, "2022", "2023"), qRollTest = qlike(S, roll, "2024", "2025-12-30");
function drawVol() {
  ewLam = state.lam === 0.97 ? ew97 : ewmaVar(S, state.lam);
  const ann = (v: (number | null)[]) => v.slice(FTX[0], FTX[1] + 1).map((x) => (x == null ? null : Math.sqrt(x * 365)));
  lineChart(plotEl("ftx"), {
    x0: FTX[0], lines: [{ y: ann(roll), color: "var(--rust)" }, { y: ann(ewLam), color: "var(--blue)", width: 2 }],
    height: 240, ticks: "months", yFmt: (v) => pct(v, 0), marker: state.day, yMin: 0,
  });
  const qv = qlike(S, ewLam, "2022", "2023"), qt = qlike(S, ewLam, "2024", "2025-12-30");
  out("s5-qlike").innerHTML =
    `<thead><tr><th>Average QLIKE (lower is better)</th><th>Validation 2022–23</th><th>Test 2024–25</th></tr></thead><tbody>` +
    `<tr><td>30-day rolling</td><td>${num(qRollVal)}</td><td>${num(qRollTest)}</td></tr>` +
    `<tr><td>EWMA, λ = ${state.lam.toFixed(2)}</td><td>${num(qv)}</td><td>${num(qt)}</td></tr></tbody>`;
  $("#lam-out").textContent = state.lam.toFixed(2);
  out("lam-legend").textContent = state.lam.toFixed(2);
}
$("#lam").addEventListener("input", (e) => { state.lam = +(+(e.target as HTMLInputElement).value).toFixed(2); drawVol(); drawVolDay(); });
function drawVolDay() {
  const i = state.day, lam = state.lam, v0 = ewLam[i - 1]!, x = R(i), v1 = ewLam[i]!;
  out("s5-calc").innerHTML =
    `${dayName(i)}: ${lam.toFixed(2)} × ${num(v0, 6)} + ${(1 - lam).toFixed(2)} × (${num(x, 4)})² = <b>${num(v1, 6)}</b>. ` +
    `Annual volatility forecast for ${dayName(i + 1)}: EWMA <b>${pct(Math.sqrt(v1 * 365), 1)}</b>, 30-day rolling ${pct(Math.sqrt(roll[i]! * 365), 1)}.`;
}
onDay(() => { drawVol(); drawVolDay(); });

// ---------- step 6 ----------
const NAMES = ["Buy and hold", "Fixed mix", "Volatility target"];
const COLORS = ["var(--muted)", "var(--rust)", "var(--blue)"];
function runs() {
  const c = state.cost / 1e4, wf = state.target / TRAIN_VOL;
  return [backtest(S, () => 1, c), backtest(S, () => wf, c), vtRun()];
}
function drawStrategy() {
  const rs = runs(), ms = rs.map((r) => metrics(S, r, "2024", "2025"));
  const rows: [string, (m: (typeof ms)[0]) => string][] = [
    ["CAGR", (m) => num(m.cagr, 3)], ["Volatility", (m) => num(m.vol, 3)], ["Sharpe", (m) => num(m.sharpe, 3)],
    ["Max drawdown", (m) => num(m.maxDD, 3)], ["Turnover a year", (m) => num(m.turnover, 3)], ["Average weight", (m) => num(m.avgW, 3)],
  ];
  out("s6-metrics").innerHTML = `<thead><tr><th></th>${NAMES.map((n) => `<th>${n}</th>`).join("")}</tr></thead><tbody>` +
    rows.map(([k, f]) => `<tr><td>${k}</td>${ms.map((m) => `<td>${f(m)}</td>`).join("")}</tr>`).join("") + "</tbody>";
  const t0 = indexOf(S.start, "2024-01-01");
  lineChart(plotEl("growth"), {
    x0: t0, lines: ms.map((m, k) => ({ y: m.wealth, color: COLORS[k], width: k === 2 ? 2.2 : 1.6 })),
    height: 240, ticks: "months", log: true, yFmt: (v) => v.toFixed(1), marker: state.day >= t0 ? state.day : null,
  });
  $("#target-out").textContent = `${Math.round(state.target * 100)}%`;
  $("#cost-out").textContent = `${state.cost} bp`;
}
function drawStrategyDay() {
  const i = state.day, el = out("s6-day");
  if (i < BT_START || i > BT_END) {
    el.innerHTML = `<tbody><tr><td>The backtest runs from 1 Jan 2022. Pick a later day to see it worked through.</td></tr></tbody>`;
    return;
  }
  const run = vtRun(), k = i - run.start, w = run.w[k], r = R(i), f = S.rf[i]!, sg = Math.sqrt(ew97[i - 1]! * 365);
  const gross = w * r + (1 - w) * f;
  const row = (a: string, b: string, c: string) => `<tr><td>${a}</td><td style="text-align:left">${b}</td><td>${c}</td></tr>`;
  el.innerHTML = `<thead><tr><th>Step</th><th style="text-align:left">Calculation</th><th>Result</th></tr></thead><tbody>` +
    row(`Forecast made ${dayName(i - 1)}`, `√(EWMA × 365)`, pct(sg, 1)) +
    row("Weight in Bitcoin", `min(1, ${pct(state.target, 0)} ÷ ${pct(sg, 1)})`, pct(w, 1)) +
    row("Gross return", `${num(w, 3)} × ${pct(r)} + ${num(1 - w, 3)} × ${pct(f, 4)}`, pct(gross, 3)) +
    row("Trading", `turnover ${num(run.to[k], 4)} × ${state.cost} bp`, pct(-(state.cost / 1e4) * run.to[k], 4)) +
    row("Net return", "gross − cost", `<b>${pct(run.ret[k], 3)}</b>`) + "</tbody>";
}
function strategyChanged() { drawStrategy(); drawStrategyDay(); $$("[data-ex-example]").forEach((ex) => (ex.innerHTML = ex.dataset.exKey ? example(ex.dataset.exKey, state.day) : "")); }
$("#target").addEventListener("input", (e) => { state.target = +(e.target as HTMLInputElement).value; strategyChanged(); });
$("#cost").addEventListener("input", (e) => { state.cost = +(e.target as HTMLInputElement).value; strategyChanged(); });
$("[data-reset]").addEventListener("click", () => {
  state.target = 0.3; state.cost = 25;
  ($("#target") as HTMLInputElement).value = "0.30"; ($("#cost") as HTMLInputElement).value = "25";
  strategyChanged();
});
onDay(() => { drawStrategy(); drawStrategyDay(); });

// ---------- step 7 (always the notebook's settings: 30% target, 25 bp) ----------
const base = [backtest(S, () => 1), backtest(S, () => 0.3 / TRAIN_VOL), backtest(S, vtWeight(ew97, 0.3))];
out("s7-years").innerHTML = `<thead><tr><th>Year</th>${NAMES.map((n) => `<th>${n}</th>`).join("")}</tr></thead><tbody>` +
  ["2022", "2023", "2024", "2025"].map((y) => {
    const sh = base.map((r) => metrics(S, r, y, y).sharpe);
    const best = Math.max(...sh);
    return `<tr><td>${y}</td>${sh.map((v) => `<td>${v === best ? `<b>${num(v, 2)}</b>` : num(v, 2)}</td>`).join("")}</tr>`;
  }).join("") + "</tbody>";

const excess = (run: ReturnType<typeof backtest>) => {
  const [a, b] = range(S.start, N, "2024", "2025");
  return run.ret.slice(a - run.start, b - run.start + 1).map((v, k) => v - (S.rf[a + k] as number));
};
let seed = 42;
let boot: ReturnType<typeof blockBootstrap> | null = null;
function drawBoot() {
  const el = plotEl("boot");
  if (!boot) { el.innerHTML = ""; return; }
  const W = Math.max(280, el.clientWidth), H = 220, ml = 40, mr = 12, mt = 10, mb = 30, lo = -0.8, hi = 0.6, bins = 56;
  const counts = new Array(bins).fill(0);
  for (const d of boot.diffs) { const k = Math.floor(((d - lo) / (hi - lo)) * bins); if (k >= 0 && k < bins) counts[k]++; }
  const top = Math.max(...counts), bw = (W - ml - mr) / bins;
  const X = (v: number) => ml + ((v - lo) / (hi - lo)) * (W - ml - mr);
  let s = `<svg width="${W}" height="${H}" aria-hidden="true"><g class="axis">`;
  for (const v of [-0.8, -0.4, 0, 0.4]) s += `<text x="${X(v)}" y="${H - 8}" text-anchor="middle">${minus(v.toFixed(1))}</text>`;
  s += `</g>`;
  counts.forEach((c, k) => {
    const mid = lo + ((k + 0.5) / bins) * (hi - lo), inside = mid >= boot!.lo && mid <= boot!.hi;
    const h = (c / top) * (H - mt - mb);
    s += `<rect x="${(ml + k * bw + 0.5).toFixed(1)}" y="${(H - mb - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${inside ? "var(--blue)" : "var(--line3)"}"/>`;
  });
  s += `<line x1="${X(0)}" x2="${X(0)}" y1="${mt}" y2="${H - mb}" style="stroke:var(--ink);stroke-width:1.5"/>`;
  s += `<line x1="${X(boot.actual)}" x2="${X(boot.actual)}" y1="${mt}" y2="${H - mb}" style="stroke:var(--rust);stroke-width:2;stroke-dasharray:4 3"/>`;
  el.innerHTML = s + "</svg>";
}
$("[data-boot]").addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  out("s7-status").textContent = "Running 5,000 resamples…";
  setTimeout(() => {
    boot = blockBootstrap(excess(base[2]), excess(base[1]), 5000, 20, seed);
    drawBoot();
    out("s7-msg").innerHTML =
      `Sharpe of volatility target minus fixed mix: <b>${num(boot.actual, 3)}</b> (dashed line). 95% of the resamples fall between ` +
      `<b>${num(boot.lo, 2)}</b> and <b>${num(boot.hi, 2)}</b> (blue bars). The range includes 0, so the gap could be luck: neither strategy is shown to be better.`;
    out("s7-status").textContent = `Done, seed ${seed}.`;
    btn.textContent = "Run again with a new seed";
    btn.disabled = false;
    seed += 1;
  }, 30);
});

// ---------- redraw charts when the width changes ----------
let lastW = window.innerWidth, timer = 0;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  clearTimeout(timer);
  timer = window.setTimeout(() => { drawPrice(); drawDD(); drawMomentum(); drawR2(); drawVol(); drawStrategy(); drawBoot(); }, 120);
});

setDay(state.day);
