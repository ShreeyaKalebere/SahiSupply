"""Inventory and distribution KPIs, computed identically for every plan (PRD 8.1, 8.2)."""
from __future__ import annotations

from datetime import timedelta

from app.inventory.eligibility import days_until, evaluate_pair
from app.inventory.problem import PlanningProblem
from app.modules.rules import ActiveRules
from app.optimization.plan import Plan

LOST_SALE_SHARE = 0.40  # share of a stockout that becomes a lost sale (global benchmark, upper bound)


def _min_life_threshold(rules: ActiveRules, shelf: int) -> int:
    if rules.min_life_days is not None:
        return rules.min_life_days
    if rules.min_life_pct is not None:
        import math
        return math.ceil(shelf * rules.min_life_pct / 100.0)
    return 1


def compute_kpis(problem: PlanningProblem, plan: Plan, reference_rules: ActiveRules | None = None) -> dict:
    """reference_rules: the module's real rule set, used to count blocked units shipped and expiry risk
    (so a rules-off diagnostic plan is judged against the rules it ignored)."""
    ref = reference_rules or problem.rules
    ref_problem = problem.with_rules(ref)
    products, batches = problem.products, problem.batches

    need_units = sum(problem.need.values())
    delivered = sum(ln["qty"] for ln in plan.lines)
    got = plan.delivered_by_pair()
    shortage = {k: max(0, q - got.get(k, 0)) for k, q in problem.need.items()}
    unmet = sum(shortage.values())

    transport = margin = fresh_w = 0.0
    blocked_units = 0
    blocked_lines = []
    shipped_by_batch: dict[str, int] = {}
    shipped_by_wh: dict[str, int] = {}
    for ln in plan.lines:
        b = batches[ln["batch_id"]]
        p = products[b["product_id"]]
        cost = problem.unit_cost(ln["batch_id"], ln["outlet_id"])
        transport += cost * ln["qty"]
        margin += p["unit_margin"] * ln["qty"]
        lead = problem.routes[(b["warehouse_id"], ln["outlet_id"])]["lead_time_days"]
        life = days_until(b["expiry_date"], problem.planning_date) - lead
        fresh_w += max(life, 0) / p["shelf_life_days"] * ln["qty"]
        shipped_by_batch[ln["batch_id"]] = shipped_by_batch.get(ln["batch_id"], 0) + ln["qty"]
        shipped_by_wh[b["warehouse_id"]] = shipped_by_wh.get(b["warehouse_id"], 0) + ln["qty"]
        ev = evaluate_pair(ref_problem, b, ln["outlet_id"])
        rule_blocks = [x for x in ev.blocks if x.code in ("MIN_LIFE", "STORAGE", "EXPIRED")]
        if rule_blocks:
            blocked_units += ln["qty"]
            blocked_lines.append({**ln, "reason": "; ".join(x.message for x in rule_blocks),
                                  "rule_ids": sorted({x.rule_id for x in rule_blocks if x.rule_id})})

    # Expiry risk: units left after this plan that will fail the shelf-life rule (or expire) by the next cycle
    next_cycle = problem.planning_date + timedelta(days=problem.review_period_days)
    min_lead = {}
    for (w, _), r in problem.routes.items():
        min_lead[w] = min(min_lead.get(w, 99), r["lead_time_days"])
    expiry_units = 0
    expiry_value = 0.0
    expiry_by_product: dict[str, int] = {}
    for bid, b in batches.items():
        left = b["quantity"] - shipped_by_batch.get(bid, 0)
        if left <= 0:
            continue
        p = products[b["product_id"]]
        life_next = days_until(b["expiry_date"], next_cycle) - min_lead.get(b["warehouse_id"], 1)
        if life_next < _min_life_threshold(ref, p["shelf_life_days"]):
            expiry_units += left
            expiry_value += left * p["unit_cost"]
            expiry_by_product[b["product_id"]] = expiry_by_product.get(b["product_id"], 0) + left

    crit = {pid for pid, p in products.items() if p["criticality"] == "critical"}
    crit_need = sum(q for (d, p), q in problem.need.items() if p in crit)
    crit_short = sum(s for (d, p), s in shortage.items() if p in crit)
    std_net_margin = sum((products[ln["product_id"]]["unit_margin"] - problem.unit_cost(ln["batch_id"], ln["outlet_id"]))
                         * ln["qty"] for ln in plan.lines if ln["product_id"] not in crit)

    regions: dict[str, dict] = {}
    for (d, p), q in problem.need.items():
        reg = problem.outlets[d]["region"]
        r = regions.setdefault(reg, {"need_units": 0, "delivered_units": 0})
        r["need_units"] += q
        r["delivered_units"] += got.get((d, p), 0)
    for r in regions.values():
        r["fill_rate"] = r["delivered_units"] / r["need_units"] if r["need_units"] else 1.0

    outlets: dict[str, dict] = {}
    for (d, p), q in problem.need.items():
        o = outlets.setdefault(d, {"need_units": 0, "delivered_units": 0, "critical_shortage_units": 0})
        o["need_units"] += q
        o["delivered_units"] += got.get((d, p), 0)
        if p in crit:
            o["critical_shortage_units"] += shortage[(d, p)]
    for o in outlets.values():
        o["fill_rate"] = o["delivered_units"] / o["need_units"] if o["need_units"] else 1.0

    return {
        "need_units": need_units,
        "delivered_units": delivered,
        "unmet_units": unmet,
        "fill_rate": delivered / need_units if need_units else 1.0,
        "transport_cost": transport,
        "cost_per_delivered_unit": transport / delivered if delivered else 0.0,
        "critical_need_units": crit_need,
        "critical_shortage_units": crit_short,
        "critical_fill_rate": (crit_need - crit_short) / crit_need if crit_need else None,
        "expiry_risk_units": expiry_units,
        "expiry_risk_value": expiry_value,
        "freshness_on_arrival_pct": 100.0 * fresh_w / delivered if delivered else None,
        "gross_margin_delivered": margin,
        "net_margin": margin - transport,
        "standard_net_margin": std_net_margin,
        "blocked_units_shipped": blocked_units,
        "blocked_lines": blocked_lines[:50],
        "by_region": regions,
        "by_outlet": outlets,
        "shipped_by_warehouse": shipped_by_wh,
        "_shortage_by_pair": shortage,
        "_expiry_by_product": expiry_by_product,
    }


