# SahiSupply

**Right Product. Right Place. Right Time.**

SahiSupply is an explainable distribution-planning workspace. It decides which product **batches** go to which
destinations and how much to ship, checks shelf life **on arrival**, verifies every plan with an
**independent checker**, explains each line ("why this warehouse, why not that one"), and measures the plan
against a spreadsheet-style **greedy baseline** on identical, fingerprinted data.

One engine serves three industry modules defined in YAML:

| Module | Destinations | Need source | Enforced rules |
|---|---|---|---|
| Grocery Retail | kirana stores, supermarkets | open orders (rationing) | G1 ≥ 3 days life on arrival; FEFO tie-break |
| Cosmetics Retail | beauty stores, salons, department stores | forecast | K1 ≥ 30% of shelf life on arrival; K2 cool storage for sensitive skincare; K3 FEFO tie-break |
| Pharmaceuticals | pharmacies, clinics, hospitals | forecast | C1 ≥ 90 days on arrival; C2 critical shortage weight 10; C3 2-8 °C storage match; C4 80% equity floor (optional) |

> **All data is synthetic** (seed 42). Thresholds are configurable design settings, not regulatory rules. No
> regulatory compliance, clinical guidance or real-world impact is claimed.
> **Database:** MongoDB replaces the PRD's SQLite throughout.

The product spec is [`Asteroid_PS2_SahiSupply_PRD.md`](Asteroid_PS2_SahiSupply_PRD.md). See also
[docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md), [data/README.md](data/README.md),
[validation/results.md](validation/results.md) (measured numbers) and [validation/log.md](validation/log.md).

---

## Prerequisites

* Python 3.11+ (tested with 3.11.8)
* Node.js 20+ and npm (tested with Node 25.2, npm 11.6)
* MongoDB 7+ running locally, **or** a MongoDB Atlas cluster (tested with local MongoDB 8.2.5)
* Optional: Docker Desktop (the Dockerfiles and Compose file are provided but were **not** built in this
  environment because the Docker daemon was not running)

## 1. Configure MongoDB

```bash
cp .env.example .env
```

* **Local:** keep `MONGODB_URI=mongodb://localhost:27017`.
* **Atlas:** create a cluster and a database user, allow your IP, then set
  `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`.
  Never commit `.env`.
* `MONGODB_DB` defaults to `sahisupply`; tests always use `sahisupply_test` and drop it before seeding.

## 2. Install

```bash
pip install -r backend/requirements-dev.txt
```

```bash
npm --prefix frontend install
```

## 3. Seed the synthetic data

```bash
cd backend && python -m scripts.seed_database
```

This creates collections, JSON-schema validators and indexes, then loads all three modules (warehouses,
outlets, products, ~135 batches, 60 routes in both contested/uncontested variants, 32,400 demand rows,
orders, outlet stock). Re-running replaces each module's data; it never duplicates.

## 4. Run

Backend (from the repo root):

```bash
python -m uvicorn app.main:app --app-dir backend --port 8000
```

Frontend dev server (proxies `/api` to port 8000):

```bash
npm --prefix frontend run dev
```

Open http://localhost:5173. API docs: http://localhost:8000/docs. If `frontend/dist` exists
(`npm --prefix frontend run build`), the backend also serves the built UI at http://localhost:8000.

### Docker (not verified here)

```bash
docker compose up -d --build
```

```bash
docker compose run --rm seed
```

Then open http://localhost:8000.

## 5. Tests

```bash
cd backend && python -m pytest
```

```bash
cd backend && python -m pytest -m slow tests/test_harness.py -s
```

```bash
npm --prefix frontend test
```

```bash
cd backend && python -m scripts.benchmark
```

### Results recorded in this environment (2026-10-24)

The PRD's Food Distribution module was replaced by **Cosmetics Retail** at the product owner's request; the PRD file itself is unchanged.

