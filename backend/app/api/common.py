"""Shared API helpers: response envelope, error type, module validation, in-process metrics."""
from __future__ import annotations

import threading

from fastapi import HTTPException

from app.modules.config_loader import load_all_configs


def ok(data, **meta) -> dict:
    return {"data": data, "meta": {"synthetic_data": True, **meta}}


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str, details=None):
        super().__init__(status_code=status, detail={"code": code, "message": message, "details": details})


def require_module(module: str) -> str:
    if module not in load_all_configs():
        raise ApiError(404, "UNKNOWN_MODULE", f"Unknown module '{module}'",
                       {"available": sorted(load_all_configs())})
    return module


class Metrics:
    def __init__(self):
        self._lock = threading.Lock()
        self.counters = {"runs": 0, "runs_valid": 0, "runs_invalid": 0, "solver_failures": 0,
                         "checker_violations": 0, "overrides_accepted": 0, "overrides_rejected": 0,
                         "snapshot_fallbacks": 0}
        self.solve_seconds: list[float] = []

    def inc(self, key: str, n: int = 1):
        with self._lock:
            self.counters[key] = self.counters.get(key, 0) + n

    def solve(self, s: float):
        with self._lock:
            self.solve_seconds = (self.solve_seconds + [s])[-500:]

    def snapshot(self) -> dict:
        with self._lock:
            xs = sorted(self.solve_seconds)
        pct = (lambda q: xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None)
        return {**self.counters, "solve_seconds_p50": pct(0.5), "solve_seconds_p95": pct(0.95), "solves": len(xs)}


metrics = Metrics()
