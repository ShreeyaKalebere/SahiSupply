"""Warehouse detail view for the map popup and the 3D warehouse.

Real (from the database, synthetic sample data): the warehouse record, every batch it holds with
quantity, expiry and shelf-life eligibility, network supply shortfalls, and - when a plan is given -
what this warehouse ships this week. Simulated for demonstration and labelled as such: storage
capacity (no such field exists in the data) and rack/bin positions (built in the frontend).
"""
from __future__ import annotations

from app.modules.config_loader import get_config
from app.services import data_service, run_store
from app.services.views import inventory_view, risks_view

# Storage capacity is not part of the dataset; the demo assumes the building holds 1.6x what it can
# dispatch in a week. Always returned with simulated=True.
STORAGE_CAPACITY_FACTOR = 1.6
LOW_STOCK_SHARE = 0.10   # stock left after this week's plan below 10% of today's stock = stockout risk
EXPIRING_LIFE_PCT = 25.0  # under 25% of shelf life left counts as expiring soon


class WarehouseNotFound(KeyError):
    pass


def _status(row: dict) -> str:
    if row["eligibility"] == "blocked":
        return "blocked"
    if row["expiry_risk"] or row["remaining_life_pct"] < EXPIRING_LIFE_PCT:
        return "expiring"
    return "ok"


def warehouse_details(module: str, warehouse_id: str, *, contested_pattern: bool = True,
                      plan_id: str | None = None) -> dict:
    ds, source = data_service.get_dataset(module, contested_pattern)
    wh = next((w for w in ds["warehouses"] if w["warehouse_id"] == warehouse_id), None)
    if wh is None:
        raise WarehouseNotFound(warehouse_id)
    products = {p["product_id"]: p for p in ds["products"]}
    cfg = get_config(module)

    inv = inventory_view(module, "S0", contested_pattern)
    rows = [r for r in inv["rows"] if r["warehouse_id"] == warehouse_id]

    run = run_store.get(plan_id) if plan_id else None
    if run is not None and run.get("module") != module:
        run = None
    shipped: dict[str, int] = {}
    if run and run.get("optimizer"):
        for ln in run["optimizer"]["lines"]:
            if ln["warehouse_id"] == warehouse_id:
                shipped[ln["product_id"]] = shipped.get(ln["product_id"], 0) + ln["qty"]

    batches = []
    for r in rows:
        p = products[r["product_id"]]
        batches.append({
            "batch_id": r["batch_id"], "product_id": r["product_id"], "product_name": r["product_name"],
            "category": r["category"], "storage_class": r["storage_class"], "criticality": r["criticality"],
            "quantity": r["quantity"], "volume_l": round(r["quantity"] * p["unit_volume_l"], 2),
            "expiry_date": r["expiry_date"], "days_to_expiry": r["days_to_expiry"],
            "remaining_life_pct": round(r["remaining_life_pct"], 1), "eligible_outlets": r["eligible_outlets"],
            "total_outlets": r["total_outlets"], "block_reasons": r["block_reasons"], "status": _status(r),
        })
    batches.sort(key=lambda b: (b["product_id"], b["expiry_date"]))

    prod_rows: dict[str, dict] = {}
    for b in batches:
        pr = prod_rows.setdefault(b["product_id"], {
            "product_id": b["product_id"], "name": b["product_name"], "category": b["category"],
            "storage_class": b["storage_class"], "criticality": b["criticality"], "units": 0, "volume_l": 0.0,
            "batches": 0, "nearest_expiry": b["expiry_date"], "statuses": set()})
        pr["units"] += b["quantity"]
        pr["volume_l"] += b["volume_l"]
        pr["batches"] += 1
        pr["nearest_expiry"] = min(pr["nearest_expiry"], b["expiry_date"])
        pr["statuses"].add(b["status"])
    shortfall = {s["product_id"]: s for s in risks_view(module, contested_pattern)["supply_shortfall"]}

    product_list, stockout = [], []
    for pid, pr in prod_rows.items():
        sent = shipped.get(pid, 0) if run else None
        left = pr["units"] - sent if sent is not None else None
        statuses = pr.pop("statuses")
        pr["volume_l"] = round(pr["volume_l"], 2)
        pr["status"] = "blocked" if statuses == {"blocked"} else "expiring" if statuses & {"expiring", "blocked"} else "ok"
        pr["shipped_this_week"] = sent
        pr["units_after_plan"] = left
        if left is not None and left <= LOW_STOCK_SHARE * pr["units"]:
            pr["status"] = "low"
            stockout.append({"product_id": pid, "name": pr["name"], "units_left": left,
                             "reason": f"Only {left} of {pr['units']} units left after this week's plan"})
        elif pid in shortfall:
            s = shortfall[pid]
            stockout.append({"product_id": pid, "name": pr["name"], "units_left": left,
                             "reason": f"Network-wide, forecast need ({s['forecast_need']:.0f}) exceeds safe stock ({s['eligible_supply']})"})
        product_list.append(pr)
    product_list.sort(key=lambda x: -x["units"])

    total_vol = sum(b["volume_l"] for b in batches)
    cold_vol = sum(b["volume_l"] for b in batches if b["storage_class"] != "ambient")
    capacity = round(STORAGE_CAPACITY_FACTOR * wh["outbound_capacity_l"], 1)
    return {
        "warehouse": {k: wh[k] for k in ("warehouse_id", "name", "city", "region", "lat", "lon", "status",
                                         "cold_storage", "outbound_capacity_l")},
        "industry": {"module": module, "name": cfg.display_name},
        "operator": "SahiSupply sample distribution network (synthetic, not a real company)",
        "metrics": {
            "total_units": sum(b["quantity"] for b in batches), "total_volume_l": round(total_vol, 1),
            "cold_volume_l": round(cold_vol, 1), "ambient_volume_l": round(total_vol - cold_vol, 1),
            "storage_capacity_l": capacity, "storage_capacity_simulated": True,
            "utilization": round(total_vol / capacity, 4) if capacity else None,
            "batches": len(batches), "products": len(product_list),
            "expiring_batches": sum(1 for b in batches if b["status"] != "ok"),
        },
        "products": product_list,
        "batches": batches,
        "stockout_risks": stockout,
        "expiring_batches": [b for b in sorted(batches, key=lambda b: b["days_to_expiry"]) if b["status"] != "ok"],
        "plan_id": run["plan_id"] if run else None,
        "planning_date": inv["planning_date"],
        "data_source": source,
        "data_notes": {
            "from_database": "Stock, batches, expiry dates and eligibility come from the SahiSupply database "
                             "(synthetic sample data, seed 42).",
            "simulated": [f"Storage capacity = {STORAGE_CAPACITY_FACTOR} x weekly dispatch capacity (no capacity field "
                          "in the data)", "Rack and bin positions in the 3D view",
                          "Operator name (sample network, not a real company)"],
        },
    }
