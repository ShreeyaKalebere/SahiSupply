"""Read-side views: dashboard, inventory, risks, forecast chart data and the fair evaluation table."""
from __future__ import annotations

import threading

import numpy as np

from app.forecasting.models import MODEL_NAMES
from app.inventory.eligibility import build_eligibility, days_until, evaluate_pair
from app.optimization.baseline import greedy_plan
from app.optimization.checker import check_plan
from app.optimization.model import solve
from app.services.kpis import compute_kpis
from app.services.planner import prepare_problem


def inventory_view(module: str, scenario_id: str = "S0", contested_pattern: bool = True) -> dict:
    problem, ctx = prepare_problem(module, scenario_id, contested_pattern=contested_pattern)
    R = problem.review_period_days
    rows = []
    for b in sorted(problem.batches.values(), key=lambda b: (b["warehouse_id"], b["product_id"], b["expiry_date"])):
        p = problem.products[b["product_id"]]
        evals = [evaluate_pair(problem, b, d) for d in problem.outlets]
        ok = [e for e in evals if e.eligible]
        reasons: dict[str, int] = {}
        for e in evals:
            for blk in e.blocks:
                key = blk.code if not blk.rule_id else f"{blk.code} ({blk.rule_id})"
                reasons[key] = reasons.get(key, 0) + 1
        dte = days_until(b["expiry_date"], problem.planning_date)
        if not ok:
            status = "blocked"
        elif len(ok) < len(evals):
            status = "partially_eligible"
        else:
            status = "eligible"
        rows.append({
            "batch_id": b["batch_id"], "warehouse_id": b["warehouse_id"],
            "warehouse_name": problem.warehouses[b["warehouse_id"]]["name"],
            "warehouse_status": problem.warehouses[b["warehouse_id"]]["status"],
            "product_id": b["product_id"], "product_name": p["name"], "category": p["category"],
            "criticality": p["criticality"], "storage_class": p["storage_class"], "quantity": b["quantity"],
            "manufacturing_date": b.get("manufacturing_date"), "expiry_date": b["expiry_date"],
            "days_to_expiry": dte, "shelf_life_days": p["shelf_life_days"],
            "remaining_life_pct": 100.0 * dte / p["shelf_life_days"],
            "eligible_outlets": len(ok), "total_outlets": len(evals), "eligibility": status,
            "block_reasons": reasons, "expiry_risk": dte <= R or not ok,
        })
    return {"planning_date": problem.planning_date.isoformat(), "scenario_id": scenario_id,
            "rules_enforced": list(problem.rules.enabled_ids), "rows": rows, "data_source": problem.data_source}


def risks_view(module: str, contested_pattern: bool = True) -> dict:
    problem, ctx = prepare_problem(module, "S0", contested_pattern=contested_pattern)
    fc = ctx["forecast"]
    idx = fc.index()
    stockout = []
    for (d, pid), nd in problem.need_detail.items():
        i = idx[(d, pid)]
        lead_demand = float(fc.forecast[i, :nd.lead_time_days].sum())
        if nd.usable_on_hand < lead_demand:
            stockout.append({"outlet_id": d, "outlet_name": problem.outlets[d]["name"], "product_id": pid,
                             "product_name": problem.products[pid]["name"],
                             "criticality": problem.products[pid]["criticality"],
                             "usable_on_hand": nd.usable_on_hand, "forecast_over_lead_time": lead_demand,
                             "lead_time_days": nd.lead_time_days})
    stockout.sort(key=lambda r: (r["criticality"] != "critical", r["usable_on_hand"] - r["forecast_over_lead_time"]))
    inv = inventory_view(module, "S0", contested_pattern)
    expiry = [r for r in inv["rows"] if r["expiry_risk"]]
    expiry.sort(key=lambda r: r["days_to_expiry"])

    # Supply shortfall: forecast need for the next cycle vs eligible supply (raised in both modes)
    elig = build_eligibility(problem)
    eligible_supply: dict[str, int] = {}
    seen = set()
    for e in elig.eligible_pairs():
        if e.batch_id not in seen:
            seen.add(e.batch_id)
            eligible_supply[e.product_id] = eligible_supply.get(e.product_id, 0) + problem.batches[e.batch_id]["quantity"]
    shortfall = []
    for pid, p in problem.products.items():
        fneed = sum(nd.forecast_units + nd.safety_stock - nd.usable_on_hand
                    for (d, q), nd in problem.need_detail.items() if q == pid)
        sup = eligible_supply.get(pid, 0)
        if fneed > sup:
            shortfall.append({"product_id": pid, "product_name": p["name"], "criticality": p["criticality"],
                              "forecast_need": fneed, "eligible_supply": sup, "gap": fneed - sup})
    shortfall.sort(key=lambda r: -r["gap"])
    return {"stockout_risk": stockout, "expiry_risk": expiry, "supply_shortfall": shortfall,
            "definitions": {
                "stockout_risk": "Usable outlet on-hand is below forecast demand over the delivery lead time.",
                "expiry_risk": "Batch expires within the review period or fails the shelf-life/storage rules for every outlet.",
                "supply_shortfall": "Forecast need (incl. safety stock, minus usable on-hand) exceeds eligible network supply.",
            }, "data_source": problem.data_source}


