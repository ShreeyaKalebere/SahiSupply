// Types mirroring the FastAPI response shapes (see docs/api.md).

export type ModuleId = "pharmacy" | "grocery" | "cosmetics" | string;
export type ScenarioId = "S0" | "S1" | "S2" | "S3" | "S4";
export type DataSource = "mongodb" | "snapshot";

export interface Envelope<T> {
  data: T;
  meta: { synthetic_data: boolean; data_source?: DataSource; persisted?: boolean; [k: string]: unknown };
}

export interface RuleSummary {
  id: string;
  template: string;
  status: "active" | "planned" | "unavailable";
  default_on: boolean;
  description: string;
}

export interface ModuleSummary {
  industry: string;
  display_name: string;
  description: string;
  destination_types: string[];
  need_source: "forecast" | "orders";
  review_period_days: number;
  kpis: string[];
  rules: RuleSummary[];
}

export interface ModuleConfigView extends ModuleSummary {
  rules: (RuleSummary & { params: Record<string, unknown>; enforcement: string; test: string | null })[];
  service_levels: { critical: number; standard: number };
  templates: string[];
  disclaimer: string;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  priority: string;
  change: string;
}

export interface Kpis {
  need_units: number;
  delivered_units: number;
  unmet_units: number;
  fill_rate: number;
  transport_cost: number;
  cost_per_delivered_unit: number;
  critical_need_units: number;
  critical_shortage_units: number;
  critical_fill_rate: number | null;
  expiry_risk_units: number;
  expiry_risk_value: number;
  freshness_on_arrival_pct: number | null;
  gross_margin_delivered: number;
  net_margin: number;
  standard_net_margin: number;
  blocked_units_shipped: number;
  blocked_lines: (PlanLine & { reason: string; rule_ids: string[] })[];
  by_region: Record<string, { need_units: number; delivered_units: number; fill_rate: number }>;
  by_outlet: Record<string, { need_units: number; delivered_units: number; fill_rate: number; critical_shortage_units: number }>;
  shipped_by_warehouse: Record<string, number>;
}

export interface Violation {
  code: string;
  message: string;
  entity: string;
}

export interface CheckResult {
  valid: boolean;
  violation_count: number;
  violations: Violation[];
  checked: { lines: number; constraints: string[] };
  recomputed: Record<string, number>;
}

export interface PlanLine {
  batch_id: string;
  outlet_id: string;
  product_id: string;
  warehouse_id: string;
  qty: number;
  product_name: string;
  outlet_name: string;
  warehouse_name: string;
  expiry_date: string;
  unit_cost: number;
  line_cost: number;
  lead_time_days: number;
  life_on_arrival_days: number;
  life_on_arrival_pct: number;
  criticality: string;
}

export interface SolverInfo {
  status: string;
  objective?: number;
  best_bound?: number;
  gap?: number;
  solve_seconds: number;
  integer_variables?: number;
  constraints?: number;
  time_limit_s?: number;
  backend: string;
}

export interface PlanSection {
  solver: SolverInfo;
  kpis: Kpis;
  check: CheckResult;
  lines: PlanLine[];
  fingerprint: string;
  objective_terms?: Record<string, number>;
  penalty?: { service_penalty_s: number; weights: Record<string, number>; fefo_epsilon: number; note: string };
}

export interface AllocationSource {
  batch_id: string;
  warehouse_id: string;
  qty: number;
  unit_cost: number;
  line_cost: number;
  life_on_arrival_days: number;
  life_on_arrival_pct: number;
  expiry_date: string;
  lead_time_days: number;
}

export type DeliveryStatus = "approved" | "dispatched" | "in_transit" | "delivered" | "complete";

export interface Shipment {
  shipment_id: string;
  warehouse_id: string;
  outlet_id: string;
  qty: number;
  products: number;
  status: DeliveryStatus;
  updated_at: string | null;
  history: { status: DeliveryStatus; at: string; note?: string; proof?: boolean }[];
}

