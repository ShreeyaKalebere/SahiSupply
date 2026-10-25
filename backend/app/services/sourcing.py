"""Stock-aware sourcing: "this store needs N units of a product - where should they come from, and which path?"

The shop owner does not need to know where stock is. Starting from the current plan:

1. Availability per warehouse = batch stock minus what this week's plan already ships, kept only when the
   batch passes the same eligibility rules the optimizer uses (open road, warehouse operational, shelf
   life on arrival, storage class) - via ``evaluate_pair`` on the plan's exact inputs.
2. Remaining capacity = warehouse outbound, road and store receiving/cold capacity minus the plan's use.
3. A small OR-Tools (SCIP) model picks batches:
   - flexible:  minimise planned lane cost (the existing objective), FEFO tie-break;
   - deadline:  only warehouses whose direct trip arrives by the deadline (mandatory), or penalise late ones
                (preferred), then cost;
   - emergency: minimise the latest arrival among the warehouses used, then cost.
   Units that cannot be sourced are reported as a shortfall with the reason - never hidden.
4. The chosen warehouses become a route (route_planner): one truck collecting from each in an OR-Tools
   order, compared with separate trucks driving in parallel.
5. The independent checker re-verifies the new lines against the plan's inputs with the plan's own usage
   removed from stock and capacity.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

from ortools.linear_solver import pywraplp

from app.inventory.eligibility import evaluate_pair
from app.optimization import checker
from app.services import route_planner
from app.services.planner import problem_from_raw

SHORTFALL_PENALTY = 1e6


class SourcingError(ValueError):
    pass


def _hm(m: float) -> str:
    t = int(round(abs(m)))
    return f"{t // 60} h {t % 60:02d} min"


def source_order(run: dict, outlet_id: str, product_id: str, qty: int, mode: str, params: dict) -> dict:
    if not run.get("optimizer"):
        raise SourcingError("The current plan has no optimized result to build on")
    raw = run["raw_inputs"]
    problem = problem_from_raw(raw, run["need_detail"], run.get("rules_spec_ids", {}), run["data_source"])
    if outlet_id not in problem.outlets:
        raise SourcingError(f"Store {outlet_id} is not in this plan's network")
    if product_id not in problem.products:
        raise SourcingError(f"Product {product_id} is not in this module")
    product = problem.products[product_id]
    store = problem.outlets[outlet_id]
    vol = product["unit_volume_l"]
    cold = product["storage_class"] != "ambient"

    p = {"speed_kmh": params.get("speed_kmh") or route_planner.DEFAULT_SPEED_KMH,
         "load_min": params.get("load_min", route_planner.DEFAULT_LOAD_MIN),
         "unload_min": params.get("unload_min", route_planner.DEFAULT_UNLOAD_MIN),
         "per_unit_min": params.get("per_unit_min", route_planner.DEFAULT_PER_UNIT_MIN),
         "dispatch_at": params.get("dispatch_at"), "deadline_at": params.get("deadline_at") if mode == "deadline" else None,
         "deadline_type": params.get("deadline_type", "mandatory"), "on_top": params.get("on_top_of_plan", True)}
    if mode == "deadline" and not p["deadline_at"]:
        raise SourcingError("Enter a delivery deadline, or choose 'Time doesn't matter'")
    start = route_planner._parse_dt(p["dispatch_at"]) or datetime.now(timezone.utc)
    deadline = route_planner._parse_dt(p["deadline_at"])

    # What this week's plan already uses (ignored when the order is planned on its own).
    on_top = params.get("on_top_of_plan", True)
    lines = run["optimizer"]["lines"] if on_top else []
    used_batch: dict[str, int] = {}
    used_wh: dict[str, float] = {}
    used_route: dict[tuple[str, str], float] = {}
    used_recv = used_cold = 0.0
    for ln in lines:
        v = problem.products[ln["product_id"]]["unit_volume_l"] * ln["qty"]
        used_batch[ln["batch_id"]] = used_batch.get(ln["batch_id"], 0) + ln["qty"]
        used_wh[ln["warehouse_id"]] = used_wh.get(ln["warehouse_id"], 0) + v
        used_route[(ln["warehouse_id"], ln["outlet_id"])] = used_route.get((ln["warehouse_id"], ln["outlet_id"]), 0) + v
        if ln["outlet_id"] == outlet_id:
            used_recv += v
            if problem.products[ln["product_id"]]["storage_class"] != "ambient":
                used_cold += v
    recv_left = max(0.0, store["receiving_capacity_l"] - used_recv)
    cold_left = max(0.0, store["cold_capacity_l"] - used_cold) if cold else None

    net = route_planner.Network(run["module"], run["contested_pattern"], run)

    # Availability per warehouse, with the reasons stock is unusable.
    wh_rows: dict[str, dict] = {}
    cand: list[dict] = []
    for w in sorted(problem.warehouses):
        lg = net.leg(w, outlet_id, p["speed_kmh"])
        direct_min = p["load_min"] + lg["drive_min"] + p["unload_min"]
        route = problem.routes.get((w, outlet_id))
        wh_rows[w] = {"warehouse_id": w, "name": problem.warehouses[w]["name"], "status": problem.warehouses[w]["status"],
                      "total_units": 0, "committed_units": 0, "free_units": 0, "eligible_units": 0, "blocked": {},
                      "distance_km": lg["distance_km"], "direct_min": round(direct_min, 1),
                      "arrival_at": (start + timedelta(minutes=direct_min)).isoformat(), "road_open": lg["open"],
                      "unit_cost": None, "allocated": 0,
                      "outbound_left_l": round(max(0.0, problem.warehouses[w]["outbound_capacity_l"] - used_wh.get(w, 0)), 1),
                      "road_left_l": round(max(0.0, route["capacity_l"] - used_route.get((w, outlet_id), 0)), 1) if route else 0.0}
    for b in problem.batches_of(product_id):
        row = wh_rows[b["warehouse_id"]]
        free = b["quantity"] - used_batch.get(b["batch_id"], 0)
        row["total_units"] += b["quantity"]
        row["committed_units"] += used_batch.get(b["batch_id"], 0)
        row["free_units"] += max(0, free)
        if free <= 0:
            continue
        ev = evaluate_pair(problem, b, outlet_id)
        if not ev.eligible:
            code = ev.blocks[0].code if ev.blocks else "BLOCKED"
            row["blocked"][code] = row["blocked"].get(code, 0) + free
            continue
        row["eligible_units"] += free
        row["unit_cost"] = round(ev.unit_cost, 4)
        cand.append({"batch": b, "free": free, "cost": ev.unit_cost, "life": ev.life_on_arrival, "pct": ev.life_on_arrival_pct})

    late = set()
    if deadline is not None:
        late = {w for w, r in wh_rows.items() if start + timedelta(minutes=r["direct_min"]) > deadline}

    # Allocation model (OR-Tools SCIP).
    solver = pywraplp.Solver.CreateSolver("SCIP")
    y = {}
    for c in cand:
        w = c["batch"]["warehouse_id"]
        if mode == "deadline" and p["deadline_type"] == "mandatory" and w in late:
            continue
        y[c["batch"]["batch_id"]] = (solver.IntVar(0, c["free"], f"y_{c['batch']['batch_id']}"), c)
    short = solver.NumVar(0, qty, "shortfall")
    take = solver.Constraint(qty, qty, "demand")
    take.SetCoefficient(short, 1)
    by_w: dict[str, list] = {}
    for var, c in y.values():
        take.SetCoefficient(var, 1)
        by_w.setdefault(c["batch"]["warehouse_id"], []).append(var)
    for w, vs in by_w.items():
        lim = min(wh_rows[w]["outbound_left_l"], wh_rows[w]["road_left_l"])
        cw = solver.Constraint(-solver.infinity(), lim)
        for v in vs:
            cw.SetCoefficient(v, vol)
    crecv = solver.Constraint(-solver.infinity(), recv_left)
    for var, _ in y.values():
        crecv.SetCoefficient(var, vol)
    if cold:
        ccold = solver.Constraint(-solver.infinity(), cold_left)
        for var, _ in y.values():
            ccold.SetCoefficient(var, vol)

    obj = solver.Objective()
    obj.SetCoefficient(short, SHORTFALL_PENALTY)
    max_r = max((c["life"] or 0 for c in cand), default=1) or 1
    min_c = min((c["cost"] for c in cand), default=1.0) or 1.0
    for var, c in y.values():
        w = c["batch"]["warehouse_id"]
        coef = c["cost"] + 0.01 * min_c * (c["life"] or 0) / max_r       # FEFO tie-break, as in the main model
        if mode == "deadline" and w in late:                              # preferred deadline: lateness is costly
            coef += 1000.0
        obj.SetCoefficient(var, coef)
    if mode == "emergency" and by_w:
        # Minimise the latest arrival among warehouses used (weight dominates cost).
        tmax = solver.NumVar(0, solver.infinity(), "latest_arrival")
        for w, vs in by_w.items():
            use = solver.BoolVar(f"use_{w}")
            cap = sum(c["free"] for _, c in y.values() if c["batch"]["warehouse_id"] == w)
            link = solver.Constraint(-solver.infinity(), 0)
            for v in vs:
                link.SetCoefficient(v, 1)
            link.SetCoefficient(use, -cap)
            ct = solver.Constraint(-solver.infinity(), 0)
            ct.SetCoefficient(use, wh_rows[w]["direct_min"])
            ct.SetCoefficient(tmax, -1)
        obj.SetCoefficient(tmax, 1000.0)
    obj.SetMinimization()
    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        raise SourcingError("The sourcing model found no solution")

    alloc = []
    for var, c in y.values():
        q = int(round(var.solution_value()))
        if q > 0:
            b = c["batch"]
            alloc.append({"batch_id": b["batch_id"], "product_id": product_id, "product_name": product["name"],
                          "warehouse_id": b["warehouse_id"], "outlet_id": outlet_id, "outlet_name": store["name"], "qty": q,
                          "expiry_date": b["expiry_date"], "life_on_arrival_days": c["life"], "unit_cost": round(c["cost"], 4),
                          "line_cost": round(c["cost"] * q, 2)})
            wh_rows[b["warehouse_id"]]["allocated"] += q
    alloc.sort(key=lambda a: (a["warehouse_id"], a["expiry_date"]))
    got = sum(a["qty"] for a in alloc)
    shortfall = qty - got

    # Paths: one truck collecting from every chosen warehouse vs separate trucks in parallel.
    chosen = sorted({a["warehouse_id"] for a in alloc}, key=lambda w: wh_rows[w]["direct_min"], reverse=True)
    options = []
    if chosen:
        net.lines = alloc
        stops = chosen + [outlet_id]
        order = route_planner._ortools_order(net, stops, p["speed_kmh"]) or stops
        one = route_planner._evaluate(net, order, "One truck collecting from each warehouse" if len(chosen) > 1 else "Direct delivery",
                                      "one_truck", p, set())
        options.append(one)
        if len(chosen) > 1:
            trips = [route_planner._evaluate(net, [w, outlet_id], f"Truck from {w}", "parallel", p, set()) for w in chosen]
            par = max(trips, key=lambda t: t["total_min"])
            par = {**par, "label": f"{len(chosen)} trucks in parallel", "kind": "parallel",
                   "order": chosen + [outlet_id], "legs": [lg for t in trips for lg in t["legs"]],
                   "distance_km": round(sum(t["distance_km"] for t in trips), 1), "trips": [t["order"] for t in trips],
                   "cost": round(sum(a["line_cost"] for a in alloc), 2), "units": got,
                   "handling_min": max(t["handling_min"] for t in trips)}
            options.append(par)
    rec = None
    if options:
        if mode == "emergency":
            rec = min(options, key=lambda o: o["total_min"])
        elif mode == "deadline":
            met = [o for o in options if o["deadline"] and o["deadline"]["met"]]
            rec = min(met, key=lambda o: (len(o.get("trips", [1])), o["distance_km"])) if met else (
                None if p["deadline_type"] == "mandatory" else min(options, key=lambda o: o["total_min"]))
        else:
            rec = min(options, key=lambda o: (len(o.get("trips", [1])), o["distance_km"]))   # fewest trucks, then distance
    for o in options:
        o["recommended"] = o is rec
        o["served_lines"] = [{k: ln[k] for k in ("batch_id", "product_name", "warehouse_id", "outlet_id", "qty", "line_cost")} for ln in alloc]
        o["shipments"] = []

    # Independent check: the new lines against the plan's inputs, with the plan's own usage removed.
    check = None
    if alloc:
        chk_raw = copy.deepcopy(raw)
        for b in chk_raw["batches"]:
            b["quantity"] -= used_batch.get(b["batch_id"], 0)
        for w in chk_raw["warehouses"]:
            w["outbound_capacity_l"] = max(0.0, w["outbound_capacity_l"] - used_wh.get(w["warehouse_id"], 0))
        for r in chk_raw["routes"]:
            r["capacity_l"] = max(0.0, r["capacity_l"] - used_route.get((r["warehouse_id"], r["outlet_id"]), 0))
        for o in chk_raw["outlets"]:
            if o["outlet_id"] == outlet_id:
                o["receiving_capacity_l"] = recv_left
                o["cold_capacity_l"] = cold_left if cold else max(0.0, o["cold_capacity_l"] - used_cold)
        chk_raw["need"] = [{"outlet_id": outlet_id, "product_id": product_id, "need": qty}]
        res = checker.check_plan(chk_raw, [{k: a[k] for k in ("batch_id", "outlet_id", "product_id", "warehouse_id", "qty")} for a in alloc])
        check = {"valid": res.valid, "lines_checked": len(alloc), "violations": [v.as_dict() for v in res.violations][:10]}

    advice = _advice(qty, got, shortfall, wh_rows, product, store, recv_left, cold_left, vol, mode, p, late, rec, options, deadline, start)
    return {
        "mode": mode, "plan_id": run["plan_id"], "outlet": {"id": outlet_id, "name": store["name"], "city": store.get("city")},
        "product": {"id": product_id, "name": product["name"], "storage_class": product["storage_class"], "unit_volume_l": vol},
        "requested": qty, "fulfilled": got, "shortfall": shortfall, "on_top_of_plan": on_top,
        "warehouses": sorted(wh_rows.values(), key=lambda r: (-r["allocated"], r["direct_min"])),
        "allocation": alloc, "options": options, "recommended": rec["kind"] if rec else None, "advice": advice, "check": check,
        "store_capacity": {"receiving_left_l": round(recv_left, 1), "cold_left_l": round(cold_left, 1) if cold_left is not None else None},
        "assumptions": {"speed_kmh": p["speed_kmh"], "load_min": p["load_min"], "unload_min": p["unload_min"], "per_unit_min": p["per_unit_min"]},
        "data_notes": [
            ("Availability = stock in the database minus what this week's plan already ships; capacity left = capacity minus "
             "the plan's use." if on_top else "Planned as a separate order: this week's planned deliveries are ignored, so "
             "stock and capacity are counted in full (the two cannot both happen in the same week).")
            + " Eligibility uses the plan's rules (shelf life on arrival, storage, open roads).",
            "Distances are straight-line x 1.3 estimates (no road-routing data); time assumes the stated average speed, no traffic.",
            "Cost is the planned lane cost per litre for each warehouse -> store lane. Synthetic sample data.",
        ],
    }


def _advice(qty, got, shortfall, wh_rows, product, store, recv_left, cold_left, vol, mode, p, late, rec, options, deadline, start) -> list[dict]:
    out: list[dict] = []
    eligible = sum(r["eligible_units"] for r in wh_rows.values())
    used = [r for r in wh_rows.values() if r["allocated"]]
    if got:
        parts = ", ".join(f"{r['allocated']} from {r['warehouse_id']} {r['name']}" for r in used)
        out.append({"level": "ok", "text": f"{got} of {qty} units can be sent: {parts}."})
    if shortfall:
        reasons = []
        if eligible < qty:
            reasons.append(f"only {eligible} units are free and eligible across all warehouses after this week's plan")
        if recv_left < qty * vol - 1e-6:
            reasons.append(f"{store['name']} has receiving space for only {int(recv_left // vol)} more units this week"
                           + (" after the plan's deliveries" if p.get("on_top", True) else ""))
        if cold_left is not None and cold_left < qty * vol - 1e-6:
            reasons.append(f"its cold storage has room for only {int(cold_left // vol)} more units")
        if mode == "deadline" and p["deadline_type"] == "mandatory" and late:
            reasons.append(f"{len(late)} warehouse(s) cannot reach the store by the deadline")
        blocked = {}
        for r in wh_rows.values():
            for k, v in r["blocked"].items():
                blocked[k] = blocked.get(k, 0) + v
        if blocked:
            reasons.append("unusable stock: " + ", ".join(f"{v} units {k.replace('_', ' ').lower()}" for k, v in blocked.items()))
        out.append({"level": "flag", "text": f"{shortfall} units cannot be supplied" + (": " + "; ".join(reasons) if reasons else "") + "."})
    if mode == "deadline" and deadline is not None:
        if rec is None and options:
            fastest = min(options, key=lambda o: o["total_min"])
            out.append({"level": "flag", "text": f"The mandatory deadline cannot be met: the fastest path ({fastest['label']}) needs "
                                                 f"{_hm(fastest['total_min'])} and arrives {_hm(-fastest['deadline']['slack_min'])} late."})
        elif rec is not None and rec["deadline"]:
            out.append({"level": "ok" if rec["deadline"]["met"] else "warning",
                        "text": f"{rec['label']}: arrives {'with ' + _hm(rec['deadline']['slack_min']) + ' to spare' if rec['deadline']['met'] else _hm(-rec['deadline']['slack_min']) + ' after the preferred deadline'}."})
        if late and shortfall:
            later = sum(wh_rows[w]["eligible_units"] for w in late)
            if later:
                out.append({"level": "info", "text": f"{later} more eligible units exist in warehouses that would arrive after the deadline "
                                                     f"({', '.join(sorted(late))}); choose 'Time doesn't matter' to include them."})
    if mode == "emergency" and rec is not None:
        out.append({"level": "info", "text": f"Fastest way to get the stock there: {rec['label']} ({_hm(rec['total_min'])}). "
                                             "Emergency picks the quickest warehouses; it does not assume faster driving."})
    if len(options) > 1:
        one, par = options[0], options[1]
        out.append({"level": "info", "text": f"One truck: {_hm(one['total_min'])}, {one['distance_km']:.0f} km. Separate trucks in parallel: "
                                             f"{_hm(par['total_min'])} (slowest truck), {par['distance_km']:.0f} km in total."})
    return out
