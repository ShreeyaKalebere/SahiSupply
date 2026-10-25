"""Batch QR traceability: signed QR codes, dispatch/delivery scans, flags and an append-only event log.

A QR code encodes ``SAHI1|<module>|<batch_id>|<signature>``. The signature is an HMAC of the module and
batch id with a server secret, so codes that were not issued by this system (typos, copies of other
systems' labels, hand-made codes) are rejected. A QR code only verifies information recorded in this
system; it cannot prove that the physical product is genuine.

Scans are checked against the plan: the batch must belong to the shipment being loaded or delivered,
must not be expired, and should still meet the shelf-life rule. When every batch of a shipment has been
scanned OK at a stage, the shipment status advances (dispatch -> Dispatched; delivery -> Delivered).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import os
import secrets
import threading
import uuid
from datetime import date, datetime, timezone

from pymongo.errors import PyMongoError

from app.database.connection import get_db, ping
from app.services import data_service, delivery_status

log = logging.getLogger("sahisupply.trace")

PREFIX = "SAHI1"
SIG_LEN = 16
NOTICE = ("A QR code only verifies information recorded in SahiSupply; it cannot independently prove that the "
          "physical product is genuine.")

_lock = threading.Lock()
_secret: bytes | None = None
_mem_events: list[dict] = []


class InvalidCode(ValueError):
    pass


def _get_secret() -> bytes:
    """QR_SECRET from the environment, else one random secret per database (kept in app_settings)."""
    global _secret
    with _lock:
        if _secret is not None:
            return _secret
        env = os.getenv("QR_SECRET")
        if env:
            _secret = env.encode()
            return _secret
        ok, _ = ping()
        if ok:
            try:
                coll = get_db().app_settings
                doc = coll.find_one({"_id": "qr_secret"})
                if doc is None:
                    coll.update_one({"_id": "qr_secret"}, {"$setOnInsert": {"value": secrets.token_hex(32)}}, upsert=True)
                    doc = coll.find_one({"_id": "qr_secret"})
                _secret = doc["value"].encode()
                return _secret
            except PyMongoError as exc:
                log.error("could not load QR secret: %s", exc)
        log.warning("QR_SECRET not set and MongoDB unavailable: using a temporary secret (codes change on restart)")
        _secret = secrets.token_bytes(32)
        return _secret


def _sign(module: str, batch_id: str) -> str:
    return hmac.new(_get_secret(), f"{module}|{batch_id}".encode(), hashlib.sha256).hexdigest()[:SIG_LEN]


def qr_payload(module: str, batch_id: str) -> str:
    return f"{PREFIX}|{module}|{batch_id}|{_sign(module, batch_id)}"


def parse(code: str) -> tuple[str, str]:
    parts = (code or "").strip().split("|")
    if len(parts) != 4 or parts[0] != PREFIX:
        raise InvalidCode("Not a SahiSupply batch code")
    _, module, batch_id, sig = parts
    if not hmac.compare_digest(sig, _sign(module, batch_id)):
        raise InvalidCode("Code signature does not match - this label was not issued by this SahiSupply server")
    return module, batch_id


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _min_life_days(rules: dict | None, shelf: int) -> int:
    if not rules:
        return 1
    if rules.get("min_life_days") is not None:
        return int(rules["min_life_days"])
    if rules.get("min_life_pct") is not None:
        return math.ceil(shelf * rules["min_life_pct"] / 100.0)
    return 1


def batch_record(module: str, batch_id: str, run: dict | None = None) -> dict | None:
    """Everything the label and scanner show: product, warehouse, quantity, expiry and planned destinations."""
    contested = run["contested_pattern"] if run else True
    ds, source = data_service.get_dataset(module, contested)
    b = next((x for x in ds["batches"] if x["batch_id"] == batch_id), None)
    if b is None:
        return None
    p = next(x for x in ds["products"] if x["product_id"] == b["product_id"])
    w = next((x for x in ds["warehouses"] if x["warehouse_id"] == b["warehouse_id"]), {})
    days = (date.fromisoformat(b["expiry_date"]) - _today()).days
    dests = []
    if run and run.get("module") == module and run.get("optimizer"):
        for ln in run["optimizer"]["lines"]:
            if ln["batch_id"] == batch_id:
                dests.append({"outlet_id": ln["outlet_id"], "outlet_name": ln["outlet_name"], "qty": ln["qty"],
                              "shipment_id": delivery_status.shipment_id(ln["warehouse_id"], ln["outlet_id"])})
    return {
        "module": module, "batch_id": batch_id, "product_id": p["product_id"], "product_name": p["name"],
        "category": p.get("category"), "storage_class": p.get("storage_class"), "criticality": p.get("criticality"),
        "warehouse_id": b["warehouse_id"], "warehouse_name": w.get("name", b["warehouse_id"]), "quantity": b["quantity"],
        "expiry_date": b["expiry_date"], "manufacturing_date": b.get("manufacturing_date"), "days_to_expiry": days,
        "expired": days < 0, "min_life_days": _min_life_days((run or {}).get("raw_inputs", {}).get("rules"), p["shelf_life_days"]),
        "planned_destinations": dests, "plan_id": run["plan_id"] if run else None, "data_source": source,
    }


def labels(module: str, run: dict | None, warehouse_id: str | None = None, shipment: str | None = None) -> list[dict]:
    contested = run["contested_pattern"] if run else True
    ds, _ = data_service.get_dataset(module, contested)
    ids = [b["batch_id"] for b in ds["batches"] if warehouse_id in (None, "", b["warehouse_id"])]
    if shipment and run and run.get("optimizer"):
        in_ship = {ln["batch_id"] for ln in run["optimizer"]["lines"]
                   if delivery_status.shipment_id(ln["warehouse_id"], ln["outlet_id"]) == shipment}
        ids = [i for i in ids if i in in_ship]
    return [{"payload": qr_payload(module, i), "record": batch_record(module, i, run)} for i in ids]


# ---- event log ---------------------------------------------------------------------------------

def _save_event(ev: dict) -> bool:
    ok, _ = ping()
    if ok:
        try:
            get_db().trace_events.insert_one(dict(ev))
            return True
        except PyMongoError as exc:
            log.error("failed to persist trace event: %s", exc)
    with _lock:
        _mem_events.append(ev)
    return False


def events(*, plan_id: str | None = None, batch_id: str | None = None, shipment_id: str | None = None,
           limit: int = 200) -> list[dict]:
    q = {k: v for k, v in (("plan_id", plan_id), ("batch_id", batch_id), ("shipment_id", shipment_id)) if v}
    rows: list[dict] = []
    ok, _ = ping()
    if ok:
        try:
            rows = list(get_db().trace_events.find(q, {"_id": 0}).sort("at", -1).limit(limit))
        except PyMongoError:
            pass
    with _lock:
        rows += [e for e in _mem_events if all(e.get(k) == v for k, v in q.items())]
    rows.sort(key=lambda e: e["at"], reverse=True)
    return rows[:limit]


def _scanned_ok(plan_id: str, shipment_id: str, stage: str) -> set[str]:
    return {e["batch_id"] for e in events(plan_id=plan_id, shipment_id=shipment_id, limit=1000)
            if e.get("stage") == stage and e.get("result") in ("ok", "warning") and e.get("batch_id")}


# ---- scanning ----------------------------------------------------------------------------------

def scan(code: str, run: dict, stage: str, shipment_id: str | None, actor: str | None, device: str | None) -> dict:
    """Check one scanned code against the plan, log it, and advance the shipment status when complete."""
    flags: list[dict] = []
    record = None
    module = batch_id = None
    try:
        module, batch_id = parse(code)
    except InvalidCode as exc:
        flags.append({"code": "invalid_code", "level": "flag", "message": str(exc)})

    if module and module != run["module"]:
        flags.append({"code": "wrong_module", "level": "flag",
                      "message": f"This is a {module} batch; the plan is for {run['module']}"})
    elif module:
        record = batch_record(module, batch_id, run)
        if record is None:
            flags.append({"code": "unknown_batch", "level": "flag", "message": f"Batch {batch_id} is not in the database"})

    expected: dict[str, int] = {}
    if shipment_id:
        for ln in run["optimizer"]["lines"]:
            if delivery_status.shipment_id(ln["warehouse_id"], ln["outlet_id"]) == shipment_id:
                expected[ln["batch_id"]] = ln["qty"]

    if record:
        if record["expired"]:
            flags.append({"code": "expired", "level": "flag",
                          "message": f"Expired on {record['expiry_date']} - do not dispatch or deliver"})
        elif record["days_to_expiry"] < record["min_life_days"]:
            flags.append({"code": "short_dated", "level": "warning",
                          "message": f"Only {record['days_to_expiry']} days of shelf life left (rule: {record['min_life_days']})"})
        if shipment_id and batch_id not in expected:
            where = ", ".join(f"{d['outlet_name']} ({d['shipment_id']})" for d in record["planned_destinations"]) or "no shipment this week"
            flags.append({"code": "wrong_batch", "level": "flag",
                          "message": f"Batch {batch_id} is not part of {shipment_id}. Planned for: {where}"})

    status_before = None
    if shipment_id:
        rows, _ = delivery_status.list_for_run(run)
        status_before = next((r["status"] for r in rows if r["shipment_id"] == shipment_id), None)
        if status_before is None:
            flags.append({"code": "unknown_shipment", "level": "flag", "message": f"{shipment_id} is not in this plan"})
        elif stage == "dispatch" and status_before != "approved":
            flags.append({"code": "already_dispatched", "level": "warning", "message": f"Shipment is already {status_before}"})
        elif stage == "delivery" and status_before == "approved":
            flags.append({"code": "not_dispatched", "level": "warning", "message": "Shipment was never scanned or marked as dispatched"})
        if batch_id and batch_id in _scanned_ok(run["plan_id"], shipment_id, stage):
            flags.append({"code": "duplicate_scan", "level": "warning", "message": f"Batch already scanned at {stage}"})

    result = ("invalid" if any(f["code"] == "invalid_code" for f in flags)
              else "flagged" if any(f["level"] == "flag" for f in flags)
              else "warning" if flags else "ok")
    ev = {"event_id": uuid.uuid4().hex[:12], "at": datetime.now(timezone.utc).isoformat(), "type": "scan",
          "stage": stage, "result": result, "flags": flags, "plan_id": run["plan_id"], "module": module or run["module"],
          "batch_id": batch_id, "shipment_id": shipment_id, "actor": actor, "device": device, "status_change": None}

    # Count this scan, then advance the shipment once every planned batch has been scanned OK at this stage.
    progress = None
    status_after = status_before
    if shipment_id and expected and status_before:
        done = _scanned_ok(run["plan_id"], shipment_id, stage) | ({batch_id} if result in ("ok", "warning") else set())
        progress = {"scanned": len(done & set(expected)), "total": len(expected),
                    "missing": sorted(set(expected) - done)}
        if result in ("ok", "warning") and not progress["missing"]:
            steps = []
            if stage == "dispatch" and status_before == "approved":
                steps = ["dispatched"]
            elif stage == "delivery" and status_before == "dispatched":
                steps = ["in_transit", "delivered"]
            elif stage == "delivery" and status_before == "in_transit":
                steps = ["delivered"]
            note = f"All {len(expected)} batches scanned at {stage} (QR)"
            try:
                for s in steps:
                    row, _ = delivery_status.advance(run, shipment_id, s, note=note)
                    status_after = row["status"]
            except delivery_status.InvalidTransition as exc:
                flags.append({"code": "status_not_updated", "level": "warning", "message": str(exc)})
            if status_after != status_before:
                ev["status_change"] = {"from": status_before, "to": status_after}
    ev["persisted"] = _save_event(ev)
    return {"result": result, "flags": flags, "record": record, "event": ev, "progress": progress,
            "status_before": status_before, "status_after": status_after, "notice": NOTICE}
