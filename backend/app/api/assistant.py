"""Chat assistant endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.common import ApiError, ok, require_module
from app.schemas.requests import ChatRequest
from app.services import data_service, run_store
from app.services.assistant import SUGGESTIONS, answer, build_context, claude_available

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/status")
def status():
    return ok({"engine": "claude" if claude_available() else "built-in", "suggestions": SUGGESTIONS})


@router.post("/chat")
def chat(req: ChatRequest):
    require_module(req.module)
    if req.messages[-1].role != "user":
        raise ApiError(422, "INVALID_INPUT", "The last message must be from the user")
    run = run_store.get(req.plan_id) if req.plan_id else None
    if run is not None and run["module"] != req.module:
        run = None
    ds, _ = data_service.get_dataset(req.module)
    names = {w["warehouse_id"]: w["name"] for w in ds["warehouses"]}
    ctx = build_context(run, req.module, names)
    result = answer([m.model_dump() for m in req.messages], ctx)
    return ok({**result, "suggestions": SUGGESTIONS, "plan_id": run["plan_id"] if run else None})
