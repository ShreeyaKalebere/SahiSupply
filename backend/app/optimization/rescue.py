"""Expiry Rescue: which batches will be written off if they are not shipped this cycle.

Uses the same test as the expiry-risk KPI: a batch is at risk when, held until the next planning
cycle, its remaining life (minus the warehouse's shortest lead time) falls below the shelf-life
rule. Already-expired batches are listed but never rescued - the eligibility rules keep them out
of every plan.
"""
from __future__ import annotations

from datetime import timedelta

from app.inventory.eligibility import days_until
from app.inventory.problem import PlanningProblem
from app.services.kpis import _min_life_threshold


def at_risk_batches(problem: PlanningProblem) -> dict[str, dict]:
    next_cycle = problem.planning_date + timedelta(days=problem.review_period_days)
    min_lead: dict[str, int] = {}
    for (w, _), r in problem.routes.items():
        if r["open"]:
            min_lead[w] = min(min_lead.get(w, 99), r["lead_time_days"])
    out = {}
    for bid, b in problem.batches.items():
        p = problem.products[b["product_id"]]
        threshold = _min_life_threshold(problem.rules, p["shelf_life_days"])
        life_next = days_until(b["expiry_date"], next_cycle) - min_lead.get(b["warehouse_id"], 1)
        if life_next >= threshold:
            continue
        days_left = days_until(b["expiry_date"], problem.planning_date)
        out[bid] = {"days_to_expiry": days_left, "expired": days_left <= 0, "threshold_days": threshold,
                    "remaining_life_pct": max(0.0, 100.0 * days_left / max(p["shelf_life_days"], 1)),
                    "unit_value": p["unit_cost"]}
    return out


def rescue_bonus(problem: PlanningProblem) -> dict[str, float]:
    """Objective reward per unit shipped from an at-risk batch = the write-off it avoids (unit cost)."""
    return {bid: r["unit_value"] for bid, r in at_risk_batches(problem).items() if not r["expired"]}
