# SahiSupply measured results

Generated 2026-10-24T13:03:04.764638+00:00 by `backend/scripts/benchmark.py` on synthetic seed-42 data. Targets are design goals from the PRD; results below are measured, including any misses.

## Forecast backtest (rolling origin, 4 folds x 14 days)

| Module | Seasonal naive WAPE | 28-day MA WAPE | Gradient boosting WAPE | Selected | Improvement vs naive | Target >= 10% | Noise floor WAPE |
|---|---|---|---|---|---|---|---|
| pharmacy | 0.599 | 0.443 | 0.439 | gradient_boosting | 26.6% | met | 0.428 |
| grocery | 0.547 | 0.433 | 0.408 | gradient_boosting | 25.5% | met | 0.376 |
| cosmetics | 0.607 | 0.481 | 0.449 | gradient_boosting | 26.0% | met | 0.412 |

## Demo-size solve time (20 runs: S0-S3 x modules, repeated)

- p50 = **0.05s** (target < 2 s: met)
- p95 = **0.08s** (target < 5 s: met)
- max = 0.16s, statuses: {'OPTIMAL': 20}, max MIP gap 0.098% (solver stops at 0.1%; 10 s time limit)

## Fair evaluation: optimizer vs greedy baseline on identical data

Fill rate under S0-S3, contested-supply pattern on and off. North-star target: >= +5 pp in >= 2 of S1-S3 (pattern on).

### pharmacy

North-star target **met**: 2/3 disruption scenarios >= +5 pp with the pattern on, 0/3 with it off.

| Scenario | Pattern | Baseline fill | Optimized fill | Delta pp | Critical short (base -> opt) | Cost/unit (base -> opt) | Expiry-risk units (base -> opt) | Both valid |
|---|---|---|---|---|---|---|---|---|
| S0 | on | 77.0% | 90.3% | +13.3 | 1234 -> 371 | 0.07 -> 0.09 | 504 -> 504 | yes |
| S1 | on | 77.9% | 85.1% | +7.2 | 1290 -> 397 | 0.08 -> 0.09 | 504 -> 504 | yes |
| S2 | on | 62.6% | 61.2% | -1.3 | 1349 -> 1254 | 0.10 -> 0.10 | 504 -> 504 | yes |
| S3 | on | 77.3% | 84.4% | +7.2 | 1083 -> 395 | 0.09 -> 0.10 | 504 -> 504 | yes |
| S0 | off | 91.6% | 92.9% | +1.3 | 385 -> 306 | 0.07 -> 0.07 | 504 -> 504 | yes |
| S1 | off | 86.8% | 87.8% | +1.0 | 461 -> 306 | 0.07 -> 0.07 | 504 -> 504 | yes |
| S2 | off | 65.2% | 60.7% | -4.5 | 1043 -> 845 | 0.09 -> 0.09 | 504 -> 504 | yes |
| S3 | off | 85.3% | 86.3% | +0.9 | 393 -> 330 | 0.09 -> 0.09 | 504 -> 504 | yes |

### grocery

North-star target **met**: 3/3 disruption scenarios >= +5 pp with the pattern on, 0/3 with it off.

| Scenario | Pattern | Baseline fill | Optimized fill | Delta pp | Critical short (base -> opt) | Cost/unit (base -> opt) | Expiry-risk units (base -> opt) | Both valid |
|---|---|---|---|---|---|---|---|---|
| S0 | on | 77.7% | 90.3% | +12.6 | 0 -> 0 | 3.13 -> 4.37 | 4722 -> 4508 | yes |
| S1 | on | 77.5% | 88.6% | +11.1 | 0 -> 0 | 3.29 -> 4.33 | 4263 -> 3915 | yes |
| S2 | on | 74.0% | 79.2% | +5.3 | 0 -> 0 | 2.45 -> 2.49 | 4722 -> 4734 | yes |
| S3 | on | 82.6% | 89.0% | +6.4 | 0 -> 0 | 4.54 -> 4.74 | 4429 -> 4368 | yes |
| S0 | off | 89.1% | 92.7% | +3.6 | 0 -> 0 | 3.29 -> 3.26 | 3757 -> 4074 | yes |
| S1 | off | 87.1% | 90.8% | +3.7 | 0 -> 0 | 3.28 -> 3.29 | 3570 -> 3478 | yes |
| S2 | off | 78.6% | 80.5% | +1.8 | 0 -> 0 | 2.75 -> 2.47 | 4440 -> 4510 | yes |
| S3 | off | 86.9% | 91.6% | +4.7 | 0 -> 0 | 4.09 -> 4.10 | 4267 -> 3915 | yes |

### cosmetics

North-star target **met**: 3/3 disruption scenarios >= +5 pp with the pattern on, 0/3 with it off.

| Scenario | Pattern | Baseline fill | Optimized fill | Delta pp | Critical short (base -> opt) | Cost/unit (base -> opt) | Expiry-risk units (base -> opt) | Both valid |
|---|---|---|---|---|---|---|---|---|
| S0 | on | 71.2% | 80.7% | +9.5 | 0 -> 0 | 0.30 -> 0.33 | 3665 -> 3665 | yes |
| S1 | on | 66.6% | 73.5% | +6.9 | 0 -> 0 | 0.29 -> 0.30 | 3665 -> 3665 | yes |
| S2 | on | 59.4% | 66.7% | +7.3 | 0 -> 0 | 0.35 -> 0.33 | 3665 -> 3665 | yes |
| S3 | on | 73.5% | 78.6% | +5.1 | 0 -> 0 | 0.36 -> 0.34 | 3665 -> 3665 | yes |
| S0 | off | 81.3% | 83.0% | +1.7 | 0 -> 0 | 0.29 -> 0.25 | 3665 -> 3665 | yes |
| S1 | off | 73.9% | 75.6% | +1.8 | 0 -> 0 | 0.28 -> 0.23 | 3665 -> 3665 | yes |
| S2 | off | 66.4% | 69.1% | +2.7 | 0 -> 0 | 0.32 -> 0.25 | 3665 -> 3665 | yes |
| S3 | off | 77.0% | 80.8% | +3.7 | 0 -> 0 | 0.34 -> 0.29 | 3665 -> 3665 | yes |

Cost per delivered unit is often higher for the optimizer: it ships to remote outlets the baseline leaves short, so the PRD's 'cost per unit <= baseline + 5%' target is not met everywhere. Reported as measured.
