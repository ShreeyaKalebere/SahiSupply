"""User-built networks: removing warehouses/stores and opening/closing roads really changes the plan."""
import pytest

from app.inventory.eligibility import build_eligibility
from app.optimization.checker import check_plan
from app.optimization.model import solve
from app.scenarios.custom import NetworkEdit
from app.services.planner import PlanningInputError, prepare_problem


def _solve(datasets, edit, module="pharmacy"):
    pb, ctx = prepare_problem(module, "S0", dataset=datasets[module], source="test", network=edit)
    plan = solve(pb, build_eligibility(pb)).plan
    assert check_plan(pb.raw_inputs(), plan.lines, expected_fingerprint=pb.fingerprint()).valid
    return pb, ctx, plan


def test_removing_a_warehouse_removes_its_stock_and_shipments(datasets):
    pb, ctx, plan = _solve(datasets, NetworkEdit(warehouses=["W1", "W2", "W3"]))
    assert set(pb.warehouses) == {"W1", "W2", "W3"}
    assert all(b["warehouse_id"] in {"W1", "W2", "W3"} for b in pb.batches.values())
    assert all(ln["warehouse_id"] in {"W1", "W2", "W3"} for ln in plan.lines)
    assert ctx["network"]["warehouses_removed"] == ["W4", "W5"]


def test_removing_stores_drops_their_need(datasets):
    pb, _, plan = _solve(datasets, NetworkEdit(outlets=["D1", "D2", "D9"]))
    assert {d for d, _ in pb.need} == {"D1", "D2", "D9"}
    assert {ln["outlet_id"] for ln in plan.lines} <= {"D1", "D2", "D9"}


def test_closing_a_used_road_moves_the_shipment(datasets):
    _, _, base = _solve(datasets, None)
    used = max({f"{ln['warehouse_id']}-{ln['outlet_id']}" for ln in base.lines},
               key=lambda r: sum(ln["qty"] for ln in base.lines if f"{ln['warehouse_id']}-{ln['outlet_id']}" == r))
    _, ctx, plan = _solve(datasets, NetworkEdit(route_overrides={used: False}))
    assert ctx["network"]["roads_closed"] == [used]
    assert not any(f"{ln['warehouse_id']}-{ln['outlet_id']}" == used for ln in plan.lines)


def test_reopening_a_closed_road_lets_nagpur_serve_chandrapur(datasets):
    _, _, base = _solve(datasets, None)
    assert not any(ln["warehouse_id"] == "W5" and ln["outlet_id"] == "D9" for ln in base.lines)
    _, ctx, plan = _solve(datasets, NetworkEdit(route_overrides={"W5-D9": True}))
    assert ctx["network"]["roads_opened"] == ["W5-D9"]
    assert any(ln["warehouse_id"] == "W5" and ln["outlet_id"] == "D9" for ln in plan.lines)


@pytest.mark.parametrize("edit", [NetworkEdit(warehouses=[]), NetworkEdit(outlets=[]),
                                  NetworkEdit(warehouses=["W9"]), NetworkEdit(route_overrides={"W1-D99": False})])
def test_invalid_edits_are_rejected(datasets, edit):
    with pytest.raises(PlanningInputError):
        prepare_problem("pharmacy", "S0", dataset=datasets["pharmacy"], source="test", network=edit)


@pytest.mark.mongo
def test_api_run_with_custom_network(client):
    body = {"module": "grocery", "include_insights": False,
            "network": {"warehouses": ["W1", "W2"], "outlets": ["D1", "D5", "D9"], "route_overrides": {"W1-D5": False}}}
    r = client.post("/api/optimization/run", json=body)
    assert r.status_code == 200, r.text
    run = r.json()["data"]
    assert run["status"] == "VALID" and run["network"]["summary"]["roads_closed"] == ["W1-D5"]
    assert {ln["warehouse_id"] for ln in run["optimizer"]["lines"]} <= {"W1", "W2"}
    assert not any(ln["warehouse_id"] == "W1" and ln["outlet_id"] == "D5" for ln in run["optimizer"]["lines"])
    bad = client.post("/api/optimization/run", json={"module": "grocery", "network": {"warehouses": []}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_PLANNING_INPUT"
