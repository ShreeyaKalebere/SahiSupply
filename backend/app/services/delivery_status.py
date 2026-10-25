"""Delivery (shipment) status tracking for an approved plan.

A shipment is one truck trip: every plan line from one warehouse to one store. Its id is
SHP-{warehouse_id}-{outlet_id}, unique within the plan. Statuses move strictly forward:
approved -> dispatched -> in_transit -> delivered -> complete. Stored in MongoDB
(`delivery_status`); if MongoDB is down, an in-memory store flagged persisted=False.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError, PyMongoError

from app.database.connection import get_db, ping

log = logging.getLogger("sahisupply.deliveries")

STATUSES = ("approved", "dispatched", "in_transit", "delivered", "complete")
NEXT = {a: b for a, b in zip(STATUSES, STATUSES[1:], strict=False)}

_memory: dict[tuple[str, str], dict] = {}
_lock = threading.Lock()
_indexed = False


class InvalidTransition(ValueError):
    def __init__(self, current: str, requested: str):
        allowed = NEXT.get(current)
        super().__init__(f"Cannot move a shipment from '{current}' to '{requested}'"
                         + (f"; next allowed status is '{allowed}'" if allowed else "; it is already complete"))
        self.current, self.requested, self.allowed = current, requested, allowed


class UnknownShipment(KeyError):
    pass


def shipment_id(warehouse_id: str, outlet_id: str) -> str:
    return f"SHP-{warehouse_id}-{outlet_id}"


def shipments(run: dict) -> dict[str, dict]:
    """Shipments in the run's optimized plan, keyed by shipment id."""
    out: dict[str, dict] = {}
    for ln in (run.get("optimizer") or {}).get("lines", []):
        sid = shipment_id(ln["warehouse_id"], ln["outlet_id"])
        s = out.setdefault(sid, {"shipment_id": sid, "warehouse_id": ln["warehouse_id"], "outlet_id": ln["outlet_id"],
                                 "qty": 0, "products": 0})
        s["qty"] += ln["qty"]
        s["products"] += 1
    return out


def _coll():
    global _indexed
    c = get_db().delivery_status
    if not _indexed:
        c.create_index([("plan_id", 1), ("shipment_id", 1)], unique=True)
        _indexed = True
    return c


def _stored(plan_id: str) -> tuple[dict[str, dict], bool]:
    ok, _ = ping()
    if ok:
        try:
            return {d["shipment_id"]: d for d in _coll().find({"plan_id": plan_id}, {"_id": 0})}, True
        except PyMongoError as exc:
            log.error("failed to read delivery statuses for %s: %s", plan_id, exc)
    with _lock:
        return {sid: d for (pid, sid), d in _memory.items() if pid == plan_id}, False


def list_for_run(run: dict) -> tuple[list[dict], bool]:
    stored, persisted = _stored(run["plan_id"])
    rows = []
    for sid, s in shipments(run).items():
        d = stored.get(sid)
        rows.append({**s, "status": d["status"] if d else "approved", "updated_at": d.get("updated_at") if d else None,
                     "history": d.get("history", []) if d else []})
    return rows, persisted


def advance(run: dict, sid: str, status: str) -> tuple[dict, bool]:
    """Move one shipment to `status`, which must be the next status in order."""
    plan_id = run["plan_id"]
    ship = shipments(run).get(sid)
    if ship is None:
        raise UnknownShipment(sid)
    now = datetime.now(timezone.utc).isoformat()
    event = {"status": status, "at": now}
    ok, _ = ping()
    if ok:
        try:
            c = _coll()
            cur = c.find_one({"plan_id": plan_id, "shipment_id": sid}, {"_id": 0})
            current = cur["status"] if cur else "approved"
            if NEXT.get(current) != status:
                raise InvalidTransition(current, status)
            if cur is None:
                c.insert_one({"plan_id": plan_id, "shipment_id": sid, "status": status, "updated_at": now, "history": [event]})
            else:
                # Conditional on the status we read, so two clicks can't both advance it.
                res = c.update_one({"plan_id": plan_id, "shipment_id": sid, "status": current},
                                   {"$set": {"status": status, "updated_at": now}, "$push": {"history": event}})
                if res.matched_count == 0:
                    raise InvalidTransition(c.find_one({"plan_id": plan_id, "shipment_id": sid})["status"], status)
            doc = c.find_one({"plan_id": plan_id, "shipment_id": sid}, {"_id": 0})
            return {**ship, "status": doc["status"], "updated_at": doc["updated_at"], "history": doc["history"]}, True
        except DuplicateKeyError:
            raise InvalidTransition("dispatched", status) from None
        except PyMongoError as exc:
            log.error("failed to persist delivery status %s/%s: %s", plan_id, sid, exc)
    with _lock:
        cur = _memory.get((plan_id, sid))
        current = cur["status"] if cur else "approved"
        if NEXT.get(current) != status:
            raise InvalidTransition(current, status)
        doc = {"plan_id": plan_id, "shipment_id": sid, "status": status, "updated_at": now,
               "history": (cur["history"] if cur else []) + [event]}
        _memory[(plan_id, sid)] = doc
    return {**ship, "status": status, "updated_at": now, "history": doc["history"]}, False
