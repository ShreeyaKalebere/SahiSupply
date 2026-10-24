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
    wids = [w["warehouse_id"] for w in datasets["pharmacy"]["warehouses"]]
    pb, ctx, plan = _solve(datasets, NetworkEdit(warehouses=wids[:3]))
    assert set(pb.warehouses) == set(wids[:3])
    assert all(b["warehouse_id"] in set(wids[:3]) for b in pb.batches.values())
    assert all(ln["warehouse_id"] in set(wids[:3]) for ln in plan.lines)
    assert ctx["network"]["warehouses_removed"] == wids[3:]


def test_removing_stores_drops_their_need(datasets):
    oids = [o["outlet_id"] for o in datasets["pharmacy"]["outlets"]]
    pb, _, plan = _solve(datasets, NetworkEdit(outlets=oids[:3]))
    assert {d for d, _ in pb.need} == set(oids[:3])
    assert {ln["outlet_id"] for ln in plan.lines} <= set(oids[:3])


def test_closing_a_used_road_moves_the_shipment(datasets):
    _, _, base = _solve(datasets, None)
    used = max({f"{ln['warehouse_id']}-{ln['outlet_id']}" for ln in base.lines},
               key=lambda r: sum(ln["qty"] for ln in base.lines if f"{ln['warehouse_id']}-{ln['outlet_id']}" == r))
    _, ctx, plan = _solve(datasets, NetworkEdit(route_overrides={used: False}))
    assert ctx["network"]["roads_closed"] == [used]
    assert not any(f"{ln['warehouse_id']}-{ln['outlet_id']}" == used for ln in plan.lines)


def test_reopening_a_closed_road_lets_remote_outlet_be_served(datasets):
    closed_r = next(r for r in datasets["pharmacy"]["routes"] if not r["open"])
    rid = closed_r["route_id"]
    _, ctx, plan = _solve(datasets, NetworkEdit(route_overrides={rid: True}))
    assert ctx["network"]["roads_opened"] == [rid]
    assert any(f"{ln['warehouse_id']}-{ln['outlet_id']}" == rid for ln in plan.lines)


@pytest.mark.parametrize("edit", [NetworkEdit(warehouses=[]), NetworkEdit(outlets=[]),
                                  NetworkEdit(warehouses=["WH-INVALID"]), NetworkEdit(route_overrides={"WH-INV-SH-INV": False})])
def test_invalid_edits_are_rejected(datasets, edit):
    with pytest.raises(PlanningInputError):
        prepare_problem("pharmacy", "S0", dataset=datasets["pharmacy"], source="test", network=edit)


@pytest.mark.mongo
def test_api_run_with_custom_network(client):
    wids = ["WH-NES-01", "WH-NES-02"]
    oids = ["SH-NES-01", "SH-NES-02", "SH-NES-03"]
    closed_route = f"{wids[0]}-{oids[0]}"
    body = {"module": "grocery", "include_insights": False,
            "network": {"warehouses": wids, "outlets": oids, "route_overrides": {closed_route: False}}}
    r = client.post("/api/optimization/run", json=body)
    assert r.status_code == 200, r.text
    run = r.json()["data"]
    assert run["status"] == "VALID" and run["network"]["summary"]["roads_closed"] == [closed_route]
    assert {ln["warehouse_id"] for ln in run["optimizer"]["lines"]} <= set(wids)
    assert not any(f"{ln['warehouse_id']}-{ln['outlet_id']}" == closed_route for ln in run["optimizer"]["lines"])
    bad = client.post("/api/optimization/run", json={"module": "grocery", "network": {"warehouses": []}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_PLANNING_INPUT"
