"""Controlled simulations: Chaos Mode (disruptions) and Expiry Rescue Mission.

Both re-run the normal planning pipeline (forecast -> net need -> OR-Tools MILP -> independent checker)
on a private copy of the data and compare against the plan the user is looking at. Nothing here
detects real disruptions, and stored operational data is never modified.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.common import ApiError, ok, require_module
from app.api.optimization import _network, plan_diff, public_run
from app.scenarios.chaos import KINDS, ChaosEdit
from app.schemas.requests import SimulationRequest
from app.services import run_store
from app.services.planner import run_plan

router = APIRouter(prefix="/api", tags=["simulation"])

SIM_NOTE = "Controlled simulation on synthetic data - not real-time disruption detection."
TRANSFER_DAYS = 1   # assumed warehouse-to-warehouse transfer time for transfer suggestions


def _settings(req: SimulationRequest) -> dict:
    return {"rule_toggles": req.rule_toggles, "contested_pattern": req.contested_pattern, "network": _network(req)}


def _before(req: SimulationRequest, fingerprint: str | None = None) -> dict:
    """The plan being compared against: the user's current plan when it matches, else a fresh one."""
    run = run_store.get(req.before_plan_id) if req.before_plan_id else None
    usable = (run is not None and run.get("optimizer") and run["module"] == req.module and not run.get("chaos")
              and not run.get("rescue") and (fingerprint is None or run["fingerprint"] == fingerprint))
    if usable:
        return run
    return run_store.save(run_plan(req.module, req.scenario_id, include_insights=False, include_regret=False, **_settings(req)))


def _lanes(run: dict) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = {}
    for ln in (run.get("optimizer") or {}).get("lines", []):
        k = (ln["warehouse_id"], ln["outlet_id"])
        out[k] = out.get(k, 0) + ln["qty"]
    return out


def _requirements(run: dict) -> dict:
    """Unsatisfied requirements in a plan: remaining shortages, critical gaps, checker violations."""
    opt = run.get("optimizer")
    if not opt:
        return {"feasible": False, "solver_status": (run.get("optimizer_error") or {}).get("status"),
                "message": "The optimizer found no feasible plan for this disruption. No recovery is claimed."}
    short = sorted((r for r in run["allocation"] if r["unmet"] > 0), key=lambda r: (r["criticality"] != "critical", -r["unmet"]))
    below = (run.get("equity") or {}).get("below_floor_on") or []
    return {"feasible": True, "checker_valid": opt["check"]["valid"], "violations": opt["check"].get("violations", [])[:10],
            "unmet_units": opt["kpis"]["unmet_units"], "critical_shortage_units": opt["kpis"]["critical_shortage_units"],
            "short_orders": len(short), "below_fill_floor": len(below),
            "top_shortages": [{k: r[k] for k in ("outlet_id", "outlet_name", "product_id", "product_name", "criticality",
                                                  "required", "allocated", "unmet")} for r in short[:15]]}


@router.get("/chaos/kinds")
def chaos_kinds():
    return ok([{"kind": k, "label": v} for k, v in KINDS.items()], note=SIM_NOTE)


