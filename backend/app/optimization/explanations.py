"""Deterministic why / why-not explanations (PRD 6.5). Templates filled with plan numbers; no LLM.

For every (outlet, product) line with need > 0 we report the need components, each chosen source
and why it was chosen, and exactly one reason for every other warehouse holding the product:
closed, blocked (with the rule value), capacity-bound (naming the constraint),
allocated elsewhere (naming the outlets and the rupee difference), or costlier by Rs X per unit.
A reason is only claimed when the computed plan establishes it.
"""
from __future__ import annotations

from app.inventory.eligibility import Eligibility, evaluate_pair
from app.inventory.problem import PlanningProblem
from app.optimization.plan import Plan


def _rs(x: float) -> str:
    return f"₹{x:,.2f}"


def capacity_usage(problem: PlanningProblem, plan: Plan) -> dict:
    out_used: dict[str, float] = {}
    in_used: dict[str, float] = {}
    cold_used: dict[str, float] = {}
    route_used: dict[tuple[str, str], float] = {}
    batch_used: dict[str, int] = {}
    for ln in plan.lines:
        b = problem.batches[ln["batch_id"]]
        p = problem.products[b["product_id"]]
        vol = ln["qty"] * p["unit_volume_l"]
        out_used[b["warehouse_id"]] = out_used.get(b["warehouse_id"], 0) + vol
        in_used[ln["outlet_id"]] = in_used.get(ln["outlet_id"], 0) + vol
        if p["storage_class"] != "ambient":
            cold_used[ln["outlet_id"]] = cold_used.get(ln["outlet_id"], 0) + vol
        route_used[(b["warehouse_id"], ln["outlet_id"])] = route_used.get((b["warehouse_id"], ln["outlet_id"]), 0) + vol
        batch_used[ln["batch_id"]] = batch_used.get(ln["batch_id"], 0) + ln["qty"]
    return {"out": out_used, "in": in_used, "cold": cold_used, "route": route_used, "batch": batch_used}


def _binding(problem: PlanningProblem, usage: dict, w: str | None, d: str, pid: str) -> str | None:
    """Name a capacity constraint that cannot take one more unit of pid, if any."""
    p = problem.products[pid]
    v = p["unit_volume_l"]
    o = problem.outlets[d]
    if o["receiving_capacity_l"] - usage["in"].get(d, 0) < v - 1e-9:
        return f"{o['name']} receiving capacity full ({usage['in'].get(d, 0):.1f}/{o['receiving_capacity_l']:.1f} L)"
    if p["storage_class"] != "ambient" and o["cold_capacity_l"] - usage["cold"].get(d, 0) < v - 1e-9:
        return f"{o['name']} cold capacity full ({usage['cold'].get(d, 0):.1f}/{o['cold_capacity_l']:.1f} L)"
    if w is None:
        return None
    r = problem.routes[(w, d)]
    if r["capacity_l"] - usage["route"].get((w, d), 0) < v - 1e-9:
        return f"route {r['route_id']} capacity full ({usage['route'].get((w, d), 0):.1f}/{r['capacity_l']:.1f} L)"
    wh = problem.warehouses[w]
    if wh["outbound_capacity_l"] - usage["out"].get(w, 0) < v - 1e-9:
        return f"{w} outbound capacity full ({usage['out'].get(w, 0):.1f}/{wh['outbound_capacity_l']:.1f} L)"
    return None


