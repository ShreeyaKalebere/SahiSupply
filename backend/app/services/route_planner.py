"""Route planner: a truck trip through stops the user connects on the map (A -> B -> C -> D).

Distances. The dataset has no road-routing data. Warehouse -> store legs use the route record's
distance (straight-line x 1.3 circuity, as generated) and its open/closed flag; any other leg
(store -> store, warehouse -> warehouse) uses the same straight-line x 1.3 estimate. Every leg is
labelled as an approximation, and no road geometry or traffic is invented.

Time. Driving time = distance / an assumed average truck speed; loading and unloading use a fixed
time per stop plus a time per unit. All three are request parameters, returned with the result.
No rest breaks or traffic are modelled.

Cost. The existing cost objective: per-litre lane cost of each planned warehouse -> store line
(the optimizer's own line_cost). Stop order does not change it; the stops served do.

Stop order. "As connected" is the user's order. The optimized order comes from the OR-Tools routing
solver (fixed source and destination). Emergency mode visits urgent stops first (exact search over
orders, small stop counts only). Deadlines are checked on the computed timeline; a missed mandatory
deadline is reported as infeasible with alternatives, never as achievable.
"""
from __future__ import annotations

import itertools
import math
from datetime import datetime, timedelta, timezone

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from app.optimization import checker
from app.services import data_service, delivery_status

CIRCUITY = 1.3              # same factor the dataset's route distances use
DEFAULT_SPEED_KMH = 40.0    # assumed average loaded-truck speed (no traffic data)
DEFAULT_LOAD_MIN = 30.0     # fixed minutes per warehouse pickup
DEFAULT_UNLOAD_MIN = 20.0   # fixed minutes per store drop
DEFAULT_PER_UNIT_MIN = 0.02  # handling minutes per unit (≈ 1.2 s)
BLOCKED = 10**9
MAX_EXACT_STOPS = 7         # intermediates searched exhaustively in emergency mode

COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


class RouteInputError(ValueError):
    pass


def _haversine_km(a: dict, b: dict) -> float:
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _bearing(a: dict, b: dict) -> float:
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl = math.radians(b["lon"] - a["lon"])
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


