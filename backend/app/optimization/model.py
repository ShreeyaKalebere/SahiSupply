"""Batch-level MILP (PRD 6.2), solved with OR-Tools pywraplp + SCIP.

    min  sum c(b,d) x(b,d)  +  sum pi(p) u(d,p)  +  eps * sum r_b x(b,d)   [+ 100 pi * floor slack]
    s.t. sum_d x(b,d)                     <= I_b            (batch stock)
         sum_{b of p} x(b,d) + u(d,p)      = q(d,p)          (need balance; nothing beyond need)
         sum v_p x  over warehouse w      <= OutCap_w
         sum v_p x  into outlet d         <= InCap_d
         sum v_p x  of cold p into d      <= ColdCap_d
         sum v_p x  on route (w,d)        <= RouteCap_wd
         x(b,d) in Z>=0, only for eligible pairs; u >= 0
    pi(p) = class weight * (m_p + s), s = service-level policy penalty (> largest unit delivery cost)
    eps   = 1% of the smallest unit cost / max r_b  (bounded FEFO tie-break, grocery G1)
The same builder with relax=True gives the LP relaxation (GLOP) used to rank constraints by dual value.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from ortools.linear_solver import pywraplp

from app.inventory.eligibility import Eligibility, build_eligibility, days_until
from app.inventory.problem import PlanningProblem
from app.optimization.plan import Plan, make_line, sort_lines

CAPACITY_KINDS = ("stock", "outbound", "receiving", "cold", "route")
FLOOR_SLACK_MULTIPLIER = 100.0
MIP_GAP = 1e-3  # relative gap at which SCIP stops (0.1%)


class OptimizationError(RuntimeError):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status


@dataclass
class SolveResult:
    status: str
    plan: Plan | None
    objective: float | None = None
    best_bound: float | None = None
    gap: float | None = None
    solve_seconds: float = 0.0
    n_int_vars: int = 0
    n_constraints: int = 0
    duals: dict[tuple[str, str], float] = field(default_factory=dict)
    objective_terms: dict = field(default_factory=dict)
    penalty: dict = field(default_factory=dict)


_STATUS = {
    pywraplp.Solver.OPTIMAL: "OPTIMAL",
    pywraplp.Solver.FEASIBLE: "FEASIBLE",
    pywraplp.Solver.INFEASIBLE: "INFEASIBLE",
    pywraplp.Solver.UNBOUNDED: "UNBOUNDED",
    pywraplp.Solver.ABNORMAL: "ABNORMAL",
    pywraplp.Solver.NOT_SOLVED: "NOT_SOLVED",
    pywraplp.Solver.MODEL_INVALID: "MODEL_INVALID",
}


def penalty_settings(problem: PlanningProblem, elig: Eligibility) -> dict:
    costs = [e.unit_cost for e in elig.eligible_pairs()]
    max_c = max(costs) if costs else 1.0
    service_penalty = round(1.5 * max_c + 1.0, 4)
    w = problem.rules.shortage_weights
    pi = {pid: w.get(p["criticality"], 1.0) * (p["unit_margin"] + service_penalty)
          for pid, p in problem.products.items()}
    return {"service_penalty_s": service_penalty, "pi": pi, "weights": dict(w),
            "note": "pi = class weight x (unit gross margin + s). s is a policy setting, not money."}


def solve(problem: PlanningProblem, elig: Eligibility | None = None, *, relax: bool = False,
          time_limit_s: float = 10.0, rescue: dict[str, float] | None = None) -> SolveResult:
    elig = elig or build_eligibility(problem)
    solver = pywraplp.Solver.CreateSolver("GLOP" if relax else "SCIP")
    if solver is None:
        raise OptimizationError("ERROR", "solver backend unavailable")
    solver.SetTimeLimit(int(time_limit_s * 1000))
    inf = solver.infinity()

    pairs = sorted(elig.eligible_pairs(), key=lambda e: (e.batch_id, int(e.outlet_id[1:])))
    pen = penalty_settings(problem, elig)
    pi = pen["pi"]

    fefo_eps = 0.0
    r_b: dict[str, int] = {}
    if problem.rules.fefo and pairs:
        r_b = {e.batch_id: max(days_until(problem.batches[e.batch_id]["expiry_date"], problem.planning_date), 0)
               for e in pairs}
        min_c = min(e.unit_cost for e in pairs)
        max_r = max(r_b.values()) or 1
        fefo_eps = 0.01 * min_c / max_r

    x = {}
    for e in pairs:
        ub = min(problem.batches[e.batch_id]["quantity"], problem.need[(e.outlet_id, e.product_id)])
        name = f"x_{e.batch_id}_{e.outlet_id}"
        x[(e.batch_id, e.outlet_id)] = solver.NumVar(0, ub, name) if relax else solver.IntVar(0, ub, name)
    u = {k: solver.NumVar(0, q, f"u_{k[0]}_{k[1]}") for k, q in sorted(problem.need.items()) if q > 0}

    cons: dict[tuple[str, str], pywraplp.Constraint] = {}
    by_batch: dict[str, list] = {}
    by_pair: dict[tuple[str, str], list] = {}
    by_wh: dict[str, list] = {}
    by_out: dict[str, list] = {}
    by_cold: dict[str, list] = {}
    by_route: dict[tuple[str, str], list] = {}
    for (bid, d), var in x.items():
        b = problem.batches[bid]
        p = problem.products[b["product_id"]]
        v = p["unit_volume_l"]
        by_batch.setdefault(bid, []).append(var)
        by_pair.setdefault((d, b["product_id"]), []).append(var)
        by_wh.setdefault(b["warehouse_id"], []).append((v, var))
        by_out.setdefault(d, []).append((v, var))
        if p["storage_class"] != "ambient":
            by_cold.setdefault(d, []).append((v, var))
        by_route.setdefault((b["warehouse_id"], d), []).append((v, var))

    for bid, vs in by_batch.items():
        c = solver.Constraint(-inf, problem.batches[bid]["quantity"], f"stock_{bid}")
        for var in vs:
            c.SetCoefficient(var, 1)
        cons[("stock", bid)] = c
    for k, uk in u.items():
        c = solver.Constraint(problem.need[k], problem.need[k], f"bal_{k[0]}_{k[1]}")
        c.SetCoefficient(uk, 1)
        for var in by_pair.get(k, []):
            c.SetCoefficient(var, 1)
        cons[("balance", f"{k[0]}|{k[1]}")] = c

    def cap(kind: str, key: str, limit: float, terms: list):
        c = solver.Constraint(-inf, limit, f"{kind}_{key}")
        for v, var in terms:
            c.SetCoefficient(var, v)
        cons[(kind, key)] = c

    for w, terms in by_wh.items():
        cap("outbound", w, problem.warehouses[w]["outbound_capacity_l"], terms)
    for d, terms in by_out.items():
        cap("receiving", d, problem.outlets[d]["receiving_capacity_l"], terms)
    for d, terms in by_cold.items():
        cap("cold", d, problem.outlets[d]["cold_capacity_l"], terms)
    for (w, d), terms in by_route.items():
        cap("route", problem.routes[(w, d)]["route_id"], problem.routes[(w, d)]["capacity_l"], terms)

    # Equity guardrail (P1, C4): u <= (1 - f) q + slack, slack penalised at 100 pi
    slack = {}
    r = problem.rules
    if r.fill_floor_pct is not None:
        f = r.fill_floor_pct / 100.0
        for k, uk in u.items():
            if problem.products[k[1]]["criticality"] in r.fill_floor_classes:
                s = solver.NumVar(0, inf, f"floor_slack_{k[0]}_{k[1]}")
                c = solver.Constraint(-inf, (1 - f) * problem.need[k], f"floor_{k[0]}_{k[1]}")
                c.SetCoefficient(uk, 1)
                c.SetCoefficient(s, -1)
                slack[k] = s

    obj = solver.Objective()
    for e in pairs:
        var = x[(e.batch_id, e.outlet_id)]
        # Expiry rescue: shipping a unit of an at-risk batch avoids writing it off (its unit cost).
        obj.SetCoefficient(var, e.unit_cost + fefo_eps * r_b.get(e.batch_id, 0) - (rescue or {}).get(e.batch_id, 0.0))
    for k, uk in u.items():
        obj.SetCoefficient(uk, pi[k[1]])
    for k, s in slack.items():
        obj.SetCoefficient(s, FLOOR_SLACK_MULTIPLIER * pi[k[1]])
    obj.SetMinimization()

    params = pywraplp.MPSolverParameters()
    if not relax:
        params.SetDoubleParam(pywraplp.MPSolverParameters.RELATIVE_MIP_GAP, MIP_GAP)
    t0 = time.perf_counter()
    code = solver.Solve(params)
    elapsed = time.perf_counter() - t0
    status = _STATUS.get(code, "ERROR")

    res = SolveResult(status=status, plan=None, solve_seconds=elapsed,
                      n_int_vars=0 if relax else len(x), n_constraints=solver.NumConstraints(),
                      penalty={"service_penalty_s": pen["service_penalty_s"], "weights": pen["weights"],
                               "fefo_epsilon": fefo_eps, "note": pen["note"]})
    if status not in ("OPTIMAL", "FEASIBLE"):
        return res

    res.objective = obj.Value()
    if relax:
        res.best_bound = res.objective
        res.gap = 0.0
        res.duals = {k: c.dual_value() for k, c in cons.items() if k[0] in CAPACITY_KINDS}
        return res
    res.best_bound = obj.BestBound()
    res.gap = abs(res.objective - res.best_bound) / max(abs(res.objective), 1e-9)

    lines = []
    for (bid, d), var in x.items():
        q = int(round(var.solution_value()))
        if q > 0:
            lines.append(make_line(problem, bid, d, q))
    plan = Plan("optimizer", sort_lines(lines))
    transport = sum(problem.unit_cost(ln["batch_id"], ln["outlet_id"]) * ln["qty"] for ln in lines)
    short = plan.shortages(problem)
    res.objective_terms = {
        "transport_cost": transport,
        "shortage_penalty": sum(pi[p] * s for (_, p), s in short.items()),
        "fefo_term": sum(fefo_eps * r_b.get(ln["batch_id"], 0) * ln["qty"] for ln in lines),
        "floor_slack_penalty": sum(FLOOR_SLACK_MULTIPLIER * pi[k[1]] * s.solution_value() for k, s in slack.items()),
    }
    plan.solver = {"status": status, "objective": res.objective, "best_bound": res.best_bound, "gap": res.gap,
                   "solve_seconds": elapsed, "integer_variables": len(x), "constraints": solver.NumConstraints(),
                   "time_limit_s": time_limit_s, "backend": "OR-Tools pywraplp / SCIP"}
    res.plan = plan
    return res
