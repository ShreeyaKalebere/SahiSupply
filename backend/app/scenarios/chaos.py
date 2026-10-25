"""Chaos Mode: controlled, user-triggered disruptions (not real-time disruption detection).

Each disruption is applied to the scenario's private copy of the data after the scenario and
network edits, so the stored operational data is never changed and the same inputs always give
the same plan. The rest of the run (forecast, net need, MILP, checker) is unchanged.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

KINDS = {
    "warehouse_offline": "Warehouse suddenly goes offline",
    "demand_surge": "Demand increases by 50%",
    "road_closed": "Major road becomes unavailable",
    "supplier_delay": "Supplier shipment is delayed",
    "fuel_cost": "Fuel / transport costs increase by 30%",
}
DEMAND_UPLIFT = 1.5
FUEL_UPLIFT = 1.3
DELAYED_SHARE = 1 / 3


class ChaosError(ValueError):
    pass


@dataclass
class ChaosEdit:
    kind: str
    warehouse_id: str | None = None   # warehouse_offline, supplier_delay
    route_id: str | None = None       # road_closed
    region: str | None = None         # demand_surge (None = whole network)

    def as_dict(self) -> dict:
        return asdict(self)


def apply_chaos(ds: dict, edit: ChaosEdit) -> tuple[dict, dict[tuple[str, str], float]]:
    """Apply the disruption to ``ds`` (a scenario copy). Returns (summary, demand multipliers)."""
    if edit.kind not in KINDS:
        raise ChaosError(f"unknown disruption {edit.kind!r}")
    wh = {w["warehouse_id"]: w for w in ds["warehouses"]}
    summary: dict = {"kind": edit.kind, "label": KINDS[edit.kind], "params": edit.as_dict(), "closed_routes": [],
                     "offline_warehouses": [], "delayed_batches": [], "delayed_units": 0, "demand_uplift": None,
                     "cost_uplift": None, "assumptions": []}
    multipliers: dict[tuple[str, str], float] = {}

    def need_wh() -> dict:
        if not edit.warehouse_id or edit.warehouse_id not in wh:
            raise ChaosError("choose a warehouse in the current network")
        return wh[edit.warehouse_id]

    if edit.kind == "warehouse_offline":
        w = need_wh()
        if w["status"] == "closed":
            raise ChaosError(f"{w['warehouse_id']} is already closed")
        w["status"] = "closed"
        summary["offline_warehouses"] = [w["warehouse_id"]]
        summary["assumptions"].append(f"{w['warehouse_id']} {w['name']} offline: none of its stock can ship this cycle.")

    elif edit.kind == "demand_surge":
        outs = [o for o in ds["outlets"] if edit.region in (None, "", o["region"])]
        if not outs:
            raise ChaosError(f"no stores in region {edit.region!r}")
        prods = {p["product_id"] for p in ds["products"]}
        multipliers = {(o["outlet_id"], p): DEMAND_UPLIFT for o in outs for p in prods}
        summary["demand_uplift"] = DEMAND_UPLIFT
        summary["affected_outlets"] = sorted(o["outlet_id"] for o in outs)
        summary["assumptions"].append(f"Forecast and open orders x{DEMAND_UPLIFT} for every product at "
                                      f"{len(outs)} store(s){' in ' + edit.region if edit.region else ' (whole network)'}.")

    elif edit.kind == "road_closed":
        route = next((r for r in ds["routes"] if r["route_id"] == edit.route_id), None)
        if route is None:
            raise ChaosError("choose a road in the current network")
        if not route["open"]:
            raise ChaosError(f"road {edit.route_id} is already closed")
        route["open"] = False
        summary["closed_routes"] = [route["route_id"]]
        summary["affected_outlets"] = [route["outlet_id"]]
        summary["assumptions"].append(f"Road {route['route_id']} ({route['distance_km']:.0f} km) closed this cycle.")

    elif edit.kind == "supplier_delay":
        w = need_wh()
        mine = sorted((b for b in ds["batches"] if b["warehouse_id"] == w["warehouse_id"]),
                      key=lambda b: (b["manufacturing_date"], b["batch_id"]), reverse=True)
        if not mine:
            raise ChaosError(f"{w['warehouse_id']} holds no stock")
        delayed = mine[:max(1, round(len(mine) * DELAYED_SHARE))]
        ids = {b["batch_id"] for b in delayed}
        ds["batches"] = [b for b in ds["batches"] if b["batch_id"] not in ids]   # new list: source data untouched
        summary["delayed_batches"] = sorted(ids)
        summary["delayed_units"] = sum(b["quantity"] for b in delayed)
        summary["assumptions"].append(
            f"Simulated supplier delay: the data has no supplier records, so the newest third of {w['warehouse_id']}'s "
            f"batches by manufacturing date ({len(ids)} batches, {summary['delayed_units']} units) is treated as the "
            "inbound supplier shipment and arrives after this planning week.")

    elif edit.kind == "fuel_cost":
        for r in ds["routes"]:
            r["cost_per_litre"] = round(r["cost_per_litre"] * FUEL_UPLIFT, 4)
        summary["cost_uplift"] = FUEL_UPLIFT
        summary["assumptions"].append(f"Every road's cost per litre x{FUEL_UPLIFT} (fuel price shock).")

    return summary, multipliers
