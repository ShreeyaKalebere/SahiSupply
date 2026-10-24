# SahiSupply API

Base URL: `http://localhost:8000`. Interactive OpenAPI docs: `/docs` (Swagger) and `/openapi.json`.

**Envelope.** Success: `{"data": ..., "meta": {"synthetic_data": true, "data_source": "mongodb" | "snapshot", ...}}`.
Error: `{"error": {"code": "...", "message": "...", "details": ...}}` - no stack traces are returned.

| Code | HTTP | When |
|---|---|---|
| `INVALID_INPUT` | 422 | Pydantic validation failed (unknown field, bad pattern, size limits) |
| `INVALID_PLANNING_INPUT` | 422 | Unknown rule id, enabling a planned rule, unknown scenario |
| `OVERRIDE_REJECTED` | 422 | Edited plan fails the checker; `details.violations` lists them |
| `UNKNOWN_MODULE` / `PLAN_NOT_FOUND` / `UNKNOWN_SERIES` | 404 | |
| `DATA_NOT_SEEDED` | 503 | MongoDB is up but the module was never seeded |
| `INTERNAL_ERROR` | 500 | Logged server-side |

## Endpoints and frontend usage

| Method | Path | Purpose | Used by (frontend `api.*`) |
|---|---|---|---|
| GET | `/api/health` | MongoDB connectivity, solver availability | `health` |
| GET | `/api/metrics` | Runs, checker violations, overrides, fallbacks, solve p50/p95 | - |
| GET | `/api/modules` | Module summaries and rule statuses | `modules` (header tabs) |
| GET | `/api/config/{module}` | Full rule table with enforcement status and test reference | `config` (Configuration) |
| GET | `/api/scenarios` | S0-S4 definitions | `scenarios` (header, Scenarios) |
| GET | `/api/dashboard?module=` | Inventory, forecast, need, risk counts | `dashboard` (Overview) |
| GET | `/api/warehouses?module=` / `/api/outlets` / `/api/products` / `/api/routes` | Network entities | `warehouses`, `outlets` (Map) |
| GET | `/api/inventory?module=&scenario_id=` | Batches with expiry and eligibility | `inventory` (Inventory) |
| GET | `/api/risks?module=` | Stockout, expiry and supply-shortfall flags | `risks` (Overview) |
| POST | `/api/forecast/train` | `{module, refresh}` - retrain, persist metrics to `forecast_runs` | `trainForecast` |
| POST | `/api/forecast/predict` | `{module, outlet_id?, product_id?}` - 14-day forecast | - |
| GET | `/api/forecast/metrics?module=&outlet_id=&product_id=` | Backtest metrics + chart series | `forecast` (Forecasting) |
| POST | `/api/optimization/run` | `{module, scenario_id, rule_toggles, contested_pattern, include_insights}` | `run` (Run plan) |
| GET | `/api/optimization/history?module=&limit=` | Run summaries from MongoDB | `history` (History, restore) |
| GET | `/api/optimization/{plan_id}` | Full run document | `getRun` |
| GET | `/api/optimization/{plan_id}/explanations?outlet_id=&product_id=` | Why / why-not records | (embedded in run) |
| GET | `/api/optimization/{plan_id}/insights` | Value-of-one-more-unit insights | (embedded in run) |
| POST | `/api/optimization/{plan_id}/override` | `{batch_id, outlet_id, new_qty, reason, actor?}` | `override` (drawer) |
| GET | `/api/optimization/{plan_id}/overrides` | Accepted and rejected override log | - |
| GET | `/api/optimization/{plan_id}/export.csv?plan=optimizer|baseline` | FEFO pick list with header metadata | `exportUrl` (Export) |
| POST | `/api/scenarios/run` | Same body as run; returns `{run, diff}` vs a fresh S0 plan | `runScenario` (Scenarios) |
| GET | `/api/evaluation?module=` | S0-S3 x pattern on/off, optimizer vs baseline | `evaluation` (Comparison) |

## Run document (abridged)

```json
{
  "plan_id": "PLN-1A2B3C4D5E", "module": "pharmacy", "scenario_id": "S3", "status": "VALID",
  "plan_status": "VALID | VALID_WITH_OVERRIDES | INVALID | SOLVER_FAILED", "version": 1,
  "fingerprint": "sha256 of scenario-applied inputs + rules + need", "data_source": "mongodb", "persisted": true,
  "optimizer": {"solver": {"status": "OPTIMAL", "gap": 0.0, "solve_seconds": 0.1}, "kpis": {}, "check": {"valid": true}, "lines": []},
  "baseline":  {"solver": {"status": "HEURISTIC"}, "kpis": {}, "check": {"valid": true}, "lines": []},
  "comparison": {"deltas": {}, "fill_rate_pp": 7.2, "business_impact": {}},
  "rules_off": {"kpis": {"blocked_units_shipped": 556}}, "equity": null, "regret": {"regret_pp": 9.7},
  "insights": {"items": [{"statement": "...", "verified": true}]},
  "explanations": [{"outlet_id": "D9", "product_id": "P01", "sources": [], "alternatives": [], "shortage_reason": "..."}],
  "allocation": [{"outlet_id": "D9", "product_id": "P01", "required": 22, "allocated": 12, "unmet": 10}]
}
```

`raw_inputs` (the checker's input snapshot) is stored in MongoDB but stripped from API responses.
