"""Optimization runs, overrides and forecast metrics persistence."""
from __future__ import annotations

from pymongo import DESCENDING
from pymongo.database import Database

SUMMARY_FIELDS = {"_id": 0, "plan_id": 1, "created_at": 1, "module": 1, "scenario": 1, "scenario_id": 1, "status": 1,
                  "plan_status": 1, "fingerprint": 1, "contested_pattern": 1, "rules_enforced": 1, "data_source": 1,
                  "version": 1, "optimizer.solver": 1, "optimizer.kpis.fill_rate": 1,
                  "optimizer.kpis.unmet_units": 1, "optimizer.kpis.transport_cost": 1,
                  "optimizer.kpis.critical_shortage_units": 1, "optimizer.check.valid": 1,
                  "optimizer.check.violation_count": 1, "baseline.kpis.fill_rate": 1, "baseline.check.valid": 1,
                  "comparison.fill_rate_pp": 1, "timings.total": 1}


def save_run(db: Database, run: dict) -> None:
    db.optimization_runs.replace_one({"plan_id": run["plan_id"]}, run, upsert=True)


def get_run(db: Database, plan_id: str) -> dict | None:
    return db.optimization_runs.find_one({"plan_id": plan_id}, {"_id": 0})


def list_runs(db: Database, module: str | None = None, limit: int = 50) -> list[dict]:
    q = {"module": module} if module else {}
    return list(db.optimization_runs.find(q, SUMMARY_FIELDS).sort("created_at", DESCENDING).limit(limit))


def save_override(db: Database, doc: dict) -> None:
    db.plan_overrides.insert_one(dict(doc))


def list_overrides(db: Database, plan_id: str) -> list[dict]:
    return list(db.plan_overrides.find({"plan_id": plan_id}, {"_id": 0}).sort("created_at", 1))


def save_forecast_metrics(db: Database, doc: dict) -> None:
    db.forecast_runs.replace_one({"module": doc["module"], "history_fingerprint": doc["history_fingerprint"]},
                                 doc, upsert=True)