@router.post("/chaos/run")
def chaos_run(req: SimulationRequest):
    require_module(req.module)
    if req.chaos is None:
        raise ApiError(422, "CHAOS_REQUIRED", "Choose a disruption to simulate")
    before = _before(req)
    after = run_store.save(run_plan(req.module, req.scenario_id, include_insights=False, include_regret=False,
                                    chaos=ChaosEdit(**req.chaos.model_dump()), **_settings(req)))
    chaos = after["chaos"]
    impact = None
    if after.get("optimizer") and before.get("optimizer"):
        diff = plan_diff(before, after)
        la, lb = _lanes(before), _lanes(after)
        lost = [{"warehouse_id": w, "outlet_id": d, "qty": q} for (w, d), q in la.items() if (w, d) not in lb]
        new = [{"warehouse_id": w, "outlet_id": d, "qty": q} for (w, d), q in lb.items() if (w, d) not in la]
        lead = lambda r: max((s["lead_time_days"] for s in r.get("sources", [])), default=0)  # noqa: E731
        a = {(r["outlet_id"], r["product_id"]): r for r in before["allocation"]}
        delayed, newly_short = [], []
        for r in after["allocation"]:
            ra = a.get((r["outlet_id"], r["product_id"]))
            if ra and r["sources"] and ra["sources"] and lead(r) > lead(ra):
                delayed.append({"outlet_id": r["outlet_id"], "outlet_name": r["outlet_name"], "product_name": r["product_name"],
                                "lead_before": lead(ra), "lead_after": lead(r)})
            if r["unmet"] > (ra["unmet"] if ra else 0):
                newly_short.append({"outlet_id": r["outlet_id"], "outlet_name": r["outlet_name"], "product_name": r["product_name"],
                                    "unmet_before": ra["unmet"] if ra else 0, "unmet_after": r["unmet"]})
        affected = sorted({c["outlet_id"] for c in diff["changed_rows"]}, key=lambda x: int(x[1:]))
        kb, ka = before["optimizer"]["kpis"], after["optimizer"]["kpis"]
        impact = {"diff": diff, "lost_lanes": lost, "new_lanes": new, "delayed_deliveries": delayed,
                  "newly_short": newly_short, "affected_outlets": affected,
                  "kpis_before": kb, "kpis_after": ka, "explanation": _explain(chaos, kb, ka, lost, new, delayed, newly_short)}
    return ok({"before": public_run(before), "after": public_run(after), "chaos": chaos, "impact": impact,
               "requirements": _requirements(after), "note": SIM_NOTE},
              data_source=after["data_source"], persisted=after["persisted"])


def _explain(chaos: dict, kb: dict, ka: dict, lost: list, new: list, delayed: list, short: list) -> list[str]:
    out = [f"Disruption: {chaos['label']}. " + " ".join(chaos["assumptions"])]
    if new:
        out.append(f"The optimizer re-routed through {len(new)} alternative warehouse-to-store connection(s) "
                   f"and dropped {len(lost)} connection(s) it could no longer use or afford.")
    elif lost:
        out.append(f"{len(lost)} connection(s) stopped; no alternative connection could serve them.")
    dc = ka["transport_cost"] - kb["transport_cost"]
    out.append(f"Delivery cost {'rises' if dc > 0 else 'falls'} by Rs {abs(dc):,.0f}; fill rate goes from "
               f"{kb['fill_rate'] * 100:.1f}% to {ka['fill_rate'] * 100:.1f}%.")
    if delayed:
        out.append(f"{len(delayed)} order(s) now come from a warehouse further away (longer lead time).")
    if ka["unmet_units"] > 0:
        out.append(f"{ka['unmet_units']:,} units still cannot be delivered"
                   + (f", including {ka['critical_shortage_units']:,} critical units" if ka["critical_shortage_units"] else "")
                   + ". The optimizer protects critical items first (higher shortage penalty), then cheaper lanes.")
    else:
        out.append("Every store need is still covered after re-planning.")
    if short:
        out.append(f"{len(short)} order(s) are shorter than before the disruption.")
    return out


