"""Turn demand-history records into dense (series x day) arrays plus known-calendar features."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np


@dataclass
class SeriesData:
    outlet_ids: list[str]
    product_ids: list[str]
    keys: list[tuple[str, str]]       # series index -> (outlet_id, product_id)
    y: np.ndarray                     # (S, T_hist) observed demand
    mu: np.ndarray | None             # (S, T_hist) synthetic expected demand (noise floor only)
    promo: np.ndarray                 # (P, T_total) known promotion flags, history + horizon
    festival: np.ndarray              # (T_total,)
    dow: np.ndarray                   # (T_total,)
    dates: list[date]                 # T_total dates
    history_days: int
    horizon_days: int

    @property
    def outlet_idx(self) -> np.ndarray:
        return np.array([self.outlet_ids.index(d) for d, _ in self.keys])

    @property
    def product_idx(self) -> np.ndarray:
        return np.array([self.product_ids.index(p) for _, p in self.keys])


def build_series(dataset: dict) -> SeriesData:
    meta = dataset["meta"]
    hist = int(meta["history_days"])
    horizon = int(meta["horizon_days"])
    start = date.fromisoformat(meta["history_start"])
    dates = [start + timedelta(days=t) for t in range(hist + horizon)]
    outlet_ids = sorted({o["outlet_id"] for o in dataset["outlets"]}, key=lambda s: int(s[1:]))
    product_ids = sorted({p["product_id"] for p in dataset["products"]})
    keys = [(d, p) for d in outlet_ids for p in product_ids]
    sidx = {k: i for i, k in enumerate(keys)}
    day = {d.isoformat(): t for t, d in enumerate(dates[:hist])}

    y = np.zeros((len(keys), hist))
    mu = np.full((len(keys), hist), np.nan)
    for r in dataset["demand_history"]:
        t = day.get(r["date"])
        if t is None:
            continue
        i = sidx[(r["outlet_id"], r["product_id"])]
        y[i, t] = r["qty"]
        if r.get("mu") is not None:
            mu[i, t] = r["mu"]

    fest = np.zeros(len(dates), dtype=bool)
    for f in dataset["calendar"]["festivals"]:
        s, e = date.fromisoformat(f["start"]), date.fromisoformat(f["end"])
        for t, d in enumerate(dates):
            if s <= d <= e:
                fest[t] = True
    pidx = {p: i for i, p in enumerate(product_ids)}
    promo = np.zeros((len(product_ids), len(dates)), dtype=bool)
    for pr in dataset["calendar"]["promotions"]:
        s, e = date.fromisoformat(pr["start"]), date.fromisoformat(pr["end"])
        for t, d in enumerate(dates):
            if s <= d <= e:
                promo[pidx[pr["product_id"]], t] = True

    return SeriesData(
        outlet_ids, product_ids, keys, y,
        None if np.isnan(mu).all() else mu,
        promo, fest, np.array([d.weekday() for d in dates]), dates, hist, horizon,
    )