class Network:
    """Nodes, road records and planned lines the trip is evaluated against."""

    def __init__(self, module: str, contested: bool, run: dict | None):
        if run is not None:
            raw = run["raw_inputs"]   # exactly what the optimizer and checker used (scenario/network applied)
            self.raw = raw
            warehouses, outlets, routes, products = raw["warehouses"], raw["outlets"], raw["routes"], raw["products"]
            self.lines = run["optimizer"]["lines"] if run.get("optimizer") else []
            self.batches = {b["batch_id"]: b for b in raw["batches"]}
        else:
            ds, _ = data_service.get_dataset(module, contested)
            self.raw = None
            warehouses, outlets, routes, products = ds["warehouses"], ds["outlets"], ds["routes"], ds["products"]
            self.lines = []
            self.batches = {b["batch_id"]: b for b in ds["batches"]}
        self.nodes: dict[str, dict] = {}
        for w in warehouses:
            self.nodes[w["warehouse_id"]] = {"id": w["warehouse_id"], "kind": "warehouse", "name": w["name"], "city": w.get("city"),
                                             "lat": w["lat"], "lon": w["lon"], "status": w.get("status", "operational")}
        for o in outlets:
            self.nodes[o["outlet_id"]] = {"id": o["outlet_id"], "kind": "store", "name": o["name"], "city": o.get("city"),
                                          "lat": o["lat"], "lon": o["lon"], "status": "operational"}
        self.routes = {(r["warehouse_id"], r["outlet_id"]): r for r in routes}
        self.products = {p["product_id"]: p for p in products}

    def leg(self, a: str, b: str, speed: float) -> dict:
        na, nb = self.nodes[a], self.nodes[b]
        rec = self.routes.get((a, b)) or self.routes.get((b, a))
        if rec is not None:
            km, basis, open_ = float(rec["distance_km"]), "route record: straight-line x 1.3 (approximate)", bool(rec["open"])
        else:
            km, basis, open_ = _haversine_km(na, nb) * CIRCUITY, "straight-line x 1.3 estimate (no route record)", None
        brg = _bearing(na, nb)
        blocked = None
        if open_ is False:
            blocked = f"Road {rec['route_id']} is closed in this plan's data"
        return {"from": a, "to": b, "from_name": na["name"], "to_name": nb["name"], "distance_km": round(km, 1),
                "drive_min": round(km / speed * 60, 1), "bearing_deg": round(brg), "direction": COMPASS[int((brg + 22.5) // 45) % 8],
                "basis": basis, "route_id": rec["route_id"] if rec else None, "open": open_, "blocked": blocked,
                "lead_time_days": rec["lead_time_days"] if rec else None}


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _evaluate(net: Network, order: list[str], label: str, kind: str, p: dict, urgent: set[str]) -> dict:
    speed = p["speed_kmh"]
    legs = [net.leg(a, b, speed) for a, b in zip(order, order[1:], strict=False)]
    # Planned lines this truck can carry: store S gets lines from warehouses visited before S.
    seen_w: list[str] = []
    served: list[dict] = []
    unload_units: dict[str, int] = {}
    load_units: dict[str, int] = {}
    for sid in order:
        n = net.nodes[sid]
        if n["kind"] == "warehouse":
            seen_w.append(sid)
            continue
        for ln in net.lines:
            if ln["outlet_id"] == sid and ln["warehouse_id"] in seen_w:
                served.append(ln)
                unload_units[sid] = unload_units.get(sid, 0) + ln["qty"]
                load_units[ln["warehouse_id"]] = load_units.get(ln["warehouse_id"], 0) + ln["qty"]
    t = _parse_dt(p["dispatch_at"]) or datetime.now(timezone.utc)
    start = t
    timeline = []
    handling_total = 0.0
    for i, sid in enumerate(order):
        n = net.nodes[sid]
        if i > 0:
            t = t + timedelta(minutes=legs[i - 1]["drive_min"])
        arrive = t
        units = load_units.get(sid, 0) if n["kind"] == "warehouse" else unload_units.get(sid, 0)
        base = p["load_min"] if n["kind"] == "warehouse" else p["unload_min"]
        handling = 0.0 if (i == 0 and n["kind"] == "store") else base + units * p["per_unit_min"]
        handling_total += handling
        t = t + timedelta(minutes=handling)
        timeline.append({"stop": sid, "letter": chr(65 + i), "name": n["name"], "kind": n["kind"], "city": n["city"],
                         "arrive_at": arrive.isoformat(), "handling_min": round(handling, 1), "depart_at": t.isoformat(),
                         "units": units, "urgent": sid in urgent,
                         "warning": "Warehouse is closed in this plan" if n["kind"] == "warehouse" and n["status"] == "closed" else None})
    total_min = (t - start).total_seconds() / 60
    drive_min = sum(lg["drive_min"] for lg in legs)
    blocked = [lg["blocked"] for lg in legs if lg["blocked"]] + [s["warning"] for s in timeline if s["warning"]]
    deadline = _parse_dt(p.get("deadline_at"))
    dl = None
    if deadline is not None:
        finish = _parse_dt(timeline[-1]["arrive_at"])
        slack = (deadline - finish).total_seconds() / 60
        dl = {"deadline_at": deadline.isoformat(), "arrival_at": finish.isoformat(), "slack_min": round(slack, 1),
              "met": slack >= 0 and not blocked, "type": p.get("deadline_type") or "mandatory"}
    urgent_done = max((_parse_dt(s["arrive_at"]) for s in timeline if s["urgent"]), default=None)
    return {
        "label": label, "kind": kind, "order": order, "legs": legs, "timeline": timeline,
        "distance_km": round(sum(lg["distance_km"] for lg in legs), 1), "drive_min": round(drive_min, 1),
        "handling_min": round(handling_total, 1), "total_min": round(total_min, 1), "eta": timeline[-1]["arrive_at"],
        "cost": round(sum(ln["line_cost"] for ln in served), 2) if net.lines else None,
        "units": sum(ln["qty"] for ln in served), "served_lines": served,
        "blocked": blocked, "feasible_route": not blocked, "deadline": dl,
        "urgent_reached_min": round((urgent_done - start).total_seconds() / 60, 1) if urgent_done else None,
    }


def _ortools_order(net: Network, stops: list[str], speed: float) -> list[str] | None:
    """Best order of the intermediate stops with fixed source and destination (OR-Tools routing)."""
    n = len(stops)
    if n < 4:
        return None
    manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n - 1])
    routing = pywrapcp.RoutingModel(manager)
    cache = {}

    def arc(i: int, j: int) -> int:
        a, b = manager.IndexToNode(i), manager.IndexToNode(j)
        if (a, b) not in cache:
            lg = net.leg(stops[a], stops[b], speed)
            cache[(a, b)] = BLOCKED if lg["blocked"] else int(lg["distance_km"] * 1000)
        return cache[(a, b)]
    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(arc))
    prm = pywrapcp.DefaultRoutingSearchParameters()
    prm.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    prm.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    prm.time_limit.FromMilliseconds(400)
    sol = routing.SolveWithParameters(prm)
    if sol is None:
        return None
    idx, order = routing.Start(0), []
    while not routing.IsEnd(idx):
        order.append(stops[manager.IndexToNode(idx)])
        idx = sol.Value(routing.NextVar(idx))
    order.append(stops[manager.IndexToNode(idx)])
    return order


