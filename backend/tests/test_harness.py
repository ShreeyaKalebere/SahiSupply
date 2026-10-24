"""Correctness gate (PRD 8.5): 0 checker violations over many random seeds and all scenarios.

Default run uses 10 seeds; the full 100-seed gate and the stress test are marked slow:
    pytest -m slow tests/test_harness.py
Need is taken from the generator's known expected demand so each seed does not retrain the forecaster;
the checker invariants do not depend on forecast quality.
"""
import time

import pytest

from app.data.generator import generate_dataset
from app.inventory.eligibility import build_eligibility
from app.inventory.net_need import need_from_expected
from app.inventory.problem import build_problem
from app.modules.config_loader import get_config
from app.modules.rules import resolve_rules
from app.optimization.baseline import greedy_plan
from app.optimization.checker import check_plan
from app.optimization.model import solve
from app.scenarios.definitions import apply_scenario

SCENARIOS = ("S0", "S1", "S2", "S3", "S4")


def run_seed(module: str, seed: int, scenarios=SCENARIOS, **gen) -> list[dict]:
    cfg = get_config(module)
    rules = resolve_rules(cfg)
    ds = generate_dataset(module, seed=seed, history_days=gen.pop("history_days", 40), **gen)
    out = []
    for sid in scenarios:
        sc = apply_scenario(ds, sid)
        sc.dataset["future_expected"] = ds["future_expected"]
        need = need_from_expected(sc.dataset, review_period_days=7, z_by_class=cfg.service_levels.model_dump(),
                                  need_source=cfg.planning.need_source)
        for (d, p), mult in sc.demand_multipliers.items():
            need[(d, p)].need = int(round(need[(d, p)].need * mult))
        pb = build_problem(sc.dataset, module=module, scenario_id=sid, rules=rules, review_period_days=7, need_detail=need)
        fp = pb.fingerprint()
        elig = build_eligibility(pb)
        res = solve(pb, elig)
        base = greedy_plan(pb, elig)
        raw = pb.raw_inputs()
        co = check_plan(raw, res.plan.lines, expected_fingerprint=fp) if res.plan else None
        cb = check_plan(raw, base.lines, expected_fingerprint=fp)
        out.append({"module": module, "seed": seed, "scenario": sid, "status": res.status,
                    "opt_violations": len(co.violations) if co else None, "base_violations": len(cb.violations),
                    "seconds": res.solve_seconds, "gap": res.gap})
    return out


@pytest.mark.parametrize("module", ["pharmacy", "grocery", "food"])
def test_ten_seeds_zero_violations(module):
    rows = [r for s in range(10) for r in run_seed(module, 1000 + s)]
    assert all(r["status"] in ("OPTIMAL", "FEASIBLE") for r in rows)
    assert sum(r["opt_violations"] for r in rows) == 0
    assert sum(r["base_violations"] for r in rows) == 0


@pytest.mark.slow
@pytest.mark.parametrize("module", ["pharmacy", "grocery", "food"])
def test_hundred_seeds_zero_violations(module):
    rows = [r for s in range(100) for r in run_seed(module, s)]
    bad = [r for r in rows if r["opt_violations"] or r["base_violations"] or r["status"] not in ("OPTIMAL", "FEASIBLE")]
    print(f"\n{module}: {len(rows)} runs, {len(bad)} with violations or failures, "
          f"max solve {max(r['seconds'] for r in rows):.2f}s")
    assert not bad, bad[:5]


@pytest.mark.slow
def test_stress_10x48x30_within_time_limit():
    t0 = time.perf_counter()
    rows = run_seed("pharmacy", 42, scenarios=("S0",), n_warehouses=10, n_outlets=48, n_products=30, history_days=40)
    r = rows[0]
    print(f"\nstress: status={r['status']} solve={r['seconds']:.2f}s gap={r['gap']:.4%} total={time.perf_counter() - t0:.1f}s")
    assert r["status"] in ("OPTIMAL", "FEASIBLE") and r["opt_violations"] == 0
    assert r["seconds"] <= 11.0
