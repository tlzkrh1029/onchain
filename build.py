#!/usr/bin/env python3
"""
Daily build for the onchain GitHub Pages site.

1. Fetch BTC AdrActCnt + PriceUSD from the Coin Metrics Community API
   (falls back to the cached CSV in data/ if the API is unreachable).
2. Compute AASI (indicators/aasi.py).
3. Write data/aasi.csv (committed history) and _site/ (deployed to Pages).

Usage:
    python build.py              # fetch + build
    python build.py --offline    # use data/coinmetrics_btc.csv only
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from indicators import aasi

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SITE_SRC = ROOT / "site"
OUT = ROOT / "_site"
CACHE = DATA / "coinmetrics_btc.csv"

API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
FETCH_START = "2014-11-01"


def fetch_coinmetrics() -> pd.DataFrame:
    import requests

    params = {
        "assets": "btc",
        "metrics": "AdrActCnt,PriceUSD",
        "frequency": "1d",
        "start_time": FETCH_START,
        "page_size": 10000,
    }
    rows, url, first = [], API, True
    while url:
        r = requests.get(url, params=params if first else None, timeout=60,
                         headers={"User-Agent": "onchain-pages-build"})
        r.raise_for_status()
        j = r.json()
        rows += j.get("data", [])
        url, first = j.get("next_page_url"), False
    if not rows:
        raise RuntimeError("Coin Metrics returned no rows")
    df = pd.DataFrame(rows)
    df["time"] = pd.to_datetime(df["time"]).dt.tz_localize(None).dt.strftime("%Y-%m-%d")
    for c in ("AdrActCnt", "PriceUSD"):
        df[c] = pd.to_numeric(df.get(c), errors="coerce")
    return df[["time", "AdrActCnt", "PriceUSD"]]


def load_raw(offline: bool) -> tuple[pd.DataFrame, str]:
    if not offline:
        try:
            df = fetch_coinmetrics()
            DATA.mkdir(exist_ok=True)
            df.to_csv(CACHE, index=False)
            return df, "api"
        except Exception as e:  # network/API problems: keep the site up with cached data
            print(f"::warning::Coin Metrics fetch failed ({e}); using cached {CACHE.name}", file=sys.stderr)
    if not CACHE.exists():
        sys.exit(f"no data: API unavailable and {CACHE} missing")
    return pd.read_csv(CACHE), "cache"


def rnd(v, nd):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return round(float(v), nd)


def build(offline: bool = False) -> dict:
    raw, origin = load_raw(offline)
    res = aasi.compute(aasi.to_site_dates(raw))
    ent = aasi.entries(res)

    # committed history
    DATA.mkdir(exist_ok=True)
    res.round({"aa_chg_28d": 6, "px_chg_28d": 6, "upper": 6, "lower": 6, "price": 2}).to_csv(DATA / "aasi.csv")

    valid = res.dropna(subset=["upper", "px_chg_28d"])
    last_date = valid.index[-1]
    last = valid.iloc[-1]
    prev_entry = ent.iloc[-1] if len(ent) else None

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "data_origin": origin,
            "source": "Coin Metrics Community API (AdrActCnt, PriceUSD), CC BY-NC 4.0",
            "params": {"lag": aasi.LAG, "window": aasi.WINDOW, "k_up": aasi.K_UP, "k_dn": aasi.K_DN},
            "date_convention": "date D = Coin Metrics day D-1 (activity during D-1 UTC, price at 00:00 UTC on D); same labels as lookintobitcoin.com",
        },
        "start": res.index[0].strftime("%Y-%m-%d"),
        "series": {
            "price": [rnd(v, 2) for v in res["price"]],
            "active_addresses": [None if pd.isna(v) else int(v) for v in res["active_addresses"]],
            "aa_chg": [rnd(v, 5) for v in res["aa_chg_28d"]],
            "px_chg": [rnd(v, 5) for v in res["px_chg_28d"]],
            "upper": [rnd(v, 5) for v in res["upper"]],
            "lower": [rnd(v, 5) for v in res["lower"]],
        },
        "latest": {
            "date": last_date.strftime("%Y-%m-%d"),
            "zone": last["zone"],
            "price": rnd(last["price"], 2),
            "active_addresses": int(last["active_addresses"]),
            "aa_chg": rnd(last["aa_chg_28d"], 5),
            "px_chg": rnd(last["px_chg_28d"], 5),
            "upper": rnd(last["upper"], 5),
            "lower": rnd(last["lower"], 5),
            "last_entry": None if prev_entry is None else {
                "date": prev_entry["date"].strftime("%Y-%m-%d"),
                "zone": prev_entry["zone"],
            },
        },
        "entries": [
            {
                "date": r.date.strftime("%Y-%m-%d"),
                "zone": r.zone,
                "price": rnd(r.price, 2),
                "px_chg": rnd(r.px_chg_28d, 5),
                "fwd_28d": rnd(r.fwd_28d, 5),
            }
            for r in ent.itertuples()
        ],
    }

    # site output
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SITE_SRC, OUT)
    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data" / "aasi.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    shutil.copy(DATA / "aasi.csv", OUT / "data" / "aasi.csv")
    (OUT / ".nojekyll").write_text("")

    zone_ko = {"over": "과열", "under": "과매도", "in": "중립"}[last["zone"]]
    summary = (
        f"AASI {last_date.date()} ({origin}): zone={last['zone']} ({zone_ko}) | "
        f"28d price {last['px_chg_28d']:+.2%} | band [{last['lower']:+.2%}, {last['upper']:+.2%}] | "
        f"28d active addr {last['aa_chg_28d']:+.2%} | entries={len(ent)}"
    )
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(f"### Daily build\n\n{summary}\n")
    return payload


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="skip the API, use data/coinmetrics_btc.csv")
    build(offline=ap.parse_args().offline)
