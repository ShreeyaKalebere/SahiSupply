"""SahiSupply FastAPI application."""
from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import assistant, network, optimization, system
from app.config import REPO_ROOT, get_settings
from app.database.connection import DatabaseUnavailable, get_db, ping
from app.database.indexes import ensure_schema
from app.modules.config_loader import ConfigError, load_all_configs
from app.services.data_service import DatasetNotSeeded
from app.services.planner import PlanningInputError


class JsonFormatter(logging.Formatter):
    def format(self, record):
        base = {"ts": self.formatTime(record), "level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        return json.dumps(base)


def _setup_logging():
    h = logging.StreamHandler()
    h.setFormatter(JsonFormatter())
    root = logging.getLogger("sahisupply")
    root.handlers[:] = [h]
    root.setLevel(logging.INFO)
    root.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_logging()
    log = logging.getLogger("sahisupply")
    load_all_configs()  # fail fast on an invalid industry config
    db_ok, why = ping()
    if db_ok:
        ensure_schema(get_db())
        log.info("MongoDB connected; schema ensured")
    else:
        log.warning("MongoDB unavailable (%s): serving the read-only synthetic snapshot", why)
    if get_settings().app_env != "test":
        threading.Thread(target=_warm_forecasts, daemon=True).start()
    yield


def _warm_forecasts():
    """Train each module's forecaster in the background so the first plan run is fast."""
    from app.forecasting.service import get_forecast
    from app.services import data_service
    for module in load_all_configs():
        try:
            ds, _ = data_service.get_dataset(module)
            get_forecast(ds, module)
        except Exception:  # noqa: BLE001 - warm-up is best effort; real requests surface errors
            logging.getLogger("sahisupply").warning("forecast warm-up failed for %s", module)


app = FastAPI(title="SahiSupply API", version="1.0.0",
              description="Explainable, expiry-aware distribution planning. All data is synthetic.",
              lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Time-ms"] = f"{(time.perf_counter() - t0) * 1000:.0f}"
    return response


def _err(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


@app.exception_handler(StarletteHTTPException)
async def http_exc(_, exc: StarletteHTTPException):
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return _err(exc.status_code, exc.detail["code"], exc.detail["message"], exc.detail.get("details"))
    return _err(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_exc(_, exc: RequestValidationError):
    details = [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return _err(422, "INVALID_INPUT", "Request validation failed", details)


@app.exception_handler(PlanningInputError)
async def planning_exc(_, exc: PlanningInputError):
    return _err(422, "INVALID_PLANNING_INPUT", str(exc))


@app.exception_handler(DatasetNotSeeded)
async def notseeded_exc(_, exc: DatasetNotSeeded):
    return _err(503, "DATA_NOT_SEEDED", str(exc))


@app.exception_handler(DatabaseUnavailable)
async def db_exc(_, exc: DatabaseUnavailable):
    return _err(503, "DATABASE_UNAVAILABLE", str(exc))


@app.exception_handler(ConfigError)
async def config_exc(_, exc: ConfigError):
    return _err(500, "CONFIG_ERROR", str(exc))


@app.exception_handler(Exception)
async def unhandled(_, exc: Exception):
    logging.getLogger("sahisupply").exception("unhandled error")
    return _err(500, "INTERNAL_ERROR", "Unexpected server error. See server logs for details.")


app.include_router(system.router)
app.include_router(network.router)
app.include_router(optimization.router)
app.include_router(assistant.router)

# Serve the built frontend (single-image deployment) when present.
_dist = Path(REPO_ROOT / "frontend" / "dist")
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return _err(404, "NOT_FOUND", "Unknown API route")
        f = _dist / path
        return FileResponse(f if path and f.is_file() else _dist / "index.html")
