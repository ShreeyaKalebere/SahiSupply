"""Resolve a module config plus per-run toggles into the concrete rule set the engine enforces."""
from __future__ import annotations

from dataclasses import dataclass, field

from app.modules.config_loader import ModuleConfig


@dataclass(frozen=True)
class ActiveRules:
    min_life_rule_id: str | None = None
    min_life_days: int | None = None
    min_life_pct: float | None = None
    storage_rule_id: str | None = None
    storage_classes: frozenset[str] = frozenset()
    shortage_weights: dict[str, float] = field(default_factory=lambda: {"critical": 1.0, "standard": 1.0})
    fefo: bool = False
    fill_floor_rule_id: str | None = None
    fill_floor_pct: float | None = None
    fill_floor_classes: frozenset[str] = frozenset()
    enabled_ids: tuple[str, ...] = ()
    disabled_ids: tuple[str, ...] = ()

    def blocking_off(self) -> "ActiveRules":
        """Rules-off diagnostic: drop every blocking rule (shelf life and storage)."""
        return ActiveRules(
            shortage_weights=self.shortage_weights, fefo=self.fefo,
            fill_floor_rule_id=self.fill_floor_rule_id, fill_floor_pct=self.fill_floor_pct,
            fill_floor_classes=self.fill_floor_classes,
            enabled_ids=tuple(i for i in self.enabled_ids if i not in (self.min_life_rule_id, self.storage_rule_id)),
            disabled_ids=tuple(sorted({*self.disabled_ids, *(i for i in (self.min_life_rule_id, self.storage_rule_id) if i)})),
        )

    def as_spec(self) -> dict:
        """Plain-data form handed to the independent checker and the fingerprint."""
        return {
            "min_life_days": self.min_life_days,
            "min_life_pct": self.min_life_pct,
            "storage_classes": sorted(self.storage_classes),
            "shortage_weights": dict(sorted(self.shortage_weights.items())),
            "fefo": self.fefo,
            "fill_floor_pct": self.fill_floor_pct,
            "fill_floor_classes": sorted(self.fill_floor_classes),
            "enabled_ids": list(self.enabled_ids),
        }


def resolve_rules(config: ModuleConfig, toggles: dict[str, bool] | None = None) -> ActiveRules:
    toggles = toggles or {}
    unknown = set(toggles) - {r.id for r in config.rules}
    if unknown:
        raise ValueError(f"unknown rule ids for {config.industry}: {sorted(unknown)}")
    kw: dict = {"shortage_weights": {"critical": 1.0, "standard": 1.0}}
    enabled, disabled = [], []
    for rule in config.rules:
        if rule.status != "active":
            if toggles.get(rule.id):
                raise ValueError(f"rule {rule.id} is {rule.status} and cannot be enabled")
            continue
        on = toggles.get(rule.id, rule.default_on)
        (enabled if on else disabled).append(rule.id)
        if not on:
            continue
        p = rule.params
        if rule.template == "min_life_on_arrival":
            kw.update(min_life_rule_id=rule.id, min_life_days=p.min_days, min_life_pct=p.min_pct)
        elif rule.template == "storage_match":
            kw.update(storage_rule_id=rule.id, storage_classes=frozenset(p.classes))
        elif rule.template == "shortage_weight":
            kw["shortage_weights"] = {"critical": 1.0, "standard": 1.0, **p.weights}
        elif rule.template == "fefo":
            kw["fefo"] = p.enabled
        elif rule.template == "min_fill_floor":
            kw.update(fill_floor_rule_id=rule.id, fill_floor_pct=p.floor_pct,
                      fill_floor_classes=frozenset(p.classes))
    return ActiveRules(**kw, enabled_ids=tuple(enabled), disabled_ids=tuple(disabled))
