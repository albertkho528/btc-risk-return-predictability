# Code explorer website

An interactive walk-through of the five notebooks in `../notebooks`. Pick a day on the Bitcoin price chart and every step of the pipeline shows that day's calculation next to the notebook code that produced it. Every line of code can be clicked for a plain-English explanation.

Built with [Astro](https://astro.build) as a fully static site: no server, no tracking, fonts bundled with the site.

## What each step shows

| Step | Notebook | Interactive part |
|---|---|---|
| 1 Prices and returns | `01_data` | The selected day's return, price ÷ yesterday's price − 1 |
| 2 Risk statistics | `02_stats` | Risk statistics for any sub-period; drawdown chart; daily T-bill rate |
| 3 Momentum signal | `03_momentum` cells 1–2 | One row of the regression table; switch between the correct `shift(-1)` and the look-ahead mistake |
| 4 Out-of-sample test | `03_momentum` cells 3–5 | The forecast made on the selected day; running R² out of sample |
| 5 Volatility forecasts | `04_volatility` | λ slider redraws the FTX chart and recomputes QLIKE |
| 6 Strategy backtest | `05_strategy` cells 1–6 | The selected day's weight, return and cost; target and cost sliders rerun the backtest |
| 7 Robustness | `05_strategy` cells 7–9 | Sharpe by year; runs the 5,000-sample block bootstrap in the browser |

## Run it on your own computer

Needs Node.js 20 or newer.

```bash
cd site
npm install
npm run dev          # opens a live preview at http://localhost:4321
npm run build        # writes the finished site to site/dist
npm run preview      # serves site/dist
```

## Checking the numbers

The calculations are rewritten in TypeScript (`src/lib/quant.ts`) so the browser can redo them for any day or setting. This script checks that they reproduce the notebooks' printed results:

```bash
npm run check-numbers
```

## Updating the data

If a notebook changes, run it again in VS Code, save it, then regenerate the website's data from the repository root:

```bash
python site/scripts/export_data.py
```

This rewrites `src/data/*.json` and the chart images in `public/nb/`. Line explanations live in `src/data/explanations.ts`, keyed by `notebook:cell:line`.

## Files

| Path | Contents |
|---|---|
| `src/pages/index.astro` | The page |
| `src/components/NotebookView.astro` | Notebook cells with clickable, coloured lines |
| `src/scripts/app.ts` | Day picker, charts, sliders and line explanations |
| `src/lib/quant.ts` | Returns, risk statistics, EWMA, QLIKE, backtest, bootstrap |
| `src/lib/highlight.ts` | Python syntax colours (VS Code Dark+) |
| `src/data/` | Data exported from the notebooks, and the line explanations |
| `scripts/export_data.py` | Exports notebook code, outputs and series to `src/data/` |
| `scripts/check_numbers.mjs` | Compares the TypeScript results with the notebooks |

## Deploying

On [Vercel](https://vercel.com): import the GitHub repository, set **Root Directory** to `site`, keep the detected Astro settings, and deploy. Every push to `main` redeploys the site.
