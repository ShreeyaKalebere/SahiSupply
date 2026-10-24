"""Run persistence: MongoDB first; if it is down, an in-memory store flagged persisted=False."""
from __future__ import annotations

import copy
import logging
import threading

from pymongo.errors import PyMongoError

from app.database.connection import get_db, ping
from app.database.repositories import runs_repo

log = logging.getLogger("sahisupply.runs")
_memory: dict[str, dict] = {}
_mem_overrides: dict[str, list[dict]] = {}
_lock = threading.Lock()


def save(run: dict) -> dict:
    ok, _ = ping()
    if ok:
        try:
            run["persisted"] = True
            runs_repo.save_run(get_db(), copy.deepcopy(run))
            return run
        except PyMongoError as exc:
            log.error("failed to persist run %s: %s", run["plan_id"], exc)
    run["persisted"] = False
    with _lock:
        _memory[run["plan_id"]] = run
    return run


def get(plan_id: str) -> dict | None:
    with _lock:
        if plan_id in _memory:
            return _memory[plan_id]
    ok, _ = ping()
    if ok:
        try:
            return runs_repo.get_run(get_db(), plan_id)
        except PyMongoError:
            return None
    return None


def history(module: str | None, limit: int) -> tuple[list[dict], str]:
    ok, _ = ping()
    rows: list[dict] = []
    source = "unavailable"
    if ok:
        try:
            rows = runs_repo.list_runs(get_db(), module, limit)
            source = "mongodb"
        except PyMongoError:
            pass
    with _lock:
        mem = [r for r in _memory.values() if not module or r["module"] == module]
    for r in mem:
        rows.append({k: r.get(k) for k in ("plan_id", "created_at", "module", "scenario", "scenario_id", "status",
                                           "plan_status", "fingerprint", "contested_pattern", "data_source", "version")}
                    | {"optimizer": {"kpis": r["optimizer"]["kpis"] if r.get("optimizer") else None,
                                     "solver": r["optimizer"]["solver"] if r.get("optimizer") else None,
                                     "check": r["optimizer"]["check"] if r.get("optimizer") else None},
                       "baseline": {"kpis": r["baseline"]["kpis"]}, "persisted": False})
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return rows[:limit], source


def record_override(doc: dict) -> bool:
    ok, _ = ping()
    if ok:
        try:
            runs_repo.save_override(get_db(), doc)
            return True
        except PyMongoError as exc:
            log.error("failed to persist override: %s", exc)
    with _lock:
        _mem_overrides.setdefault(doc["plan_id"], []).append(doc)
    return False


def overrides(plan_id: str) -> list[dict]:
    ok, _ = ping()
    rows = []
    if ok:
        try:
            rows = runs_repo.list_overrides(get_db(), plan_id)
        except PyMongoError:
            pass
    with _lock:
        rows += _mem_overrides.get(plan_id, [])
    return rows
