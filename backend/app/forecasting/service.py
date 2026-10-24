"""Forecast service: backtest, model selection, final horizon forecast and sigma per series."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np

from app.forecasting.backtest import BacktestResult, rolling_backtest
from app.forecasting.models import MODEL_NAMES, forecast_with
from app.forecasting.series import SeriesData, build_series
from app.utils.fingerprint import fingerprint

SIGMA_FLOOR = 1.0


@dataclass
class ForecastResult:
    module: str
    history_fingerprint: str
    series: SeriesData
    backtest: BacktestResult
    selected: str
    forecast: np.ndarray        # (S, horizon) from the planning date
    sigma: np.ndarray           # (S,) std of daily backtest errors of the selected model, floored at 1
    train_seconds: float

    def index(self) -> dict[tuple[str, str], int]:
        return {k: i for i, k in enumerate(self.series.keys)}

    def metrics_payload(self) -> dict:
        bt = self.backtest
        sd = self.series
        ws = bt.metrics["seasonal_naive"]["wape"]
        models = []
        for m, v in bt.metrics.items():
            models.append({
                "model": m, "label": MODEL_NAMES[m], "mae": v["mae"], "rmse": v["rmse"], "wape": v["wape"],
                "fold_wape": v["fold_wape"],
                "wape_vs_seasonal_naive_pct": (100.0 * (ws - v["wape"]) / ws) if ws else None,
            })
        sel = bt.metrics[self.selected]["wape"]
        improvement = 100.0 * (ws - sel) / ws if ws else None
        return {
            "module": self.module,
            "selected_model": self.selected,
            "selected_label": MODEL_NAMES[self.selected],
            "models": models,
            "noise_floor": bt.noise_floor,
            "noise_floor_note": "Noise floor = error of a forecaster that knew the generator's true expected demand. "
                                "Only available because the evaluation data is synthetic.",
            "target": {"description": ">= 10% lower WAPE than seasonal naive",
                       "achieved": bool(improvement is not None and improvement >= 10.0),
                       "improvement_pct": improvement},
            "evaluation": {
                "method": "rolling origin, 4 folds x 14 days",
                "start": sd.dates[bt.origins[0]].isoformat(),
                "end": sd.dates[sd.history_days - 1].isoformat(),
                "fold_origins": [sd.dates[o].isoformat() for o in bt.origins],
                "series": len(sd.keys),
            },
            "history_fingerprint": self.history_fingerprint,
            "train_seconds": round(self.train_seconds, 2),
        }


def run_forecast(dataset: dict, module: str) -> ForecastResult:
    t0 = time.perf_counter()
    sd = build_series(dataset)
    bt = rolling_backtest(sd)
    fc = forecast_with(bt.selected, sd.y, sd.horizon_days, sd)
    err = bt.actual - bt.predictions[bt.selected]
    sigma = np.maximum(err.std(axis=1), SIGMA_FLOOR)
    return ForecastResult(module, history_fingerprint(dataset), sd, bt, bt.selected, fc, sigma,
                          time.perf_counter() - t0)


def history_fingerprint(dataset: dict) -> str:
    return fingerprint({
        "meta": {k: dataset["meta"].get(k) for k in ("module", "seed", "planning_date", "history_days")},
        "n": len(dataset["demand_history"]),
        "sum": int(sum(r["qty"] for r in dataset["demand_history"])),
        "calendar": dataset["calendar"],
    })


_cache: dict[str, ForecastResult] = {}
_lock = threading.Lock()


def get_forecast(dataset: dict, module: str, *, refresh: bool = False) -> ForecastResult:
    """Cached by a fingerprint of the demand history, so a scenario change re-uses the trained model."""
    key = f"{module}:{history_fingerprint(dataset)}"
    with _lock:
        if not refresh and key in _cache:
            return _cache[key]
    result = run_forecast(dataset, module)
    with _lock:
        _cache[key] = result
    return result
