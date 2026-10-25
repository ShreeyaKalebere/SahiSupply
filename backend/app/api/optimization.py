"""Optimization runs, explanations, insights, overrides, export and scenario endpoints."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Path, Query
from fastapi.responses import StreamingResponse

from app.api.common import ApiError, metrics, ok, require_module
from app.scenarios.custom import NetworkEdit
from app.schemas.requests import DeliveryStatusRequest, OverrideRequest, RunRequest
from app.services import delivery_status, run_store
from app.services.overrides import OverrideRejected, apply_override
from app.services.planner import run_plan

router = APIRouter(prefix="/api", tags=["optimization"])

HIDDEN = ("raw_inputs",)


def public_run(run: dict) -> dict:
    return {k: v for k, v in run.items() if k not in HIDDEN}


def _network(req: RunRequest) -> NetworkEdit | None:
    if req.network is None:
        return None
    return NetworkEdit(warehouses=req.network.warehouses, outlets=req.network.outlets,
                       route_overrides=req.network.route_overrides)


def _execute(req: RunRequest) -> dict:
    require_module(req.module)
    run = run_plan(req.module, req.scenario_id, rule_toggles=req.rule_toggles,
                   contested_pattern=req.contested_pattern, include_insights=req.include_insights,
                   network=_network(req))
    metrics.inc("runs")
    metrics.inc({"VALID": "runs_valid", "INVALID": "runs_invalid", "SOLVER_FAILED": "solver_failures"}[run["status"]])
    if run["data_source"] == "snapshot":
        metrics.inc("snapshot_fallbacks")
    if run.get("optimizer"):
        metrics.inc("checker_violations", run["optimizer"]["check"]["violation_count"])
        metrics.solve(run["optimizer"]["solver"]["solve_seconds"])
    return run_store.save(run)


@router.post("/optimization/run")
def optimization_run(req: RunRequest):
    run = _execute(req)
    return ok(public_run(run), data_source=run["data_source"], persisted=run["persisted"])


@router.get("/optimization/history")
def optimization_history(module: str | None = Query(None, pattern=r"^[a-z][a-z0-9_]{1,30}$"),
                         limit: int = Query(50, ge=1, le=200)):
    rows, source = run_store.history(module, limit)
    return ok(rows, source=source, count=len(rows))


def _get(plan_id: str) -> dict:
    run = run_store.get(plan_id)
    if run is None:
        raise ApiError(404, "PLAN_NOT_FOUND", f"Plan {plan_id} not found")
    return run


@router.get("/optimization/{plan_id}")
def optimization_get(plan_id: str):
    run = _get(plan_id)
    return ok(public_run(run), data_source=run["data_source"], persisted=run.get("persisted", True))


@router.get("/optimization/{plan_id}/explanations")
def optimization_explanations(plan_id: str, outlet_id: str | None = None, product_id: str | None = None):
    run = _get(plan_id)
    rows = [e for e in run["explanations"] if outlet_id in (None, e["outlet_id"]) and product_id in (None, e["product_id"])]
    return ok(rows, plan_status=run["plan_status"], count=len(rows))


@router.get("/optimization/{plan_id}/insights")
def optimization_insights(plan_id: str):
    run = _get(plan_id)
    if run.get("insights") is None:
        raise ApiError(404, "NO_INSIGHTS", "Insights were not computed for this plan")
    return ok(run["insights"], plan_status=run["plan_status"])


@router.post("/optimization/{plan_id}/override")
def optimization_override(plan_id: str, req: OverrideRequest):
    run = _get(plan_id)
    try:
        updated = apply_override(run, batch_id=req.batch_id, outlet_id=req.outlet_id, new_qty=req.new_qty,
                                 reason=req.reason, actor=req.actor)
    except OverrideRejected as exc:
        metrics.inc("overrides_rejected")
        raise ApiError(422, "OVERRIDE_REJECTED", str(exc), {"violations": exc.violations}) from None
    metrics.inc("overrides_accepted")
    return ok(public_run(updated), persisted=updated.get("persisted", False))


@router.get("/optimization/{plan_id}/overrides")
def optimization_overrides(plan_id: str):
    _get(plan_id)
    return ok(run_store.overrides(plan_id))


def _approved(plan_id: str) -> dict:
    run = _get(plan_id)
    if run["status"] != "VALID" or not run.get("optimizer") or run.get("chaos"):
        raise ApiError(409, "PLAN_NOT_APPROVED", "Only a valid (approved), non-simulated plan has deliveries to track")
    return run


@router.get("/optimization/{plan_id}/deliveries")
def optimization_deliveries(plan_id: str):
    rows, persisted = delivery_status.list_for_run(_approved(plan_id))
    return ok(rows, count=len(rows), persisted=persisted, statuses=list(delivery_status.STATUSES))


@router.post("/optimization/{plan_id}/deliveries/{shipment_id}/status")
def optimization_delivery_status(plan_id: str, req: DeliveryStatusRequest,
                                 shipment_id: str = Path(pattern=r"^SHP-[A-Za-z0-9_]{1,30}-[A-Za-z0-9_]{1,30}$")):
    run = _approved(plan_id)
    try:
        row, persisted = delivery_status.advance(run, shipment_id, req.status)
    except delivery_status.UnknownShipment:
        raise ApiError(404, "UNKNOWN_SHIPMENT", f"Shipment {shipment_id} is not in plan {plan_id}") from None
    except delivery_status.InvalidTransition as exc:
        raise ApiError(409, "INVALID_TRANSITION", str(exc), {"current": exc.current, "allowed": exc.allowed}) from None
    return ok(row, persisted=persisted)


@router.get("/optimization/{plan_id}/export.csv")
def optimization_export(plan_id: str, plan: str = Query("optimizer", pattern="^(optimizer|baseline)$")):
    run = _get(plan_id)
    section = run.get(plan)
    if section is None:
        raise ApiError(404, "NO_PLAN", f"No {plan} plan in this run")
    valid = section["check"]["valid"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["# SahiSupply pick list (FEFO order) - SYNTHETIC DATA"])
    w.writerow(["# module", run["module_name"], "scenario", f"{run['scenario_id']} {run['scenario']['name']}"])
    w.writerow(["# plan", plan, "plan_id", run["plan_id"], "version", run.get("version", 1)])
    w.writerow(["# plan_status", run["plan_status"] if plan == "optimizer" else ("VALID" if valid else "INVALID"),
                "checker_valid", valid])
    w.writerow(["# data_fingerprint", run["fingerprint"]])
    w.writerow(["# planning_date", run["planning_date"], "generated_at", datetime.now(timezone.utc).isoformat()])
    w.writerow(["warehouse_id", "warehouse_name", "batch_id", "expiry_date", "product_id", "product_name",
                "outlet_id", "outlet_name", "quantity", "lead_time_days", "life_on_arrival_days", "unit_cost_rs",
                "line_cost_rs"])
    for ln in sorted(section["lines"], key=lambda x: (x["warehouse_id"], x["expiry_date"], x["batch_id"],
                                                      int(x["outlet_id"][1:]))):
        w.writerow([ln["warehouse_id"], ln["warehouse_name"], ln["batch_id"], ln["expiry_date"], ln["product_id"],
                    ln["product_name"], ln["outlet_id"], ln["outlet_name"], ln["qty"], ln["lead_time_days"],
                    ln["life_on_arrival_days"], f"{ln['unit_cost']:.2f}", f"{ln['line_cost']:.2f}"])
    fname = f"sahisupply_{run['module']}_{run['scenario_id']}_{run['plan_id']}_{plan}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


def plan_diff(s0: dict, run: dict) -> dict:
    """Row-by-row allocation changes and KPI deltas between a reference plan and a changed one."""
    a = {(r["outlet_id"], r["product_id"]): r for r in s0["allocation"]}
    b = {(r["outlet_id"], r["product_id"]): r for r in run["allocation"]}
    changed = []
    for k in sorted(set(a) | set(b), key=lambda k: (int(k[0][1:]), k[1])):
        ra, rb = a.get(k), b.get(k)
        src_a = {(s["warehouse_id"], s["batch_id"]): s["qty"] for s in (ra or {}).get("sources", [])}
        src_b = {(s["warehouse_id"], s["batch_id"]): s["qty"] for s in (rb or {}).get("sources", [])}
        if ra and rb and src_a == src_b and ra["required"] == rb["required"]:
            continue
        ref = rb or ra
        changed.append({
            "outlet_id": k[0], "outlet_name": ref["outlet_name"], "product_id": k[1],
            "product_name": ref["product_name"], "region": ref["region"],
            "s0_required": ra["required"] if ra else 0, "scenario_required": rb["required"] if rb else 0,
            "s0_allocated": ra["allocated"] if ra else 0, "scenario_allocated": rb["allocated"] if rb else 0,
            "s0_unmet": ra["unmet"] if ra else 0, "scenario_unmet": rb["unmet"] if rb else 0,
            "s0_sources": sorted(f"{w}:{b}" for w, b in src_a), "scenario_sources": sorted(f"{w}:{b}" for w, b in src_b),
        })
    ko, ks = s0["optimizer"]["kpis"], run["optimizer"]["kpis"]
    return {"changed_rows": changed, "changed_count": len(changed),
            "kpi_delta": {k: ks[k] - ko[k] for k in ("fill_rate", "unmet_units", "transport_cost",
                                                     "critical_shortage_units", "expiry_risk_units")},
            "s0_kpis": ko, "s0_fingerprint": s0["fingerprint"]}


@router.post("/scenarios/run")
def scenarios_run(req: RunRequest):
    """Run a scenario and diff its plan against a freshly solved S0 plan on the same settings."""
    run = _execute(req)
    diff = None
    if req.scenario_id != "S0" and run.get("optimizer"):
        s0 = run_plan(req.module, "S0", rule_toggles=req.rule_toggles, contested_pattern=req.contested_pattern,
                      include_insights=False, include_regret=False, network=_network(req))
        if s0.get("optimizer"):
            diff = plan_diff(s0, run)
    return ok({"run": public_run(run), "diff": diff}, data_source=run["data_source"], persisted=run["persisted"])
