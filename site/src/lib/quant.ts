// The notebooks' calculations, written again in TypeScript so the website can
// recompute them in the browser. scripts/check_numbers.mjs checks that these
// functions reproduce the notebooks' printed results.

export type Series = { start: string; price: (number | null)[]; ret: (number | null)[]; rf: (number | null)[] };

const DAY = 86400000;

export function dateOf(start: string, i: number): Date {
  return new Date(Date.parse(start + "T00:00:00Z") + i * DAY);
}
export function indexOf(start: string, iso: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY);
}
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Index range [a, b] (inclusive) for calendar strings like "2024" or "2024-03-01". */
export function range(start: string, n: number, from: string, to: string): [number, number] {
  const a = from.length === 4 ? from + "-01-01" : from;
  const b = to.length === 4 ? to + "-12-31" : to;
  return [Math.max(0, indexOf(start, a)), Math.min(n - 1, indexOf(start, b))];
}

export const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
export function std(x: number[]): number {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
}
export function quantile(x: number[], q: number): number {
  // linear interpolation, as pandas does by default
  const s = [...x].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Risk statistics of 02_stats for returns between two dates. */
export function riskStats(S: Series, from = "2018", to = "2025") {
  const [a, b] = range(S.start, S.ret.length, from, to);
  const r = S.ret.slice(a, b + 1) as number[];
  let w = 1, peak = 1, maxDD = 0, troughI = a;
  const wealth: number[] = [], dd: number[] = [];
  r.forEach((v, k) => {
    w *= 1 + v; peak = Math.max(peak, w);
    const d = w / peak - 1; wealth.push(w); dd.push(d);
    if (d < maxDD) { maxDD = d; troughI = a + k; }
  });
  const q = quantile(r, 0.05);
  const tail = r.filter((v) => v <= q);
  const m = mean(r), s = std(r), n = r.length;
  const m3 = r.reduce((t, v) => t + (v - m) ** 3, 0) / n, m2 = r.reduce((t, v) => t + (v - m) ** 2, 0) / n;
  const m4 = r.reduce((t, v) => t + (v - m) ** 4, 0) / n;
  // pandas' bias-corrected skewness and excess kurtosis
  const g1 = m3 / m2 ** 1.5, skew = (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
  const kurt = ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * (m4 / m2 ** 2) - 3 * (n - 1));
  return {
    a, wealth, dd, troughI,
    annualVol: s * Math.sqrt(365),
    cagr: wealth[wealth.length - 1] ** (365 / n) - 1,
    maxDD, var95: -q, cvar95: -mean(tail), skew, kurt, mean: m, std: s,
  };
}

/** 30-day rolling mean of squared returns (variance forecast for tomorrow), as 04_volatility. */
export function rollingVar(S: Series, win = 30): (number | null)[] {
  const out: (number | null)[] = new Array(S.ret.length).fill(null);
  for (let i = 0; i < S.ret.length; i++) {
    if (i - win + 1 < 1) continue; // the first return is empty
    let s = 0;
    for (let k = i - win + 1; k <= i; k++) s += (S.ret[k] as number) ** 2;
    out[i] = s / win;
  }
  return out;
}

/** EWMA variance forecasts, started from the 2017 warm-up average, as 04_volatility. */
export function ewmaVar(S: Series, lam: number): (number | null)[] {
  const warmEnd = indexOf(S.start, "2017-12-31");
  let s = 0, n = 0;
  for (let i = 1; i <= warmEnd; i++) { s += (S.ret[i] as number) ** 2; n++; }
  let v = s / n;
  const out: (number | null)[] = new Array(S.ret.length).fill(null);
  for (let i = 1; i < S.ret.length; i++) {
    const x = S.ret[i] as number;
    v = lam * v + (1 - lam) * x * x;
    out[i] = v;
  }
  return out;
}

/** Average QLIKE: forecast made on day t scored against the return on t + 1, for t in [from, to]. */
export function qlike(S: Series, fc: (number | null)[], from: string, to: string): number {
  const [a, b] = range(S.start, S.ret.length, from, to);
  let s = 0, n = 0;
  for (let t = a; t <= b && t + 1 < S.ret.length; t++) {
    const f = fc[t], y = S.ret[t + 1];
    if (f == null || y == null) continue;
    s += Math.log(f) + (y * y) / f; n++;
  }
  return s / n;
}

export type Run = { start: number; ret: number[]; to: number[]; w: number[] };

/** The daily backtest loop of 05_strategy. `weight(i)` is the target weight decided on day i. */
export function backtest(S: Series, weight: (i: number) => number, cost = 0.0025, from = "2022-01-01", to = "2025-12-31", lag = 1): Run {
  const [a, b] = range(S.start, S.ret.length, from, to);
  const run: Run = { start: a, ret: [], to: [], w: [] };
  let drift: number | null = null;
  for (let t = a; t <= b; t++) {
    const w = weight(t - lag);
    const r = S.ret[t] as number, f = S.rf[t] as number;
    const turn = drift === null ? w : Math.abs(w - drift);
    const gross = w * r + (1 - w) * f;
    run.ret.push(gross - cost * turn); run.to.push(turn); run.w.push(w);
    drift = (w * (1 + r)) / (w * (1 + r) + (1 - w) * (1 + f));
  }
  return run;
}

export function metrics(S: Series, run: Run, from: string, to: string) {
  const [a, b] = range(S.start, S.ret.length, from, to);
  const i0 = a - run.start, i1 = b - run.start;
  const ret = run.ret.slice(i0, i1 + 1), w = run.w.slice(i0, i1 + 1), turn = run.to.slice(i0, i1 + 1);
  const ex = ret.map((v, k) => v - (S.rf[a + k] as number));
  let wl = 1, peak = 1, mdd = 0;
  const wealth = ret.map((v) => { wl *= 1 + v; peak = Math.max(peak, wl); mdd = Math.min(mdd, wl / peak - 1); return wl; });
  return {
    cagr: wealth[wealth.length - 1] ** (365 / ret.length) - 1,
    vol: std(ret) * Math.sqrt(365),
    sharpe: (mean(ex) / std(ex)) * Math.sqrt(365),
    maxDD: mdd,
    turnover: turn.slice(1).reduce((s, v) => s + v, 0) / (ret.length / 365),
    avgW: mean(w),
    wealth,
  };
}

export function trainVol(S: Series): number {
  const [a, b] = range(S.start, S.ret.length, "2018", "2021");
  return std(S.ret.slice(a, b + 1) as number[]) * Math.sqrt(365);
}

/** Volatility-targeting weight for day i from an EWMA variance series. */
export const vtWeight = (ev: (number | null)[], target = 0.3) => (i: number) =>
  Math.min(1, target / Math.sqrt((ev[i] as number) * 365));

/** Small seeded random-number generator (mulberry32), so a bootstrap run can be repeated. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sr = (x: number[]) => (mean(x) / std(x)) * Math.sqrt(365);

/** Paired moving-block bootstrap of the Sharpe difference, as 05_strategy cell 9. */
export function blockBootstrap(exA: number[], exB: number[], reps = 5000, B = 20, seed = 42) {
  const n = exA.length, rand = rng(seed), k = Math.ceil(n / B), diffs: number[] = [];
  const a = new Array(n), b = new Array(n);
  for (let r = 0; r < reps; r++) {
    let p = 0;
    for (let j = 0; j < k && p < n; j++) {
      const s = Math.floor(rand() * (n - B + 1));
      for (let q = 0; q < B && p < n; q++, p++) { a[p] = exA[s + q]; b[p] = exB[s + q]; }
    }
    diffs.push(sr(a) - sr(b));
  }
  diffs.sort((x, y) => x - y);
  return { actual: sr(exA) - sr(exB), lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975), diffs };
}