def public_kpis(k: dict) -> dict:
    return {key: v for key, v in k.items() if not key.startswith("_")}


def compare(problem: PlanningProblem, opt: dict, base: dict) -> dict:
    """Optimizer minus baseline deltas and illustrative weekly business impact (synthetic prices)."""
    products = problem.products
    crit = {pid for pid, p in products.items() if p["criticality"] == "critical"}
    lost_margin_avoided = 0.0
    for (d, pid), s_opt in opt["_shortage_by_pair"].items():
        if pid in crit:
            continue
        delta_short = base["_shortage_by_pair"].get((d, pid), 0) - s_opt
        lost_margin_avoided += delta_short * products[pid]["unit_margin"] * LOST_SALE_SHARE
    waste_avoided = 0.0
    for pid in set(opt["_expiry_by_product"]) | set(base["_expiry_by_product"]):
        delta = base["_expiry_by_product"].get(pid, 0) - opt["_expiry_by_product"].get(pid, 0)
        waste_avoided += delta * products[pid]["unit_cost"]
    delta_cost = opt["transport_cost"] - base["transport_cost"]
    keys = ["fill_rate", "unmet_units", "delivered_units", "transport_cost", "cost_per_delivered_unit",
            "expiry_risk_units", "critical_shortage_units", "freshness_on_arrival_pct", "net_margin",
            "blocked_units_shipped"]
    deltas = {}
    for k in keys:
        a, b = opt.get(k), base.get(k)
        deltas[k] = None if a is None or b is None else a - b
    return {
        "deltas": deltas,
        "fill_rate_pp": 100.0 * deltas["fill_rate"],
        "business_impact": {
            "lost_margin_avoided": lost_margin_avoided,
            "waste_avoided": waste_avoided,
            "delta_delivery_cost": delta_cost,
            "net_weekly_benefit": lost_margin_avoided + waste_avoided - delta_cost,
            "critical_units_gained": base["critical_shortage_units"] - opt["critical_shortage_units"],
            "lost_sale_share": LOST_SALE_SHARE,
            "note": "Illustrative, synthetic prices. Lost margin = delta units short x unit gross margin x 0.40 "
                    "(standard products only); critical medicines are reported in units, not rupees. "
                    "Never extrapolated to real companies.",
        },
    }
