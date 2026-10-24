"""Health, modules, configuration and metrics endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from ortools.linear_solver import pywraplp

from app.api.common import metrics, ok, require_module
from app.config import get_settings
from app.database.connection import ping
from app.modules.config_loader import TEMPLATES, get_config, load_all_configs
from app.scenarios.definitions import list_scenarios

router = APIRouter(prefix="/api", tags=["system"])

# Where each rule template's enforcement is tested (shown in the configuration view).
RULE_TESTS = {
    "min_life_on_arrival": "tests/test_optimizer.py::test_min_life_rule_blocks_and_changes_plan",
    "storage_match": "tests/test_optimizer.py::test_storage_match_blocks_mismatch",
    "shortage_weight": "tests/test_optimizer.py::test_critical_weight_changes_objective",
    "fefo": "tests/test_optimizer.py::test_fefo_prefers_earlier_expiry_only_on_ties",
    "min_fill_floor": "tests/test_optimizer.py::test_equity_floor_lifts_low_fill_outlets",
}


@router.get("/health")
def health():
    db_ok, why = ping()
    s = get_settings()
    return ok({
        "status": "ok" if db_ok else "degraded",
        "mongodb": {"connected": db_ok, "database": s.mongodb_db, "detail": why,
                    "fallback": None if db_ok else "read-only synthetic snapshot; runs are not persisted"},
        "solver": {"scip": pywraplp.Solver.CreateSolver("SCIP") is not None,
                   "glop": pywraplp.Solver.CreateSolver("GLOP") is not None,
                   "time_limit_s": s.solver_time_limit_s},
        "environment": s.app_env, "version": "1.0.0",
    })


@router.get("/metrics")
def get_metrics():
    return ok(metrics.snapshot())


def _module_summary(cfg) -> dict:
    return {
        "industry": cfg.industry, "company": cfg.company, "company_name": cfg.company_name, "color": cfg.color,
        "display_name": cfg.display_name, "description": cfg.description,
        "destination_types": cfg.destination_types, "need_source": cfg.planning.need_source,
        "review_period_days": cfg.planning.review_period_days, "kpis": cfg.kpis,
        "rules": [{"id": r.id, "template": r.template, "status": r.status, "default_on": r.default_on,
                   "description": r.description} for r in cfg.rules],
    }


@router.get("/modules")
def modules():
    return ok([_module_summary(c) for c in load_all_configs().values()])


@router.get("/config/{module}")
def module_config(module: str):
    require_module(module)
    cfg = get_config(module)
    rules = []
    for r in cfg.rules:
        enforcement = {"active": "Active and enforced by the optimizer, baseline and independent checker"
                                 if r.template in ("min_life_on_arrival", "storage_match")
                                 else "Active and applied in the optimizer objective/constraints",
                       "planned": "Planned - not enforced", "unavailable": "Unavailable - required data missing"}[r.status]
        if r.status == "active" and not r.default_on:
            enforcement = "Implemented; optional per run (off by default)"
        rules.append({"id": r.id, "template": r.template, "status": r.status, "default_on": r.default_on,
                      "params": r.params.model_dump(exclude_none=True), "description": r.description,
                      "enforcement": enforcement, "test": RULE_TESTS.get(r.template)})
    return ok({**_module_summary(cfg), "rules": rules,
               "service_levels": cfg.service_levels.model_dump(), "templates": list(TEMPLATES),
               "disclaimer": "Thresholds are configurable design settings, not regulatory requirements. "
                             "No regulatory compliance is claimed."})


@router.get("/scenarios")
def scenarios():
    return ok(list_scenarios())
