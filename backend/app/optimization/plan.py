"""Plan data structure shared by the optimizer, baseline, overrides and KPIs."""
from __future__ import annotations

from dataclasses import dataclass, field

from app.inventory.problem import PlanningProblem


@dataclass
class Plan:
    method: str                                   # optimizer | baseline | rules_off | override | applied_s0
    lines: list[dict]                             # {batch_id, outlet_id, product_id, warehouse_id, qty}
    solver: dict = field(default_factory=dict)    # status, objective, best_bound, gap, solve_seconds

    def delivered_by_pair(self) -> dict[tuple[str, str], int]:
        out: dict[tuple[str, str], int] = {}
        for ln in self.lines:
            k = (ln["outlet_id"], ln["product_id"])
            out[k] = out.get(k, 0) + ln["qty"]
        return out

    def shortages(self, problem: PlanningProblem) -> dict[tuple[str, str], int]:
        got = self.delivered_by_pair()
        return {k: q - got.get(k, 0) for k, q in problem.need.items() if q - got.get(k, 0) > 0}

    def qty_map(self) -> dict[tuple[str, str], int]:
        return {(ln["batch_id"], ln["outlet_id"]): ln["qty"] for ln in self.lines}


def make_line(problem: PlanningProblem, batch_id: str, outlet_id: str, qty: int) -> dict:
    b = problem.batches[batch_id]
    return {"batch_id": batch_id, "outlet_id": outlet_id, "product_id": b["product_id"],
            "warehouse_id": b["warehouse_id"], "qty": int(qty)}


def sort_lines(lines: list[dict]) -> list[dict]:
    return sorted(lines, key=lambda ln: (int(ln["outlet_id"][1:]), ln["product_id"], ln["batch_id"]))
