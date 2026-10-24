"""Independent plan checker (PRD 6.5).

Deliberately self-contained: it reads only plain raw data (the scenario-applied
inputs, the rule spec and the need table) and does NOT import the optimizer,
the baseline or app.inventory.eligibility. Shelf life is recomputed from raw ISO
dates with its own arithmetic, and the cost formula is restated here as a data
definition so totals are recomputed independently.

A plan is valid only if it has zero violations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

from app.utils.fingerprint import fingerprint

REEFER_FACTOR = 1.6     # data definition: non-ambient unit cost multiplier
VOL_TOL = 1e-6
MONEY_TOL = 0.01


@dataclass
class Violation:
    code: str
    message: str
    entity: str = ""

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "entity": self.entity}


@dataclass
class CheckResult:
    valid: bool
    violations: list[Violation] = field(default_factory=list)
    checked: dict = field(default_factory=dict)
    recomputed: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"valid": self.valid, "violation_count": len(self.violations),
                "violations": [v.as_dict() for v in self.violations[:200]],
                "checked": self.checked, "recomputed": self.recomputed}


def _days_between(later_iso: str, earlier_iso: str) -> int:
    a = datetime.strptime(later_iso, "%Y-%m-%d")
    b = datetime.strptime(earlier_iso, "%Y-%m-%d")
    return int((a - b).total_seconds() // 86400)


def _cap_exceeded(used: float, limit: float) -> bool:
    return used > limit + VOL_TOL * max(1.0, abs(limit))


def recompute_totals(raw: dict, lines: list[dict]) -> dict:
    products = {p["product_id"]: p for p in raw["products"]}
    batches = {b["batch_id"]: b for b in raw["batches"]}
    routes = {(r["warehouse_id"], r["outlet_id"]): r for r in raw["routes"]}
    need = {(n["outlet_id"], n["product_id"]): n["need"] for n in raw["need"]}
    delivered = sum(ln["qty"] for ln in lines)
    cost = margin = 0.0
    got: dict[tuple[str, str], int] = {}
    crit_got: dict[tuple[str, str], int] = {}
    for ln in lines:
        b = batches.get(ln["batch_id"])
        if b is None:
            continue
        p = products[b["product_id"]]
        r = routes.get((b["warehouse_id"], ln["outlet_id"]))
        if r is not None:
            f = REEFER_FACTOR if p["storage_class"] != "ambient" else 1.0
            cost += r["cost_per_litre"] * p["unit_volume_l"] * f * ln["qty"]
        margin += p["unit_margin"] * ln["qty"]
        k = (ln["outlet_id"], b["product_id"])
        got[k] = got.get(k, 0) + ln["qty"]
        if p["criticality"] == "critical":
            crit_got[k] = crit_got.get(k, 0) + ln["qty"]
    need_units = sum(need.values())
    unmet = sum(max(0, q - got.get(k, 0)) for k, q in need.items())
    crit_short = sum(max(0, q - got.get(k, 0)) for k, q in need.items()
                     if products[k[1]]["criticality"] == "critical")
    return {"need_units": need_units, "delivered_units": delivered, "unmet_units": unmet,
            "transport_cost": cost, "gross_margin_delivered": margin,
            "critical_shortage_units": crit_short,
            "fill_rate": (delivered / need_units) if need_units else 1.0}


def check_plan(raw: dict, lines: list[dict], *, expected_fingerprint: str | None = None,
               reported: dict | None = None) -> CheckResult:
    v: list[Violation] = []
    rules = raw["rules"]
    planning = raw["planning_date"]
    wh = {w["warehouse_id"]: w for w in raw["warehouses"]}
    outs = {o["outlet_id"]: o for o in raw["outlets"]}
    products = {p["product_id"]: p for p in raw["products"]}
    batches = {b["batch_id"]: b for b in raw["batches"]}
    routes = {(r["warehouse_id"], r["outlet_id"]): r for r in raw["routes"]}
    need = {(n["outlet_id"], n["product_id"]): n["need"] for n in raw["need"]}

    if expected_fingerprint is not None:
        fp = fingerprint(raw)
        if fp != expected_fingerprint:
            v.append(Violation("FINGERPRINT", "Input fingerprint does not match the plan's fingerprint",
                               f"{fp[:12]} != {expected_fingerprint[:12]}"))

    shipped_b: dict[str, int] = {}
    got: dict[tuple[str, str], int] = {}
    vol_w: dict[str, float] = {}
    vol_d: dict[str, float] = {}
    cold_d: dict[str, float] = {}
    vol_r: dict[tuple[str, str], float] = {}
    seen: set[tuple[str, str]] = set()

    for ln in lines:
        bid, d, qty = ln.get("batch_id"), ln.get("outlet_id"), ln.get("qty")
        ent = f"{bid}->{d}"
        if not isinstance(qty, int) or isinstance(qty, bool):
            v.append(Violation("INTEGRALITY", f"Quantity {qty!r} is not an integer", ent))
            continue
        if qty < 0:
            v.append(Violation("NEGATIVE", f"Negative quantity {qty}", ent))
            continue
        if (bid, d) in seen:
            v.append(Violation("DUPLICATE_LINE", "Batch/outlet pair appears more than once", ent))
        seen.add((bid, d))
        b = batches.get(bid)
        o = outs.get(d)
        if b is None or o is None:
            v.append(Violation("UNKNOWN_ENTITY", "Unknown batch or outlet", ent))
            continue
        if ln.get("product_id") not in (None, b["product_id"]) or ln.get("warehouse_id") not in (None, b["warehouse_id"]):
            v.append(Violation("LINE_MISMATCH", "Line product/warehouse does not match the batch record", ent))
        if qty == 0:
            continue
        p = products[b["product_id"]]
        w = b["warehouse_id"]
        if wh[w]["status"] != "operational":
            v.append(Violation("WAREHOUSE_CLOSED", f"Ships from {w}, which is {wh[w]['status']}", ent))
        r = routes.get((w, d))
        if r is None:
            v.append(Violation("NO_ROUTE", f"No route {w}->{d}", ent))
            continue
        if not r["open"]:
            v.append(Violation("ROUTE_CLOSED", f"Route {r['route_id']} is closed", ent))

        # shelf life on arrival, recomputed from raw dates
        life = _days_between(b["expiry_date"], planning) - int(r["lead_time_days"])
        if life <= 0:
            v.append(Violation("EXPIRED_ON_ARRIVAL", f"{life} days of shelf life on arrival", ent))
        if rules.get("min_life_days") is not None and life < rules["min_life_days"]:
            v.append(Violation("MIN_LIFE", f"{life} days on arrival < {rules['min_life_days']}", ent))
        if rules.get("min_life_pct") is not None:
            need_days = math.ceil(p["shelf_life_days"] * rules["min_life_pct"] / 100.0)
            if life < need_days:
                v.append(Violation("MIN_LIFE", f"{life} days on arrival < {rules['min_life_pct']}% of "
                                               f"{p['shelf_life_days']} ({need_days} days)", ent))
        sc = p["storage_class"]
        if sc in rules.get("storage_classes", []) and sc not in o["storage"]:
            v.append(Violation("STORAGE", f"{d} cannot store {sc}", ent))

        shipped_b[bid] = shipped_b.get(bid, 0) + qty
        k = (d, b["product_id"])
        got[k] = got.get(k, 0) + qty
        vol = qty * p["unit_volume_l"]
        vol_w[w] = vol_w.get(w, 0.0) + vol
        vol_d[d] = vol_d.get(d, 0.0) + vol
        vol_r[(w, d)] = vol_r.get((w, d), 0.0) + vol
        if sc != "ambient":
            cold_d[d] = cold_d.get(d, 0.0) + vol

    for bid, s in shipped_b.items():
        if s > batches[bid]["quantity"]:
            v.append(Violation("STOCK", f"Ships {s} > {batches[bid]['quantity']} available", bid))
    for k, g in got.items():
        if g > need.get(k, 0):
            v.append(Violation("NEED", f"Delivers {g} > need {need.get(k, 0)}", f"{k[0]}/{k[1]}"))
    for w, used in vol_w.items():
        if _cap_exceeded(used, wh[w]["outbound_capacity_l"]):
            v.append(Violation("OUTBOUND_CAPACITY", f"{used:.2f} L > {wh[w]['outbound_capacity_l']} L", w))
    for d, used in vol_d.items():
        if _cap_exceeded(used, outs[d]["receiving_capacity_l"]):
            v.append(Violation("RECEIVING_CAPACITY", f"{used:.2f} L > {outs[d]['receiving_capacity_l']} L", d))
    for d, used in cold_d.items():
        if _cap_exceeded(used, outs[d]["cold_capacity_l"]):
            v.append(Violation("COLD_CAPACITY", f"{used:.2f} L > {outs[d]['cold_capacity_l']} L", d))
    for k, used in vol_r.items():
        if _cap_exceeded(used, routes[k]["capacity_l"]):
            v.append(Violation("ROUTE_CAPACITY", f"{used:.2f} L > {routes[k]['capacity_l']} L", routes[k]["route_id"]))

    totals = recompute_totals(raw, lines)
    if reported:
        for key in ("need_units", "delivered_units", "unmet_units", "critical_shortage_units"):
            if key in reported and reported[key] != totals[key]:
                v.append(Violation("TOTALS", f"Displayed {key}={reported[key]} but recomputed {totals[key]}", key))
        for key in ("transport_cost", "gross_margin_delivered"):
            if key in reported and abs(reported[key] - totals[key]) > MONEY_TOL:
                v.append(Violation("TOTALS", f"Displayed {key}={reported[key]:.2f} but recomputed {totals[key]:.2f}", key))
        if "fill_rate" in reported and abs(reported["fill_rate"] - totals["fill_rate"]) > 1e-9:
            v.append(Violation("TOTALS", "Displayed fill rate does not match recomputed", "fill_rate"))

    return CheckResult(
        valid=not v, violations=v,
        checked={"lines": len(lines), "batches": len(shipped_b), "routes": len(vol_r),
                 "constraints": ["integrality", "stock", "need", "outbound_capacity", "receiving_capacity",
                                 "cold_capacity", "route_capacity", "warehouse_status", "route_status",
                                 "expiry_on_arrival", "min_life_on_arrival", "storage_match",
                                 "fingerprint", "displayed_totals"]},
        recomputed=totals,
    )


def verify_insight(base_raw: dict, base_lines: list[dict], mod_raw: dict, mod_lines: list[dict],
                   *, added_units: float, reported: dict) -> CheckResult:
    """Re-check an insight: the modified plan must be valid on the modified inputs, and the displayed
    per-unit values must equal values recomputed here from the two plans' raw lines."""
    res = check_plan(mod_raw, mod_lines)
    products = {p["product_id"]: p for p in base_raw["products"]}

    def standard_net_margin(raw, lines):
        batches = {b["batch_id"]: b for b in raw["batches"]}
        routes = {(r["warehouse_id"], r["outlet_id"]): r for r in raw["routes"]}
        total = 0.0
        for ln in lines:
            b = batches[ln["batch_id"]]
            p = products[b["product_id"]]
            if p["criticality"] == "critical":
                continue
            f = REEFER_FACTOR if p["storage_class"] != "ambient" else 1.0
            c = routes[(b["warehouse_id"], ln["outlet_id"])]["cost_per_litre"] * p["unit_volume_l"] * f
            total += (p["unit_margin"] - c) * ln["qty"]
        return total

    base_t, mod_t = recompute_totals(base_raw, base_lines), recompute_totals(mod_raw, mod_lines)
    margin_per_unit = (standard_net_margin(mod_raw, mod_lines) - standard_net_margin(base_raw, base_lines)) / added_units
    crit_per_unit = (base_t["critical_shortage_units"] - mod_t["critical_shortage_units"]) / added_units
    res.recomputed.update({"net_margin_per_unit": margin_per_unit, "critical_units_avoided_per_unit": crit_per_unit})
    if abs(margin_per_unit - reported.get("net_margin_per_unit", 0.0)) > MONEY_TOL:
        res.violations.append(Violation("INSIGHT", "Net margin per unit does not reproduce"))
    if abs(crit_per_unit - reported.get("critical_units_avoided_per_unit", 0.0)) > 1e-6:
        res.violations.append(Violation("INSIGHT", "Critical units avoided per unit does not reproduce"))
    res.valid = not res.violations
    return res
