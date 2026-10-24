"""Industry configuration loader.

Each industry is a YAML file that selects rules from a fixed registry of typed
templates. Params are validated by a Pydantic model per template; unknown keys
are rejected and no code is ever evaluated from a config.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import get_settings

RuleStatus = Literal["active", "planned", "unavailable"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MinLifeParams(_Strict):
    min_days: int | None = Field(default=None, ge=0, le=3650)
    min_pct: float | None = Field(default=None, gt=0, le=100)

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.min_days is None) == (self.min_pct is None):
            raise ValueError("min_life_on_arrival needs exactly one of min_days or min_pct")
        return self


class StorageMatchParams(_Strict):
    classes: list[Literal["chilled", "2-8C"]] = Field(min_length=1)


class ShortageWeightParams(_Strict):
    weights: dict[Literal["critical", "standard"], float]

    @model_validator(mode="after")
    def _positive(self):
        if any(w <= 0 for w in self.weights.values()):
            raise ValueError("shortage weights must be positive")
        return self


class FefoParams(_Strict):
    enabled: bool = True


class MinFillFloorParams(_Strict):
    floor_pct: float = Field(gt=0, le=100)
    classes: list[Literal["critical", "standard"]] = Field(min_length=1)


class _RuleBase(_Strict):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,20}$")
    status: RuleStatus
    description: str = ""
    default_on: bool = True


class MinLifeRule(_RuleBase):
    template: Literal["min_life_on_arrival"]
    params: MinLifeParams


class StorageMatchRule(_RuleBase):
    template: Literal["storage_match"]
    params: StorageMatchParams


class ShortageWeightRule(_RuleBase):
    template: Literal["shortage_weight"]
    params: ShortageWeightParams


class FefoRule(_RuleBase):
    template: Literal["fefo"]
    params: FefoParams


class MinFillFloorRule(_RuleBase):
    template: Literal["min_fill_floor"]
    params: MinFillFloorParams


Rule = Annotated[
    Union[MinLifeRule, StorageMatchRule, ShortageWeightRule, FefoRule, MinFillFloorRule],
    Field(discriminator="template"),
]

TEMPLATES = ("min_life_on_arrival", "storage_match", "shortage_weight", "fefo", "min_fill_floor")


class Planning(_Strict):
    review_period_days: int = Field(ge=1, le=28)
    need_source: Literal["forecast", "orders"]


class ServiceLevels(_Strict):
    critical: float = Field(gt=0, le=4)
    standard: float = Field(gt=0, le=4)


class ModuleConfig(_Strict):
    industry: str = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
    display_name: str
    company: str | None = None
    company_name: str | None = None
    color: str | None = None
    description: str = ""
    destination_types: list[str] = Field(min_length=1)
    planning: Planning
    service_levels: ServiceLevels
    kpis: list[str] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_rule_ids(self):
        ids = [r.id for r in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule ids must be unique within a module")
        return self

    def rule(self, rule_id: str):
        return next((r for r in self.rules if r.id == rule_id), None)


class ConfigError(ValueError):
    pass


def load_config_file(path: Path) -> ModuleConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path.name}: invalid YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path.name}: top level must be a mapping")
    try:
        return ModuleConfig.model_validate(raw)
    except Exception as exc:  # pydantic.ValidationError
        raise ConfigError(f"{path.name}: {exc}") from exc


@lru_cache
def load_all_configs(configs_dir: str | None = None) -> dict[str, ModuleConfig]:
    directory = Path(configs_dir) if configs_dir else get_settings().configs_dir
    configs: dict[str, ModuleConfig] = {}
    for path in sorted(directory.glob("*.yaml")):
        cfg = load_config_file(path)
        configs[cfg.industry] = cfg
    if not configs:
        raise ConfigError(f"no industry configs found in {directory}")
    return configs


def get_config(module: str) -> ModuleConfig:
    configs = load_all_configs()
    if module not in configs:
        raise KeyError(module)
    return configs[module]
