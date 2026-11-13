"""
AASI (Active Address Sentiment Indicator), reproduced from public data.

The formula was reverse-engineered from the lookintobitcoin.com chart data;
fed the site's own inputs it reproduces the site's series to ~1e-15.

    aa_chg = active_addresses.pct_change(28)            # raw daily counts, no smoothing
    px_chg = price.pct_change(28)
    m      = aa_chg.rolling(28, min_periods=2).mean()
    sd     = aa_chg.rolling(28, min_periods=2).std()    # sample std (ddof=1)
    upper  = m + 1.8 * sd
    lower  = m - 1.1 * sd

    px_chg > upper -> "over"   (short-term overheated)
    px_chg < lower -> "under"  (short-term oversold)
"""
from __future__ import annotations

import pandas as pd

LAG = 28
WINDOW = 28
K_UP = 1.8
K_DN = 1.1
# The site's AASI series starts on 2014-12-03 (site label). Starting the input at the
# same point keeps the early, expanding-window bands identical to the site's.
START = "2014-12-03"


def to_site_dates(cm: pd.DataFrame) -> pd.DataFrame:
    """Coin Metrics labels a day by the day the activity happened (price = end of day).
    Look Into Bitcoin labels the same value with the next date (00:00 UTC close).
    Return a frame indexed by the site's date label."""
    d = cm.dropna(subset=["AdrActCnt", "PriceUSD"]).copy()
    d["date"] = pd.to_datetime(d["time"]).dt.tz_localize(None).dt.normalize() + pd.Timedelta(days=1)
    d = d.set_index("date").sort_index()
    return d[["AdrActCnt", "PriceUSD"]].rename(columns={"AdrActCnt": "active_addresses", "PriceUSD": "price"})


def compute(raw: pd.DataFrame, start: str = START) -> pd.DataFrame:
    """raw: index = date (site label), columns active_addresses, price."""
    d = raw[raw.index >= start].asfreq("D")  # gaps become explicit NaN; 28 rows == 28 days
    aa = d["active_addresses"].astype(float)
    px = d["price"].astype(float)

    out = pd.DataFrame(index=d.index)
    out.index.name = "date"
    out["price"] = px
    out["active_addresses"] = d["active_addresses"].round().astype("Int64")
    out["aa_chg_28d"] = aa / aa.shift(LAG) - 1
    out["px_chg_28d"] = px / px.shift(LAG) - 1
    roll = out["aa_chg_28d"].rolling(WINDOW, min_periods=2)
    m, sd = roll.mean(), roll.std(ddof=1)
    out["upper"] = m + K_UP * sd
    out["lower"] = m - K_DN * sd
    out["zone"] = None
    ok = out["upper"].notna() & out["px_chg_28d"].notna()
    out.loc[ok, "zone"] = "in"
    out.loc[ok & (out["px_chg_28d"] > out["upper"]), "zone"] = "over"
    out.loc[ok & (out["px_chg_28d"] < out["lower"]), "zone"] = "under"
    return out


def entries(res: pd.DataFrame) -> pd.DataFrame:
    """First day of every run outside the band, with the price 28 days later."""
    rows, prev = [], "in"
    px = res["price"]
    for date, z in res["zone"].items():
        if z is None:
            continue
        if z != "in" and z != prev:
            fwd_date = date + pd.Timedelta(days=LAG)
            fwd = px.get(fwd_date)
            rows.append(
                {
                    "date": date,
                    "zone": z,
                    "price": px.loc[date],
                    "px_chg_28d": res.at[date, "px_chg_28d"],
                    "fwd_28d": (fwd / px.loc[date] - 1) if fwd is not None and pd.notna(fwd) else None,
                }
            )
        prev = z
    return pd.DataFrame(rows)
