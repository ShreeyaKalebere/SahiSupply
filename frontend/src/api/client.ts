import type {
  ChaosParams, ChaosResult, ChatReply, ChatTurn, DeliveryStatus, RescueResult, LiveWeather, Shipment, NetworkEdit, Route, WarehouseDetails,
  Dashboard, Envelope, Evaluation, ForecastChart, ForecastMetrics, Health, HistoryRow, InventoryRow, ModuleConfigView,
  ModuleSummary, Outlet, Risks, Run, Scenario, ScenarioDiff, ScenarioId, Warehouse,
} from "../types/api";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the SahiSupply API. Is the backend running on port 8000?");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as Envelope<T>;
}

export interface RunParams {
  module: string;
  scenario_id: ScenarioId;
  rule_toggles?: Record<string, boolean>;
  contested_pattern?: boolean;
  include_insights?: boolean;
  network?: NetworkEdit | null;
}

const q = (o: Record<string, string | boolean | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)])).toString();

export const api = {
  health: () => request<Health>("/api/health"),
  modules: () => request<ModuleSummary[]>("/api/modules"),
  config: (m: string) => request<ModuleConfigView>(`/api/config/${m}`),
  scenarios: () => request<Scenario[]>("/api/scenarios"),
  dashboard: (m: string, contested = true) => request<Dashboard>(`/api/dashboard?${q({ module: m, contested_pattern: contested })}`),
  inventory: (m: string, scenario: string = "S0", contested = true) =>
    request<{ planning_date: string; rows: InventoryRow[]; rules_enforced: string[] }>(
      `/api/inventory?${q({ module: m, scenario_id: scenario, contested_pattern: contested })}`),
  risks: (m: string, contested = true) => request<Risks>(`/api/risks?${q({ module: m, contested_pattern: contested })}`),
  warehouses: (m: string) => request<Warehouse[]>(`/api/warehouses?module=${m}`),
  outlets: (m: string) => request<Outlet[]>(`/api/outlets?module=${m}`),
  warehouseDetails: (m: string, id: string, contested = true, planId?: string | null) =>
    request<WarehouseDetails>(`/api/warehouses/${encodeURIComponent(id)}/details?${q({ module: m, contested_pattern: contested, plan_id: planId })}`),
  routes: (m: string, contested = true) => request<Route[]>(`/api/routes?${q({ module: m, contested_pattern: contested })}`),
  forecast: (m: string, outlet?: string | null, product?: string | null) =>
    request<ForecastChart>(`/api/forecast/metrics?${q({ module: m, outlet_id: outlet, product_id: product })}`),
  trainForecast: (m: string) => request<ForecastMetrics>("/api/forecast/train", { method: "POST", body: JSON.stringify({ module: m, refresh: true }) }),
  run: (p: RunParams) => request<Run>("/api/optimization/run", { method: "POST", body: JSON.stringify(p) }),
  runScenario: (p: RunParams) =>
    request<{ run: Run; diff: ScenarioDiff | null }>("/api/scenarios/run", { method: "POST", body: JSON.stringify(p) }),
  getRun: (id: string) => request<Run>(`/api/optimization/${id}`),
  history: (m?: string, limit = 50) => request<HistoryRow[]>(`/api/optimization/history?${q({ module: m, limit: String(limit) })}`),
  override: (id: string, body: { batch_id: string; outlet_id: string; new_qty: number; reason: string; actor?: string }) =>
    request<Run>(`/api/optimization/${id}/override`, { method: "POST", body: JSON.stringify(body) }),
  deliveries: (planId: string) => request<Shipment[]>(`/api/optimization/${planId}/deliveries`),
  setDeliveryStatus: (planId: string, shipmentId: string, status: DeliveryStatus) =>
    request<Shipment>(`/api/optimization/${planId}/deliveries/${encodeURIComponent(shipmentId)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  chaosRun: (p: RunParams & { before_plan_id?: string | null; chaos: ChaosParams }) =>
    request<ChaosResult>("/api/chaos/run", { method: "POST", body: JSON.stringify(p) }),
  rescueRun: (p: RunParams & { before_plan_id?: string | null }) =>
    request<RescueResult>("/api/rescue/run", { method: "POST", body: JSON.stringify(p) }),
  evaluation: (m: string) => request<Evaluation>(`/api/evaluation?module=${m}`),
  liveWeather: (m: string, contested = true, threshold?: number) =>
    request<LiveWeather>(`/api/live/weather?${q({ module: m, contested_pattern: contested, threshold_mm: threshold?.toString() })}`),
  chat: (module: string, messages: ChatTurn[], planId?: string | null) =>
    request<ChatReply>("/api/assistant/chat", { method: "POST", body: JSON.stringify({ module, plan_id: planId ?? null, messages }) }),
  assistantStatus: () => request<{ engine: "claude" | "built-in"; suggestions: string[] }>("/api/assistant/status"),
  exportUrl: (id: string, plan: "optimizer" | "baseline" = "optimizer") => `${BASE}/api/optimization/${id}/export.csv?plan=${plan}`,
};