def _urgent_first(net: Network, stops: list[str], urgent: set[str], p: dict) -> list[str] | None:
    """Emergency: visit urgent stops as early as possible (exact search over intermediate orders)."""
    mid = stops[1:-1]
    if not mid or not (urgent & set(mid)) or len(mid) > MAX_EXACT_STOPS:
        return None
    speed = p["speed_kmh"]
    best, best_key = None, None
    for perm in itertools.permutations(mid):
        order = [stops[0], *perm, stops[-1]]
        legs = [net.leg(a, b, speed) for a, b in zip(order, order[1:], strict=False)]
        if any(lg["blocked"] for lg in legs):
            continue
        t, urgent_sum, last_urgent = 0.0, 0.0, 0.0
        for i, lg in enumerate(legs, start=1):
            t += lg["drive_min"]
            if order[i] in urgent:
                urgent_sum += t
                last_urgent = t
        key = (last_urgent, urgent_sum, t)
        if best_key is None or key < best_key:
            best, best_key = order, key
    return best


def plan_route(module: str, contested: bool, run: dict | None, stops: list[dict], mode: str, params: dict) -> dict:
    net = Network(module, contested, run)
    ids = [s["id"] for s in stops]
    if len(ids) < 2:
        raise RouteInputError("Connect at least two locations (a source and a destination)")
    if len(set(ids)) != len(ids):
        raise RouteInputError("Each location can appear only once in a route")
    if unknown := [i for i in ids if i not in net.nodes]:
        raise RouteInputError(f"Unknown locations for this plan: {', '.join(unknown)}")
    if not any(net.nodes[i]["kind"] == "warehouse" for i in ids):
        raise RouteInputError("Include at least one warehouse - the truck needs somewhere to load")
    urgent = {s["id"] for s in stops if s.get("urgent")}
    p = {"speed_kmh": params.get("speed_kmh") or DEFAULT_SPEED_KMH, "load_min": params.get("load_min", DEFAULT_LOAD_MIN),
         "unload_min": params.get("unload_min", DEFAULT_UNLOAD_MIN), "per_unit_min": params.get("per_unit_min", DEFAULT_PER_UNIT_MIN),
         "dispatch_at": params.get("dispatch_at"), "deadline_at": params.get("deadline_at") if mode == "deadline" else None,
         "deadline_type": params.get("deadline_type", "mandatory")}
    if mode == "deadline" and not p["deadline_at"]:
        raise RouteInputError("Enter a delivery deadline, or choose 'Time doesn't matter'")

    cands = [_evaluate(net, ids, "As you connected", "connected", p, urgent)]
    opt = _ortools_order(net, ids, p["speed_kmh"])
    if opt and opt != ids:
        cands.append(_evaluate(net, opt, "Optimized stop order (OR-Tools)", "optimized", p, urgent))
    if mode == "emergency":
        uf = _urgent_first(net, ids, urgent, p)
        if uf and all(uf != c["order"] for c in cands):
            cands.append(_evaluate(net, uf, "Urgent stops first", "urgent_first", p, urgent))
    if len(ids) > 2 and net.nodes[ids[0]]["kind"] == "warehouse":
        cands.append(_evaluate(net, [ids[0], ids[-1]], "Direct to destination (skip intermediate stops)", "direct", p, urgent))

    # Pick the recommended option for the chosen mode (only among options that don't use a closed road).
    full = [c for c in cands if c["kind"] != "direct" and c["feasible_route"]]
    rec = None
    if mode == "emergency":
        rec = min(full, key=lambda c: (c["urgent_reached_min"] if c["urgent_reached_min"] is not None else c["total_min"], c["total_min"]), default=None)
    elif mode == "deadline":
        mandatory = p["deadline_type"] == "mandatory"
        ok_ = [c for c in full if c["deadline"]["met"]]
        rec = min(ok_, key=lambda c: (c["cost"] or 0, c["distance_km"])) if ok_ else (None if mandatory else min(full, key=lambda c: c["total_min"], default=None))
    else:
        rec = min(full, key=lambda c: (c["cost"] or 0, c["distance_km"]), default=None)
    for c in cands:
        c["recommended"] = rec is not None and c is rec

    advice = _advice(net, ids, cands, rec, mode, p, urgent)

    check = None
    if run is not None and rec is not None and rec["served_lines"]:
        res = checker.check_plan(net.raw, rec["served_lines"])
        check = {"valid": res.valid, "lines_checked": len(rec["served_lines"]),
                 "violations": [v.as_dict() for v in res.violations][:10]}
    for c in cands:
        c["served_lines"] = [{k: ln[k] for k in ("batch_id", "product_name", "warehouse_id", "outlet_id", "qty", "line_cost")}
                             for ln in c["served_lines"]]
        c["shipments"] = sorted({delivery_status.shipment_id(ln["warehouse_id"], ln["outlet_id"]) for ln in c["served_lines"]})
    return {
        "mode": mode, "stops": [net.nodes[i] | {"urgent": i in urgent} for i in ids], "candidates": cands,
        "recommended": rec["kind"] if rec else None, "advice": advice, "check": check,
        "plan_id": run["plan_id"] if run else None,
        "assumptions": {"speed_kmh": p["speed_kmh"], "load_min": p["load_min"], "unload_min": p["unload_min"],
                        "per_unit_min": p["per_unit_min"], "dispatch_at": cands[0]["timeline"][0]["arrive_at"]},
        "data_notes": [
            "No road-routing data is available: distances are straight-line x 1.3 estimates and map lines are not roads.",
            f"Driving time assumes an average truck speed of {p['speed_kmh']:.0f} km/h; no traffic or rest breaks are modelled.",
            "Cost is the optimizer's planned lane cost (per litre, per warehouse->store lane) for the units this truck carries; "
            "fuel or per-km truck costs are not in the data.",
            "Loading/unloading times are assumptions you can change.",
            "Synthetic sample network.",
        ],
    }


