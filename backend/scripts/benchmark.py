"""Measure the PRD performance and outcome targets and write validation/results.md.

Usage (from backend/):  python -m scripts.benchmark
Uses the deterministic seed-42 datasets (generated in memory; no database writes).
Every number in the output is measured by this script - targets are listed next to them.
"""
from __future__ import annotations

import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT  # noqa: E402
from app.data.generator import generate_dataset  # noqa: E402
from app.forecasting.service import get_forecast  # noqa: E402
from app.inventory.eligibility import build_eligibility  # noqa: E402
from app.optimization.model import solve  # noqa: E402
from app.services import views  # noqa: E402
from app.services.planner import prepare_problem  # noqa: E402

MODULES = ("pharmacy", "grocery", "food")


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def main() -> None:
    out = [f"# SahiSupply measured results\n\nGenerated {datetime.now(timezone.utc).isoformat()} by "
           "`backend/scripts/benchmark.py` on synthetic seed-42 data. Targets are design goals from the PRD; "
           "results below are measured, including any misses.\n"]
    datasets = {m: generate_dataset(m) for m in MODULES}

    # ---------- forecasting ----------
    out.append("## Forecast backtest (rolling origin, 4 folds x 14 days)\n")
    out.append("| Module | Seasonal naive WAPE | 28-day MA WAPE | Gradient boosting WAPE | Selected | Improvement vs naive | Target >= 10% | Noise floor WAPE |")
    out.append("|---|---|---|---|---|---|---|---|")
    for m in MODULES:
        p = get_forecast(datasets[m], m).metrics_payload()
        w = {x["model"]: x["wape"] for x in p["models"]}
        out.append(f"| {m} | {w['seasonal_naive']:.3f} | {w['moving_average_28']:.3f} | {w['gradient_boosting']:.3f} | "
                   f"{p['selected_model']} | {p['target']['improvement_pct']:.1f}% | {'met' if p['target']['achieved'] else 'NOT met'} | "
                   f"{p['noise_floor']['wape']:.3f} |")

    # ---------- solve times ----------
    out.append("\n## Demo-size solve time (20 runs: S0-S3 x modules, repeated)\n")
    times, statuses, gaps = [], [], []
    combos = [(m, s) for m in MODULES for s in ("S0", "S1", "S2", "S3")]
    problems = {}
    for m, s in combos:
        problems[(m, s)], _ = prepare_problem(m, s, dataset=datasets[m], source="benchmark")
    i = 0
    while len(times) < 20:
        m, s = combos[i % len(combos)]
        i += 1
        pb = problems[(m, s)]
        t0 = time.perf_counter()
        res = solve(pb, build_eligibility(pb))
        times.append(time.perf_counter() - t0)
        statuses.append(res.status)
        gaps.append(res.gap or 0.0)
    p50, p95 = statistics.median(times), pct(times, 0.95)
    out.append(f"- p50 = **{p50:.2f}s** (target < 2 s: {'met' if p50 < 2 else 'NOT met'})")
    out.append(f"- p95 = **{p95:.2f}s** (target < 5 s: {'met' if p95 < 5 else 'NOT met'})")
    out.append(f"- max = {max(times):.2f}s, statuses: {dict((s, statuses.count(s)) for s in set(statuses))}, "
               f"max MIP gap {max(gaps):.3%} (solver stops at 0.1%; 10 s time limit)")

    # ---------- fair evaluation ----------
    out.append("\n## Fair evaluation: optimizer vs greedy baseline on identical data\n")
    out.append("Fill rate under S0-S3, contested-supply pattern on and off. North-star target: >= +5 pp in >= 2 of S1-S3 (pattern on).\n")
    for m in MODULES:
        ev = views.fair_evaluation(m)
        ns = ev["north_star"]
        out.append(f"### {m}\n")
        out.append(f"North-star target {'**met**' if ns['target_met'] else '**not met**'}: "
                   f"{ns['scenarios_meeting_target_pattern_on']}/3 disruption scenarios >= +5 pp with the pattern on, "
                   f"{ns['scenarios_meeting_target_pattern_off']}/3 with it off.\n")
        out.append("| Scenario | Pattern | Baseline fill | Optimized fill | Delta pp | Critical short (base -> opt) | Cost/unit (base -> opt) | Expiry-risk units (base -> opt) | Both valid |")
        out.append("|---|---|---|---|---|---|---|---|---|")
        for r in ev["rows"]:
            out.append(f"| {r['scenario_id']} | {'on' if r['contested_pattern'] else 'off'} | {r['baseline_fill_rate']:.1%} | "
                       f"{r['optimizer_fill_rate']:.1%} | {r['fill_rate_pp']:+.1f} | {r['baseline_critical_shortage']} -> "
                       f"{r['optimizer_critical_shortage']} | {r['baseline_cost_per_unit']:.2f} -> {r['optimizer_cost_per_unit']:.2f} | "
                       f"{r['baseline_expiry_risk']} -> {r['optimizer_expiry_risk']} | "
                       f"{'yes' if r['optimizer_valid'] and r['baseline_valid'] else 'NO'} |")
        out.append("")
    out.append("Cost per delivered unit is often higher for the optimizer: it ships to remote outlets the baseline leaves "
               "short, so the PRD's 'cost per unit <= baseline + 5%' target is not met everywhere. Reported as measured.\n")

    path = REPO_ROOT / "validation" / "results.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print("\n".join(out))
    print(f"\nWrote {path}")


if __name__ == "__main__":
    main()
