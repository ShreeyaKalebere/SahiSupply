"""'Value of one more unit' insights (PRD 6.6), two-stage method.

1. Rank: solve the LP relaxation of the same model (GLOP) and rank capacity constraints
   (batch stock, route, cold, outbound, receiving) by |dual value|. Duals are only used to rank.
2. Measure: for each top candidate, re-solve the INTEGER model with +k units of that resource,
   k = max(10, 5% of the current limit), and report the measured change per added unit:
     - standard products: rupees of net margin recovered = delta(gross margin - delivery cost) / k
       (the policy penalty is excluded, so the figure reflects synthetic real economics)
     - critical medicines: critical shortage units avoided per added unit (no rupee value).
   Candidates with no measured improvement are dropped. Every value is reproduced by the checker.
"""
from __future__ import annotations

import time

from app.inventory.eligibility import build_eligibility
from app.inventory.problem import PlanningProblem
from app.optimization import checker
from app.optimization.model import solve
from app.optimization.plan import Plan

MAX_CANDIDATES = 8
MAX_PER_KIND = 3
TOP_N = 5
LIMIT_FIELD = {"stock": "quantity", "route": "capacity_l", "cold": "cold_capacity_l",
               "outbound": "outbound_capacity_l", "receiving": "receiving_capacity_l"}


def _limit(problem: PlanningProblem, kind: str, key: str) -> float:
    if kind == "stock":
        return problem.batches[key]["quantity"]
    if kind == "route":
        return next(r for r in problem.routes.values() if r["route_id"] == key)["capacity_l"]
    if kind in ("cold", "receiving"):
        return problem.outlets[key][LIMIT_FIELD[kind]]
    return problem.warehouses[key]["outbound_capacity_l"]


def _describe(problem: PlanningProblem, kind: str, key: str, k: float) -> tuple[str, str]:
    if kind == "stock":
        b = problem.batches[key]
        p = problem.products[b["product_id"]]
        return (f"Stock of {p['name']} at {b['warehouse_id']} (batch {key})",
                f"Each extra {int(k)} units of {p['name']} at {b['warehouse_id']}")
    if kind == "route":
        r = next(r for r in problem.routes.values() if r["route_id"] == key)
        o = problem.outlets[r["outlet_id"]]
        return (f"Route capacity {r['warehouse_id']} → {o['name']} ({o['region']})",
                f"{k:.0f} L more vehicle capacity on {r['warehouse_id']} → {r['outlet_id']}")
    if kind == "cold":
        o = problem.outlets[key]
        return (f"Cold capacity at {o['name']}", f"A {k:.0f} L fridge expansion at {o['name']}")
    if kind == "receiving":
        o = problem.outlets[key]
        return (f"Receiving capacity at {o['name']}", f"{k:.0f} L more receiving space at {o['name']}")
    w = problem.warehouses[key]
    return (f"Outbound capacity at {w['name']}", f"{k:.0f} L more outbound capacity at {key}")