def _hm(minutes: float) -> str:
    m = int(round(abs(minutes)))
    return f"{m // 60} h {m % 60:02d} min"


def _advice(net: Network, ids: list[str], cands: list[dict], rec: dict | None, mode: str, p: dict, urgent: set[str]) -> list[dict]:
    out: list[dict] = []
    full = [c for c in cands if c["kind"] != "direct"]
    for c in full:
        for b in c["blocked"]:
            out.append({"level": "flag", "text": f"{c['label']}: {b}."})
    if mode == "deadline":
        dl = _parse_dt(p["deadline_at"])
        if rec is None or not rec["deadline"]["met"]:
            usable = [c for c in full if c["feasible_route"]]
            fastest = min(usable, key=lambda c: c["total_min"], default=None)
            if fastest is None:
                out.append({"level": "flag", "text": "Every connected route uses a closed road or closed warehouse, so no deadline can be promised."})
            else:
                short = -fastest["deadline"]["slack_min"]
                out.append({"level": "flag" if p["deadline_type"] == "mandatory" else "warning",
                            "text": f"The {p['deadline_type']} deadline cannot be met: the fastest option ({fastest['label']}) arrives "
                                    f"{_hm(short)} late. It needs {_hm(fastest['total_min'])} ({_hm(fastest['drive_min'])} driving at "
                                    f"{p['speed_kmh']:.0f} km/h over {fastest['distance_km']:.0f} km + {_hm(fastest['handling_min'])} loading/unloading)."})
                latest = dl - timedelta(minutes=fastest["total_min"])
                if latest > datetime.now(timezone.utc):
                    out.append({"level": "info", "text": f"Dispatch by {latest.isoformat(timespec='minutes')} to make it with the same stops."})
                else:
                    out.append({"level": "info", "text": "Starting earlier is not possible: the latest workable dispatch time has already passed."})
            direct = next((c for c in cands if c["kind"] == "direct"), None)
            if direct and direct["deadline"] and direct["deadline"]["met"]:
                out.append({"level": "info", "text": f"Going straight to {net.nodes[ids[-1]]['name']} (skipping intermediate stops) arrives with "
                                                     f"{_hm(direct['deadline']['slack_min'])} to spare; serve the other stops with a second truck."})
            out.extend(_alt_sources(net, ids, p))
        else:
            out.append({"level": "ok", "text": f"Deadline met with {_hm(rec['deadline']['slack_min'])} to spare ({rec['label']})."})
    elif mode == "emergency":
        if not urgent:
            out.append({"level": "warning", "text": "No stop is marked urgent; mark urgent stops so they are visited first."})
        if rec is not None and rec["urgent_reached_min"] is not None:
            out.append({"level": "ok", "text": f"Urgent stops reached within {_hm(rec['urgent_reached_min'])} of dispatch ({rec['label']})."})
        out.append({"level": "info", "text": "Emergency mode reorders stops; it does not assume faster driving than the normal speed."})
    else:
        if rec is not None:
            conn = cands[0]
            if rec["kind"] == "optimized" and conn["feasible_route"]:
                out.append({"level": "ok", "text": f"The optimized order saves {conn['distance_km'] - rec['distance_km']:.0f} km and "
                                                   f"{_hm(conn['total_min'] - rec['total_min'])} versus the order you connected, at the same cost."})
            else:
                out.append({"level": "ok", "text": f"Recommended: {rec['label']} - lowest planned cost, then shortest distance."})
    if rec is not None and rec["units"] == 0 and net.lines:
        out.append({"level": "warning", "text": "This week's plan sends nothing along this trip from the selected warehouse(s), so no units or cost are shown."})
    return out