| Suite | Result |
|---|---|
| Backend `pytest` (unit, optimizer, checker incl. 60 Hypothesis examples, explanations/insights, API integration against MongoDB, 10-seed harness) | **64 passed** |
| Correctness gate `-m slow`: 100 seeds × S0-S4 × 3 modules = 1,500 runs | **0 checker violations** for optimizer and baseline; max solve 1.65 s, all OPTIMAL/FEASIBLE (cosmetics re-run after it replaced Food Distribution) |
| Stress test 10 warehouses × 48 outlets × 30 products | OPTIMAL in **1.06 s**, gap 0.04% |
| Frontend Vitest + React Testing Library | **8 passed** |
| `ruff check backend`, `tsc --noEmit`, `vite build` | clean |
| Demo-size solve time (20 runs) | p50 **0.05 s**, p95 **0.08 s** (targets < 2 s / < 5 s) |
| Forecast WAPE vs seasonal naive | −26.6% pharmacy, −25.5% grocery, −26.0% cosmetics (gradient boosting selected in all three; target ≥ 10%) |
| North-star (≥ +5 pp fill under disruption in ≥ 2 of S1-S3, pattern on) | met in all three modules; **0/3 with the pattern off** in every module |

Misses and caveats (from `validation/results.md`): in pharmacy S2 the optimizer's overall fill rate is
1.3 pp (pattern on) and 4.5 pp (pattern off) **below** the baseline because C2 prioritises critical
medicines (its critical shortage is lower); cost per delivered unit is often higher than the baseline's
(+5% target not met everywhere) because the optimizer serves remote outlets the baseline leaves short;
expiry-risk units do not fall by 10% in every module/scenario; with the contested-supply pattern off, the
gains are 1-5 pp. A full UI acceptance pass was run in the in-app browser (see Demo below); end-to-end
browser tests are not automated.

## Demo workflow (≈ 3 minutes)

The UI uses plain language; technical numbers sit behind "Show technical details" links. Press **?** in
the header (or "How it works" in the sidebar) for a 3-step explanation and a glossary.

1. **Pharmacy → Run plan.** The **Dashboard** shows orders delivered vs manual planning, units short,
   critical medicines short, delivery cost, a "Plan health" donut and an "All rules checked" badge.
2. **Needs your attention** → click *Chandrapur Rural Clinic · Human Insulin*. The **Why?** panel shows
   Needed / Sending / Short and explains each warehouse in one sentence (fridge full, road closed, stock
   already sent to another store, expires too soon...).
3. In the panel, open **change this delivery** and ask for more than is possible → the change is refused
   with the reason; a valid change is saved and logged.
4. **Smart suggestions**: e.g. "Add fridge space at Gadchiroli Primary Clinic - 14 fewer critical shortages",
   each tested by re-making the plan.
5. **What-if → Monsoon road closures**: before/after delivered %, what changed, and the stores hit hardest.
6. **vs. Manual planning**: side-by-side cards, value in ₹ (sample prices), and what your rules prevent.
7. **Rules & settings**: switch a rule off (e.g. "Fresh on arrival") and run again to see its effect.
7b. **Network builder**: switch warehouses and stores on/off and click roads in the grid to close or open them, then
   *Run plan with this network* - e.g. open Nagpur → Chandrapur and watch that store go from 34% to 58% supplied.
8. Switch to **Grocery** and **Cosmetics** and run a plan in each.
9. **Download plan**: pick list as CSV, or print view.
10. **Past plans**: every plan is read back from MongoDB.

## Implemented

* P0-01 config-driven industry switch (strict YAML schema, fixed template registry, no `eval`)
* P0-02 deterministic generator (SHA-256 identical per seed), synthetic labels, contested pattern on/off
* P0-03 forecasting: seasonal naive, 28-day MA, HistGradientBoosting; rolling backtest 4×14; MAE/RMSE/WAPE; noise floor
* P0-04 net need (forecast and orders modes) with hand-calculated fixtures; stockout/expiry/shortfall flags
* P0-05 batch-level MILP (OR-Tools SCIP) with G1, F1, C1, C2 (+ F2, C3, C4)
* P0-06 independent checker and typed input validation; 100-seed gate
* P0-07 greedy baseline, ₹ impact, scenarios S0-S3 (+ S4)
* P0-08 why / why-not explanations per line and per shortage
* P0-09 value-of-one-more-unit insights (GLOP duals rank, SCIP re-solves measure, checker reproduces)
* P0-10 planner workspace (11 views, plain-language UI, mobile bottom navigation) with real API data only
* P0-11 CSV / print export in FEFO order; validated, logged overrides
* Network builder: user-chosen warehouses/stores and per-road open/close, applied to the data before planning and
  verified by the checker (`backend/app/scenarios/custom.py`)
