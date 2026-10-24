"""Scenario library (PRD 6.4). Each scenario is an explicit, deterministic change to the base dataset."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

SCENARIOS = {
    "S0": {"name": "Normal week", "priority": "P0", "change": "No disruptions."},
    "S1": {"name": "Festival spike", "priority": "P0", "change": "+40% demand for 5 products at 4 outlets."},
    "S2": {"name": "Warehouse outage", "priority": "P0", "change": "The largest warehouse (by outbound capacity) is closed."},
    "S3": {"name": "Monsoon closure", "priority": "P0",
           "change": "Routes from the 2 cheapest-serving warehouses into Western Maharashtra are closed (ghat roads)."},
    "S4": {"name": "Cold-room failure", "priority": "P1", "change": "One clinic's (or outlet's) cold capacity set to 0."},
}

FESTIVAL_UPLIFT = 1.4
MONSOON_REGION = "Western Maharashtra"


@dataclass
class AppliedScenario:
    scenario_id: str
    dataset: dict
    demand_multipliers: dict[tuple[str, str], float] = field(default_factory=dict)
    assumptions: list[str] = field(default_factory=list)
    changes: dict = field(default_factory=dict)


def _total_demand(dataset: dict, key: str) -> dict[str, int]:
    tot: dict[str, int] = {}
    for r in dataset["demand_history"]:
        tot[r[key]] = tot.get(r[key], 0) + r["qty"]
    return tot


def apply_scenario(dataset: dict, scenario_id: str) -> AppliedScenario:
    if scenario_id not in SCENARIOS:
        raise KeyError(scenario_id)
    ds = {k: (copy.deepcopy(v) if k in ("warehouses", "outlets", "routes", "meta") else v)
          for k, v in dataset.items()}
    ds["meta"]["scenario_id"] = scenario_id
    sc = AppliedScenario(scenario_id, ds, assumptions=[SCENARIOS[scenario_id]["change"]])

    if scenario_id == "S1":
        by_p = _total_demand(dataset, "product_id")
        by_d = _total_demand(dataset, "outlet_id")
        prods = sorted(by_p, key=lambda p: (-by_p[p], p))[:5]
        outs = sorted(by_d, key=lambda d: (-by_d[d], d))[:4]
        sc.demand_multipliers = {(d, p): FESTIVAL_UPLIFT for d in outs for p in prods}
        sc.changes = {"products": prods, "outlets": outs, "uplift": FESTIVAL_UPLIFT}
        sc.assumptions.append(f"Uplift applied to the forecast and open orders of products {', '.join(prods)} "
                              f"at outlets {', '.join(outs)} (the 5 highest-volume products, 4 highest-volume outlets).")

    elif scenario_id == "S2":
        w = max(ds["warehouses"], key=lambda w: (w["outbound_capacity_l"], w["warehouse_id"]))
        w["status"] = "closed"
        sc.changes = {"closed_warehouses": [w["warehouse_id"]]}
        sc.assumptions.append(f"{w['warehouse_id']} {w['name']} closed; its stock cannot be shipped this cycle.")

    elif scenario_id == "S3":
        region_outlets = {o["outlet_id"] for o in ds["outlets"] if o["region"] == MONSOON_REGION}
        avg_cost: dict[str, list[float]] = {}
        for r in ds["routes"]:
            if r["outlet_id"] in region_outlets:
                avg_cost.setdefault(r["warehouse_id"], []).append(r["cost_per_litre"])
        closed_w = sorted(avg_cost, key=lambda w: (sum(avg_cost[w]) / len(avg_cost[w]), w))[:2]
        closed = []
        for r in ds["routes"]:
            if r["outlet_id"] in region_outlets and r["warehouse_id"] in closed_w and r["open"]:
                r["open"] = False
                closed.append(r["route_id"])
        sc.changes = {"region": MONSOON_REGION, "warehouses": closed_w, "closed_routes": sorted(closed)}
        sc.assumptions.append(f"Closed {len(closed)} routes from {', '.join(closed_w)} into {MONSOON_REGION}.")

    elif scenario_id == "S4":
        cands = [o for o in ds["outlets"] if o["cold_capacity_l"] > 0]
        clinics = [o for o in cands if o["type"] == "clinic"]
        pool = clinics or [o for o in cands if o.get("remote")] or cands
        target = next((o for o in pool if o["outlet_id"] == "D9"), pool[0]) if pool else None
        if target:
            sc.changes = {"outlet": target["outlet_id"], "cold_capacity_before_l": target["cold_capacity_l"]}
            target["cold_capacity_l"] = 0.0
            sc.assumptions.append(f"{target['name']} ({target['outlet_id']}) cold capacity set to 0.")
    return sc


def list_scenarios() -> list[dict]:
    return [{"id": k, **v} for k, v in SCENARIOS.items()]
