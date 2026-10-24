"""The planning problem: one scenario-applied snapshot of network data plus net need.

Every engine (optimizer, baseline, checker, KPIs, explanations) reads from this
same object so both plans are computed on identical inputs.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace
from datetime import date

from app.modules.rules import ActiveRules
from app.utils.fingerprint import fingerprint

COLD_CHAIN_COST_FACTOR = 1.6  # reefer surcharge on non-ambient products


@dataclass
class NeedDetail:
    outlet_id: str
    product_id: str
    need: int
    source: str                     # "forecast" | "orders"
    horizon_days: int = 0           # R + L_d
    lead_time_days: int = 0
    forecast_units: float = 0.0     # sum of forecast over the horizon
    safety_stock: float = 0.0       # z * sigma * sqrt(R + L)
    sigma: float = 0.0
    z: float = 0.0
    usable_on_hand: int = 0         # U(d,p)
    on_hand_total: int = 0
    order_qty: int = 0
    scenario_multiplier: float = 1.0

    def as_dict(self) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


@dataclass
class PlanningProblem:
    module: str
    scenario_id: str
    planning_date: date
    review_period_days: int
    rules: ActiveRules
    warehouses: dict[str, dict]
    outlets: dict[str, dict]
    products: dict[str, dict]
    batches: dict[str, dict]
    routes: dict[tuple[str, str], dict]          # (warehouse_id, outlet_id) -> route
    need: dict[tuple[str, str], int]             # (outlet_id, product_id) -> units
    need_detail: dict[tuple[str, str], NeedDetail] = field(default_factory=dict)
    data_source: str = "mongodb"
    contested_pattern: bool = True

    # ---- derived helpers ----
    def unit_cost(self, batch_id: str, outlet_id: str) -> float:
        b = self.batches[batch_id]
        p = self.products[b["product_id"]]
        r = self.routes[(b["warehouse_id"], outlet_id)]
        factor = COLD_CHAIN_COST_FACTOR if p["storage_class"] != "ambient" else 1.0
        return r["cost_per_litre"] * p["unit_volume_l"] * factor

    def batches_of(self, product_id: str) -> list[dict]:
        return [b for b in self.batches.values() if b["product_id"] == product_id]

    def raw_inputs(self) -> dict:
        """Plain-data snapshot used for fingerprinting and by the independent checker."""
        return {
            "module": self.module,
            "scenario_id": self.scenario_id,
            "planning_date": self.planning_date.isoformat(),
            "review_period_days": self.review_period_days,
            "rules": self.rules.as_spec(),
            "warehouses": sorted(self.warehouses.values(), key=lambda x: x["warehouse_id"]),
            "outlets": sorted(self.outlets.values(), key=lambda x: x["outlet_id"]),
            "products": sorted(self.products.values(), key=lambda x: x["product_id"]),
            "batches": sorted(self.batches.values(), key=lambda x: x["batch_id"]),
            "routes": sorted(self.routes.values(), key=lambda x: x["route_id"]),
            "need": [{"outlet_id": d, "product_id": p, "need": q}
                     for (d, p), q in sorted(self.need.items())],
        }

    def fingerprint(self) -> str:
        return fingerprint(self.raw_inputs())

    def with_rules(self, rules: ActiveRules) -> "PlanningProblem":
        return replace(self, rules=rules)

    def with_resource_delta(self, kind: str, key: str, delta: float) -> "PlanningProblem":
        """Copy of the problem with one resource limit raised by ``delta`` (insights re-solve)."""
        new = replace(self, warehouses=dict(self.warehouses), outlets=dict(self.outlets),
                      batches=dict(self.batches), routes=dict(self.routes))
        if kind == "stock":
            table, k, field_ = new.batches, key, "quantity"
        elif kind == "route":
            table, k, field_ = new.routes, next(rk for rk, r in new.routes.items() if r["route_id"] == key), "capacity_l"
        elif kind in ("cold", "receiving"):
            table, k, field_ = new.outlets, key, f"{kind}_capacity_l"
        elif kind == "outbound":
            table, k, field_ = new.warehouses, key, "outbound_capacity_l"
        else:
            raise ValueError(kind)
        row = copy.copy(table[k])
        row[field_] = int(row[field_] + delta) if kind == "stock" else row[field_] + delta
        table[k] = row
        return new


def build_problem(dataset: dict, *, module: str, scenario_id: str, rules: ActiveRules,
                  review_period_days: int, need_detail: dict[tuple[str, str], NeedDetail],
                  data_source: str = "mongodb") -> PlanningProblem:
    strip = lambda d: {k: v for k, v in d.items() if k not in ("_id", "module", "variant", "location")}
    return PlanningProblem(
        module=module,
        scenario_id=scenario_id,
        planning_date=date.fromisoformat(dataset["meta"]["planning_date"]),
        review_period_days=review_period_days,
        rules=rules,
        warehouses={w["warehouse_id"]: strip(w) for w in dataset["warehouses"]},
        outlets={o["outlet_id"]: strip(o) for o in dataset["outlets"]},
        products={p["product_id"]: strip(p) for p in dataset["products"]},
        batches={b["batch_id"]: strip(b) for b in dataset["batches"]},
        routes={(r["warehouse_id"], r["outlet_id"]): strip(r) for r in dataset["routes"]},
        need={k: v.need for k, v in need_detail.items()},
        need_detail=need_detail,
        data_source=data_source,
        contested_pattern=dataset["meta"].get("contested_pattern", True),
    )