def compute_insights(problem: PlanningProblem, base_plan: Plan, *, time_limit_s: float = 5.0) -> dict:
    t0 = time.perf_counter()
    elig = build_eligibility(problem)
    lp = solve(problem, elig, relax=True, time_limit_s=time_limit_s)
    if lp.status not in ("OPTIMAL", "FEASIBLE"):
        return {"method": "lp_dual_rank_then_integer_resolve", "status": f"LP {lp.status}", "items": [],
                "candidates": [], "seconds": time.perf_counter() - t0}
    ranked = sorted(((k, v) for k, v in lp.duals.items() if abs(v) > 1e-7), key=lambda kv: (-abs(kv[1]), kv[0]))
    # Highest |dual| first, at most MAX_PER_KIND per resource kind so stock, route and cold all get measured
    candidates, per_kind = [], {}
    for (kind, key), dual in ranked:
        if per_kind.get(kind, 0) < MAX_PER_KIND:
            candidates.append(((kind, key), dual))
            per_kind[kind] = per_kind.get(kind, 0) + 1
        if len(candidates) >= MAX_CANDIDATES:
            break

    base_raw = problem.raw_inputs()
    items = []
    measured = []
    for (kind, key), dual in candidates:
        limit = _limit(problem, kind, key)
        k = max(10.0, 0.05 * limit)
        if kind == "stock":
            k = float(int(round(k)))
        mod = problem.with_resource_delta(kind, key, k)
        res = solve(mod, build_eligibility(mod), time_limit_s=time_limit_s)
        entry = {"kind": kind, "key": key, "lp_dual": dual, "limit": limit, "added": k, "status": res.status}
        if res.plan is None:
            entry["dropped"] = "re-solve failed"
            measured.append(entry)
            continue
        # measured per-unit values, computed from raw lines via the independent checker's arithmetic
        base_t = checker.recompute_totals(base_raw, base_plan.lines)
        mod_raw = mod.raw_inputs()
        mod_t = checker.recompute_totals(mod_raw, res.plan.lines)

        def std_margin(prob, lines):
            return sum((prob.products[ln["product_id"]]["unit_margin"] - prob.unit_cost(ln["batch_id"], ln["outlet_id"]))
                       * ln["qty"] for ln in lines if prob.products[ln["product_id"]]["criticality"] != "critical")

        margin_pu = (std_margin(mod, res.plan.lines) - std_margin(problem, base_plan.lines)) / k
        crit_pu = (base_t["critical_shortage_units"] - mod_t["critical_shortage_units"]) / k
        units_pu = (mod_t["delivered_units"] - base_t["delivered_units"]) / k
        entry.update(net_margin_per_unit=margin_pu, critical_units_avoided_per_unit=crit_pu,
                     extra_units_delivered_per_unit=units_pu)
        if margin_pu <= 0.01 and crit_pu <= 1e-9:
            entry["dropped"] = "no measured improvement"
            measured.append(entry)
            continue
        ver = checker.verify_insight(base_raw, base_plan.lines, mod_raw, res.plan.lines, added_units=k,
                                     reported={"net_margin_per_unit": margin_pu, "critical_units_avoided_per_unit": crit_pu})
        title, lead = _describe(problem, kind, key, k)
        unit = "units" if kind == "stock" else "L"
        parts = []
        if crit_pu > 1e-9:
            parts.append(f"prevents about {crit_pu * k:.0f} critical shortage units")
        if margin_pu > 0.01:
            parts.append(f"recovers about ₹{margin_pu * k:,.0f} of net margin")
        items.append({
            "kind": kind, "key": key, "title": title,
            "statement": f"{lead} {' and '.join(parts)} this week.",
            "added": k, "added_unit": unit, "current_limit": limit, "lp_dual": dual,
            "net_margin_per_unit": margin_pu, "net_margin_total": margin_pu * k,
            "critical_units_avoided_per_unit": crit_pu, "critical_units_avoided_total": crit_pu * k,
            "extra_units_delivered": units_pu * k,
            "signal": {"stock": "procurement or rebalancing", "route": "add vehicle capacity",
                       "cold": "add cold storage", "receiving": "expand receiving space",
                       "outbound": "add dispatch capacity"}[kind],
            "verified": ver.valid, "verification": ver.as_dict()["violations"],
            "resolve_status": res.status, "note": "Measured by integer re-solve; valid for small changes.",
        })
        measured.append(entry)

    items.sort(key=lambda it: (-it["critical_units_avoided_per_unit"], -it["net_margin_per_unit"]))
    return {
        "method": "lp_dual_rank_then_integer_resolve",
        "status": "OK",
        "items": items[:TOP_N],
        "candidates": [{"kind": c["kind"], "key": c["key"], "lp_dual": c["lp_dual"], "added": c["added"],
                        "dropped": c.get("dropped"), "net_margin_per_unit": c.get("net_margin_per_unit"),
                        "critical_units_avoided_per_unit": c.get("critical_units_avoided_per_unit")}
                       for c in measured],
        "notes": ["LP duals (GLOP) only rank candidates; every displayed value comes from an integer re-solve.",
                  "Rupee values exclude the policy shortage penalty; critical medicines are counted in units."],
        "seconds": time.perf_counter() - t0,
    }