def explain_plan(problem: PlanningProblem, elig: Eligibility, plan: Plan) -> list[dict]:
    usage = capacity_usage(problem, plan)
    lines_by_pair: dict[tuple[str, str], list[dict]] = {}
    receivers: dict[str, dict[str, int]] = {}
    for ln in plan.lines:
        lines_by_pair.setdefault((ln["outlet_id"], ln["product_id"]), []).append(ln)
        receivers.setdefault(ln["batch_id"], {})
        receivers[ln["batch_id"]][ln["outlet_id"]] = receivers[ln["batch_id"]].get(ln["outlet_id"], 0) + ln["qty"]

    holders: dict[str, dict[str, list[dict]]] = {}
    for b in problem.batches.values():
        holders.setdefault(b["product_id"], {}).setdefault(b["warehouse_id"], []).append(b)

    out = []
    for (d, pid), q in sorted(problem.need.items(), key=lambda kv: (int(kv[0][0][1:]), kv[0][1])):
        if q <= 0:
            continue
        o = problem.outlets[d]
        p = problem.products[pid]
        chosen = lines_by_pair.get((d, pid), [])
        delivered = sum(ln["qty"] for ln in chosen)
        short = q - delivered
        chosen_w = {ln["warehouse_id"] for ln in chosen}

        # evaluate every warehouse holding the product
        alt_evals: dict[str, list] = {}
        for w, bs in holders.get(pid, {}).items():
            alt_evals[w] = [elig.pairs.get((b["batch_id"], d)) or evaluate_pair(problem, b, d) for b in bs]
        eligible_costs = {w: min(e.unit_cost for e in evs if e.eligible) for w, evs in alt_evals.items()
                          if any(e.eligible for e in evs)}
        best_chosen_cost = min((problem.unit_cost(ln["batch_id"], d) for ln in chosen), default=None)

        sources = []
        for ln in sorted(chosen, key=lambda ln: -ln["qty"]):
            ev = elig.pairs.get((ln["batch_id"], d)) or evaluate_pair(problem, problem.batches[ln["batch_id"]], d)
            b = problem.batches[ln["batch_id"]]
            cheaper = {w: c for w, c in eligible_costs.items() if c < ev.unit_cost - 1e-9 and w != ln["warehouse_id"]}
            same_w_elig = [e for e in alt_evals[ln["warehouse_id"]] if e.eligible]
            earliest = min(problem.batches[e.batch_id]["expiry_date"] for e in same_w_elig) == b["expiry_date"]
            why = (f"Batch {ln['batch_id']} from {ln['warehouse_id']} ({problem.warehouses[ln['warehouse_id']]['name']}): "
                   f"{b['quantity']} units in stock, arrives with {ev.life_on_arrival} days "
                   f"({ev.life_on_arrival_pct:.0f}% of shelf life) left, {_rs(ev.unit_cost)}/unit delivered.")
            if not cheaper:
                why += " Lowest feasible delivery cost for this outlet."
            else:
                why += " Cheaper sources were not usable: " + ", ".join(sorted(cheaper)) + " (see alternatives)."
            if problem.rules.fefo and earliest and len(same_w_elig) > 1:
                why += " Earliest-expiring eligible batch at this warehouse (FEFO)."
            rule_notes = []
            if problem.rules.min_life_rule_id:
                rule_notes.append(f"{problem.rules.min_life_rule_id}: shelf life on arrival passes")
            if problem.rules.storage_rule_id and p["storage_class"] in problem.rules.storage_classes:
                rule_notes.append(f"{problem.rules.storage_rule_id}: {p['storage_class']} storage available")
            sources.append({
                "batch_id": ln["batch_id"], "warehouse_id": ln["warehouse_id"], "qty": ln["qty"],
                "unit_cost": ev.unit_cost, "life_on_arrival_days": ev.life_on_arrival,
                "life_on_arrival_pct": ev.life_on_arrival_pct, "expiry_date": b["expiry_date"],
                "lead_time_days": ev.lead_time_days, "rules_passed": rule_notes, "why": why,
            })

        alternatives = []
        for w in sorted(alt_evals, key=lambda w: int(w[1:])):
            if w in chosen_w:
                continue
            evs = alt_evals[w]
            wh = problem.warehouses[w]
            route = problem.routes.get((w, d))
            if wh["status"] != "operational":
                alternatives.append({"warehouse_id": w, "status": "closed", "reason": f"{w} is {wh['status']}"})
                continue
            if route is None or not route["open"]:
                alternatives.append({"warehouse_id": w, "status": "closed",
                                     "reason": f"Route {w}->{d} is closed" if route else f"No route {w}->{d}"})
                continue
            eligible = [e for e in evs if e.eligible]
            if not eligible:
                best = max(evs, key=lambda e: (e.life_on_arrival if e.life_on_arrival is not None else -9999))
                blk = best.blocks[0] if best.blocks else None
                code = blk.code if blk else "BLOCKED"
                if code == "NO_STOCK":
                    alternatives.append({"warehouse_id": w, "status": "no_stock", "reason": f"{w} has no stock"})
                else:
                    tag = f"{blk.rule_id}: " if blk and blk.rule_id else ""
                    alternatives.append({"warehouse_id": w, "status": "blocked", "rule_id": blk.rule_id if blk else None,
                                         "reason": f"Blocked by rule - {tag}{blk.message if blk else 'ineligible'} "
                                                   f"(best batch {best.batch_id})"})
                continue
            cost_w = min(e.unit_cost for e in eligible)
            left = sum(problem.batches[e.batch_id]["quantity"] - usage["batch"].get(e.batch_id, 0) for e in eligible)
            if left <= 0:
                recv: dict[str, int] = {}
                for e in eligible:
                    for od, qq in receivers.get(e.batch_id, {}).items():
                        recv[od] = recv.get(od, 0) + qq
                top = sorted(recv.items(), key=lambda kv: -kv[1])[:3]
                diff = ""
                if best_chosen_cost is not None:
                    dlt = cost_w - best_chosen_cost
                    diff = f"; would cost {_rs(abs(dlt))}/unit {'more' if dlt >= 0 else 'less'} than the chosen source"
                alternatives.append({"warehouse_id": w, "status": "allocated_elsewhere",
                                     "allocated_to": [{"outlet_id": od, "qty": qq} for od, qq in top],
                                     "reason": "All eligible stock allocated elsewhere: "
                                               + ", ".join(f"{od} ({qq})" for od, qq in top) + diff})
                continue
            bind = _binding(problem, usage, w, d, pid)
            if bind:
                alternatives.append({"warehouse_id": w, "status": "capacity_bound", "reason": f"Capacity-bound: {bind}"})
                continue
            if best_chosen_cost is not None and short <= 0:
                dlt = cost_w - best_chosen_cost
                if dlt > 1e-9:
                    alternatives.append({"warehouse_id": w, "status": "costlier", "delta_per_unit": dlt,
                                         "reason": f"Costlier by {_rs(dlt)} per unit ({_rs(cost_w)} vs {_rs(best_chosen_cost)})"})
                else:
                    alternatives.append({"warehouse_id": w, "status": "equal_cost",
                                         "reason": f"Same delivery cost ({_rs(cost_w)}); tie broken by expiry/solver order"})
                continue
            if short <= 0:
                alternatives.append({"warehouse_id": w, "status": "not_needed",
                                     "reason": f"Need fully met by other sources ({_rs(cost_w)}/unit here)"})
                continue
            alternatives.append({"warehouse_id": w, "status": "unexplained",
                                 "reason": f"{left} eligible units remain at {w} but were not used "
                                           f"(within the solver's optimality tolerance)"})

        shortage_reason = None
        if short > 0:
            parts = []
            outlet_bind = _binding(problem, usage, None, d, pid)
            if outlet_bind:
                parts.append(outlet_bind)
            used_bind = [_binding(problem, usage, w, d, pid) for w in chosen_w]
            parts += [f"chosen source limited: {b}" for b in used_bind if b and b != outlet_bind]
            for w in chosen_w:
                evs = [e for e in alt_evals[w] if e.eligible]
                if evs and sum(problem.batches[e.batch_id]["quantity"] - usage["batch"].get(e.batch_id, 0) for e in evs) <= 0:
                    parts.append(f"all eligible stock at {w} is used")
            parts += [f"{a['warehouse_id']}: {a['reason']}" for a in alternatives]
            if not holders.get(pid):
                parts.append("no warehouse holds this product")
            # an outlet-level limit applies to every source; state it once rather than per warehouse
            if outlet_bind:
                parts = [outlet_bind] + [x for x in parts[1:] if not x.endswith(outlet_bind)]
            parts = list(dict.fromkeys(parts))
            shortage_reason = f"{short} of {q} units unmet. " + ("; ".join(parts) if parts else
                                                                 "No eligible source with remaining stock.")

        nd = problem.need_detail.get((d, pid))
        if nd and nd.source == "forecast":
            need_text = (f"Need {q} = forecast {nd.forecast_units:.1f} over {nd.horizon_days} days (R={problem.review_period_days} + "
                         f"L={nd.lead_time_days}) + safety {nd.safety_stock:.1f} (z={nd.z}, σ={nd.sigma:.2f}) "
                         f"- usable on-hand {nd.usable_on_hand}, rounded up")
        elif nd:
            need_text = f"Need {q} = open order quantity {nd.order_qty}"
        else:
            need_text = f"Need {q}"
        if nd and nd.scenario_multiplier != 1.0:
            need_text += f" (scenario uplift x{nd.scenario_multiplier})"

        status = "short" if short > 0 else "met"
        summary = (f"{delivered}/{q} units of {p['name']} to {o['name']} from "
                   f"{', '.join(sorted(chosen_w)) or 'no source'}"
                   + (f"; {short} short" if short > 0 else ""))
        out.append({
            "outlet_id": d, "outlet_name": o["name"], "product_id": pid, "product_name": p["name"],
            "criticality": p["criticality"], "need": q, "delivered": delivered, "shortage": max(short, 0),
            "status": status, "need_text": need_text, "need_detail": nd.as_dict() if nd else None,
            "sources": sources, "alternatives": alternatives, "shortage_reason": shortage_reason,
            "summary": summary,
        })
    return out
