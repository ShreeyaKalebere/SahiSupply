"""Greedy baseline: the spreadsheet planner (PRD 6.3).

1. Sort (outlet, product) pairs by need, largest first (ties: outlet id, product id).
2. For each pair, take eligible batches cheapest first, then earliest expiry, then batch id.
3. Allocate until the need is met, stock runs out, or a capacity limit is reached
   (warehouse outbound, outlet receiving, outlet cold, route).
Runs on the identical PlanningProblem and eligibility as the optimizer.
"""
from __future__ import annotations

import math
import time

from app.inventory.eligibility import Eligibility, build_eligibility
from app.inventory.problem import PlanningProblem
from app.optimization.plan import Plan, make_line, sort_lines


def greedy_plan(problem: PlanningProblem, elig: Eligibility | None = None) -> Plan:
    t0 = time.perf_counter()
    elig = elig or build_eligibility(problem)
    stock = {bid: b["quantity"] for bid, b in problem.batches.items()}
    out_left = {w: x["outbound_capacity_l"] for w, x in problem.warehouses.items()}
    in_left = {d: o["receiving_capacity_l"] for d, o in problem.outlets.items()}
    cold_left = {d: o["cold_capacity_l"] for d, o in problem.outlets.items()}
    route_left = {k: r["capacity_l"] for k, r in problem.routes.items()}

    candidates: dict[tuple[str, str], list] = {}
    for e in elig.eligible_pairs():
        candidates.setdefault((e.outlet_id, e.product_id), []).append(e)

    order = sorted(((k, q) for k, q in problem.need.items() if q > 0),
                   key=lambda kq: (-kq[1], int(kq[0][0][1:]), kq[0][1]))
    alloc: dict[tuple[str, str], int] = {}
    for (d, pid), q in order:
        remaining = q
        p = problem.products[pid]
        v = p["unit_volume_l"]
        cold = p["storage_class"] != "ambient"
        cands = sorted(candidates.get((d, pid), []),
                       key=lambda e: (round(e.unit_cost, 6), problem.batches[e.batch_id]["expiry_date"], e.batch_id))
        for e in cands:
            if remaining <= 0:
                break
            w = e.warehouse_id
            limits = [stock[e.batch_id], remaining,
                      math.floor(out_left[w] / v + 1e-9), math.floor(in_left[d] / v + 1e-9),
                      math.floor(route_left[(w, d)] / v + 1e-9)]
            if cold:
                limits.append(math.floor(cold_left[d] / v + 1e-9))
            take = max(0, min(limits))
            if take <= 0:
                continue
            stock[e.batch_id] -= take
            remaining -= take
            out_left[w] -= take * v
            in_left[d] -= take * v
            route_left[(w, d)] -= take * v
            if cold:
                cold_left[d] -= take * v
            alloc[(e.batch_id, d)] = alloc.get((e.batch_id, d), 0) + take

    lines = [make_line(problem, b, d, q) for (b, d), q in alloc.items() if q > 0]
    return Plan("baseline", sort_lines(lines),
                {"status": "HEURISTIC", "solve_seconds": time.perf_counter() - t0,
                 "backend": "greedy: largest need first, cheapest then earliest-expiry batch"})