* **Ask SahiSupply** chat assistant on every page, grounded in the current plan (`backend/app/services/assistant.py`).
  Uses Claude (`claude-opus-5-5`, server-side refusal fallback enabled) when `ANTHROPIC_API_KEY` is set; otherwise a
  built-in assistant answers from the same plan data (store-level "why short", suggestions, terms, pages)
* **Live weather (real data)**: 7-day rainfall forecast from Open-Meteo for every warehouse/store; roads touching a site
  at or above the threshold (default 64.5 mm/day, IMD "heavy rain") can be closed and the plan re-made (What-if page).
  Only the weather is live; stock and demand remain synthetic. If the service is unreachable the API returns 503 - no
  weather is invented
* Animated maps: small 3D delivery trucks drive slowly along curved, fading arcs from warehouse to store; sending
  warehouses pulse; closed/unconnected roads are red dotted lines. The truck is rendered from
  `frontend/public/models/delivery_truck.glb` with three.js (16 headings, loaded on demand).
  **Model credit:** "Delivery Truck" by [Jasmin Daniel](https://sketchfab.com/jasmin.daniel),
  [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) - also shown in the map attribution
* **Warehouse popup + interactive 3D warehouse** (Map page): click a warehouse marker for its stock, simulated
  capacity and utilisation, stockout risks, expiring/blocked batches and products
  (`GET /api/warehouses/{id}/details`). **View 3D Warehouse** opens a three.js scene (lazy-loaded) with an
  industry-specific interior - Grocery pallet racking, Cosmetics beauty shelving, Pharmacy GDP shelving with a
  2-8 °C cold room - built from that warehouse's real batches: one bay per batch slot, status tags, a quarantine
  cage for blocked batches, loading dock with the GLB truck, and an animated forklift. Orbit/zoom/pan, zone camera
  presets, and click a shelf (or a product in the list) for batch, quantity, expiry and eligibility. Racks, pallets
  and cartons are instanced (about a dozen draw calls). A 2D plan is used when WebGL is unavailable. Rack/bin
  positions and storage capacity are simulated and labelled; quantities, batches and expiry come from MongoDB.
* P1-01 equity guardrail with cost of fairness · P1-02 disruption-regret score · P1-03 Leaflet map with list
  fallback · P1-05 F2/C3 storage rules and S4 cold-room failure
* MongoDB persistence (runs, overrides, forecast metrics), labelled snapshot fallback, JSON logs, `/api/metrics`

## Not implemented / incomplete

* **Real-time stock/demand data**: no public live dataset of distributor batches and orders exists; the app runs on the
  synthetic dataset. Plugging in a distributor's ERP export (CSV import) is the next step. Live data today = weather only.

* P1-04 Hindi/Marathi WhatsApp dispatch notes (needs a native-speaker check; not built).
* P1-06 live "add dairy" demo: a new YAML file loads and validates (tested), but the synthetic generator only
  has catalogs for the three modules, so a fourth module would not have data to plan with.
* Automated browser end-to-end tests; rate limiting; authentication/roles (future).
* Docker images and Compose were written but not built or run here (daemon unavailable).
* Validation fieldwork (interviews, survey, usability tests): template only, no findings.

## Known limitations

* Single planning period; no in-transit stock; no vehicle routing; no transfers between outlets.
* Distances are straight-line × 1.3, not road distances; map lines are not routes.
* Orders mode takes order quantities as given.
* Demand, prices and margins are synthetic; results do not prove real-world impact.
* The "lost sale share" (0.40) is a global benchmark used as an upper bound.
* Forecast WAPE is high in absolute terms because daily outlet-product counts are small and noisy; compare it
  with the reported noise floor.
* Diagnostics (rules-off run, insight re-solves) use a 3 s solver limit; their status is reported.

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI banner "Snapshot fallback - MongoDB down" | Start MongoDB or fix `MONGODB_URI`; runs are not persisted until it is back |
| `DATA_NOT_SEEDED` (503) | Run `python -m scripts.seed_database` from `backend/` |
| "Cannot reach the SahiSupply API" | Start the backend on port 8000 (the Vite proxy targets it) |
| First run is slow | Forecasters train once per module (~1-4 s) at startup, then are cached |
| Atlas connection timeout | Allow your IP in Atlas Network Access; raise `MONGODB_TIMEOUT_MS` |
