"""Dashboard, network entities, inventory, risks and forecasting endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.common import ApiError, ok, require_module
from app.database.connection import get_db, ping
from app.database.repositories import runs_repo
from app.forecasting.service import get_forecast
from app.schemas.requests import ForecastPredictRequest, ForecastTrainRequest
from app.services import data_service, views
from app.services.live_weather import IMD_HEAVY_RAIN_MM, LiveDataUnavailable, weather_closures

router = APIRouter(prefix="/api", tags=["network"])
ModuleQ = Query(..., pattern=r"^[a-z][a-z0-9_]{1,30}$")


@router.get("/dashboard")
def dashboard(module: str = ModuleQ, contested_pattern: bool = True):
    require_module(module)
    data = views.dashboard_view(module, contested_pattern)
    return ok(data, data_source=data["data_source"])


def _entities(module: str, key: str, contested_pattern: bool = True):
    require_module(module)
    ds, src = data_service.get_dataset(module, contested_pattern)
    return ok(ds[key], data_source=src, count=len(ds[key]))


@router.get("/warehouses")
def warehouses(module: str = ModuleQ):
    return _entities(module, "warehouses")


@router.get("/outlets")
def outlets(module: str = ModuleQ):
    return _entities(module, "outlets")


@router.get("/products")
def products(module: str = ModuleQ):
    return _entities(module, "products")


@router.get("/routes")
def routes(module: str = ModuleQ, contested_pattern: bool = True):
    return _entities(module, "routes", contested_pattern)


@router.get("/inventory")
def inventory(module: str = ModuleQ, scenario_id: str = Query("S0", pattern=r"^S[0-4]$"),
              contested_pattern: bool = True):
    require_module(module)
    data = views.inventory_view(module, scenario_id, contested_pattern)
    return ok(data, data_source=data["data_source"])


@router.get("/risks")
def risks(module: str = ModuleQ, contested_pattern: bool = True):
    require_module(module)
    data = views.risks_view(module, contested_pattern)
    return ok(data, data_source=data["data_source"])


@router.post("/forecast/train")
def forecast_train(req: ForecastTrainRequest):
    require_module(req.module)
    ds, src = data_service.get_dataset(req.module)
    fc = get_forecast(ds, req.module, refresh=req.refresh)
    payload = fc.metrics_payload()
    db_ok, _ = ping()
    if db_ok:
        from datetime import datetime, timezone
        runs_repo.save_forecast_metrics(get_db(), {**payload, "trained_at": datetime.now(timezone.utc)})
    return ok(payload, data_source=src, persisted=db_ok)


@router.post("/forecast/predict")
def forecast_predict(req: ForecastPredictRequest):
    require_module(req.module)
    try:
        data = views.forecast_chart(req.module, req.outlet_id, req.product_id)
    except KeyError:
        raise ApiError(404, "UNKNOWN_SERIES", "No demand series matches that outlet/product") from None
    return ok({"forecast": data["forecast"], "selection": data["selection"],
               "model": data["metrics"]["selected_model"]}, data_source=data["data_source"])


@router.get("/forecast/metrics")
def forecast_metrics(module: str = ModuleQ, outlet_id: str | None = Query(None, pattern=r"^D\d{1,4}$"),
                     product_id: str | None = Query(None, pattern=r"^P\d{2,4}$")):
    require_module(module)
    try:
        data = views.forecast_chart(module, outlet_id, product_id)
    except KeyError:
        raise ApiError(404, "UNKNOWN_SERIES", "No demand series matches that outlet/product") from None
    return ok(data, data_source=data["data_source"])


@router.get("/evaluation")
def evaluation(module: str = ModuleQ):
    require_module(module)
    return ok(views.fair_evaluation(module))


@router.get("/live/weather")
def live_weather(module: str = ModuleQ, contested_pattern: bool = True,
                 threshold_mm: float = Query(IMD_HEAVY_RAIN_MM, ge=0.1, le=500)):
    """Real 7-day rainfall forecast for every warehouse and store, and the roads heavy rain would close."""
    require_module(module)
    ds, src = data_service.get_dataset(module, contested_pattern)
    try:
        data = weather_closures(ds, threshold_mm)
    except LiveDataUnavailable as exc:
        raise ApiError(503, "LIVE_DATA_UNAVAILABLE", str(exc)) from None
    return ok(data, data_source=src, live=True)
