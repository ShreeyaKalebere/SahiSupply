"""Stock-aware sourcing: availability after the plan, OR-Tools allocation per mode, honest shortfalls, checker."""
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.mongo
T0 = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def run(client):
    return client.post("/api/optimization/run", json={"module": "pharmacy", "include_insights": False}).json()["data"]


def _src(client, run, outlet="D2", product="P03", qty=100, mode="flexible", **kw):
    return client.post("/api/routes/source", json={"module": "pharmacy", "plan_id": run["plan_id"], "outlet_id": outlet,
                                                   "product_id": product, "quantity": qty, "mode": mode,
                                                   "dispatch_at": T0.isoformat(), **kw})


def _free_eligible(d):
    return sum(w["eligible_units"] for w in d["warehouses"])


def test_availability_subtracts_the_plan(client, run, seeded_db):
    d = _src(client, run).json()["data"]
    for w in d["warehouses"]:
        db_units = sum(b["quantity"] for b in seeded_db.batches.find({"module": "pharmacy", "warehouse_id": w["warehouse_id"], "product_id": "P03"}))
        assert w["total_units"] == db_units
        planned = sum(ln["qty"] for ln in run["optimizer"]["lines"] if ln["warehouse_id"] == w["warehouse_id"] and ln["product_id"] == "P03")
        assert w["committed_units"] == planned
        assert w["eligible_units"] <= w["free_units"] <= w["total_units"]


def test_allocation_respects_stock_and_is_checked(client, run):
    d = _src(client, run, qty=100).json()["data"]
    assert d["fulfilled"] + d["shortfall"] == 100
    assert d["fulfilled"] <= _free_eligible(d)
    by_w = {w["warehouse_id"]: w for w in d["warehouses"]}
    for a in d["allocation"]:
        assert a["qty"] <= by_w[a["warehouse_id"]]["eligible_units"]
    if d["allocation"]:
        assert d["check"]["valid"] is True, d["check"]
        assert d["options"] and any(o["recommended"] for o in d["options"])
        assert d["options"][0]["units"] == d["fulfilled"]


def test_impossible_quantity_reports_shortfall(client, run):
    d = _src(client, run, qty=900000).json()["data"]
    assert d["shortfall"] > 0
    assert d["fulfilled"] <= _free_eligible(d)
    assert any("cannot be supplied" in a["text"] for a in d["advice"])


def test_mandatory_deadline_excludes_late_warehouses(client, run):
    deadline = T0 + timedelta(hours=3)
    d = _src(client, run, mode="deadline", deadline_at=deadline.isoformat()).json()["data"]
    for a in d["allocation"]:
        w = next(x for x in d["warehouses"] if x["warehouse_id"] == a["warehouse_id"])
        assert datetime.fromisoformat(w["arrival_at"]) <= deadline
    rec = next((o for o in d["options"] if o["recommended"]), None)
    assert rec is None or rec["deadline"]["met"]


def test_emergency_prefers_fast_warehouses(client, run):
    flex = _src(client, run, qty=50).json()["data"]
    emer = _src(client, run, qty=50, mode="emergency").json()["data"]
    if not flex["allocation"] or not emer["allocation"]:
        pytest.skip("no eligible stock for this product/store")
    slowest = lambda d: max(next(w for w in d["warehouses"] if w["warehouse_id"] == a["warehouse_id"])["direct_min"] for a in d["allocation"])  # noqa: E731
    assert slowest(emer) <= slowest(flex) + 1e-6


def test_separate_order_ignores_plan_usage(client, run):
    on_top = _src(client, run, product="P04").json()["data"]
    alone = _src(client, run, product="P04", on_top_of_plan=False).json()["data"]
    assert all(w["committed_units"] == 0 for w in alone["warehouses"])
    assert alone["store_capacity"]["receiving_left_l"] >= on_top["store_capacity"]["receiving_left_l"]
    assert alone["fulfilled"] >= on_top["fulfilled"]


def test_requires_known_store_and_product(client, run):
    assert _src(client, run, outlet="D999").status_code == 422
    assert _src(client, run, product="P999").status_code == 422