def _alt_sources(net: Network, ids: list[str], p: dict) -> list[dict]:
    """Other warehouses with an open road to the destination that could reach it sooner."""
    dest = ids[-1]
    if net.nodes[dest]["kind"] != "store":
        return []
    deadline = _parse_dt(p["deadline_at"])
    start = _parse_dt(p["dispatch_at"]) or datetime.now(timezone.utc)
    need_products = {ln["product_id"] for ln in net.lines if ln["outlet_id"] == dest}
    rows = []
    for wid, w in net.nodes.items():
        if w["kind"] != "warehouse" or wid in ids or w["status"] == "closed":
            continue
        lg = net.leg(wid, dest, p["speed_kmh"])
        if lg["blocked"]:
            continue
        mins = p["load_min"] + lg["drive_min"] + p["unload_min"]
        arrive = start + timedelta(minutes=mins)
        has = {b["product_id"] for b in net.batches.values() if b["warehouse_id"] == wid}
        rows.append((mins, wid, w["name"], arrive, len(need_products & has), len(need_products)))
    out = []
    for mins, wid, name, arrive, have, need in sorted(rows)[:2]:
        meets = deadline is not None and arrive <= deadline
        stock = f"holds {have} of the {need} products planned for this store" if need else "stock for this store not in this week's plan"
        out.append({"level": "info" if meets else "warning",
                    "text": f"Alternative source {wid} {name}: about {_hm(mins)} door to door, "
                            f"{'meets' if meets else 'still misses'} the deadline; {stock}. Re-run the plan to move stock there."})
    return out
