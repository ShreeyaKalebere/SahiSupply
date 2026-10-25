"""Route planner: distances from route records, OR-Tools ordering, cost from planned lines, honest deadlines."""
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.mongo

T0 = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def run(client):
    return client.post("/api/optimization/run", json={"module": "pharmacy", "include_insights": False}).json()["data"]


def _plan(client, run, stops, mode="flexible", **kw):
    body = {"module": "pharmacy", "plan_id": run["plan_id"], "stops": [s if isinstance(s, dict) else {"id": s} for s in stops],
            "mode": mode, "dispatch_at": T0.isoformat(), **kw}
    return client.post("/api/routes/plan", json=body)


def _busy_trip(run):
    """W1 plus three stores it ships to in this plan."""
    stores = sorted({ln["outlet_id"] for ln in run["optimizer"]["lines"] if ln["warehouse_id"] == "W1"})
    return ["W1", *stores[:3]]


def test_flexible_route_distances_cost_and_checker(client, run, seeded_db):
    stops = _busy_trip(run)
    r = _plan(client, run, stops)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    conn = d["candidates"][0]
    assert conn["kind"] == "connected" and conn["order"] == stops
    # Warehouse -> store leg uses the stored route distance; every leg is labelled approximate.
    route = seeded_db.routes.find_one({"module": "pharmacy", "warehouse_id": "W1", "outlet_id": stops[1]})
    assert conn["legs"][0]["distance_km"] == pytest.approx(route["distance_km"], abs=0.05)
    assert all("approximate" in lg["basis"] or "estimate" in lg["basis"] for lg in conn["legs"])
    assert conn["distance_km"] == pytest.approx(sum(lg["distance_km"] for lg in conn["legs"]), abs=0.2)
    # Cost = the optimizer's planned line cost for W1 -> these stores.
    planned = [ln for ln in run["optimizer"]["lines"] if ln["warehouse_id"] == "W1" and ln["outlet_id"] in stops[1:]]
    assert conn["cost"] == pytest.approx(sum(ln["line_cost"] for ln in planned), abs=0.05)
    assert conn["units"] == sum(ln["qty"] for ln in planned)
    # Timeline adds up: drive + handling = total
    assert conn["total_min"] == pytest.approx(conn["drive_min"] + conn["handling_min"], abs=0.5)
    # OR-Tools order is never longer than the connected order; the recommendation passes the checker.
    opt = next((c for c in d["candidates"] if c["kind"] == "optimized"), conn)
    assert opt["distance_km"] <= conn["distance_km"] + 0.1
    assert d["check"]["valid"] is True and d["check"]["lines_checked"] > 0
    assert any("No road-routing data" in n for n in d["data_notes"])


def test_impossible_mandatory_deadline_is_never_claimed(client, run):
    r = _plan(client, run, _busy_trip(run), mode="deadline", deadline_at=(T0 + timedelta(minutes=10)).isoformat())
    d = r.json()["data"]
    assert d["recommended"] is None
    assert not any(c["deadline"]["met"] for c in d["candidates"] if c["kind"] != "direct")
    assert any("cannot be met" in a["text"] for a in d["advice"])


def test_generous_deadline_is_met(client, run):
    d = _plan(client, run, _busy_trip(run), mode="deadline", deadline_at=(T0 + timedelta(days=3)).isoformat()).json()["data"]
    rec = next(c for c in d["candidates"] if c["recommended"])
    assert rec["deadline"]["met"] and rec["deadline"]["slack_min"] > 0


def test_closed_road_is_flagged_not_recommended(client, run):
    closed = next((r for r in client.get("/api/routes?module=pharmacy").json()["data"] if not r["open"]), None)
    if closed is None:
        pytest.skip("no closed road in this dataset")
    d = _plan(client, run, [closed["warehouse_id"], closed["outlet_id"]]).json()["data"]
    assert d["candidates"][0]["blocked"]
    assert d["recommended"] is None


def test_emergency_visits_urgent_stop_first(client, run):
    stops = _busy_trip(run)
    urgent = stops[2]
    body = [{"id": s, "urgent": s == urgent} for s in stops]
    d = _plan(client, run, body, mode="emergency").json()["data"]
    rec = next(c for c in d["candidates"] if c["recommended"])
    assert rec["order"][1] == urgent
    assert rec["urgent_reached_min"] is not None


def test_input_validation(client, run):
    assert _plan(client, run, ["D1", "D2"]).status_code == 422          # no warehouse
    assert _plan(client, run, ["W1", "W1"]).status_code == 422          # duplicate
    assert _plan(client, run, ["W1", "D1"], mode="deadline").status_code == 422   # deadline missing
