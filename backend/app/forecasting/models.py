"""Forecasting models. Each takes history up to an origin and returns an (S, h) forecast.

No model ever reads data at or after the origin except known-in-advance
calendar flags (planned promotions and the festival calendar).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from app.forecasting.series import SeriesData

MODEL_NAMES = {
    "seasonal_naive": "Seasonal naive (same weekday last week)",
    "moving_average_28": "28-day moving average",
    "gradient_boosting": "Gradient boosting (lags 7/14/21/28, weekday, promo, festival, IDs)",
}


def seasonal_naive(y: np.ndarray, h: int) -> np.ndarray:
    """y(T+k) = y(T+k-7*ceil(k/7)): repeat the last observed week."""
    last_week = y[:, -7:]
    reps = int(np.ceil(h / 7))
    return np.tile(last_week, reps)[:, :h].astype(float)


def moving_average(y: np.ndarray, h: int, window: int = 28) -> np.ndarray:
    return np.repeat(y[:, -window:].mean(axis=1, keepdims=True), h, axis=1)


LAGS = (7, 14, 21, 28)
MIN_HISTORY = 35


class GradientBoostingForecaster:
    """One global HistGradientBoostingRegressor per industry, forecasting recursively in 7-day blocks.

    All lag features are >= 7 days, so days 1-7 of the horizon use only observed
    data and days 8-14 use the model's own days 1-7 forecast (no leakage).
    """

    def __init__(self, random_state: int = 42):
        self.model = HistGradientBoostingRegressor(
            loss="poisson", learning_rate=0.06, max_iter=250, max_leaf_nodes=31,
            min_samples_leaf=30, l2_regularization=1.0, categorical_features=[9, 10],
            random_state=random_state,
        )

    @staticmethod
    def _features(ext: np.ndarray, t: np.ndarray, s_idx: np.ndarray, sd: SeriesData) -> np.ndarray:
        """Feature rows for (series s_idx[i], day t[i]); ext holds history (+ forecasts) per series."""
        lags = [ext[s_idx, t - L] for L in LAGS]
        win = np.stack([ext[s_idx, t - 7 - k] for k in range(28)], axis=1).mean(axis=1)
        p_idx = sd.product_idx[s_idx]
        o_idx = sd.outlet_idx[s_idx]
        return np.column_stack([
            *lags,                                  # 0-3
            win,                                    # 4: 28-day mean ending 7 days ago
            sd.dow[t],                              # 5
            sd.promo[p_idx, t],                     # 6
            sd.festival[t],                         # 7
            sd.promo[p_idx, t - 7] | sd.festival[t - 7],  # 8: was lag-7 inflated?
            o_idx,                                  # 9 (categorical)
            p_idx,                                  # 10 (categorical)
            t / max(sd.history_days, 1),            # 11 trend
        ]).astype(float)

    def fit(self, y: np.ndarray, sd: SeriesData) -> "GradientBoostingForecaster":
        S, T = y.shape
        tt, ss = np.meshgrid(np.arange(MIN_HISTORY, T), np.arange(S))
        tt, ss = tt.ravel(), ss.ravel()
        X = self._features(y, tt, ss, sd)
        self.model.fit(X, y[ss, tt])
        return self

    def predict(self, y: np.ndarray, h: int, sd: SeriesData) -> np.ndarray:
        S, T = y.shape
        ext = np.concatenate([y.astype(float), np.zeros((S, h))], axis=1)
        for block in range(0, h, 7):
            days = np.arange(T + block, T + min(block + 7, h))
            tt, ss = np.meshgrid(days, np.arange(S))
            tt, ss = tt.ravel(), ss.ravel()
            pred = np.clip(self.model.predict(self._features(ext, tt, ss, sd)), 0, None)
            ext[ss, tt] = pred
        return ext[:, T:T + h]


def forecast_with(name: str, y: np.ndarray, h: int, sd: SeriesData) -> np.ndarray:
    if name == "seasonal_naive":
        return seasonal_naive(y, h)
    if name == "moving_average_28":
        return moving_average(y, h)
    if name == "gradient_boosting":
        return GradientBoostingForecaster().fit(y, sd).predict(y, h, sd)
    raise ValueError(name)
