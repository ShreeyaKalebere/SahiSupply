"""Run orchestration (PRD 5.2 run flow).

validate -> load config + data -> fingerprint -> forecast -> net need -> eligibility ->
MILP + greedy baseline on identical inputs -> independent checker on both ->
rules-off diagnostic -> insights -> KPIs + explanations -> store run.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import date, datetime, timezone

from app.config import get_settings
from app.forecasting.service import ForecastResult, get_forecast
from app.inventory.eligibility import build_eligibility, evaluate_pair
from app.inventory.net_need import compute_need
from app.inventory.problem import NeedDetail, PlanningProblem, build_problem
from app.modules.config_loader import ModuleConfig, get_config
from app.modules.rules import ActiveRules, resolve_rules
from app.optimization import checker
from app.optimization.baseline import greedy_plan
from app.optimization.explanations import explain_plan
from app.optimization.insights import compute_insights
from app.optimization.model import SolveResult, solve
from app.optimization.plan import Plan
from app.optimization.regret import apply_plan, regret_report
from app.optimization.rescue import at_risk_batches, rescue_bonus
from app.scenarios.chaos import ChaosEdit, ChaosError, apply_chaos
from app.scenarios.custom import NetworkEdit, NetworkEditError, apply_network
from app.scenarios.definitions import SCENARIOS, apply_scenario
from app.services import data_service
from app.services.kpis import compare, compute_kpis, public_kpis

log = logging.getLogger("sahisupply.planner")

# Diagnostics (rules-off run, insight re-solves) get a shorter budget than the main plan;
# each reports its own solver status so a time-limited result is visible as FEASIBLE + gap.
DIAGNOSTIC_TIME_LIMIT_S = 3.0


class PlanningInputError(ValueError):
    pass


def prepare_problem(module: str, scenario_id: str, *, rule_toggles: dict[str, bool] | None = None,
                    contested_pattern: bool = True, dataset: dict | None = None, source: str | None = None,
                    forecast: ForecastResult | None = None,
                    network: NetworkEdit | None = None, chaos: ChaosEdit | None = None) -> tuple[PlanningProblem, dict]:
    cfg = get_config(module)
    try:
        rules = resolve_rules(cfg, rule_toggles)
    except ValueError as exc:
        raise PlanningInputError(str(exc)) from exc
    if dataset is None:
        dataset, source = data_service.get_dataset(module, contested_pattern)
    fc = forecast or get_forecast(dataset, module)
    sc = apply_scenario(dataset, scenario_id)
    network_summary = None
    if network is not None and not network.is_empty():
        try:
            network_summary = apply_network(sc.dataset, network)
        except NetworkEditError as exc:
            raise PlanningInputError(str(exc)) from exc
    chaos_summary = None
    if chaos is not None:
        try:
            chaos_summary, mult = apply_chaos(sc.dataset, chaos)
        except ChaosError as exc:
            raise PlanningInputError(str(exc)) from exc
        sc.demand_multipliers = {**sc.demand_multipliers, **mult}
    need = compute_need(sc.dataset, need_source=cfg.planning.need_source,
                        review_period_days=cfg.planning.review_period_days,
                        z_by_class=cfg.service_levels.model_dump(), forecast=fc,
                        demand_multipliers=sc.demand_multipliers)
    problem = build_problem(sc.dataset, module=module, scenario_id=scenario_id, rules=rules,
                            review_period_days=cfg.planning.review_period_days, need_detail=need,
                            data_source=source or "mongodb")
    return problem, {"scenario": sc, "forecast": fc, "config": cfg, "dataset": dataset, "network": network_summary,
                     "chaos": chaos_summary}


def problem_from_raw(raw: dict, need_detail: list[dict], rules_toggles_spec: dict, data_source: str) -> PlanningProblem:
    """Rebuild a PlanningProblem from a stored run (used by overrides)."""
    spec = raw["rules"]
    rules = ActiveRules(
        min_life_rule_id=rules_toggles_spec.get("min_life_rule_id"), min_life_days=spec["min_life_days"],
        min_life_pct=spec["min_life_pct"], storage_rule_id=rules_toggles_spec.get("storage_rule_id"),
        storage_classes=frozenset(spec["storage_classes"]), shortage_weights=spec["shortage_weights"],
        fefo=spec["fefo"], fill_floor_rule_id=rules_toggles_spec.get("fill_floor_rule_id"),
        fill_floor_pct=spec["fill_floor_pct"], fill_floor_classes=frozenset(spec["fill_floor_classes"]),
        enabled_ids=tuple(spec["enabled_ids"]))
    nd = {(n["outlet_id"], n["product_id"]): NeedDetail(**n) for n in need_detail}
    return PlanningProblem(
        module=raw["module"], scenario_id=raw["scenario_id"], planning_date=date.fromisoformat(raw["planning_date"]),
        review_period_days=raw["review_period_days"], rules=rules,
        warehouses={w["warehouse_id"]: w for w in raw["warehouses"]},
        outlets={o["outlet_id"]: o for o in raw["outlets"]},
        products={p["product_id"]: p for p in raw["products"]},
        batches={b["batch_id"]: b for b in raw["batches"]},
        routes={(r["warehouse_id"], r["outlet_id"]): r for r in raw["routes"]},
        need={k: v.need for k, v in nd.items()}, need_detail=nd, data_source=data_source)


def enrich_lines(problem: PlanningProblem, plan: Plan) -> list[dict]:
    out = []
    for ln in plan.lines:
        b = problem.batches[ln["batch_id"]]
        ev = evaluate_pair(problem, b, ln["outlet_id"])
        cost = problem.unit_cost(ln["batch_id"], ln["outlet_id"])
        out.append({**ln, "product_name": problem.products[ln["product_id"]]["name"],
                    "outlet_name": problem.outlets[ln["outlet_id"]]["name"],
                    "warehouse_name": problem.warehouses[ln["warehouse_id"]]["name"],
                    "expiry_date": b["expiry_date"], "unit_cost": cost, "line_cost": cost * ln["qty"],
                    "lead_time_days": ev.lead_time_days, "life_on_arrival_days": ev.life_on_arrival,
                    "life_on_arrival_pct": ev.life_on_arrival_pct,
                    "criticality": problem.products[ln["product_id"]]["criticality"]})
    return out


def allocation_rows(problem: PlanningProblem, plan: Plan, check_valid: bool) -> list[dict]:
    by_pair: dict[tuple[str, str], list[dict]] = {}
    for ln in enrich_lines(problem, plan):
        by_pair.setdefault((ln["outlet_id"], ln["product_id"]), []).append(ln)
    rows = []
    for (d, p), q in sorted(problem.need.items(), key=lambda kv: (int(kv[0][0][1:]), kv[0][1])):
        if q <= 0:
            continue
        lines = by_pair.get((d, p), [])
        alloc = sum(ln["qty"] for ln in lines)
        rows.append({
            "outlet_id": d, "outlet_name": problem.outlets[d]["name"], "outlet_type": problem.outlets[d]["type"],
            "region": problem.outlets[d]["region"], "product_id": p, "product_name": problem.products[p]["name"],
            "criticality": problem.products[p]["criticality"], "required": q, "allocated": alloc, "unmet": q - alloc,
            "transport_cost": sum(ln["line_cost"] for ln in lines),
            "sources": [{k: ln[k] for k in ("batch_id", "warehouse_id", "qty", "unit_cost", "line_cost",
                                            "life_on_arrival_days", "life_on_arrival_pct", "expiry_date",
                                            "lead_time_days")} for ln in lines],
            "validation": "valid" if check_valid else "invalid",
        })
    return rows


def evaluate_plan(problem: PlanningProblem, plan: Plan, fp: str, reference_rules: ActiveRules | None = None) -> dict:
    k = compute_kpis(problem, plan, reference_rules)
    pub = public_kpis(k)
    reported = {key: pub[key] for key in ("need_units", "delivered_units", "unmet_units", "critical_shortage_units",
                                          "transport_cost", "gross_margin_delivered", "fill_rate")}
    chk = checker.check_plan(problem.raw_inputs(), plan.lines, expected_fingerprint=fp, reported=reported)
    if not chk.valid:
        log.error("checker rejected %s plan: %s", plan.method, [v.as_dict() for v in chk.violations[:5]])
    return {"kpis_full": k, "kpis": pub, "check": chk.as_dict()}


_s0_cache: dict[str, Plan] = {}
_s0_lock = threading.Lock()


def run_plan(module: str, scenario_id: str = "S0", *, rule_toggles: dict[str, bool] | None = None,
             contested_pattern: bool = True, include_insights: bool = True, include_regret: bool = True,
             time_limit_s: float | None = None, network: NetworkEdit | None = None,
             chaos: ChaosEdit | None = None, rescue: bool = False) -> dict:
    t_all = time.perf_counter()
    timings: dict[str, float] = {}
    if scenario_id not in SCENARIOS:
        raise PlanningInputError(f"unknown scenario {scenario_id!r}")
    time_limit_s = time_limit_s or get_settings().solver_time_limit_s

    t = time.perf_counter()
    problem, ctx = prepare_problem(module, scenario_id, rule_toggles=rule_toggles, contested_pattern=contested_pattern,
                                   network=network, chaos=chaos)
    cfg: ModuleConfig = ctx["config"]
    fc: ForecastResult = ctx["forecast"]
    timings["forecast_and_need"] = time.perf_counter() - t
    fp = problem.fingerprint()

    t = time.perf_counter()
    elig = build_eligibility(problem)
    bonus = rescue_bonus(problem) if rescue else None
    opt_res: SolveResult = solve(problem, elig, time_limit_s=time_limit_s, rescue=bonus)
    timings["optimizer"] = time.perf_counter() - t
    t = time.perf_counter()
    base_plan = greedy_plan(problem, elig)
    timings["baseline"] = time.perf_counter() - t

    t = time.perf_counter()
    base_eval = evaluate_plan(problem, base_plan, fp)
    opt_eval = evaluate_plan(problem, opt_res.plan, fp) if opt_res.plan else None
    timings["checker_and_kpis"] = time.perf_counter() - t

    if opt_res.plan is None:
        status = "SOLVER_FAILED"
    else:
        status = "VALID" if opt_eval["check"]["valid"] else "INVALID"

    # Rules-off diagnostic (not the fair baseline): what do the blocking rules prevent?
    rules_off = None
    if problem.rules.min_life_rule_id or problem.rules.storage_rule_id:
        t = time.perf_counter()
        off_problem = problem.with_rules(problem.rules.blocking_off())
        off_res = solve(off_problem, time_limit_s=min(DIAGNOSTIC_TIME_LIMIT_S, time_limit_s))
        if off_res.plan:
            off_eval = evaluate_plan(off_problem, off_res.plan, off_problem.fingerprint(), reference_rules=problem.rules)
            rules_off = {"disabled_rules": list(off_problem.rules.disabled_ids), "kpis": off_eval["kpis"],
                         "solver_status": off_res.status, "solver_gap": off_res.gap, "checker_valid_under_relaxed_rules": off_eval["check"]["valid"],
                         "note": "Diagnostic only: the same optimizer with shelf-life and storage rules switched off. "
                                 "blocked_units_shipped counts units that would break the real rules."}
        timings["rules_off"] = time.perf_counter() - t

    equity = None
    if problem.rules.fill_floor_pct is not None and opt_res.plan:
        t = time.perf_counter()
        nofloor = problem.with_rules(ActiveRules(**{**problem.rules.__dict__, "fill_floor_pct": None,
                                                    "fill_floor_rule_id": None, "fill_floor_classes": frozenset()}))
        nf = solve(nofloor, time_limit_s=time_limit_s)
        if nf.plan:
            nf_k = compute_kpis(problem, nf.plan)
            on_k = opt_eval["kpis_full"]
            floor = problem.rules.fill_floor_pct / 100.0

            def below(plan_k):
                rows = []
                for (d, p), q in problem.need.items():
                    if q > 0 and problem.products[p]["criticality"] in problem.rules.fill_floor_classes:
                        fill = 1 - plan_k["_shortage_by_pair"][(d, p)] / q
                        if fill < floor - 1e-9:
                            rows.append({"outlet_id": d, "product_id": p, "fill": fill})
                return rows
            equity = {"floor_pct": problem.rules.fill_floor_pct, "classes": sorted(problem.rules.fill_floor_classes),
                      "cost_of_fairness": on_k["transport_cost"] - nf_k["transport_cost"],
                      "net_margin_change": on_k["net_margin"] - nf_k["net_margin"],
                      "fill_rate_on": on_k["fill_rate"], "fill_rate_off": nf_k["fill_rate"],
                      "critical_shortage_on": on_k["critical_shortage_units"],
                      "critical_shortage_off": nf_k["critical_shortage_units"],
                      "below_floor_on": below(on_k), "below_floor_off": below(nf_k),
                      "note": "Cost of fairness = delivery cost with the guardrail minus without it. "
                              "The floor is soft: it cannot be met where eligible supply is insufficient."}
        timings["equity"] = time.perf_counter() - t

    insights = None
    if include_insights and opt_res.plan:
        t = time.perf_counter()
        insights = compute_insights(problem, opt_res.plan, time_limit_s=min(DIAGNOSTIC_TIME_LIMIT_S, time_limit_s))
        timings["insights"] = time.perf_counter() - t

    regret = None
    if include_regret and scenario_id != "S0" and opt_res.plan:
        t = time.perf_counter()
        key = (f"{module}|{contested_pattern}|{sorted((rule_toggles or {}).items())}|"
               f"{ctx['dataset']['meta'].get('dataset_sha256')}|{network.as_dict() if network else None}")
        with _s0_lock:
            s0_plan = _s0_cache.get(key)
        if s0_plan is None:
            s0_problem, _ = prepare_problem(module, "S0", rule_toggles=rule_toggles, contested_pattern=contested_pattern,
                                            dataset=ctx["dataset"], source=problem.data_source, forecast=fc,
                                            network=network)
            s0 = solve(s0_problem, time_limit_s=time_limit_s)
            s0_plan = s0.plan
            with _s0_lock:
                _s0_cache[key] = s0_plan
        if s0_plan is not None:
            applied, adjust = apply_plan(s0_plan, problem)
            applied_eval = evaluate_plan(problem, applied, fp)
            if applied_eval["check"]["valid"]:
                regret = regret_report(problem, applied_eval["kpis_full"], opt_eval["kpis_full"], adjust)
            else:
                regret = {"error": "applied S0 plan failed the checker", "check": applied_eval["check"]}
        timings["regret"] = time.perf_counter() - t

    t = time.perf_counter()
    explanations = explain_plan(problem, elig, opt_res.plan) if opt_res.plan else []
    timings["explanations"] = time.perf_counter() - t
    timings["total"] = time.perf_counter() - t_all

    sc = ctx["scenario"]
    run = {
        "plan_id": f"PLN-{uuid.uuid4().hex[:10].upper()}",
        "created_at": datetime.now(timezone.utc),
        "module": module, "module_name": cfg.display_name, "need_source": cfg.planning.need_source,
        "scenario_id": scenario_id,
        "scenario": {"id": scenario_id, **SCENARIOS[scenario_id], "assumptions": sc.assumptions, "changes": sc.changes},
        "contested_pattern": contested_pattern,
        "network": ({"edit": network.as_dict(), "summary": ctx["network"]}
                    if network is not None and not network.is_empty() else None),
        "chaos": ctx["chaos"],
        "rescue": ({"rescue_batches": sorted(bonus), "note": "Optimizer rewarded each unit shipped from an at-risk batch by "
                    "its unit cost (the write-off avoided). Demand, capacity, road, shelf-life and storage rules unchanged."}
                   if rescue else None),
        "at_risk": at_risk_batches(problem),
        "rule_toggles": rule_toggles or {},
        "rules_enforced": list(problem.rules.enabled_ids),
        "rules_disabled": list(problem.rules.disabled_ids),
        "rules_spec_ids": {"min_life_rule_id": problem.rules.min_life_rule_id,
                           "storage_rule_id": problem.rules.storage_rule_id,
                           "fill_floor_rule_id": problem.rules.fill_floor_rule_id},
        "data_source": problem.data_source,
        "synthetic_data": True,
        "planning_date": problem.planning_date.isoformat(),
        "review_period_days": problem.review_period_days,
        "fingerprint": fp,
        "dataset_sha256": ctx["dataset"]["meta"].get("dataset_sha256"),
        "forecast": {k: v for k, v in fc.metrics_payload().items() if k in
                     ("selected_model", "selected_label", "models", "noise_floor", "target", "evaluation")},
        "status": status,
        "plan_status": status,
        "version": 1,
        "optimizer": None if opt_res.plan is None else {
            "solver": opt_res.plan.solver, "objective_terms": opt_res.objective_terms, "penalty": opt_res.penalty,
            "kpis": opt_eval["kpis"], "check": opt_eval["check"], "lines": enrich_lines(problem, opt_res.plan),
            "fingerprint": fp,
        },
        "optimizer_error": None if opt_res.plan else {"status": opt_res.status,
                                                       "message": "The solver returned no feasible plan; no optimized "
                                                                  "plan is shown. The labelled baseline remains available."},
        "baseline": {"solver": base_plan.solver, "kpis": base_eval["kpis"], "check": base_eval["check"],
                     "lines": enrich_lines(problem, base_plan), "fingerprint": fp},
        "fairness": {"same_fingerprint": True, "fingerprint": fp,
                     "note": "Both plans were computed from the identical scenario-applied inputs and rules."},
        "comparison": compare(problem, opt_eval["kpis_full"], base_eval["kpis_full"]) if opt_eval else None,
        "rules_off": rules_off, "equity": equity, "regret": regret, "insights": insights,
        "explanations": explanations,
        "allocation": allocation_rows(problem, opt_res.plan, status == "VALID") if opt_res.plan else [],
        "need_detail": [v.as_dict() for v in problem.need_detail.values()],
        "raw_inputs": problem.raw_inputs(),
        "overrides": [],
        "timings": timings,
    }
    log.info("plan %s module=%s scenario=%s status=%s solver=%s gap=%s total=%.2fs", run["plan_id"], module,
             scenario_id, status, opt_res.status, opt_res.gap, timings["total"])
    return run
