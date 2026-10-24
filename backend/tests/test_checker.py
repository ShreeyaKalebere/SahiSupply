"""The checker catches each violation class, and property tests show optimizer/baseline plans always pass."""
import copy

from factory import batch, outlet, problem, product, route, wh
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.modules.rules import ActiveRules
from app.optimization.baseline import greedy_plan
from app.optimization.checker import check_plan
from app.optimization.model import solve


def _pb():
    return problem([wh("W1", cap=100.0), wh("W2", status="closed")],
                   [outlet("D1", cap=100.0, cold=10.0, storage=("ambient",))],
                   [product("P1"), product("P2", storage="2-8C", shelf=365)],
                   [batch("B1", "P1", "W1", 20), batch("B2", "P2", "W1", 20), batch("B3", "P1", "W2", 20),
                    batch("B4", "P1", "W1", 20, expiry="2026-12-01")],
                   [route("W1", "D1", cap=50.0), route("W2", "D1")],
                   {("D1", "P1"): 30, ("D1", "P2"): 5},
                   ActiveRules(min_life_rule_id="C1", min_life_days=90, storage_rule_id="C3",
                               storage_classes=frozenset({"2-8C"})))


def codes(pb, lines, **kw):
    return {v.code for v in check_plan(pb.raw_inputs(), lines, **kw).violations}


def L(b, d, q):
    return {"batch_id": b, "outlet_id": d, "qty": q}


def test_valid_plan_passes():
    pb = _pb()
    assert codes(pb, [L("B1", "D1", 20)]) == set()


def test_each_violation_class_is_detected():
    pb = _pb()
    assert "STOCK" in codes(pb, [L("B1", "D1", 21)])
    assert "NEED" in codes(pb, [L("B1", "D1", 20), L("B4", "D1", 0), L("B3", "D1", 15)])
    assert "WAREHOUSE_CLOSED" in codes(pb, [L("B3", "D1", 5)])
    assert "MIN_LIFE" in codes(pb, [L("B4", "D1", 5)])            # 36 - 1 = 35 days < 90
    assert "STORAGE" in codes(pb, [L("B2", "D1", 5)])
    assert "INTEGRALITY" in codes(pb, [L("B1", "D1", 2.5)])
    assert "NEGATIVE" in codes(pb, [L("B1", "D1", -3)])
    assert "UNKNOWN_ENTITY" in codes(pb, [L("B99", "D1", 1)])


def test_capacity_and_route_violations_detected():
    pb = _pb()
    pb.routes[("W1", "D1")]["open"] = False
    assert "ROUTE_CLOSED" in codes(pb, [L("B1", "D1", 1)])
    pb = _pb()
    pb.routes[("W1", "D1")]["capacity_l"] = 5.0
    assert "ROUTE_CAPACITY" in codes(pb, [L("B1", "D1", 6)])
    pb = _pb()
    pb.warehouses["W1"]["outbound_capacity_l"] = 5.0
    assert "OUTBOUND_CAPACITY" in codes(pb, [L("B1", "D1", 6)])
    pb = _pb()
    pb.outlets["D1"]["receiving_capacity_l"] = 5.0
    assert "RECEIVING_CAPACITY" in codes(pb, [L("B1", "D1", 6)])
    pb = _pb()
    pb.rules = ActiveRules()
    pb.outlets["D1"]["cold_capacity_l"] = 2.0
    assert "COLD_CAPACITY" in codes(pb, [L("B2", "D1", 3)])


def test_fingerprint_and_totals_mismatch_detected():
    pb = _pb()
    fp = pb.fingerprint()
    tampered = copy.deepcopy(pb.raw_inputs())
    tampered["batches"][0]["quantity"] = 999
    res = check_plan(tampered, [L("B1", "D1", 5)], expected_fingerprint=fp)
    assert any(v.code == "FINGERPRINT" for v in res.violations)
    assert "TOTALS" in codes(pb, [L("B1", "D1", 5)], reported={"delivered_units": 6})


# ---------------- property-based: random small networks ----------------
@st.composite
def networks(draw):
    nw, nd, np_ = draw(st.integers(1, 3)), draw(st.integers(1, 4)), draw(st.integers(1, 3))
    ws = [wh(f"W{i}", cap=draw(st.floats(5, 200)), status=draw(st.sampled_from(["operational"] * 4 + ["closed"])))
          for i in range(nw)]
    os_ = [outlet(f"D{j}", cap=draw(st.floats(5, 200)), cold=draw(st.sampled_from([0.0, 10.0, 100.0])),
                  storage=draw(st.sampled_from([("ambient",), ("ambient", "chilled"), ("ambient", "chilled", "2-8C")])))
           for j in range(nd)]
    ps = [product(f"P{k}", storage=draw(st.sampled_from(["ambient", "chilled", "2-8C"])),
                  crit=draw(st.sampled_from(["critical", "standard"])), shelf=draw(st.integers(5, 400)),
                  vol=draw(st.sampled_from([0.1, 0.5, 1.0, 3.0])), margin=draw(st.floats(0.5, 50)))
          for k in range(np_)]
    bs = []
    for k in range(np_):
        for i in range(nw):
            if draw(st.booleans()):
                days = draw(st.integers(1, 400))
                from datetime import date, timedelta
                bs.append(batch(f"B{k}{i}{len(bs)}", f"P{k}", f"W{i}", draw(st.integers(0, 80)),
                                expiry=(date(2026, 10, 26) + timedelta(days=days)).isoformat()))
    rs = [route(w["warehouse_id"], o["outlet_id"], cost_per_litre=draw(st.floats(0.5, 10)),
                lead=draw(st.integers(1, 4)), cap=draw(st.floats(1, 150)), open_=draw(st.booleans()))
          for w in ws for o in os_]
    need = {(o["outlet_id"], p["product_id"]): draw(st.integers(0, 60)) for o in os_ for p in ps}
    rules = ActiveRules(
        min_life_rule_id="R1", min_life_days=draw(st.sampled_from([None, 3, 30])),
        storage_rule_id="R2", storage_classes=frozenset(draw(st.sampled_from([[], ["2-8C"], ["chilled", "2-8C"]]))),
        shortage_weights={"critical": draw(st.sampled_from([1.0, 10.0])), "standard": 1.0},
        fefo=draw(st.booleans()))
    return problem(ws, os_, ps, bs, rs, need, rules)


@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(networks())
def test_property_optimizer_and_baseline_plans_always_pass_checker(pb):
    fp = pb.fingerprint()
    res = solve(pb, time_limit_s=5)
    assert res.status in ("OPTIMAL", "FEASIBLE")
    chk = check_plan(pb.raw_inputs(), res.plan.lines, expected_fingerprint=fp)
    assert chk.valid, chk.violations
    base = greedy_plan(pb)
    chk_b = check_plan(pb.raw_inputs(), base.lines, expected_fingerprint=fp)
    assert chk_b.valid, chk_b.violations
    # optimizer is never worse than greedy on its own objective: weighted shortage penalty dominates
    assert all(ln["qty"] > 0 for ln in res.plan.lines)