def dashboard_view(module: str, contested_pattern: bool = True) -> dict:
    problem, ctx = prepare_problem(module, "S0", contested_pattern=contested_pattern)
    elig = build_eligibility(problem)
    eligible_batches = {e.batch_id for e in elig.eligible_pairs()}
    total_units = sum(b["quantity"] for b in problem.batches.values())
    eligible_units = sum(problem.batches[b]["quantity"] for b in eligible_batches)
    fc = ctx["forecast"]
    week_forecast = float(fc.forecast[:, :problem.review_period_days].sum())
    r = risks_view(module, contested_pattern)
    return {
        "module": module, "planning_date": problem.planning_date.isoformat(),
        "review_period_days": problem.review_period_days, "need_source": ctx["config"].planning.need_source,
        "total_inventory_units": total_units, "eligible_inventory_units": eligible_units,
        "forecast_demand_units": week_forecast, "required_replenishment_units": sum(problem.need.values()),
        "open_order_units": sum(o["quantity"] for o in ctx["dataset"]["open_orders"]),
        "warehouses": len(problem.warehouses), "outlets": len(problem.outlets), "products": len(problem.products),
        "batches": len(problem.batches), "routes_open": sum(1 for x in problem.routes.values() if x["open"]),
        "stockout_risk_count": len(r["stockout_risk"]), "expiry_risk_batches": len(r["expiry_risk"]),
        "expiry_risk_units": sum(x["quantity"] for x in r["expiry_risk"]),
        "supply_shortfall_products": len(r["supply_shortfall"]),
        "forecast_model": fc.selected, "forecast_model_label": MODEL_NAMES[fc.selected],
        "data_source": problem.data_source,
    }


def forecast_chart(module: str, outlet_id: str | None = None, product_id: str | None = None) -> dict:
    problem, ctx = prepare_problem(module, "S0")
    fc = ctx["forecast"]
    sd = fc.series
    mask = np.array([(outlet_id in (None, d)) and (product_id in (None, p)) for d, p in sd.keys])
    if not mask.any():
        raise KeyError("no matching series")
    bt = fc.backtest
    start = bt.origins[0]
    history = []
    for t in range(max(0, sd.history_days - 90), sd.history_days):
        history.append({"date": sd.dates[t].isoformat(), "actual": float(sd.y[mask, t].sum()),
                        "promo": bool(sd.promo[:, t].any()), "festival": bool(sd.festival[t])})
    backtest = []
    for j in range(bt.actual.shape[1]):
        row = {"date": sd.dates[start + j].isoformat(), "actual": float(bt.actual[mask, j].sum())}
        for m, P in bt.predictions.items():
            row[m] = float(P[mask, j].sum())
        if bt.expected is not None:
            row["expected"] = float(bt.expected[mask, j].sum())
        backtest.append(row)
    future = []
    for h in range(fc.forecast.shape[1]):
        dte = sd.dates[sd.history_days + h]
        sig = float(np.sqrt((fc.sigma[mask] ** 2).sum()))
        val = float(fc.forecast[mask, h].sum())
        future.append({"date": dte.isoformat(), "forecast": val, "lower": max(0.0, val - 1.28 * sig),
                       "upper": val + 1.28 * sig})
    return {"metrics": fc.metrics_payload(), "history": history, "backtest": backtest, "forecast": future,
            "selection": {"outlet_id": outlet_id, "product_id": product_id, "series": int(mask.sum())},
            "outlets": [{"id": o["outlet_id"], "name": o["name"]} for o in problem.outlets.values()],
            "products": [{"id": p["product_id"], "name": p["name"]} for p in problem.products.values()],
            "data_source": problem.data_source}


