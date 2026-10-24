import pytest

from app.inventory.eligibility import build_eligibility
from app.optimization import checker
from app.optimization.explanations import capacity_usage, explain_plan
from app.optimization.insights import compute_insights
from app.optimization.model import solve
from app.optimization.regret import apply_plan
from app.services.kpis import compute_kpis
from app.services.planner import prepare_problem


@pytest.fixture(scope="module")
def pharmacy_s0(datasets):
    pb, _ = prepare_problem("pharmacy", "S0", dataset=datasets["pharmacy"], source="test")
    elig = build_eligibility(pb)
    res = solve(pb, elig)
    return pb, elig, res.plan


def test_every_alternative_gets_exactly_one_supported_reason(pharmacy_s0):
    pb, elig, plan = pharmacy_s0
    usage = capacity_usage(pb, plan)
    exps = explain_plan(pb, elig, plan)
    assert len(exps) == sum(1 for q in pb.need.values() if q > 0)
    for e in exps:
        holders = {b["warehouse_id"] for b in pb.batches.values() if b["product_id"] == e["product_id"]}
        chosen = {s["warehouse_id"] for s in e["sources"]}
        alts = [a["warehouse_id"] for a in e["alternatives"]]
        assert sorted(alts) == sorted(holders - chosen)          # one reason per other warehouse
        assert e["delivered"] + e["shortage"] == e["need"]
        if e["shortage"]:
            assert e["shortage_reason"]
        for a in e["alternatives"]:
            w, d = a["warehouse_id"], e["outlet_id"]
            evs = [elig.pairs[(b["batch_id"], d)] for b in pb.batches.values()
                   if b["product_id"] == e["product_id"] and b["warehouse_id"] == w]
            if a["status"] == "blocked":
                assert not any(x.eligible for x in evs)
            if a["status"] == "allocated_elsewhere":
                assert all(pb.batches[x.batch_id]["quantity"] - usage["batch"].get(x.batch_id, 0) <= 0
                           for x in evs if x.eligible)
            if a["status"] == "costlier":
                assert a["delta_per_unit"] > 0
            assert a["status"] != "unexplained" or e["shortage"] > 0


def test_explanation_numbers_come_from_the_plan(pharmacy_s0):
    pb, elig, plan = pharmacy_s0
    for e in explain_plan(pb, elig, plan):
        for s in e["sources"]:
            ln = next(x for x in plan.lines if x["batch_id"] == s["batch_id"] and x["outlet_id"] == e["outlet_id"])
            assert s["qty"] == ln["qty"]
            assert s["unit_cost"] == pytest.approx(pb.unit_cost(s["batch_id"], e["outlet_id"]))


def test_insights_values_reproduce_by_independent_resolve(pharmacy_s0):
    pb, _, plan = pharmacy_s0
    ins = compute_insights(pb, plan)
    assert ins["status"] == "OK" and 0 < len(ins["items"]) <= 5
    for it in ins["items"]:
        assert it["verified"], it["verification"]
        assert it["net_margin_per_unit"] > 0.01 or it["critical_units_avoided_per_unit"] > 0
        # recompute from scratch: new problem, new solve, checker arithmetic
        mod = pb.with_resource_delta(it["kind"], it["key"], it["added"])
        res = solve(mod, build_eligibility(mod), time_limit_s=5)
        base_t = checker.recompute_totals(pb.raw_inputs(), plan.lines)
        mod_t = checker.recompute_totals(mod.raw_inputs(), res.plan.lines)
        crit = (base_t["critical_shortage_units"] - mod_t["critical_shortage_units"]) / it["added"]
        assert crit == pytest.approx(it["critical_units_avoided_per_unit"])


def test_regret_applied_plan_is_valid_and_nonnegative(datasets, pharmacy_s0):
    _, _, s0_plan = pharmacy_s0
    pb3, _ = prepare_problem("pharmacy", "S3", dataset=datasets["pharmacy"], source="test")
    applied, adj = apply_plan(s0_plan, pb3)
    assert checker.check_plan(pb3.raw_inputs(), applied.lines).valid
    reopt = solve(pb3).plan
    assert compute_kpis(pb3, reopt)["fill_rate"] >= compute_kpis(pb3, applied)["fill_rate"] - 1e-9
