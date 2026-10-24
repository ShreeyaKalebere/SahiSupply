"""Typed API request models (Pydantic). Size limits guard every free-text and collection field."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ModuleId = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
ScenarioId = Literal["S0", "S1", "S2", "S3", "S4"]


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RunRequest(_Req):
    module: str = ModuleId
    scenario_id: ScenarioId = "S0"
    rule_toggles: dict[str, bool] = Field(default_factory=dict, max_length=20)
    contested_pattern: bool = True
    include_insights: bool = True


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