export interface AllocationRow {
  outlet_id: string;
  outlet_name: string;
  outlet_type: string;
  region: string;
  product_id: string;
  product_name: string;
  criticality: string;
  required: number;
  allocated: number;
  unmet: number;
  transport_cost: number;
  sources: AllocationSource[];
  validation: "valid" | "invalid";
}

export interface Alternative {
  warehouse_id: string;
  status: "closed" | "blocked" | "no_stock" | "allocated_elsewhere" | "capacity_bound" | "costlier" | "equal_cost" | "not_needed" | "unexplained";
  reason: string;
  rule_id?: string | null;
  delta_per_unit?: number;
  allocated_to?: { outlet_id: string; qty: number }[];
}

export interface Explanation {
  outlet_id: string;
  outlet_name: string;
  product_id: string;
  product_name: string;
  criticality: string;
  need: number;
  delivered: number;
  shortage: number;
  status: "met" | "short";
  need_text: string;
  need_detail: Record<string, number | string> | null;
  sources: (AllocationSource & { rules_passed: string[]; why: string })[];
  alternatives: Alternative[];
  shortage_reason: string | null;
  summary: string;
}

export interface InsightItem {
  kind: "stock" | "route" | "cold" | "receiving" | "outbound";
  key: string;
  title: string;
  statement: string;
  added: number;
  added_unit: string;
  current_limit: number;
  lp_dual: number;
  net_margin_per_unit: number;
  net_margin_total: number;
  critical_units_avoided_per_unit: number;
  critical_units_avoided_total: number;
  extra_units_delivered: number;
  signal: string;
  verified: boolean;
  verification: Violation[];
  resolve_status: string;
  note: string;
}

export interface Insights {
  method: string;
  status: string;
  items: InsightItem[];
  candidates: { kind: string; key: string; lp_dual: number; added: number; dropped: string | null;
    net_margin_per_unit: number | null; critical_units_avoided_per_unit: number | null }[];
  notes: string[];
  seconds: number;
}

export interface Comparison {
  deltas: Record<string, number | null>;
  fill_rate_pp: number;
  business_impact: {
    lost_margin_avoided: number;
    waste_avoided: number;
    delta_delivery_cost: number;
    net_weekly_benefit: number;
    critical_units_gained: number;
    lost_sale_share: number;
    note: string;
  };
}

export interface Regret {
  regret_pp: number;
  applied_fill_rate: number;
  reoptimized_fill_rate: number;
  residual_shortfall_units: number;
  by_region: Record<string, { need_units: number; applied_fill_rate: number; reoptimized_fill_rate: number;
    regret_pp: number; residual_shortfall_units: number }>;
  by_warehouse: Record<string, { applied_units: number; reoptimized_units: number; status: string }>;
  adjustments: { removed_units: number; trimmed_units: number };
  method: string;
  error?: string;
}

export interface Equity {
  floor_pct: number;
  classes: string[];
  cost_of_fairness: number;
  net_margin_change: number;
  fill_rate_on: number;
  fill_rate_off: number;
  critical_shortage_on: number;
  critical_shortage_off: number;
  below_floor_on: { outlet_id: string; product_id: string; fill: number }[];
  below_floor_off: { outlet_id: string; product_id: string; fill: number }[];
  note: string;
}

export interface ForecastModelMetric {
  model: string;
  label: string;
  mae: number;
  rmse: number;
  wape: number;
  fold_wape: number[];
  wape_vs_seasonal_naive_pct: number | null;
}

export interface ForecastMetrics {
  module: string;
  selected_model: string;
  selected_label: string;
  models: ForecastModelMetric[];
  noise_floor: { mae: number; rmse: number; wape: number } | null;
  noise_floor_note: string;
  target: { description: string; achieved: boolean; improvement_pct: number | null };
  evaluation: { method: string; start: string; end: string; fold_origins: string[]; series: number };
  train_seconds?: number;
}