@router.post("/rescue/run")
def rescue_run(req: SimulationRequest):
    require_module(req.module)
    after = run_store.save(run_plan(req.module, req.scenario_id, include_insights=False, include_regret=False,
                                    rescue=True, **_settings(req)))
    before = _before(req, after["fingerprint"])
    if not after.get("optimizer") or not before.get("optimizer"):
        raise ApiError(409, "NO_FEASIBLE_PLAN", "The optimizer returned no feasible plan; no rescue is claimed.")
    raw = after["raw_inputs"]
    batches = {b["batch_id"]: b for b in raw["batches"]}
    products = {p["product_id"]: p for p in raw["products"]}
    wh_name = {w["warehouse_id"]: w["name"] for w in raw["warehouses"]}
    min_lead: dict[str, int] = {}
    for r in raw["routes"]:
        if r["open"]:
            min_lead[r["warehouse_id"]] = min(min_lead.get(r["warehouse_id"], 99), r["lead_time_days"])

    def shipped(run: dict) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for ln in run["optimizer"]["lines"]:
            out.setdefault(ln["batch_id"], []).append(ln)
        return out
    sb, sa = shipped(before), shipped(after)
    # Store needs still unmet after the rescue plan, per (warehouse able to reach them, product).
    unmet_by_prod: dict[str, list[dict]] = {}
    for r in after["allocation"]:
        if r["unmet"] > 0:
            unmet_by_prod.setdefault(r["product_id"], []).append(r)
    open_routes = {(r["warehouse_id"], r["outlet_id"]) for r in raw["routes"] if r["open"]}

    rows = []
    for bid, risk in after["at_risk"].items():
        b, p = batches[bid], products[batches[bid]["product_id"]]
        qb = sum(ln["qty"] for ln in sb.get(bid, []))
        qa = sum(ln["qty"] for ln in sa.get(bid, []))
        left_b, left_a = b["quantity"] - qb, b["quantity"] - qa
        actions = []
        if risk["expired"]:
            actions.append({"type": "dispose", "text": "Already expired - never shipped. Flag for disposal per policy."})
        else:
            if qa:
                dests = sorted({ln["outlet_name"] for ln in sa[bid]})
                moved = {ln["outlet_id"] for ln in sa[bid]} != {ln["outlet_id"] for ln in sb.get(bid, [])}
                actions.append({"type": "reallocate" if moved else "dispatch",
                                "text": f"{'Reallocate' if moved else 'Prioritise dispatch'}: {qa:,} units to {', '.join(dests[:4])}"
                                        + (f" +{len(dests) - 4} more" if len(dests) > 4 else "")})
            if left_a > 0:
                for w2 in sorted({w for w in min_lead if w != b["warehouse_id"]}):
                    life = risk["days_to_expiry"] - TRANSFER_DAYS - min_lead[w2]
                    if life < risk["threshold_days"]:
                        continue
                    short = sum(r["unmet"] for r in unmet_by_prod.get(b["product_id"], []) if (w2, r["outlet_id"]) in open_routes)
                    if short > 0:
                        actions.append({"type": "transfer", "text": f"Suggest transfer of up to {min(short, left_a):,} units to "
                                        f"{w2} {wh_name.get(w2, '')}: its stores are still short {short:,} units (not optimized)."})
                        break
                if len(actions) == (1 if qa else 0):
                    actions.append({"type": "write_off", "text": f"{left_a:,} units have no eligible destination before they fail "
                                    "the shelf-life rule - flag for write-off review."})
        rows.append({"batch_id": bid, "product_id": b["product_id"], "product_name": p["name"], "warehouse_id": b["warehouse_id"],
                     "warehouse_name": wh_name.get(b["warehouse_id"], b["warehouse_id"]), "quantity": b["quantity"],
                     "expiry_date": b["expiry_date"], "days_to_expiry": risk["days_to_expiry"],
                     "remaining_life_pct": risk["remaining_life_pct"], "expired": risk["expired"],
                     "unit_value": risk["unit_value"], "value_at_risk": left_b * risk["unit_value"],
                     "shipped_before": qb, "shipped_after": qa, "left_before": left_b, "left_after": left_a,
                     "units_saved": max(0, qa - qb), "value_recovered": max(0, qa - qb) * risk["unit_value"],
                     "urgency": "expired" if risk["expired"] else "critical" if risk["days_to_expiry"] <= 3
                     else "high" if risk["days_to_expiry"] <= 7 else "medium",
                     "actions": actions})
    rows.sort(key=lambda r: (r["expired"], r["days_to_expiry"], -r["value_at_risk"]))
    live = [r for r in rows if not r["expired"]]
    kb, ka = before["optimizer"]["kpis"], after["optimizer"]["kpis"]
    summary = {
        "batches_at_risk": len(live), "expired_batches": len(rows) - len(live),
        "units_at_risk_before": sum(r["left_before"] for r in live), "units_at_risk_after": sum(r["left_after"] for r in live),
        "value_at_risk_before": sum(r["left_before"] * r["unit_value"] for r in live),
        "value_at_risk_after": sum(r["left_after"] * r["unit_value"] for r in live),
        "expired_units": sum(r["quantity"] for r in rows if r["expired"]),
        "kpis_before": kb, "kpis_after": ka,
    }
    summary["waste_avoided_units"] = summary["units_at_risk_before"] - summary["units_at_risk_after"]
    summary["value_recovered"] = summary["value_at_risk_before"] - summary["value_at_risk_after"]
    return ok({"before_plan_id": before["plan_id"], "run": public_run(after), "batches": rows, "summary": summary,
               "requirements": _requirements(after),
               "note": "Rescue plan = the same OR-Tools optimizer and rules, with shipping at-risk stock rewarded by its "
                       "write-off value. Expired or rule-blocked batches are never shipped. Transfer suggestions are a "
                       "heuristic outside the optimizer model. Prices are synthetic."},
              data_source=after["data_source"], persisted=after["persisted"])
