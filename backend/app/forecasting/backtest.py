"""Rolling-origin backtest: 4 folds x 14 days over the last 56 history days (days 125-180)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.forecasting.models import MODEL_NAMES, forecast_with
from app.forecasting.series import SeriesData

N_FOLDS = 4
FOLD_DAYS = 14


def mae(y, f) -> float:
    return float(np.mean(np.abs(y - f)))


def rmse(y, f) -> float:
    return float(np.sqrt(np.mean((y - f) ** 2)))


def wape(y, f) -> float:
    denom = float(np.sum(np.abs(y)))
    return float(np.sum(np.abs(y - f)) / denom) if denom > 0 else float("nan")


def metrics(y, f) -> dict:
    return {"mae": mae(y, f), "rmse": rmse(y, f), "wape": wape(y, f)}


@dataclass
class BacktestResult:
    origins: list[int]                       # day index of each fold origin
    predictions: dict[str, np.ndarray]       # model -> (S, 56)
    actual: np.ndarray                       # (S, 56)
    expected: np.ndarray | None              # (S, 56) synthetic mu, if known
    metrics: dict[str, dict]                 # model -> {mae, rmse, wape, fold_wape}
    noise_floor: dict | None
    selected: str


def rolling_backtest(sd: SeriesData, models=tuple(MODEL_NAMES)) -> BacktestResult:
    T = sd.history_days
    origins = [T - FOLD_DAYS * (N_FOLDS - k) for k in range(N_FOLDS)]
    preds = {m: [] for m in models}
    for origin in origins:
        hist = sd.y[:, :origin]
        for m in models:
            preds[m].append(forecast_with(m, hist, FOLD_DAYS, sd))
    actual = sd.y[:, origins[0]:T]
    out = {}
    for m in models:
        P = np.concatenate(preds[m], axis=1)
        preds[m] = P
        out[m] = metrics(actual, P)
        out[m]["fold_wape"] = [wape(actual[:, k * FOLD_DAYS:(k + 1) * FOLD_DAYS],
                                    P[:, k * FOLD_DAYS:(k + 1) * FOLD_DAYS]) for k in range(N_FOLDS)]
    expected = sd.mu[:, origins[0]:T] if sd.mu is not None else None
    floor = metrics(actual, expected) if expected is not None else None
    selected = min(models, key=lambda m: (out[m]["wape"], list(MODEL_NAMES).index(m)))
    return BacktestResult(origins, preds, actual, expected, out, floor, selected)