export interface NetworkEdit {
  warehouses: string[] | null;
  outlets: string[] | null;
  route_overrides: Record<string, boolean>;
}

export interface NetworkSummary {
  warehouses_kept: string[];
  warehouses_removed: string[];
  outlets_kept: string[];
  outlets_removed: string[];
  roads_closed: string[];
  roads_opened: string[];
}

export interface Route {
  route_id: string; warehouse_id: string; outlet_id: string; distance_km: number; lead_time_days: number;
  cost_per_litre: number; capacity_l: number; open: boolean;
}

export interface Run {
  plan_id: string;
  chaos?: ChaosSummary | null;
  rescue?: { rescue_batches: string[]; note: string } | null;
  network?: { edit: NetworkEdit; summary: NetworkSummary } | null;
  created_at: string;
  module: string;
  module_name: string;
  need_source: string;
  scenario_id: ScenarioId;
  scenario: Scenario & { assumptions: string[]; changes: Record<string, unknown> };
  contested_pattern: boolean;
  rule_toggles: Record<string, boolean>;
  rules_enforced: string[];
  rules_disabled: string[];
  data_source: DataSource;
  persisted?: boolean;
  planning_date: string;
  review_period_days: number;
  fingerprint: string;
  forecast: Pick<ForecastMetrics, "selected_model" | "selected_label" | "models" | "noise_floor" | "target" | "evaluation">;
  status: "VALID" | "INVALID" | "SOLVER_FAILED";
  plan_status: string;
  version: number;
  optimizer: PlanSection | null;
  optimizer_error: { status: string; message: string } | null;
  baseline: PlanSection;
  fairness: { same_fingerprint: boolean; fingerprint: string; note: string };
  comparison: Comparison | null;
  rules_off: { disabled_rules: string[]; kpis: Kpis; solver_status: string; note: string } | null;
  equity: Equity | null;
  regret: Regret | null;
  insights: Insights | null;
  explanations: Explanation[];
  allocation: AllocationRow[];
  overrides: { batch_id: string; outlet_id: string; original_qty: number; requested_qty: number; reason: string;
    actor: string; outcome: string; created_at: string }[];
  timings: Record<string, number>;
}

export interface ScenarioDiff {
  changed_rows: {
    outlet_id: string; outlet_name: string; product_id: string; product_name: string; region: string;
    s0_required: number; scenario_required: number; s0_allocated: number; scenario_allocated: number;
    s0_unmet: number; scenario_unmet: number; s0_sources: string[]; scenario_sources: string[];
  }[];
  changed_count: number;
  kpi_delta: Record<string, number>;
  s0_kpis: Kpis;
  s0_fingerprint: string;
}

export interface Dashboard {
  module: string;
  planning_date: string;
  review_period_days: number;
  need_source: string;
  total_inventory_units: number;
  eligible_inventory_units: number;
  forecast_demand_units: number;
  required_replenishment_units: number;
  open_order_units: number;
  warehouses: number;
  outlets: number;
  products: number;
  batches: number;
  routes_open: number;
  stockout_risk_count: number;
  expiry_risk_batches: number;
  expiry_risk_units: number;
  supply_shortfall_products: number;
  forecast_model: string;
  forecast_model_label: string;
  data_source: DataSource;
}

export interface InventoryRow {
  batch_id: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_status: string;
  product_id: string;
  product_name: string;
  category: string;
  criticality: string;
  storage_class: string;
  quantity: number;
  manufacturing_date: string;
  expiry_date: string;
  days_to_expiry: number;
  shelf_life_days: number;
  remaining_life_pct: number;
  eligible_outlets: number;
  total_outlets: number;
  eligibility: "eligible" | "partially_eligible" | "blocked";
  block_reasons: Record<string, number>;
  expiry_risk: boolean;
}

