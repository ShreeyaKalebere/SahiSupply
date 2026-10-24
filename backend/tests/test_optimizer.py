"""Optimizer correctness on small hand-built fixtures (each property checked by the independent checker too)."""
import pytest
from factory import batch, outlet, problem, product, route, wh

from app.inventory.eligibility import build_eligibility
from app.modules.rules import ActiveRules
from app.optimization.baseline import greedy_plan
from app.optimization.checker import check_plan, recompute_totals
from app.optimization.model import solve
from app.services.kpis import compute_kpis


def _solve(pb):
    res = solve(pb, time_limit_s=10)
    assert res.status == "OPTIMAL"
    chk = check_plan(pb.raw_inputs(), res.plan.lines, expected_fingerprint=pb.fingerprint())
    assert chk.valid, chk.violations
    return res


def qty(plan, bid, did):
    return sum(ln["qty"] for ln in plan.lines if ln["batch_id"] == bid and ln["outlet_id"] == did)


def test_batch_stock_never_exceeded_and_unmet_is_explicit():
    pb = problem([wh("W1")], [outlet("D1"), outlet("D2")], [product("P1")], [batch("B1", "P1", "W1", 30)],
                 [route("W1", "D1"), route("W1", "D2")], {("D1", "P1"): 25, ("D2", "P1"): 20})
    res = _solve(pb)
    assert sum(ln["qty"] for ln in res.plan.lines) == 30
    assert sum(res.plan.shortages(pb).values()) == 15


def test_need_not_exceeded():
    pb = problem([wh("W1")], [outlet("D1")], [product("P1")], [batch("B1", "P1", "W1", 500)],
                 [route("W1", "D1")], {("D1", "P1"): 40})
    assert qty(_solve(pb).plan, "B1", "D1") == 40


@pytest.mark.parametrize("kind", ["outbound", "receiving", "route", "cold"])
def test_capacities_respected(kind):
    w = wh("W1", cap=12.0 if kind == "outbound" else 1e6)
    o = outlet("D1", cap=12.0 if kind == "receiving" else 1e6, cold=12.0 if kind == "cold" else 1e6)
    r = route("W1", "D1", cap=12.0 if kind == "route" else 1e6)
    p = product("P1", vol=2.0, storage="chilled" if kind == "cold" else "ambient")
    pb = problem([w], [o], [p], [batch("B1", "P1", "W1", 100)], [r], {("D1", "P1"): 50})
    assert qty(_solve(pb).plan, "B1", "D1") == 6   # 6 units x 2 L = 12 L


def test_expired_and_unavailable_sources_blocked():
    pb = problem([wh("W1"), wh("W2", status="closed"), wh("W3")], [outlet("D1")], [product("P1")],
                 [batch("B1", "P1", "W1", 50, expiry="2026-10-27"),   # expires on arrival (lead 1 -> 0 days)
                  batch("B2", "P1", "W2", 50), batch("B3", "P1", "W3", 50)],
                 [route("W1", "D1"), route("W2", "D1"), route("W3", "D1", open_=False)], {("D1", "P1"): 30})
    res = _solve(pb)
    assert res.plan.lines == [] and sum(res.plan.shortages(pb).values()) == 30


def test_min_life_rule_blocks_and_changes_plan():
    """C1-style rule: 60 days on arrival < 90 blocks the cheap batch; turning the rule off changes the plan."""
    ps = [product("P1", shelf=730)]
    bs = [batch("B1", "P1", "W1", 50, expiry="2026-12-26"),     # 61 days -> 60 on arrival
          batch("B2", "P1", "W2", 50, expiry="2028-01-01")]
    rs = [route("W1", "D1", cost_per_litre=1.0), route("W2", "D1", cost_per_litre=3.0)]
    on = problem([wh("W1"), wh("W2")], [outlet("D1")], ps, bs, rs, {("D1", "P1"): 20},
                 ActiveRules(min_life_rule_id="C1", min_life_days=90))
    off = problem([wh("W1"), wh("W2")], [outlet("D1")], ps, bs, rs, {("D1", "P1"): 20})
    assert qty(_solve(on).plan, "B2", "D1") == 20 and qty(_solve(on).plan, "B1", "D1") == 0
    assert qty(_solve(off).plan, "B1", "D1") == 20
    pct = problem([wh("W1"), wh("W2")], [outlet("D1")], ps, bs, rs, {("D1", "P1"): 20},
                  ActiveRules(min_life_rule_id="F1", min_life_pct=40))   # 40% of 730 = 292 days
    assert qty(_solve(pct).plan, "B1", "D1") == 0


def test_storage_match_blocks_mismatch():
    ps = [product("P1", storage="2-8C")]
    o = outlet("D1", storage=("ambient", "chilled"))
    rules = ActiveRules(storage_rule_id="C3", storage_classes=frozenset({"2-8C"}))
    on = problem([wh("W1")], [o], ps, [batch("B1", "P1", "W1", 50)], [route("W1", "D1")], {("D1", "P1"): 10}, rules)
    off = problem([wh("W1")], [o], ps, [batch("B1", "P1", "W1", 50)], [route("W1", "D1")], {("D1", "P1"): 10})
    assert _solve(on).plan.lines == []
    assert qty(_solve(off).plan, "B1", "D1") == 10
    bad = check_plan(on.raw_inputs(), _solve(off).plan.lines)
    assert not bad.valid and any(v.code == "STORAGE" for v in bad.violations)


