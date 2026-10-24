"""API integration: request -> MongoDB data -> forecast -> need -> baseline -> optimizer -> checker -> KPIs -> stored run."""
import pytest

pytestmark = pytest.mark.mongo


def test_health_and_modules(client):
    h = client.get("/api/health").json()["data"]
    assert h["mongodb"]["connected"] and h["solver"]["scip"]
    mods = client.get("/api/modules").json()["data"]
    assert {m["industry"] for m in mods} == {"grocery", "cosmetics", "pharmacy"}
    cfg = client.get("/api/config/pharmacy").json()["data"]
    assert {r["id"]: r["status"] for r in cfg["rules"]}["C1"] == "active"


@pytest.mark.parametrize("module", ["pharmacy", "grocery", "cosmetics"])
def test_full_run_each_module(client, seeded_db, module):
    r = client.post("/api/optimization/run", json={"module": module, "scenario_id": "S0"})
    assert r.status_code == 200, r.text
    body = r.json()
    run = body["data"]
    assert body["meta"]["data_source"] == "mongodb" and body["meta"]["persisted"] is True
    assert run["status"] == "VALID"
    assert run["optimizer"]["check"]["valid"] and run["baseline"]["check"]["valid"]
    assert run["optimizer"]["fingerprint"] == run["baseline"]["fingerprint"] == run["fingerprint"]
    assert run["need_source"] == ("orders" if module == "grocery" else "forecast")
    k = run["optimizer"]["kpis"]
    assert k["delivered_units"] == sum(ln["qty"] for ln in run["optimizer"]["lines"])
    assert k["delivered_units"] + k["unmet_units"] == k["need_units"]
    stored = seeded_db.optimization_runs.find_one({"plan_id": run["plan_id"]})
    assert stored is not None and stored["fingerprint"] == run["fingerprint"]
    if module == "grocery":
        need = {(n["outlet_id"], n["product_id"]): n for n in run["need_detail"]}
        assert all(n["need"] == n["order_qty"] for n in need.values())


@pytest.mark.parametrize("scenario", ["S1", "S2", "S3"])
def test_p0_scenarios_recalculate(client, scenario):
    r = client.post("/api/scenarios/run", json={"module": "pharmacy", "scenario_id": scenario})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["run"]["status"] == "VALID"
    assert d["diff"]["changed_count"] > 0
    assert d["run"]["scenario"]["changes"]
    assert d["run"]["fingerprint"] != d["diff"]["s0_fingerprint"]
    assert d["run"]["regret"] and "regret_pp" in d["run"]["regret"]


def test_override_flow_and_export(client, seeded_db):
    run = client.post("/api/optimization/run", json={"module": "grocery", "scenario_id": "S0",
                                                     "include_insights": False}).json()["data"]
    pid = run["plan_id"]
    ln = run["optimizer"]["lines"][0]
    bad = client.post(f"/api/optimization/{pid}/override",
                      json={"batch_id": ln["batch_id"], "outlet_id": ln["outlet_id"], "new_qty": 10**5, "reason": "x" * 5})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "OVERRIDE_REJECTED"
    assert bad.json()["error"]["details"]["violations"]
    no_reason = client.post(f"/api/optimization/{pid}/override",
                            json={"batch_id": ln["batch_id"], "outlet_id": ln["outlet_id"], "new_qty": 1, "reason": ""})
    assert no_reason.status_code == 422
    good = client.post(f"/api/optimization/{pid}/override",
                       json={"batch_id": ln["batch_id"], "outlet_id": ln["outlet_id"], "new_qty": ln["qty"] - 1,
                             "reason": "Hold one unit for quality check"})
    assert good.status_code == 200
    assert good.json()["data"]["plan_status"] == "VALID_WITH_OVERRIDES"
    logged = list(seeded_db.plan_overrides.find({"plan_id": pid}))
    assert {o["outcome"] for o in logged} == {"accepted", "rejected"}
    csv = client.get(f"/api/optimization/{pid}/export.csv")
    assert csv.status_code == 200 and run["fingerprint"] in csv.text and "FEFO" in csv.text
    hist = client.get("/api/optimization/history?module=grocery").json()["data"]
    assert any(h["plan_id"] == pid for h in hist)


def test_malformed_inputs_return_typed_errors(client):
    assert client.post("/api/optimization/run", json={"module": "pharmacy", "scenario_id": "S9"}).status_code == 422
    r = client.post("/api/optimization/run", json={"module": "unknown"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "UNKNOWN_MODULE"
    r = client.post("/api/optimization/run", json={"module": "pharmacy", "rule_toggles": {"ZZ": True}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_PLANNING_INPUT"
    assert client.post("/api/optimization/run", json={"module": "pharmacy", "bogus": 1}).status_code == 422
    assert client.get("/api/optimization/PLN-NOPE").status_code == 404


def test_read_views(client):
    for path in ("/api/dashboard?module=pharmacy", "/api/inventory?module=cosmetics", "/api/risks?module=grocery",
                 "/api/forecast/metrics?module=pharmacy", "/api/warehouses?module=cosmetics", "/api/scenarios"):
        r = client.get(path)
        assert r.status_code == 200, (path, r.text)
    fm = client.get("/api/forecast/metrics?module=pharmacy").json()["data"]
    assert len(fm["backtest"]) == 56 and fm["metrics"]["selected_model"]


def test_mongodb_failure_falls_back_to_labelled_snapshot(client, monkeypatch):
    from app.services import data_service, run_store
    monkeypatch.setattr(data_service, "ping", lambda: (False, "ServerSelectionTimeoutError"))
    monkeypatch.setattr(run_store, "ping", lambda: (False, "ServerSelectionTimeoutError"))
    r = client.post("/api/optimization/run", json={"module": "pharmacy", "include_insights": False})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["data_source"] == "snapshot" and body["meta"]["persisted"] is False
    assert body["data"]["status"] == "VALID"
