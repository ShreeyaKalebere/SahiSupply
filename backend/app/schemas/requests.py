"""Typed API request models (Pydantic). Size limits guard every free-text and collection field."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ModuleId = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
ScenarioId = Literal["S0", "S1", "S2", "S3", "S4"]


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NetworkEditRequest(_Req):
    warehouses: list[str] | None = Field(default=None, max_length=50)
    outlets: list[str] | None = Field(default=None, max_length=500)
    route_overrides: dict[str, bool] = Field(default_factory=dict, max_length=5000)


class RunRequest(_Req):
    module: str = ModuleId
    scenario_id: ScenarioId = "S0"
    rule_toggles: dict[str, bool] = Field(default_factory=dict, max_length=20)
    contested_pattern: bool = True
    include_insights: bool = True
    network: NetworkEditRequest | None = None


class ForecastTrainRequest(_Req):
    module: str = ModuleId
    refresh: bool = True


class ForecastPredictRequest(_Req):
    module: str = ModuleId
    outlet_id: str | None = Field(default=None, pattern=r"^D\d{1,4}$")
    product_id: str | None = Field(default=None, pattern=r"^P\d{2,4}$")


class OverrideRequest(_Req):
    batch_id: str = Field(pattern=r"^B\d{3,6}$")
    outlet_id: str = Field(pattern=r"^D\d{1,4}$")
    new_qty: int = Field(ge=-1_000_000, le=1_000_000)
    reason: str = Field(min_length=3, max_length=500)
    actor: str | None = Field(default=None, max_length=80)


class ChaosRequest(_Req):
    kind: Literal["warehouse_offline", "demand_surge", "road_closed", "supplier_delay", "fuel_cost"]
    warehouse_id: str | None = Field(default=None, pattern=r"^W\d{1,4}$")
    route_id: str | None = Field(default=None, pattern=r"^W\d{1,4}-D\d{1,4}$")
    region: str | None = Field(default=None, max_length=80)


class SimulationRequest(RunRequest):
    """Chaos / rescue run: same settings as a normal run, plus the plan to compare against."""
    before_plan_id: str | None = Field(default=None, pattern=r"^PLN-[A-Z0-9]{6,20}$")
    chaos: ChaosRequest | None = None


class DeliveryStatusRequest(_Req):
    status: Literal["dispatched", "in_transit", "delivered", "complete"]


class ChatMessage(_Req):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(_Req):
    module: str = ModuleId
    plan_id: str | None = Field(default=None, pattern=r"^PLN-[A-Z0-9]{6,20}$")
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
