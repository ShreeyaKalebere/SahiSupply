import type { Kpis, Run } from "../types/api";

export const kpis = (over: Partial<Kpis> = {}): Kpis => ({
  need_units: 100, delivered_units: 90, unmet_units: 10, fill_rate: 0.9, transport_cost: 500, cost_per_delivered_unit: 5.56,
  critical_need_units: 40, critical_shortage_units: 2, critical_fill_rate: 0.95, expiry_risk_units: 3, expiry_risk_value: 30,
  freshness_on_arrival_pct: 70, gross_margin_delivered: 900, net_margin: 400, standard_net_margin: 300,
  blocked_units_shipped: 0, blocked_lines: [],
  by_region: { "Mumbai Metro": { need_units: 60, delivered_units: 58, fill_rate: 58 / 60 }, "Vidarbha-Marathwada": { need_units: 40, delivered_units: 32, fill_rate: 0.8 } },
  by_outlet: { D1: { need_units: 60, delivered_units: 58, fill_rate: 58 / 60, critical_shortage_units: 0 } },
  shipped_by_warehouse: { W1: 90 },
  ...over,
});

const line = {
  batch_id: "B001", outlet_id: "D1", product_id: "P01", warehouse_id: "W1", qty: 58, product_name: "Insulin Glargine 100IU pen",
  outlet_name: "Lifeline Hospital", warehouse_name: "Bhiwandi DC", expiry_date: "2027-06-01", unit_cost: 2.5, line_cost: 145,
  lead_time_days: 1, life_on_arrival_days: 217, life_on_arrival_pct: 40, criticality: "critical",
};

export function makeRun(over: Partial<Run> = {}): Run {
  const check = { valid: true, violation_count: 0, violations: [], checked: { lines: 1, constraints: [] }, recomputed: {} };
  return {
    plan_id: "PLN-TEST000001", created_at: "2026-10-24T10:00:00Z", module: "pharmacy", module_name: "Pharmaceutical Distribution",
    need_source: "forecast", scenario_id: "S0",
    scenario: { id: "S0", name: "Normal week", priority: "P0", change: "No disruptions.", assumptions: ["No disruptions."], changes: {} },
    contested_pattern: true, rule_toggles: {}, rules_enforced: ["C1", "C2", "C3"], rules_disabled: ["C4"], data_source: "mongodb",
    persisted: true, planning_date: "2026-10-26", review_period_days: 7, fingerprint: "abcdef0123456789".repeat(4),
    forecast: {
      selected_model: "gradient_boosting", selected_label: "Gradient boosting", models: [], noise_floor: null,
      target: { description: "", achieved: true, improvement_pct: 20 },
      evaluation: { method: "", start: "2026-08-31", end: "2026-10-25", fold_origins: [], series: 180 },
    },
    status: "VALID", plan_status: "VALID", version: 1,
    optimizer: { solver: { status: "OPTIMAL", solve_seconds: 0.2, gap: 0, backend: "SCIP" }, kpis: kpis(), check, lines: [line], fingerprint: "f" },
    optimizer_error: null,
    baseline: { solver: { status: "HEURISTIC", solve_seconds: 0.01, backend: "greedy" }, kpis: kpis({ fill_rate: 0.8, delivered_units: 80, unmet_units: 20, critical_shortage_units: 12 }), check, lines: [line], fingerprint: "f" },
    fairness: { same_fingerprint: true, fingerprint: "abcdef0123456789".repeat(4), note: "" },
    comparison: {
      deltas: { fill_rate: 0.1 }, fill_rate_pp: 10,
      business_impact: { lost_margin_avoided: 1200, waste_avoided: 0, delta_delivery_cost: 50, net_weekly_benefit: 1150, critical_units_gained: 10, lost_sale_share: 0.4, note: "Illustrative." },
    },
    rules_off: null, equity: null, regret: null,
    insights: { method: "lp", status: "OK", items: [], candidates: [], notes: ["LP duals only rank."], seconds: 1 },
    explanations: [{
      outlet_id: "D1", outlet_name: "Lifeline Hospital", product_id: "P01", product_name: "Insulin Glargine 100IU pen", criticality: "critical",
      need: 60, delivered: 58, shortage: 2, status: "short", need_text: "Need 60 = forecast ...", need_detail: null,
      sources: [{ ...line, rules_passed: ["C1: shelf life on arrival passes"], why: "Batch B001 from W1: lowest feasible delivery cost." }],
      alternatives: [{ warehouse_id: "W4", status: "blocked", rule_id: "C1", reason: "Blocked by rule - C1: 41 days on arrival < 90" }],
      shortage_reason: "2 of 60 units unmet. Lifeline Hospital cold capacity full (9.3/9.3 L)", summary: "",
    }],
    allocation: [{
      outlet_id: "D1", outlet_name: "Lifeline Hospital", outlet_type: "hospital", region: "Mumbai Metro", product_id: "P01",
      product_name: "Insulin Glargine 100IU pen", criticality: "critical", required: 60, allocated: 58, unmet: 2, transport_cost: 145,
      sources: [line], validation: "valid",
    }],
    overrides: [], timings: { total: 1 },
    ...over,
  };
}