export interface Risks {
  stockout_risk: { outlet_id: string; outlet_name: string; product_id: string; product_name: string; criticality: string;
    usable_on_hand: number; forecast_over_lead_time: number; lead_time_days: number }[];
  expiry_risk: InventoryRow[];
  supply_shortfall: { product_id: string; product_name: string; criticality: string; forecast_need: number;
    eligible_supply: number; gap: number }[];
  definitions: Record<string, string>;
}

export interface ForecastChart {
  metrics: ForecastMetrics;
  history: { date: string; actual: number; promo: boolean; festival: boolean }[];
  backtest: ({ date: string; actual: number; expected?: number } & Record<string, number | string>)[];
  forecast: { date: string; forecast: number; lower: number; upper: number }[];
  selection: { outlet_id: string | null; product_id: string | null; series: number };
  outlets: { id: string; name: string }[];
  products: { id: string; name: string }[];
}

export interface Warehouse {
  warehouse_id: string; name: string; city: string; lat: number; lon: number; region: string; status: string;
  cold_storage: boolean; outbound_capacity_l: number;
}

export interface Outlet {
  outlet_id: string; name: string; type: string; city: string; lat: number; lon: number; region: string;
  remote: boolean; storage: string[]; receiving_capacity_l: number; cold_capacity_l: number;
}

export interface HistoryRow {
  plan_id: string;
  chaos?: unknown;
  rescue?: unknown;
  created_at: string;
  module: string;
  scenario_id: string;
  scenario?: { name: string };
  status: string;
  plan_status: string;
  fingerprint: string;
  contested_pattern: boolean;
  data_source: DataSource;
  version: number;
  persisted?: boolean;
  network?: { summary?: NetworkSummary } | null;
  optimizer?: { kpis?: Partial<Kpis> | null; solver?: SolverInfo | null; check?: Partial<CheckResult> | null };
  baseline?: { kpis?: Partial<Kpis> };
  comparison?: { fill_rate_pp?: number };
}

export interface EvaluationRow {
  scenario_id: string;
  contested_pattern: boolean;
  fingerprint: string;
  optimizer_fill_rate: number;
  baseline_fill_rate: number;
  fill_rate_pp: number;
  optimizer_critical_shortage: number;
  baseline_critical_shortage: number;
  optimizer_cost_per_unit: number;
  baseline_cost_per_unit: number;
  optimizer_expiry_risk: number;
  baseline_expiry_risk: number;
  optimizer_valid: boolean;
  baseline_valid: boolean;
  solver_status: string;
  solve_seconds: number;
}

export interface Evaluation {
  module: string;
  rows: EvaluationRow[];
  north_star: { definition: string; target: string; scenarios_meeting_target_pattern_on: number;
    scenarios_meeting_target_pattern_off: number; target_met: boolean };
  note: string;
}

export interface Health {
  status: string;
  mongodb: { connected: boolean; database: string; detail: string; fallback: string | null };
  solver: { scip: boolean; glop: boolean; time_limit_s: number };
  environment: string;
  version: string;
}

export interface WeatherSite {
  id: string; kind: "warehouse" | "store"; name: string; city: string; lat: number; lon: number;
  daily: { date: string; mm: number }[]; max_mm: number; heavy: boolean;
}