_eval_cache: dict[str, dict] = {}
_eval_lock = threading.Lock()


def fair_evaluation(module: str) -> dict:
    """S0-S3 with the contested-supply pattern on and off: baseline vs optimizer on identical data."""
    rows = []
    key_parts = []
    for pattern in (True, False):
        for sid in ("S0", "S1", "S2", "S3"):
            problem, ctx = prepare_problem(module, sid, contested_pattern=pattern)
            key_parts.append(problem.fingerprint())
    key = f"{module}:{'|'.join(key_parts)}"
    with _eval_lock:
        if key in _eval_cache:
            return _eval_cache[key]
    for pattern in (True, False):
        for sid in ("S0", "S1", "S2", "S3"):
            problem, _ = prepare_problem(module, sid, contested_pattern=pattern)
            elig = build_eligibility(problem)
            opt = solve(problem, elig)
            base = greedy_plan(problem, elig)
            fp = problem.fingerprint()
            raw = problem.raw_inputs()
            ko, kb = compute_kpis(problem, opt.plan), compute_kpis(problem, base)
            rows.append({
                "scenario_id": sid, "contested_pattern": pattern, "fingerprint": fp[:12],
                "optimizer_fill_rate": ko["fill_rate"], "baseline_fill_rate": kb["fill_rate"],
                "fill_rate_pp": 100 * (ko["fill_rate"] - kb["fill_rate"]),
                "optimizer_critical_shortage": ko["critical_shortage_units"],
                "baseline_critical_shortage": kb["critical_shortage_units"],
                "optimizer_cost_per_unit": ko["cost_per_delivered_unit"],
                "baseline_cost_per_unit": kb["cost_per_delivered_unit"],
                "optimizer_expiry_risk": ko["expiry_risk_units"], "baseline_expiry_risk": kb["expiry_risk_units"],
                "optimizer_valid": check_plan(raw, opt.plan.lines, expected_fingerprint=fp).valid,
                "baseline_valid": check_plan(raw, base.lines, expected_fingerprint=fp).valid,
                "solver_status": opt.status, "solve_seconds": opt.solve_seconds,
            })
    on = [r for r in rows if r["contested_pattern"] and r["scenario_id"] != "S0"]
    off = [r for r in rows if not r["contested_pattern"] and r["scenario_id"] != "S0"]
    result = {
        "module": module, "rows": rows,
        "north_star": {
            "definition": "Fill rate under disruption (S1-S3), optimizer vs baseline on identical data, 0 violations",
            "target": ">= baseline + 5 pp in >= 2 of S1-S3 (pattern on)",
            "scenarios_meeting_target_pattern_on": sum(1 for r in on if r["fill_rate_pp"] >= 5),
            "scenarios_meeting_target_pattern_off": sum(1 for r in off if r["fill_rate_pp"] >= 5),
            "target_met": sum(1 for r in on if r["fill_rate_pp"] >= 5) >= 2
                          and all(r["optimizer_valid"] for r in rows),
        },
        "note": "Synthetic data. Pattern-off results are shown so the dependence on the designed contested-supply pattern is visible.",
    }
    with _eval_lock:
        _eval_cache[key] = result
    return result
