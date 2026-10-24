"""Eligibility builder e(b,d) used by the optimizer, the baseline and the explanations.

The independent checker (app/optimization/checker.py) deliberately does NOT
import this module; it recomputes eligibility from raw data on its own.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

from app.inventory.problem import PlanningProblem


def days_until(expiry_iso: str, ref: date) -> int:
    return (date.fromisoformat(expiry_iso) - ref).days


def life_on_arrival_days(expiry_iso: str, planning_date: date, lead_time_days: int) -> int:
    """Shelf life left when the batch reaches the outlet: expiry - planning date - lead time."""
    return days_until(expiry_iso, planning_date) - lead_time_days


@dataclass
class Block:
    code: str          # WAREHOUSE_CLOSED | NO_ROUTE | ROUTE_CLOSED | NO_STOCK | EXPIRED | MIN_LIFE | STORAGE
    message: str
    rule_id: str | None = None


@dataclass
class PairEval:
    batch_id: str
    outlet_id: str
    product_id: str
    warehouse_id: str
    eligible: bool
    life_on_arrival: int | None
    life_on_arrival_pct: float | None
    unit_cost: float | None
    lead_time_days: int | None
    blocks: list[Block] = field(default_factory=list)


def min_life_threshold_days(problem: PlanningProblem, product: dict) -> int | None:
    r = problem.rules
    if r.min_life_days is not None:
        return r.min_life_days
    if r.min_life_pct is not None:
        return math.ceil(product["shelf_life_days"] * r.min_life_pct / 100.0)
    return None


def evaluate_pair(problem: PlanningProblem, batch: dict, outlet_id: str) -> PairEval:
    wid, pid = batch["warehouse_id"], batch["product_id"]
    product = problem.products[pid]
    outlet = problem.outlets[outlet_id]
    warehouse = problem.warehouses[wid]
    route = problem.routes.get((wid, outlet_id))
    blocks: list[Block] = []

    if warehouse["status"] != "operational":
        blocks.append(Block("WAREHOUSE_CLOSED", f"Warehouse {wid} is {warehouse['status']}"))
    if route is None:
        blocks.append(Block("NO_ROUTE", f"No route {wid}->{outlet_id}"))
    elif not route["open"]:
        blocks.append(Block("ROUTE_CLOSED", f"Route {wid}->{outlet_id} is closed"))
    if batch["quantity"] <= 0:
        blocks.append(Block("NO_STOCK", f"Batch {batch['batch_id']} has no stock"))

    life = pct = cost = lead = None
    if route is not None:
        lead = route["lead_time_days"]
        life = life_on_arrival_days(batch["expiry_date"], problem.planning_date, lead)
        pct = 100.0 * life / product["shelf_life_days"]
        cost = problem.unit_cost(batch["batch_id"], outlet_id)
        if life <= 0:
            blocks.append(Block("EXPIRED", f"Expires before arrival ({life} days on arrival)"))
        else:
            thr = min_life_threshold_days(problem, product)
            if thr is not None and life < thr:
                r = problem.rules
                if r.min_life_days is not None:
                    msg = f"{life} days on arrival < {thr}"
                else:
                    msg = f"{pct:.0f}% shelf life on arrival < {r.min_life_pct:.0f}% ({life} < {thr} days)"
                blocks.append(Block("MIN_LIFE", msg, problem.rules.min_life_rule_id))

    sc = product["storage_class"]
    if sc in problem.rules.storage_classes and sc not in outlet["storage"]:
        blocks.append(Block("STORAGE", f"{outlet['name']} has no {sc} storage",
                            problem.rules.storage_rule_id))

    return PairEval(batch["batch_id"], outlet_id, pid, wid, not blocks, life, pct, cost, lead, blocks)


@dataclass
class Eligibility:
    pairs: dict[tuple[str, str], PairEval]   # (batch_id, outlet_id) -> eval, all pairs with need > 0

    def eligible_pairs(self) -> list[PairEval]:
        return [e for e in self.pairs.values() if e.eligible]


def build_eligibility(problem: PlanningProblem) -> Eligibility:
    pairs: dict[tuple[str, str], PairEval] = {}
    for b in problem.batches.values():
        for d in problem.outlets:
            if problem.need.get((d, b["product_id"]), 0) <= 0:
                continue
            pairs[(b["batch_id"], d)] = evaluate_pair(problem, b, d)
    return Eligibility(pairs)
