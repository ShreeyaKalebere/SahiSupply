"""Warehouse popup / 3D data: real batches from the database, simulated fields labelled."""
import pytest

pytestmark = pytest.mark.mongo


@pytest.mark.parametrize("module", ["pharmacy", "grocery", "cosmetics"])
def test_details_match_database_batches(client, seeded_db, module):
    r = client.get(f"/api/warehouses/W2/details?module={module}")
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    db_batches = list(seeded_db.batches.find({"module": module, "warehouse_id": "W2"}, {"_id": 0}))
    assert {b["batch_id"] for b in d["batches"]} == {b["batch_id"] for b in db_batches}
    assert d["metrics"]["total_units"] == sum(b["quantity"] for b in db_batches)
    assert sum(p["units"] for p in d["products"]) == d["metrics"]["total_units"]
    assert d["metrics"]["storage_capacity_simulated"] is True
    assert 0 < d["metrics"]["utilization"] < 5
    assert "not a real company" in d["operator"]
    assert all(b["status"] in ("ok", "expiring", "blocked") for b in d["batches"])
    assert d["industry"]["module"] == module


def test_details_with_plan_reports_stock_left(client):
    run = client.post("/api/optimization/run", json={"module": "pharmacy", "include_insights": False}).json()["data"]
    d = client.get(f"/api/warehouses/W2/details?module=pharmacy&plan_id={run['plan_id']}").json()["data"]
    assert d["plan_id"] == run["plan_id"]
    shipped = sum(ln["qty"] for ln in run["optimizer"]["lines"] if ln["warehouse_id"] == "W2")
    assert sum(p["shipped_this_week"] for p in d["products"]) == shipped
    assert all(p["units_after_plan"] == p["units"] - p["shipped_this_week"] for p in d["products"])


def test_unknown_warehouse_is_404(client):
    r = client.get("/api/warehouses/W99/details?module=pharmacy")
    assert r.status_code == 404 and r.json()["error"]["code"] == "UNKNOWN_WAREHOUSE"
