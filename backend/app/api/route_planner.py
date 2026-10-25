"""Route planner: user-connected multi-stop truck trips with distance, time, cost and deadline feasibility."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from app.api.common import ApiError, ok, require_module
from app.schemas.requests import RoutePlanRequest, SourceRequest
from app.services import route_planner, run_store, sourcing

router = APIRouter(prefix="/api/routes", tags=["route planner"])


@router.post("/plan")
def plan_route(req: RoutePlanRequest):
    require_module(req.module)
    run = None
    if req.plan_id:
        run = run_store.get(req.plan_id)
        if run is None:
            raise ApiError(404, "PLAN_NOT_FOUND", f"Plan {req.plan_id} not found")
        if run["module"] != req.module:
            raise ApiError(422, "MODULE_MISMATCH", "The plan belongs to another industry module")
    for name in ("dispatch_at", "deadline_at"):
        v = getattr(req, name)
        if v:
            try:
                datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                raise ApiError(422, "BAD_DATETIME", f"{name} must be an ISO date-time") from None
    try:
        data = route_planner.plan_route(
            req.module, run["contested_pattern"] if run else req.contested_pattern, run,
            [s.model_dump() for s in req.stops], req.mode,
            req.model_dump(include={"dispatch_at", "deadline_at", "deadline_type", "speed_kmh", "load_min", "unload_min", "per_unit_min"}))
    except route_planner.RouteInputError as exc:
        raise ApiError(422, "ROUTE_INPUT", str(exc)) from None
    return ok(data)


@router.post("/source")
def source_order(req: SourceRequest):
    """A store needs N units of a product: pick warehouses by availability and mode, and build the path."""
    require_module(req.module)
    run = run_store.get(req.plan_id)
    if run is None:
        raise ApiError(404, "PLAN_NOT_FOUND", f"Plan {req.plan_id} not found")
    if run["module"] != req.module:
        raise ApiError(422, "MODULE_MISMATCH", "The plan belongs to another industry module")
    for name in ("dispatch_at", "deadline_at"):
        v = getattr(req, name)
        if v:
            try:
                datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                raise ApiError(422, "BAD_DATETIME", f"{name} must be an ISO date-time") from None
    try:
        data = sourcing.source_order(run, req.outlet_id, req.product_id, req.quantity, req.mode,
                                     req.model_dump(include={"dispatch_at", "deadline_at", "deadline_type", "speed_kmh",
                                                             "load_min", "unload_min", "per_unit_min", "on_top_of_plan"}))
    except sourcing.SourcingError as exc:
        raise ApiError(422, "SOURCING_INPUT", str(exc)) from None
    return ok(data)
