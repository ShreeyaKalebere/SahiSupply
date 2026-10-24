"""Controlled manual overrides (PRD P0-11).

An override changes one batch->outlet quantity on the optimized plan. It needs a reason,
is re-checked by the independent checker against the stored raw inputs, and is accepted
only if every hard constraint still passes. Accepted and rejected attempts are both logged.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.inventory.eligibility import build_eligibility
from app.optimization.explanations import explain_plan
from app.optimization.plan import Plan, make_line, sort_lines
from app.services import run_store
from app.services.kpis import compare, compute_kpis
from app.services.planner import allocation_rows, enrich_lines, evaluate_plan, problem_from_raw


class OverrideRejected(ValueError):
    def __init__(self, message: str, violations: list[dict]):
        super().__init__(message)
        self.violations = violations


def apply_override(run: dict, *, batch_id: str, outlet_id: str, new_qty: int, reason: str,
                   actor: str | None) -> dict:
    if run.get("optimizer") is None:
        raise OverrideRejected("This run has no optimized plan to override.", [])
    problem = problem_from_raw(run["raw_inputs"], run["need_detail"], run["rules_spec_ids"], run["data_source"])
    if batch_id not in problem.batches or outlet_id not in problem.outlets:
        raise OverrideRejected("Unknown batch or outlet.", [{"code": "UNKNOWN_ENTITY", "message": "Unknown batch or outlet",
                                                            "entity": f"{batch_id}->{outlet_id}"}])
    qty = {(ln["batch_id"], ln["outlet_id"]): ln["qty"] for ln in run["optimizer"]["lines"]}
    original = qty.get((batch_id, outlet_id), 0)
    qty[(batch_id, outlet_id)] = new_qty
    lines = sort_lines([make_line(problem, b, d, q) for (b, d), q in qty.items() if q != 0])
    plan = Plan("override", lines)

    evaluation = evaluate_plan(problem, plan, run["fingerprint"])
    now = datetime.now(timezone.utc)
    doc = {"plan_id": run["plan_id"], "batch_id": batch_id, "outlet_id": outlet_id, "original_qty": original,
           "requested_qty": new_qty, "reason": reason, "actor": actor or "planner", "created_at": now,
           "plan_version_before": run.get("version", 1)}
    if not evaluation["check"]["valid"]:
        doc |= {"outcome": "rejected", "violations": evaluation["check"]["violations"]}
        run_store.record_override(doc)
        raise OverrideRejected("Override rejected: the edited plan breaks hard constraints.",
                               evaluation["check"]["violations"])

    elig = build_eligibility(problem)
    base_k = compute_kpis(problem, Plan("baseline", [{k: ln[k] for k in ("batch_id", "outlet_id", "product_id",
                                                                         "warehouse_id", "qty")}
                                                     for ln in run["baseline"]["lines"]]))
    version = run.get("version", 1) + 1
    doc |= {"outcome": "accepted", "plan_version_after": version}
    run_store.record_override(doc)

    run["optimizer"] |= {"kpis": evaluation["kpis"], "check": evaluation["check"],
                         "lines": enrich_lines(problem, plan)}
    run["comparison"] = compare(problem, evaluation["kpis_full"], base_k)
    run["explanations"] = explain_plan(problem, elig, plan)
    run["allocation"] = allocation_rows(problem, plan, True)
    run["overrides"] = [*run.get("overrides", []), {k: v for k, v in doc.items() if k != "plan_id"}]
    run["version"] = version
    run["plan_status"] = "VALID_WITH_OVERRIDES"
    run["status"] = "VALID"
    run_store.save(run)
    return run
