// Checks that the website's TypeScript calculations reproduce the notebooks' outputs.
// Run: npm run check-numbers   (needs Node 22.6 or newer for TypeScript imports)
import { readFileSync } from "node:fs";
import * as q from "../src/lib/quant.ts";

const S = JSON.parse(readFileSync(new URL("../src/data/series.json", import.meta.url)));
let failures = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} got ${got.toFixed(4).padStart(9)}  notebook ${want}`);
};

const st = q.riskStats(S);
check("02 annual volatility", st.annualVol, 0.6533, 0.00005);
check("02 CAGR", st.cagr, 0.2582, 0.00005);
check("02 max drawdown", st.maxDD, -0.8138, 0.00005);
check("02 VaR 95%", st.var95, 0.0522, 0.00005);
check("02 CVaR 95%", st.cvar95, 0.0793, 0.00005);
check("02 skew", st.skew, -0.2851, 0.00005);
check("02 excess kurtosis", st.kurt, 8.1945, 0.00005);

const roll = q.rollingVar(S);
check("04 QLIKE rolling, validation", q.qlike(S, roll, "2022", "2023"), -5.9977, 0.00005);
for (const [lam, want] of [[0.9, -6.0395], [0.94, -6.0922], [0.97, -6.1351]])
  check(`04 QLIKE EWMA ${lam}, validation`, q.qlike(S, q.ewmaVar(S, lam), "2022", "2023"), want, 0.00005);
const ew = q.ewmaVar(S, 0.97);
check("04 QLIKE rolling, test", q.qlike(S, roll, "2024", "2025-12-30"), -6.3612, 0.00005);
check("04 QLIKE EWMA, test", q.qlike(S, ew, "2024", "2025-12-30"), -6.4104, 0.00005);

const tv = q.trainVol(S);
check("05 fixed weight", 0.3 / tv, 0.391, 0.0005);
const runs = {
  bh: q.backtest(S, () => 1),
  fx: q.backtest(S, () => 0.3 / tv),
  vt: q.backtest(S, q.vtWeight(ew)),
};
const m = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, q.metrics(S, r, "2024", "2025")]));
check("05 Sharpe buy-and-hold", m.bh.sharpe, 0.907, 0.0005);
check("05 Sharpe fixed mix", m.fx.sharpe, 0.886, 0.0005);
check("05 Sharpe vol target", m.vt.sharpe, 0.788, 0.0005);
check("05 CAGR vol target", m.vt.cagr, 0.270, 0.0005);
check("05 vol vol target", m.vt.vol, 0.306, 0.0005);
check("05 max DD vol target", m.vt.maxDD, -0.270, 0.0005);
check("05 turnover vol target", m.vt.turnover, 4.176, 0.0005);
check("05 avg weight vol target", m.vt.avgW, 0.666, 0.0005);
check("05 Sharpe vol target, 50 bp", q.metrics(S, q.backtest(S, q.vtWeight(ew), 0.005), "2024", "2025").sharpe, 0.754, 0.0005);
check("05 Sharpe vol target, 2022-25", q.metrics(S, runs.vt, "2022", "2025").sharpe, 0.556, 0.0005);
check("05 Sharpe vol target, lam 0.94", q.metrics(S, q.backtest(S, q.vtWeight(q.ewmaVar(S, 0.94))), "2024", "2025").sharpe, 0.770, 0.0005);
check("05 Sharpe vol target, 2-day lag", q.metrics(S, q.backtest(S, q.vtWeight(ew), 0.0025, "2022-01-01", "2025-12-31", 2), "2024", "2025").sharpe, 0.759, 0.0005);
check("05 Sharpe 2022, vol target", q.metrics(S, runs.vt, "2022", "2022").sharpe, -1.49, 0.005);

const [a, b] = q.range(S.start, S.ret.length, "2024", "2025");
const exV = runs.vt.ret.slice(a - runs.vt.start, b - runs.vt.start + 1).map((v, k) => v - S.rf[a + k]);
const exF = runs.fx.ret.slice(a - runs.fx.start, b - runs.fx.start + 1).map((v, k) => v - S.rf[a + k]);
const bs = q.blockBootstrap(exV, exF);
check("05 Sharpe difference", bs.actual, -0.098, 0.0005);
check("05 bootstrap 2.5% (different RNG)", bs.lo, -0.30, 0.03);
check("05 bootstrap 97.5% (different RNG)", bs.hi, 0.10, 0.03);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks match the notebooks.");
process.exit(failures ? 1 : 0);
