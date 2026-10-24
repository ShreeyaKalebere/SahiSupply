"""Net requirement q(d,p) in forecast mode and orders mode (PRD 6.1).

Forecast mode:
    q = max(0, ceil( sum(forecast over R + L_d days) + z * sigma * sqrt(R + L_d) - U(d,p) ))
    L_d  = shortest lead time to outlet d over open routes from operational warehouses
           (falls back to the shortest route of any status if none is open)
    U    = outlet on-hand units that do not expire within R + L_d days
           ((expiry - planning_date).days > R + L_d); in-transit stock assumed zero.
Orders mode:
    q = open order quantity.
Rounding: the positive need is rounded UP to whole units (ceil).
"""
from __future__ import annotations

import math
from datetime import date

from app.inventory.problem import NeedDetail


def shortest_lead_times(dataset: dict) -> dict[str, int]:
    status = {w["warehouse_id"]: w["status"] for w in dataset["warehouses"]}
    best: dict[str, int] = {}
    fallback: dict[str, int] = {}
    for r in dataset["routes"]:
        d, lt = r["outlet_id"], r["lead_time_days"]
        fallback[d] = min(fallback.get(d, lt), lt)
        if r["open"] and status.get(r["warehouse_id"]) == "operational":
            best[d] = min(best.get(d, lt), lt)
    return {d: best.get(d, fallback[d]) for d in fallback}


def usable_on_hand(qty: int, expiry_iso: str, planning: date, horizon_days: int) -> int:
    return qty if (date.fromisoformat(expiry_iso) - planning).days > horizon_days else 0


def forecast_need(forecast_units: float, sigma: float, z: float, horizon_days: int, usable: int) -> int:
    raw = forecast_units + z * sigma * math.sqrt(horizon_days) - usable
    return max(0, math.ceil(raw - 1e-9))


def compute_need(dataset: dict, *, need_source: str, review_period_days: int, z_by_class: dict[str, float],
                 forecast=None, demand_multipliers: dict[tuple[str, str], float] | None = None
                 ) -> dict[tuple[str, str], NeedDetail]:
    """forecast: ForecastResult (required in forecast mode, optional in orders mode)."""
    mult = demand_multipliers or {}
    planning = date.fromisoformat(dataset["meta"]["planning_date"])
    R = review_period_days
    leads = shortest_lead_times(dataset)
    on_hand = {(r["outlet_id"], r["product_id"]): r for r in dataset["outlet_inventory"]}
    crit = {p["product_id"]: p["criticality"] for p in dataset["products"]}
    orders = {(o["outlet_id"], o["product_id"]): o["quantity"] for o in dataset["open_orders"]}
    idx = forecast.index() if forecast is not None else {}

    out: dict[tuple[str, str], NeedDetail] = {}
    for o in dataset["outlets"]:
        d = o["outlet_id"]
        L = leads[d]
        H = R + L
        for p in dataset["products"]:
            pid = p["product_id"]
            m = mult.get((d, pid), 1.0)
            oh = on_hand.get((d, pid))
            oh_total = oh["quantity"] if oh else 0
            U = usable_on_hand(oh["quantity"], oh["expiry_date"], planning, H) if oh else 0
            z = z_by_class[crit[pid]]
            f_units = sigma = 0.0
            if forecast is not None:
                i = idx[(d, pid)]
                f_units = float(forecast.forecast[i, :H].sum()) * m
                sigma = float(forecast.sigma[i]) * m
            if need_source == "forecast":
                if forecast is None:
                    raise ValueError("forecast mode requires a forecast")
                q = forecast_need(f_units, sigma, z, H, U)
                out[(d, pid)] = NeedDetail(d, pid, q, "forecast", H, L, f_units, z * sigma * math.sqrt(H),
                                           sigma, z, U, oh_total, 0, m)
            else:
                oq = orders.get((d, pid), 0)
                q = max(0, math.ceil(oq * m - 1e-9))
                out[(d, pid)] = NeedDetail(d, pid, q, "orders", H, L, f_units,
                                           z * sigma * math.sqrt(H) if forecast is not None else 0.0,
                                           sigma, z, U, oh_total, oq, m)
    return out


def need_from_expected(dataset: dict, *, review_period_days: int, z_by_class: dict[str, float],
                       need_source: str) -> dict[tuple[str, str], NeedDetail]:
    """Need from the generator's known expected demand (used by the 100-seed harness and stress test,
    where re-training the forecaster per seed adds time without exercising the optimizer)."""
    import numpy as np

    class _Known:
        def __init__(self):
            keys = sorted({(r["outlet_id"], r["product_id"]) for r in dataset["future_expected"]})
            self._idx = {k: i for i, k in enumerate(keys)}
            H = max(r["day_offset"] for r in dataset["future_expected"]) + 1
            self.forecast = np.zeros((len(keys), H))
            for r in dataset["future_expected"]:
                self.forecast[self._idx[(r["outlet_id"], r["product_id"])], r["day_offset"]] = r["mu"]
            self.sigma = np.maximum(np.sqrt(self.forecast.mean(axis=1)), 1.0)

        def index(self):
            return self._idx

    return compute_need(dataset, need_source=need_source, review_period_days=review_period_days,
                        z_by_class=z_by_class, forecast=_Known())
