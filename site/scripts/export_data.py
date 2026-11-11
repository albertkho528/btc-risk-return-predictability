"""Export the notebooks and cleaned data to JSON for the website.

Run from the repository root after re-running the notebooks:
    python site/scripts/export_data.py

It reads only files the notebooks saved, so the website always shows
exactly the code, outputs and data in this repository.
"""
import base64
import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "src" / "data"
IMG = ROOT / "site" / "public" / "nb"
OUT.mkdir(parents=True, exist_ok=True)
IMG.mkdir(parents=True, exist_ok=True)

NOTEBOOKS = [
    ("01_data", "From prices to daily returns"),
    ("02_stats", "Risk statistics and the risk-free rate"),
    ("03_momentum", "Momentum: in-sample and out-of-sample"),
    ("04_volatility", "Forecasting volatility"),
    ("05_strategy", "The strategy backtest and robustness"),
]


def export_notebooks():
    books = []
    for nb_id, title in NOTEBOOKS:
        nb = json.loads((ROOT / "notebooks" / f"{nb_id}.ipynb").read_text(encoding="utf-8"))
        cells, k = [], 0
        for cell in nb["cells"]:
            if cell["cell_type"] != "code":
                continue
            k += 1
            outputs = []
            for o in cell.get("outputs", []):
                if o.get("output_type") == "error":
                    outputs.append({"kind": "error", "text": f"{o['ename']}: {o['evalue']}"})
                elif "text" in o:
                    outputs.append({"kind": "text", "text": "".join(o["text"]).rstrip()})
                elif "data" in o and "image/png" in o["data"]:
                    name = f"{nb_id}-{k}-{len(outputs) + 1}.png"
                    (IMG / name).write_bytes(base64.b64decode(o["data"]["image/png"]))
                    outputs.append({"kind": "image", "src": f"/nb/{name}"})
                elif "data" in o and "text/plain" in o["data"]:
                    text = "".join(o["data"]["text/plain"]).rstrip()
                    if not text.startswith("<Axes"):
                        outputs.append({"kind": "text", "text": text})
            cells.append({"n": k, "lines": "".join(cell["source"]).splitlines(), "outputs": outputs})
        books.append({"id": nb_id, "title": title, "cells": cells})
    (OUT / "notebooks.json").write_text(json.dumps(books, ensure_ascii=False), encoding="utf-8")
    return books


def export_series():
    btc = pd.read_csv(ROOT / "data_clean" / "btc_clean.csv", index_col="date", parse_dates=True)
    rf = pd.read_csv(ROOT / "data_clean" / "rf_daily.csv", index_col=0, parse_dates=True)["rf"]
    idx = pd.date_range(btc.index[0], btc.index[-1])
    assert len(idx) == len(btc), "dates must be consecutive"
    rf = rf.reindex(idx)
    clean = lambda s, d: [None if pd.isna(v) else round(float(v), d) for v in s]
    series = {
        "start": btc.index[0].strftime("%Y-%m-%d"),
        "price": clean(btc["price"], 2),
        "ret": clean(btc["ret"], 8),
        "rf": clean(rf, 10),
    }
    (OUT / "series.json").write_text(json.dumps(series, separators=(",", ":")), encoding="utf-8")
    return btc


def export_precomputed(btc):
    p, r = btc["price"], btc["ret"]

    def fit(aligned):
        df = pd.DataFrame({
            "y": r.shift(-1) if aligned else r,
            "mom": p / p.shift(30) - 1,
            "vol": r.rolling(30).std(),
        })
        train = df.loc["2018":"2021"].dropna()
        m = sm.OLS(train["y"], sm.add_constant(train[["mom", "vol"]])).fit(
            cov_type="HAC", cov_kwds={"maxlags": 30})
        sample = train.iloc[::3]
        return {
            "params": {k: round(float(v), 5) for k, v in m.params.items()},
            "t": {k: round(float(v), 2) for k, v in m.tvalues.items()},
            "r2": round(float(m.rsquared), 6),
            "n": int(len(train)),
            "scatter": {"x": [round(float(v), 4) for v in sample["mom"]],
                        "y": [round(float(v), 4) for v in sample["y"]]},
        }

    oos = pd.read_csv(ROOT / "outputs" / "momentum_oos.csv", index_col=0, parse_dates=True)

    def cw(d):
        em, eb = d["actual"] - d["model"], d["actual"] - d["bench"]
        f = eb**2 - (em**2 - (d["bench"] - d["model"])**2)
        t = sm.OLS(f, np.ones(len(f))).fit(cov_type="HAC", cov_kwds={"maxlags": 30}).tvalues.iloc[0]
        return round(float((1 - (em**2).sum() / (eb**2).sum()) * 100), 3), round(float(t), 2)

    pre = {
        "momentum": {"aligned": fit(True), "lookahead": fit(False)},
        "oos": {
            "start": oos.index[0].strftime("%Y-%m-%d"),
            "model": [round(float(v), 7) for v in oos["model"]],
            "bench": [round(float(v), 7) for v in oos["bench"]],
            "actual": [round(float(v), 7) for v in oos["actual"]],
            "validation": cw(oos.loc["2022":"2023"]),
            "test": cw(oos.loc["2024":"2025"]),
        },
    }
    (OUT / "precomputed.json").write_text(json.dumps(pre, separators=(",", ":")), encoding="utf-8")
    return pre


if __name__ == "__main__":
    books = export_notebooks()
    btc = export_series()
    pre = export_precomputed(btc)
    print("notebooks:", [(b["id"], sum(len(c["lines"]) for c in b["cells"])) for b in books])
    print("momentum t (aligned / look-ahead):",
          pre["momentum"]["aligned"]["t"]["mom"], pre["momentum"]["lookahead"]["t"]["mom"])
    print("out-of-sample (R2 %, CW t):", pre["oos"]["validation"], pre["oos"]["test"])
