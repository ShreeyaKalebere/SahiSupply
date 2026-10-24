import copy

import numpy as np
import pytest

from app.forecasting.backtest import mae, rmse, rolling_backtest, wape
from app.forecasting.models import GradientBoostingForecaster, moving_average, seasonal_naive
from app.forecasting.series import build_series
from app.forecasting.service import run_forecast


def test_metric_formulas_hand_calculated():
    y = np.array([10.0, 0.0, 5.0, 5.0])
    f = np.array([8.0, 1.0, 5.0, 9.0])
    assert mae(y, f) == pytest.approx((2 + 1 + 0 + 4) / 4)
    assert rmse(y, f) == pytest.approx(np.sqrt((4 + 1 + 0 + 16) / 4))
    assert wape(y, f) == pytest.approx(7 / 20)


def test_seasonal_naive_and_moving_average():
    y = np.arange(28, dtype=float)[None, :]
    sn = seasonal_naive(y, 10)
    assert list(sn[0, :7]) == list(range(21, 28)) and list(sn[0, 7:10]) == [21, 22, 23]
    assert moving_average(y, 3)[0].tolist() == [13.5, 13.5, 13.5]


def test_backtest_uses_4_folds_of_14_days_over_days_125_to_180(datasets):
    sd = build_series(datasets["grocery"])
    bt = rolling_backtest(sd, models=("seasonal_naive", "moving_average_28"))
    assert bt.origins == [124, 138, 152, 166]          # 0-indexed day 124 = day 125 (1-indexed)
    assert bt.actual.shape == (180, 56)


def test_no_future_leakage(datasets):
    """Changing demand after a fold origin must not change that fold's predictions."""
    ds = datasets["pharmacy"]
    sd = build_series(ds)
    origin = 124
    hist = sd.y[:, :origin]
    gb = GradientBoostingForecaster().fit(hist, sd)
    p1 = gb.predict(hist, 14, sd)
    sd2 = copy.deepcopy(sd)
    sd2.y[:, origin:] = sd2.y[:, origin:] * 10 + 100
    gb2 = GradientBoostingForecaster().fit(sd2.y[:, :origin], sd2)
    p2 = gb2.predict(sd2.y[:, :origin], 14, sd2)
    assert np.allclose(p1, p2)


def test_model_selection_is_lowest_wape_and_noise_floor_reported(datasets):
    fc = run_forecast(datasets["cosmetics"], "cosmetics")
    m = fc.backtest.metrics
    assert fc.selected == min(m, key=lambda k: m[k]["wape"])
    payload = fc.metrics_payload()
    assert payload["noise_floor"] is not None
    assert payload["noise_floor"]["wape"] <= min(v["wape"] for v in m.values()) + 1e-9
    assert (fc.sigma >= 1.0).all()
    assert fc.forecast.shape == (180, 14) and (fc.forecast >= 0).all()
