"""Seed and load module datasets. Seeding is idempotent: each module's documents are replaced as a unit."""
from __future__ import annotations

from datetime import datetime, timezone

from pymongo import ReplaceOne
from pymongo.database import Database

from app.data.catalog import id_sort_key

ENTITY_KEYS = {
    "warehouses": "warehouse_id", "outlets": "outlet_id", "products": "product_id", "batches": "batch_id",
    "open_orders": "order_id",
}


def _geo(doc: dict) -> dict:
    return {**doc, "location": {"type": "Point", "coordinates": [doc["lon"], doc["lat"]]}}


def seed_module(db: Database, module: str, contested: dict, uncontested_routes: list[dict], config_doc: dict,
                dataset_sha: str) -> dict:
    """Replace one module's data. contested = full dataset (pattern on); uncontested_routes = pattern-off routes."""
    counts = {}
    for coll, key in ENTITY_KEYS.items():
        docs = contested[coll]
        if coll in ("warehouses", "outlets"):
            docs = [_geo(d) for d in docs]
        ops = [ReplaceOne({"module": module, key: d[key]}, {**d, "module": module}, upsert=True) for d in docs]
        db[coll].delete_many({"module": module, key: {"$nin": [d[key] for d in docs]}})
        if ops:
            db[coll].bulk_write(ops, ordered=False)
        counts[coll] = len(docs)

    db.routes.delete_many({"module": module})
    db.routes.insert_many([{**r, "module": module, "variant": "contested"} for r in contested["routes"]]
                          + [{**r, "module": module, "variant": "uncontested"} for r in uncontested_routes])
    counts["routes"] = len(contested["routes"])

    for coll in ("demand_history", "outlet_inventory"):
        db[coll].delete_many({"module": module})
        if contested[coll]:
            db[coll].insert_many([{**r, "module": module} for r in contested[coll]], ordered=False)
        counts[coll] = len(contested[coll])

    db.calendars.replace_one({"module": module}, {"module": module, **contested["calendar"]}, upsert=True)
    db.dataset_meta.replace_one({"module": module}, {
        "module": module, **contested["meta"], "dataset_sha256": dataset_sha,
        "seeded_at": datetime.now(timezone.utc), "counts": counts,
    }, upsert=True)
    db.modules.replace_one({"industry": module}, config_doc, upsert=True)
    return counts


def load_dataset(db: Database, module: str, contested_pattern: bool = True) -> dict | None:
    meta = db.dataset_meta.find_one({"module": module}, {"_id": 0})
    if meta is None:
        return None
    proj = {"_id": 0, "module": 0, "location": 0}
    variant = "contested" if contested_pattern else "uncontested"
    cal = db.calendars.find_one({"module": module}, {"_id": 0, "module": 0}) or {"festivals": [], "promotions": []}
    out = {
        "meta": {k: v for k, v in meta.items() if k not in ("seeded_at", "counts")} | {"contested_pattern": contested_pattern},
        "warehouses": list(db.warehouses.find({"module": module}, proj).sort("warehouse_id", 1)),
        "outlets": list(db.outlets.find({"module": module}, proj)),
        "products": list(db.products.find({"module": module}, proj).sort("product_id", 1)),
        "batches": list(db.batches.find({"module": module}, proj).sort("batch_id", 1)),
        "routes": list(db.routes.find({"module": module, "variant": variant}, proj | {"variant": 0}).sort("route_id", 1)),
        "demand_history": list(db.demand_history.find({"module": module}, proj)),
        "open_orders": list(db.open_orders.find({"module": module}, proj).sort("order_id", 1)),
        "outlet_inventory": list(db.outlet_inventory.find({"module": module}, proj)),
        "calendar": cal,
    }
    out["outlets"].sort(key=lambda o: id_sort_key(o["outlet_id"]))
    return out
