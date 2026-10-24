"""Disruption-regret score (PRD 6.8, P1).

The S0 plan is applied unchanged to scenario k:
  1. shipments from a closed warehouse, on a closed route, or now ineligible are removed;
  2. where a need or capacity limit is now exceeded, shipments are trimmed smallest-need-first until it holds;
  3. the independent checker validates the result before any metric is shown.
Regret(k)             = fill rate of the re-optimized plan - fill rate of the applied S0 plan
Residual shortfall(k) = need - units delivered by the re-optimized plan
"""
from __future__ import annotations

import math

from app.inventory.eligibility import evaluate_pair
from app.inventory.problem import PlanningProblem
from app.optimization.plan import Plan, make_line, sort_lines


def apply_plan(s0_plan: Plan, problem: PlanningProblem) -> tuple[Plan, dict]:
    removed = trimmed = 0
    qty: dict[tuple[str, str], int] = {}
    for ln in s0_plan.lines:
        b = problem.batches.get(ln["batch_id"])
        if b is None or not evaluate_pair(problem, b, ln["outlet_id"]).eligible:
            removed += ln["qty"]
            continue
        qty[(ln["batch_id"], ln["outlet_id"])] = ln["qty"]

    def unit_weight(bd, by_volume: bool) -> float:
        return problem.products[problem.batches[bd[0]]["product_id"]]["unit_volume_l"] if by_volume else 1.0

    def trim(keys: list, limit: float, by_volume: bool) -> None:
        """Cut shipments smallest-need-first until the summed (volume or units) usage fits the limit."""
        nonlocal trimmed
        order = sorted(keys, key=lambda bd: (problem.need.get((bd[1], problem.batches[bd[0]]["product_id"]), 0), bd))
        for bd in order:
            used = sum(qty[k] * unit_weight(k, by_volume) for k in keys)
            over = used - limit
            if over <= 1e-9:
                break
            cut = min(qty[bd], math.ceil(over / unit_weight(bd, by_volume) - 1e-9))
            qty[bd] -= cut
            trimmed += cut

    groups: dict[tuple, list] = {}
    for bd in qty:
        b = problem.batches[bd[0]]
        p = problem.products[b["product_id"]]
        groups.setdefault(("need", bd[1], b["product_id"]), []).append(bd)
        groups.setdefault(("stock", bd[0]), []).append(bd)
        groups.setdefault(("outbound", b["warehouse_id"]), []).append(bd)
        groups.setdefault(("receiving", bd[1]), []).append(bd)
        groups.setdefault(("route", b["warehouse_id"], bd[1]), []).append(bd)
        if p["storage_class"] != "ambient":
            groups.setdefault(("cold", bd[1]), []).append(bd)
    for g, keys in groups.items():
        kind = g[0]
        if kind == "need":
            trim(keys, problem.need.get((g[1], g[2]), 0), False)
        elif kind == "stock":
            trim(keys, problem.batches[g[1]]["quantity"], False)
        elif kind == "outbound":
            trim(keys, problem.warehouses[g[1]]["outbound_capacity_l"], True)
        elif kind == "receiving":
            trim(keys, problem.outlets[g[1]]["receiving_capacity_l"], True)
        elif kind == "cold":
            trim(keys, problem.outlets[g[1]]["cold_capacity_l"], True)
        elif kind == "route":
            trim(keys, problem.routes[(g[1], g[2])]["capacity_l"], True)
    lines = [make_line(problem, b, d, q) for (b, d), q in qty.items() if q > 0]
    return Plan("applied_s0", sort_lines(lines)), {"removed_units": removed, "trimmed_units": trimmed}


def regret_report(problem: PlanningProblem, applied_kpis: dict, reopt_kpis: dict, adjust: dict) -> dict:
    regions = {}
    for reg, r in reopt_kpis["by_region"].items():
        a = applied_kpis["by_region"].get(reg, {"fill_rate": 0.0, "delivered_units": 0})
        regions[reg] = {
            "need_units": r["need_units"],
            "applied_fill_rate": a["fill_rate"], "reoptimized_fill_rate": r["fill_rate"],
            "regret_pp": 100.0 * (r["fill_rate"] - a["fill_rate"]),
            "residual_shortfall_units": r["need_units"] - r["delivered_units"],
        }
    warehouses = {}
    for w in problem.warehouses:
        warehouses[w] = {"applied_units": applied_kpis["shipped_by_warehouse"].get(w, 0),
                         "reoptimized_units": reopt_kpis["shipped_by_warehouse"].get(w, 0),
                         "status": problem.warehouses[w]["status"]}
    return {
        "regret_pp": 100.0 * (reopt_kpis["fill_rate"] - applied_kpis["fill_rate"]),
        "applied_fill_rate": applied_kpis["fill_rate"],
        "reoptimized_fill_rate": reopt_kpis["fill_rate"],
        "residual_shortfall_units": reopt_kpis["need_units"] - reopt_kpis["delivered_units"],
        "by_region": regions, "by_warehouse": warehouses, "adjustments": adjust,
        "method": "S0 plan applied unchanged: closed/ineligible shipments removed, then trimmed smallest-need-first "
                  "until every need and capacity limit holds; validated by the checker.",
    }
