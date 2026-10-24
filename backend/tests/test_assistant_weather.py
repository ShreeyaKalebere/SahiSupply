"""Chat assistant (built-in engine, grounded in the plan) and live-weather road closures."""
import pytest

from app.inventory.eligibility import build_eligibility
from app.optimization.explanations import explain_plan
from app.optimization.model import solve
from app.services import assistant, live_weather
from app.services.kpis import compute_kpis, public_kpis
from app.services.planner import prepare_problem


@pytest.fixture(scope="module")
def ctx(datasets):
    pb, _ = prepare_problem("pharmacy", "S0", dataset=datasets["pharmacy"], source="test")
    elig = build_eligibility(pb)
    plan = solve(pb, elig).plan
    k = public_kpis(compute_kpis(pb, plan))
    run = {"plan_id": "PLN-TEST", "module": "pharmacy", "status": "VALID", "scenario": {"name": "Normal week"},
           "optimizer": {"kpis": k}, "baseline": {"kpis": k}, "explanations": explain_plan(pb, elig, plan),
           "insights": {"items": [{"statement": "A 10 L fridge expansion at X prevents about 14 critical shortage units."}]},
           "contested_pattern": True}
    names = {w["warehouse_id"]: w["name"] for w in datasets["pharmacy"]["warehouses"]}
    return assistant.build_context(run, "pharmacy", names)


def test_builtin_answers_store_question_with_real_reasons(ctx):
    store = ctx["shortages"][0]
    reply = assistant.builtin_answer(f"why is {store['store']} short?", ctx)
    assert store["store"] in reply and store["product"] in reply and "Why:" in reply


@pytest.mark.parametrize("q,expect", [
    ("How does SahiSupply work?", "Predict"),
    ("why doesn't nagpur supply the red stores", "Remote stores share one warehouse"),
    ("what do the dotted lines on the map mean", "Red dotted"),
    ("what should I fix first", "fridge"),
    ("is it better than manual planning?", "manual planning would deliver"),
    ("what is a fingerprint", "fingerprint"),
    ("tell me about live weather", "Open-Meteo"),
])
def test_builtin_intents(ctx, q, expect):
    assert expect.lower() in assistant.builtin_answer(q, ctx).lower()


def test_no_plan_answer_asks_to_run(datasets):
    ctx = assistant.build_context(None, "grocery", {})
    assert "Run plan" in assistant.builtin_answer("which stores are short?", ctx)


def test_engine_falls_back_to_builtin_without_credentials(ctx, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    out = assistant.answer([{"role": "user", "content": "How does it work?"}], ctx)
    assert out["engine"] == "built-in"


def test_weather_closures_close_roads_touching_heavy_rain(datasets, monkeypatch):
    ds = datasets["pharmacy"]
    first_w = ds["warehouses"][0]["warehouse_id"]
    n = len(ds["warehouses"]) + len(ds["outlets"])
    def fake(points):
        days = {"time": ["2026-10-26", "2026-10-27"]}
        # first point gets 80 mm -> heavy; everything else dry
        return [{"daily": {**days, "precipitation_sum": [80.0 if i == 0 else 1.0, 0.0]}} for i in range(len(points))]
    monkeypatch.setattr(live_weather, "_fetch", fake)
    live_weather._cache.clear()
    r = live_weather.weather_closures(ds, 64.5)
    assert r["heavy_sites"] == [first_w] and len(r["sites"]) == n
    assert r["roads_to_close"] and all(x.startswith(f"{first_w}-") for x in r["roads_to_close"])
    live_weather._cache.clear()


def test_weather_failure_raises_not_fake(datasets, monkeypatch):
    def boom(points):
        raise live_weather.LiveDataUnavailable("unreachable")
    monkeypatch.setattr(live_weather, "_fetch", boom)
    live_weather._cache.clear()
    with pytest.raises(live_weather.LiveDataUnavailable):
        live_weather.weather_closures(datasets["pharmacy"])


@pytest.mark.mongo
def test_chat_api(client):
    run = client.post("/api/optimization/run", json={"module": "pharmacy", "include_insights": False}).json()["data"]
    r = client.post("/api/assistant/chat", json={"module": "pharmacy", "plan_id": run["plan_id"],
                                                 "messages": [{"role": "user", "content": "Which stores are short and why?"}]})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["engine"] in ("built-in", "claude") and d["reply"] and d["plan_id"] == run["plan_id"]
    bad = client.post("/api/assistant/chat", json={"module": "pharmacy", "messages": []})
    assert bad.status_code == 422
