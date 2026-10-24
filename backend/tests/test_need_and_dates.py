import math
from datetime import date

import numpy as np
import pytest

from app.inventory.eligibility import life_on_arrival_days
from app.inventory.net_need import compute_need, forecast_need, shortest_lead_times, usable_on_hand

PD = date(2026, 10, 26)


def test_life_on_arrival_arithmetic():
    assert life_on_arrival_days("2026-10-31", PD, 2) == 3          # 5 days to expiry - 2 lead
    assert life_on_arrival_days("2026-10-26", PD, 1) == -1
    assert life_on_arrival_days("2027-01-24", PD, 3) == 87          # 90 days - 3 -> blocked by C1 (90)
    assert life_on_arrival_days("2026-11-30", PD, 0) == 35          # crosses month boundary


def test_usable_on_hand_excludes_stock_expiring_within_horizon():
    assert usable_on_hand(10, "2026-11-05", PD, 9) == 10   # 10 days left > 9
    assert usable_on_hand(10, "2026-11-04", PD, 9) == 0    # 9 days left is not > 9
    assert usable_on_hand(10, "2026-10-20", PD, 9) == 0    # already expired


# Three hand-calculated forecast-mode fixtures: (forecast, sigma, z, R+L, U) -> q
@pytest.mark.parametrize("f,s,z,h,u,expected", [
    (70.0, 2.0, 1.28, 8, 10, math.ceil(70 + 1.28 * 2 * math.sqrt(8) - 10)),   # 67.24 -> 68
    (20.0, 1.0, 2.05, 9, 40, 0),                                              # covered by on-hand
    (100.0, 5.0, 1.65, 10, 0, math.ceil(100 + 1.65 * 5 * math.sqrt(10))),    # 126.09 -> 127
])
def test_forecast_need_fixtures(f, s, z, h, u, expected):
    assert forecast_need(f, s, z, h, u) == expected


def _mini_dataset(need_source="forecast"):
    return {
        "meta": {"planning_date": PD.isoformat()},
        "warehouses": [{"warehouse_id": "W1", "status": "operational"}, {"warehouse_id": "W2", "status": "closed"}],
        "outlets": [{"outlet_id": "D1"}, {"outlet_id": "D2"}],
        "products": [{"product_id": "P01", "criticality": "standard"}, {"product_id": "P02", "criticality": "critical"}],
        "routes": [
            {"warehouse_id": "W1", "outlet_id": "D1", "lead_time_days": 2, "open": True},
            {"warehouse_id": "W2", "outlet_id": "D1", "lead_time_days": 1, "open": True},   # warehouse closed
            {"warehouse_id": "W1", "outlet_id": "D2", "lead_time_days": 3, "open": False},
            {"warehouse_id": "W2", "outlet_id": "D2", "lead_time_days": 4, "open": True},
        ],
        "outlet_inventory": [{"outlet_id": "D1", "product_id": "P01", "quantity": 5, "expiry_date": "2027-01-01"},
                             {"outlet_id": "D1", "product_id": "P02", "quantity": 50, "expiry_date": "2026-10-30"}],
        "open_orders": [{"outlet_id": "D1", "product_id": "P01", "quantity": 12},
                        {"outlet_id": "D2", "product_id": "P02", "quantity": 7},
                        {"outlet_id": "D1", "product_id": "P02", "quantity": 0}],
    }


class _FC:
    def __init__(self):
        self.forecast = np.full((4, 14), 2.0)
        self.sigma = np.array([1.0, 1.5, 2.0, 1.0])

    def index(self):
        return {("D1", "P01"): 0, ("D1", "P02"): 1, ("D2", "P01"): 2, ("D2", "P02"): 3}


def test_shortest_lead_time_ignores_closed_warehouses_and_routes():
    leads = shortest_lead_times(_mini_dataset())
    # D1: W2's 1-day route is unusable (warehouse closed) -> 2.
    # D2: no open route from an operational warehouse -> falls back to the shortest route of any status (3).
    assert leads == {"D1": 2, "D2": 3}


def test_forecast_mode_need_hand_calculated():
    ds = _mini_dataset()
    need = compute_need(ds, need_source="forecast", review_period_days=7,
                        z_by_class={"standard": 1.28, "critical": 2.05}, forecast=_FC())
    # D1/P01: H = 7 + 2 = 9, forecast 18, safety 1.28*1*3 = 3.84, U = 5 -> ceil(16.84) = 17
    assert need[("D1", "P01")].need == 17
    # D1/P02: on-hand expires in 4 days (<= 9) -> U = 0; 18 + 2.05*1.5*3 = 27.225 -> 28
    assert need[("D1", "P02")].need == 28 and need[("D1", "P02")].usable_on_hand == 0
    # D2/P02: H = 7 + 3 = 10, 20 + 2.05*1*sqrt(10) = 26.48 -> 27
    assert need[("D2", "P02")].need == 27


def test_orders_mode_need_equals_open_orders_and_applies_uplift():
    ds = _mini_dataset("orders")
    need = compute_need(ds, need_source="orders", review_period_days=7,
                        z_by_class={"standard": 1.28, "critical": 1.28}, forecast=None)
    assert need[("D1", "P01")].need == 12
    assert need[("D2", "P02")].need == 7
    assert need[("D1", "P02")].need == 0
    up = compute_need(ds, need_source="orders", review_period_days=7, z_by_class={"standard": 1.28, "critical": 1.28},
                      demand_multipliers={("D1", "P01"): 1.4})
    assert up[("D1", "P01")].need == math.ceil(12 * 1.4)   # 16.8 -> 17
