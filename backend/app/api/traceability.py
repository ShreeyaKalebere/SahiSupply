"""Batch QR traceability: labels, code lookup, dispatch/delivery scans and the event log."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.common import ApiError, ok, require_module
from app.schemas.requests import TraceResolveRequest, TraceScanRequest
from app.services import run_store, traceability

router = APIRouter(prefix="/api/trace", tags=["traceability"])
PLAN = r"^PLN-[A-Z0-9]{6,20}$"


def _run(plan_id: str | None, required: bool = False) -> dict | None:
    if not plan_id:
        if required:
            raise ApiError(422, "PLAN_REQUIRED", "A plan is required for scanning")
        return None
    run = run_store.get(plan_id)
    if run is None:
        raise ApiError(404, "PLAN_NOT_FOUND", f"Plan {plan_id} not found")
    return run


@router.get("/labels")
def trace_labels(module: str = Query(..., pattern=r"^[a-z][a-z0-9_]{1,30}$"), plan_id: str | None = Query(None, pattern=PLAN),
                 warehouse_id: str | None = Query(None, pattern=r"^W\d{1,4}$"),
                 shipment_id: str | None = Query(None, pattern=r"^SHP-[A-Za-z0-9_]{1,30}-[A-Za-z0-9_]{1,30}$")):
    require_module(module)
    rows = traceability.labels(module, _run(plan_id), warehouse_id, shipment_id)
    return ok(rows, count=len(rows), notice=traceability.NOTICE)


@router.post("/resolve")
def trace_resolve(req: TraceResolveRequest):
    try:
        module, batch_id = traceability.parse(req.code)
    except traceability.InvalidCode as exc:
        raise ApiError(422, "INVALID_CODE", str(exc)) from None
    run = _run(req.plan_id)
    record = traceability.batch_record(module, batch_id, run if run and run["module"] == module else None)
    if record is None:
        raise ApiError(404, "UNKNOWN_BATCH", f"Batch {batch_id} is not in the database")
    return ok({"record": record, "events": traceability.events(batch_id=batch_id, limit=50)}, notice=traceability.NOTICE)


@router.post("/scan")
def trace_scan(req: TraceScanRequest):
    run = _run(req.plan_id, required=True)
    if run["status"] != "VALID" or not run.get("optimizer") or run.get("chaos"):
        raise ApiError(409, "PLAN_NOT_APPROVED", "Scanning needs a valid (approved), non-simulated plan")
    return ok(traceability.scan(req.code, run, req.stage, req.shipment_id, req.actor, req.device))


@router.get("/events")
def trace_events(plan_id: str | None = Query(None, pattern=PLAN), batch_id: str | None = Query(None, pattern=r"^B\d{3,6}$"),
                 shipment_id: str | None = Query(None, pattern=r"^SHP-[A-Za-z0-9_]{1,30}-[A-Za-z0-9_]{1,30}$"),
                 limit: int = Query(200, ge=1, le=1000)):
    rows = traceability.events(plan_id=plan_id, batch_id=batch_id, shipment_id=shipment_id, limit=limit)
    return ok(rows, count=len(rows))
