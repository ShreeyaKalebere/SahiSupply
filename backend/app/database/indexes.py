"""Collections, JSON-schema validators and indexes."""
from __future__ import annotations

from pymongo import ASCENDING, DESCENDING, GEOSPHERE, IndexModel
from pymongo.database import Database
from pymongo.errors import CollectionInvalid

COLLECTIONS = ["modules", "warehouses", "outlets", "products", "batches", "demand_history", "open_orders",
               "outlet_inventory", "routes", "calendars", "dataset_meta", "optimization_runs",
               "plan_overrides", "forecast_runs"]

_str, _num, _int, _bool = {"bsonType": "string"}, {"bsonType": ["double", "int", "long"]}, \
    {"bsonType": ["int", "long"]}, {"bsonType": "bool"}

VALIDATORS = {
    "batches": {"$jsonSchema": {"bsonType": "object",
                                "required": ["module", "batch_id", "product_id", "warehouse_id", "quantity", "expiry_date"],
                                "properties": {"module": _str, "batch_id": _str, "product_id": _str, "warehouse_id": _str,
                                               "quantity": {"bsonType": ["int", "long"], "minimum": 0},
                                               "expiry_date": {"bsonType": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}}}},
    "routes": {"$jsonSchema": {"bsonType": "object",
                               "required": ["module", "variant", "route_id", "warehouse_id", "outlet_id", "lead_time_days",
                                            "cost_per_litre", "capacity_l", "open"],
                               "properties": {"module": _str, "variant": {"enum": ["contested", "uncontested"]},
                                              "lead_time_days": {"bsonType": ["int", "long"], "minimum": 0},
                                              "cost_per_litre": _num, "capacity_l": _num, "open": _bool}}},
    "warehouses": {"$jsonSchema": {"bsonType": "object",
                                   "required": ["module", "warehouse_id", "status", "outbound_capacity_l", "location"],
                                   "properties": {"status": {"enum": ["operational", "closed"]}, "outbound_capacity_l": _num}}},
    "outlets": {"$jsonSchema": {"bsonType": "object",
                                "required": ["module", "outlet_id", "type", "region", "receiving_capacity_l", "cold_capacity_l",
                                             "storage", "location"],
                                "properties": {"storage": {"bsonType": "array", "items": _str}}}},
    "products": {"$jsonSchema": {"bsonType": "object",
                                 "required": ["module", "product_id", "storage_class", "criticality", "shelf_life_days",
                                              "unit_volume_l", "unit_cost", "unit_margin"],
                                 "properties": {"storage_class": {"enum": ["ambient", "chilled", "2-8C"]},
                                                "criticality": {"enum": ["critical", "standard"]},
                                                "shelf_life_days": {"bsonType": ["int", "long"], "minimum": 1}}}},
    "optimization_runs": {"$jsonSchema": {"bsonType": "object",
                                          "required": ["plan_id", "module", "scenario_id", "fingerprint", "status", "created_at"],
                                          "properties": {"status": {"enum": ["VALID", "INVALID", "SOLVER_FAILED"]}}}},
    "plan_overrides": {"$jsonSchema": {"bsonType": "object",
                                       "required": ["plan_id", "batch_id", "outlet_id", "original_qty", "requested_qty",
                                                    "reason", "outcome", "created_at"],
                                       "properties": {"reason": {"bsonType": "string", "minLength": 3},
                                                      "outcome": {"enum": ["accepted", "rejected"]}}}},
}

INDEXES = {
    "modules": [IndexModel([("industry", ASCENDING)], unique=True)],
    "warehouses": [IndexModel([("module", ASCENDING), ("warehouse_id", ASCENDING)], unique=True),
                   IndexModel([("location", GEOSPHERE)])],
    "outlets": [IndexModel([("module", ASCENDING), ("outlet_id", ASCENDING)], unique=True),
                IndexModel([("location", GEOSPHERE)]), IndexModel([("module", ASCENDING), ("region", ASCENDING)])],
    "products": [IndexModel([("module", ASCENDING), ("product_id", ASCENDING)], unique=True)],
    "batches": [IndexModel([("module", ASCENDING), ("batch_id", ASCENDING)], unique=True),
                IndexModel([("module", ASCENDING), ("product_id", ASCENDING), ("expiry_date", ASCENDING)]),
                IndexModel([("module", ASCENDING), ("warehouse_id", ASCENDING)])],
    "demand_history": [IndexModel([("module", ASCENDING), ("outlet_id", ASCENDING), ("product_id", ASCENDING),
                                   ("date", ASCENDING)], unique=True),
                       IndexModel([("module", ASCENDING), ("date", ASCENDING)])],
    "open_orders": [IndexModel([("module", ASCENDING), ("order_id", ASCENDING)], unique=True)],
    "outlet_inventory": [IndexModel([("module", ASCENDING), ("outlet_id", ASCENDING), ("product_id", ASCENDING)], unique=True)],
    "routes": [IndexModel([("module", ASCENDING), ("variant", ASCENDING), ("route_id", ASCENDING)], unique=True)],
    "calendars": [IndexModel([("module", ASCENDING)], unique=True)],
    "dataset_meta": [IndexModel([("module", ASCENDING)], unique=True)],
    "optimization_runs": [IndexModel([("plan_id", ASCENDING)], unique=True),
                          IndexModel([("module", ASCENDING), ("created_at", DESCENDING)]),
                          IndexModel([("scenario_id", ASCENDING)]), IndexModel([("fingerprint", ASCENDING)])],
    "plan_overrides": [IndexModel([("plan_id", ASCENDING), ("created_at", ASCENDING)])],
    "forecast_runs": [IndexModel([("module", ASCENDING), ("history_fingerprint", ASCENDING)], unique=True)],
}


def ensure_schema(db: Database) -> None:
    existing = set(db.list_collection_names())
    for name in COLLECTIONS:
        validator = VALIDATORS.get(name)
        if name not in existing:
            try:
                if validator:
                    db.create_collection(name, validator=validator, validationLevel="strict")
                else:
                    db.create_collection(name)
            except CollectionInvalid:
                pass
        elif validator:
            db.command("collMod", name, validator=validator, validationLevel="strict")
        if name in INDEXES:
            db[name].create_indexes(INDEXES[name])