def test_critical_weight_changes_objective():
    """Scarce shared capacity: weight 10 sends it to the critical product instead of the higher-margin one."""
    ps = [product("PC", crit="critical", margin=5.0), product("PS", margin=8.0)]
    bs = [batch("B1", "PC", "W1", 100), batch("B2", "PS", "W1", 100)]
    need = {("D1", "PC"): 10, ("D1", "PS"): 10}
    w = wh("W1", cap=10.0)
    flat = problem([w], [outlet("D1")], ps, bs, [route("W1", "D1")], need)
    weighted = problem([w], [outlet("D1")], ps, bs, [route("W1", "D1")], need,
                       ActiveRules(shortage_weights={"critical": 10.0, "standard": 1.0}))
    assert qty(_solve(flat).plan, "B2", "D1") == 10
    assert qty(_solve(weighted).plan, "B1", "D1") == 10


def test_fefo_prefers_earlier_expiry_only_on_ties():
    ps = [product("P1", shelf=30)]
    tie = [batch("B1", "P1", "W1", 50, expiry="2026-11-20"), batch("B2", "P1", "W1", 50, expiry="2026-11-10")]
    rules = ActiveRules(fefo=True)
    pb = problem([wh("W1")], [outlet("D1")], ps, tie, [route("W1", "D1")], {("D1", "P1"): 20}, rules)
    assert qty(_solve(pb).plan, "B2", "D1") == 20
    # a material cost difference wins over expiry
    bs = [batch("B1", "P1", "W1", 50, expiry="2026-11-20"), batch("B2", "P1", "W2", 50, expiry="2026-11-10")]
    rs = [route("W1", "D1", cost_per_litre=1.0), route("W2", "D1", cost_per_litre=1.05)]
    pb2 = problem([wh("W1"), wh("W2")], [outlet("D1")], ps, bs, rs, {("D1", "P1"): 20}, rules)
    res = _solve(pb2)
    assert qty(res.plan, "B1", "D1") == 20
    max_r = 25   # days from 2026-10-26 to the latest expiry, 2026-11-20
    assert res.penalty["fefo_epsilon"] * max_r <= 0.01 * 1.0 + 1e-12   # eps * max(r) <= 1% of smallest unit cost


def test_equity_floor_lifts_low_fill_outlets():
    ps = [product("PC", crit="critical")]
    os_ = [outlet("D1"), outlet("D2")]
    rs = [route("W1", "D1", cost_per_litre=1.0), route("W1", "D2", cost_per_litre=5.0)]
    need = {("D1", "PC"): 50, ("D2", "PC"): 50}
    bs = [batch("B1", "PC", "W1", 60)]
    off = problem([wh("W1")], os_, ps, bs, rs, need)
    on = problem([wh("W1")], os_, ps, bs, rs, need,
                 ActiveRules(fill_floor_rule_id="C4", fill_floor_pct=80, fill_floor_classes=frozenset({"critical"})))
    r_off, r_on = _solve(off), _solve(on)
    assert qty(r_off.plan, "B1", "D1") == 50          # cheapest destination first without the floor
    # supply (60) cannot give both 80% (=80); the floor spreads shortfall instead of zeroing D2
    assert qty(r_on.plan, "B1", "D2") >= 10 and qty(r_on.plan, "B1", "D1") >= 10
    assert sum(ln["qty"] for ln in r_on.plan.lines) == 60


def test_failed_solver_result_is_not_a_plan(monkeypatch):
    from ortools.linear_solver import pywraplp

    from app.optimization import model
    real = pywraplp.Solver.Solve
    monkeypatch.setattr(pywraplp.Solver, "Solve", lambda self, *a: pywraplp.Solver.ABNORMAL)
    pb = problem([wh("W1")], [outlet("D1")], [product("P1")], [batch("B1", "P1", "W1", 5)],
                 [route("W1", "D1")], {("D1", "P1"): 5})
    res = model.solve(pb)
    assert res.status == "ABNORMAL" and res.plan is None
    monkeypatch.setattr(pywraplp.Solver, "Solve", real)


def test_baseline_and_optimizer_share_fingerprint_and_kpis_match_checker(datasets):
    from app.services.planner import prepare_problem
    pb, _ = prepare_problem("pharmacy", "S0", dataset=datasets["pharmacy"], source="test")
    fp = pb.fingerprint()
    elig = build_eligibility(pb)
    opt, base = solve(pb, elig).plan, greedy_plan(pb, elig)
    for plan in (opt, base):
        k = compute_kpis(pb, plan)
        rec = recompute_totals(pb.raw_inputs(), plan.lines)
        for key in ("delivered_units", "unmet_units", "need_units", "critical_shortage_units"):
            assert k[key] == rec[key]
        assert k["transport_cost"] == pytest.approx(rec["transport_cost"])
        assert check_plan(pb.raw_inputs(), plan.lines, expected_fingerprint=fp).valid
    assert pb.fingerprint() == fp   # nothing mutated the shared inputs


def test_determinism_same_inputs_same_plan(datasets):
    from app.services.planner import prepare_problem
    pb1, _ = prepare_problem("grocery", "S1", dataset=datasets["grocery"], source="test")
    pb2, _ = prepare_problem("grocery", "S1", dataset=datasets["grocery"], source="test")
    assert pb1.fingerprint() == pb2.fingerprint()
    assert solve(pb1).plan.lines == solve(pb2).plan.lines
    assert greedy_plan(pb1).lines == greedy_plan(pb2).lines
