"""Tiny hand-built planning problems for exact optimizer/checker tests."""
from __future__ import annotations

from datetime import date

from app.inventory.problem import NeedDetail, PlanningProblem
from app.modules.rules import ActiveRules

PLAN_DATE = date(2026, 10, 26)


def wh(wid, cap=1e6, status="operational"):
    return {"warehouse_id": wid, "name": f"WH {wid}", "city": "X", "lat": 19.0, "lon": 73.0, "region": "R1",
            "status": status, "cold_storage": True, "outbound_capacity_l": cap}


def outlet(did, cap=1e6, cold=1e6, storage=("ambient", "chilled", "2-8C"), region="R1", otype="clinic"):
    return {"outlet_id": did, "name": f"Outlet {did}", "type": otype, "city": "Y", "lat": 19.0, "lon": 73.0,
            "region": region, "remote": False, "storage": list(storage), "receiving_capacity_l": cap,
            "cold_capacity_l": cold}


def product(pid, storage="ambient", crit="standard", shelf=365, vol=1.0, cost=10.0, margin=5.0):
    return {"product_id": pid, "name": f"Prod {pid}", "category": "C", "storage_class": storage,
            "criticality": crit, "shelf_life_days": shelf, "unit_volume_l": vol, "unit_cost": cost,
            "unit_price": cost + margin, "unit_margin": margin}


def batch(bid, pid, wid, qty, expiry="2027-10-26"):
    return {"batch_id": bid, "product_id": pid, "warehouse_id": wid, "quantity": qty, "expiry_date": expiry,
            "manufacturing_date": "2025-10-26"}


def route(wid, did, cost_per_litre=1.0, lead=1, cap=1e6, open_=True):
    return {"route_id": f"{wid}-{did}", "warehouse_id": wid, "outlet_id": did, "distance_km": 100.0,
            "lead_time_days": lead, "cost_per_litre": cost_per_litre, "capacity_l": cap, "open": open_}


def problem(warehouses, outlets, products, batches, routes, need: dict, rules: ActiveRules | None = None,
            review=7) -> PlanningProblem:
    nd = {k: NeedDetail(k[0], k[1], q, "orders", order_qty=q) for k, q in need.items()}
    return PlanningProblem(
        module="test", scenario_id="S0", planning_date=PLAN_DATE, review_period_days=review,
        rules=rules or ActiveRules(),
        warehouses={w["warehouse_id"]: w for w in warehouses},
        outlets={o["outlet_id"]: o for o in outlets},
        products={p["product_id"]: p for p in products},
        batches={b["batch_id"]: b for b in batches},
        routes={(r["warehouse_id"], r["outlet_id"]): r for r in routes},
        need=dict(need), need_detail=nd,
    )