export interface LiveWeather {
  source: string; source_url: string; fetched_at: string; forecast_days: number; threshold_mm: number;
  imd_heavy_rain_mm: number; sites: WeatherSite[]; heavy_sites: string[]; roads_to_close: string[]; note: string;
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

export interface ChatReply { reply: string; engine: "claude" | "built-in"; suggestions: string[]; plan_id: string | null }

export interface WarehouseBatch {
  batch_id: string; product_id: string; product_name: string; category: string; storage_class: string;
  criticality: string; quantity: number; volume_l: number; expiry_date: string; days_to_expiry: number;
  remaining_life_pct: number; eligible_outlets: number; total_outlets: number; block_reasons: Record<string, number>;
  status: "ok" | "expiring" | "blocked";
}

export interface WarehouseProduct {
  product_id: string; name: string; category: string; storage_class: string; criticality: string;
  units: number; volume_l: number; batches: number; nearest_expiry: string;
  status: "ok" | "expiring" | "blocked" | "low"; shipped_this_week: number | null; units_after_plan: number | null;
}

export interface WarehouseDetails {
  warehouse: { warehouse_id: string; name: string; city: string; region: string; lat: number; lon: number;
    status: string; cold_storage: boolean; outbound_capacity_l: number };
  industry: { module: string; name: string };
  operator: string;
  metrics: { total_units: number; total_volume_l: number; cold_volume_l: number; ambient_volume_l: number;
    storage_capacity_l: number; storage_capacity_simulated: boolean; utilization: number | null;
    batches: number; products: number; expiring_batches: number };
  products: WarehouseProduct[];
  batches: WarehouseBatch[];
  stockout_risks: { product_id: string; name: string; units_left: number | null; reason: string }[];
  expiring_batches: WarehouseBatch[];
  plan_id: string | null;
  planning_date: string;
  data_source: DataSource;
  data_notes: { from_database: string; simulated: string[] };
}

// ---- Controlled simulations (Chaos Mode, Expiry Rescue) ----
export type ChaosKind = "warehouse_offline" | "demand_surge" | "road_closed" | "supplier_delay" | "fuel_cost";

export interface ChaosParams { kind: ChaosKind; warehouse_id?: string | null; route_id?: string | null; region?: string | null }

export interface ChaosSummary {
  kind: ChaosKind; label: string; params: ChaosParams; closed_routes: string[]; offline_warehouses: string[];
  delayed_batches: string[]; delayed_units: number; demand_uplift: number | null; cost_uplift: number | null;
  affected_outlets?: string[]; assumptions: string[];
}

export interface Lane { warehouse_id: string; outlet_id: string; qty: number }

export interface Requirements {
  feasible: boolean; solver_status?: string | null; message?: string; checker_valid?: boolean;
  violations?: { rule?: string; message?: string }[]; unmet_units?: number; critical_shortage_units?: number;
  short_orders?: number; below_fill_floor?: number;
  top_shortages?: { outlet_id: string; outlet_name: string; product_id: string; product_name: string; criticality: string; required: number; allocated: number; unmet: number }[];
}

export interface ChaosResult {
  before: Run; after: Run; chaos: ChaosSummary; note: string; requirements: Requirements;
  impact: {
    diff: ScenarioDiff; lost_lanes: Lane[]; new_lanes: Lane[]; affected_outlets: string[];
    delayed_deliveries: { outlet_id: string; outlet_name: string; product_name: string; lead_before: number; lead_after: number }[];
    newly_short: { outlet_id: string; outlet_name: string; product_name: string; unmet_before: number; unmet_after: number }[];
    kpis_before: Kpis; kpis_after: Kpis; explanation: string[];
  } | null;
}

export interface RescueBatch {
  batch_id: string; product_id: string; product_name: string; warehouse_id: string; warehouse_name: string;
  quantity: number; expiry_date: string; days_to_expiry: number; remaining_life_pct: number; expired: boolean;
  unit_value: number; value_at_risk: number; shipped_before: number; shipped_after: number; left_before: number;
  left_after: number; units_saved: number; value_recovered: number; urgency: "expired" | "critical" | "high" | "medium";
  actions: { type: "dispose" | "dispatch" | "reallocate" | "transfer" | "write_off"; text: string }[];
}

export interface RescueResult {
  before_plan_id: string; run: Run; batches: RescueBatch[]; requirements: Requirements; note: string;
  summary: {
    batches_at_risk: number; expired_batches: number; units_at_risk_before: number; units_at_risk_after: number;
    value_at_risk_before: number; value_at_risk_after: number; expired_units: number; waste_avoided_units: number;
    value_recovered: number; kpis_before: Kpis; kpis_after: Kpis;
  };
}
