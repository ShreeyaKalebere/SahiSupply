import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { ApiError } from "../api/client";
import { makeRun } from "./fixtures";

const env = <T,>(data: T, meta: Record<string, unknown> = {}) => Promise.resolve({ data, meta: { synthetic_data: true, data_source: "mongodb", ...meta } });

const modules = [
  { industry: "pharmacy", display_name: "Pharmaceutical Distribution", description: "push", destination_types: [], need_source: "forecast", review_period_days: 7, kpis: [], rules: [] },
  { industry: "grocery", display_name: "Grocery Retail", description: "pull", destination_types: [], need_source: "orders", review_period_days: 7, kpis: [], rules: [] },
];
const scenarios = [
  { id: "S0", name: "Normal week", priority: "P0", change: "none" },
  { id: "S3", name: "Monsoon closure", priority: "P0", change: "routes closed" },
];

const mocks = vi.hoisted(() => ({
  modules: vi.fn(), scenarios: vi.fn(), history: vi.fn(), getRun: vi.fn(), run: vi.fn(), runScenario: vi.fn(),
  dashboard: vi.fn(), risks: vi.fn(), override: vi.fn(), exportUrl: vi.fn(), config: vi.fn(), warehouses: vi.fn(), outlets: vi.fn(), routes: vi.fn(), liveWeather: vi.fn(), chat: vi.fn(), assistantStatus: vi.fn(), warehouseDetails: vi.fn(),
}));

vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, api: mocks };
});
// Leaflet needs real browser layout; jsdom gets light stand-ins (maps are checked in the real browser).
vi.mock("react-leaflet", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div data-testid="leaflet">{children}</div>;
  const Leaf = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { MapContainer: Box, TileLayer: () => null, Polyline: Leaf, CircleMarker: Leaf, Tooltip: Leaf, useMap: () => null };
});
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 600, height: 300 }}>{children}</div> };
});

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.modules.mockImplementation(() => env(modules));
  mocks.scenarios.mockImplementation(() => env(scenarios));
  mocks.history.mockImplementation(() => env([]));
  mocks.dashboard.mockImplementation(() => new Promise(() => undefined)); // stays loading
  mocks.risks.mockImplementation(() => new Promise(() => undefined));
  mocks.warehouses.mockImplementation(() => env([{ warehouse_id: "W1", name: "Bhiwandi DC", lat: 19.3, lon: 73.06 }, { warehouse_id: "W4", name: "Aurangabad DC", lat: 19.88, lon: 75.34 }]));
  mocks.outlets.mockImplementation(() => env([{ outlet_id: "D1", name: "Lifeline Hospital", city: "Mumbai", lat: 19, lon: 72.8 },
    { outlet_id: "D9", name: "Chandrapur Rural Clinic", city: "Chandrapur", lat: 19.9, lon: 79.3 }]));
  mocks.routes.mockImplementation(() => env([
    { route_id: "W1-D1", warehouse_id: "W1", outlet_id: "D1", distance_km: 40, lead_time_days: 1, cost_per_litre: 1, capacity_l: 50, open: true },
    { route_id: "W1-D9", warehouse_id: "W1", outlet_id: "D9", distance_km: 900, lead_time_days: 3, cost_per_litre: 6, capacity_l: 50, open: false },
    { route_id: "W4-D1", warehouse_id: "W4", outlet_id: "D1", distance_km: 300, lead_time_days: 1, cost_per_litre: 2, capacity_l: 50, open: true },
    { route_id: "W4-D9", warehouse_id: "W4", outlet_id: "D9", distance_km: 500, lead_time_days: 2, cost_per_litre: 3, capacity_l: 50, open: true },
  ]));
  mocks.liveWeather.mockImplementation(() => env({
    source: "Open-Meteo forecast API (live)", source_url: "https://open-meteo.com/", fetched_at: "2026-10-24T10:00:00Z",
    forecast_days: 7, threshold_mm: 64.5, imd_heavy_rain_mm: 64.5, heavy_sites: [], roads_to_close: [], note: "Only the weather is live.",
    sites: [{ id: "W1", kind: "warehouse", name: "Bhiwandi DC", city: "Bhiwandi", lat: 19.3, lon: 73, daily: [], max_mm: 4.5, heavy: false }],
  }));
  mocks.warehouseDetails.mockImplementation(() => env({
    warehouse: { warehouse_id: "W1", name: "Bhiwandi DC", city: "Bhiwandi", region: "Mumbai Metro", lat: 19.3, lon: 73.06, status: "operational", cold_storage: true, outbound_capacity_l: 100 },
    industry: { module: "pharmacy", name: "Pharmaceutical Distribution" }, operator: "SahiSupply sample distribution network (synthetic, not a real company)",
    metrics: { total_units: 1200, total_volume_l: 80, cold_volume_l: 10, ambient_volume_l: 70, storage_capacity_l: 160, storage_capacity_simulated: true, utilization: 0.5, batches: 2, products: 1, expiring_batches: 1 },
    products: [{ product_id: "P01", name: "Insulin Glargine", category: "Antidiabetic", storage_class: "2-8C", criticality: "critical", units: 1200, volume_l: 80, batches: 2, nearest_expiry: "2027-01-01", status: "expiring", shipped_this_week: null, units_after_plan: null }],
    batches: [
      { batch_id: "B001", product_id: "P01", product_name: "Insulin Glargine", category: "Antidiabetic", storage_class: "2-8C", criticality: "critical", quantity: 1000, volume_l: 60, expiry_date: "2027-06-01", days_to_expiry: 220, remaining_life_pct: 60, eligible_outlets: 12, total_outlets: 12, block_reasons: {}, status: "ok" },
      { batch_id: "B002", product_id: "P01", product_name: "Insulin Glargine", category: "Antidiabetic", storage_class: "2-8C", criticality: "critical", quantity: 200, volume_l: 20, expiry_date: "2026-11-30", days_to_expiry: 35, remaining_life_pct: 6, eligible_outlets: 0, total_outlets: 12, block_reasons: { "MIN_LIFE (C1)": 12 }, status: "blocked" },
    ],
    stockout_risks: [{ product_id: "P01", name: "Insulin Glargine", units_left: 5, reason: "Only 5 of 1200 units left after this week's plan" }],
    expiring_batches: [], plan_id: null, planning_date: "2026-10-26", data_source: "mongodb",
    data_notes: { from_database: "Stock comes from the database.", simulated: ["Storage capacity"] },
  }));
  mocks.assistantStatus.mockImplementation(() => env({ engine: "built-in", suggestions: ["How does SahiSupply work?"] }));
  mocks.chat.mockImplementation(() => env({ reply: "Chandrapur Rural Clinic gets 73% of what it needs.", engine: "built-in", suggestions: [], plan_id: null }));
  mocks.exportUrl.mockImplementation((id: string, plan: string) => `/api/optimization/${id}/export.csv?plan=${plan}`);
});

describe("SahiSupply workspace", () => {
  it("shows loading state and switches modules", async () => {
    renderAt("/");
    expect(await screen.findByRole("tab", { name: "Pharmacy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Grocery" }));
    expect(screen.getByRole("tab", { name: "Grocery" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(mocks.dashboard).toHaveBeenLastCalledWith("grocery", true));
  });

  it("shows API errors", async () => {
    mocks.dashboard.mockImplementation(() => Promise.reject(new ApiError(503, "DATA_NOT_SEEDED", "module has no data in MongoDB")));
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("module has no data in MongoDB");
  });

  it("runs a plan and renders the allocation table and explanation drawer", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/planner");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ module: "pharmacy", scenario_id: "S0" }));
    const table = await screen.findByRole("table", { name: "Delivery plan" });
    const row = within(table).getByText("Lifeline Hospital").closest("tr")!;
    expect(row).toHaveTextContent("Partly sent · 2 short");
    expect(row).toHaveTextContent("Bhiwandi DC");
    await userEvent.click(row);
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveTextContent("Why 2 units are short");
    expect(drawer).toHaveTextContent("This store's fridge is already full.");
    expect(drawer).toHaveTextContent("Aurangabad DC: its stock expires too soon (41 days on arrival < 90)");
  });

  it("switches scenario and calls the scenario endpoint", async () => {
    mocks.runScenario.mockImplementation(() => env({
      run: makeRun({ scenario_id: "S3", scenario: { id: "S3", name: "Monsoon closure", priority: "P0", change: "", assumptions: ["Closed 8 routes"], changes: { closed_routes: ["W1-D5"] } } }),
      diff: { changed_rows: [], changed_count: 0, kpi_delta: { fill_rate: -0.05, unmet_units: 10, transport_cost: 5, critical_shortage_units: 1, expiry_risk_units: 0 }, s0_kpis: makeRun().optimizer!.kpis, s0_fingerprint: "x" },
    }));
    renderAt("/scenarios");
    await userEvent.click(await screen.findByRole("button", { name: /Monsoon road closures/ }));
    await waitFor(() => expect(mocks.runScenario).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: "S3" })));
    expect(await screen.findByText(/What changes with "Monsoon road closures"/)).toBeInTheDocument();
  });

  it("never presents an invalid plan as approved", async () => {
    const bad = makeRun({ status: "INVALID", plan_status: "INVALID" });
    bad.optimizer!.check = { valid: false, violation_count: 1, violations: [{ code: "STOCK", message: "Ships 70 > 60", entity: "B001" }], checked: { lines: 1, constraints: [] }, recomputed: {} };
    mocks.run.mockImplementation(() => env(bad));
    renderAt("/planner");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText(/Do not use this plan/)).toBeInTheDocument();
    expect(screen.getAllByText("Failed safety check").length).toBeGreaterThan(0);
    expect(screen.queryByText("All rules checked")).toBeNull();
  });

  it("renders the baseline comparison with measured deltas", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/comparison");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText("Orders delivered, by area")).toBeInTheDocument();
    expect(screen.getAllByText("Our plan is better").length).toBeGreaterThan(0);
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("offers CSV export and a print view with fingerprint and status", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/export");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    const link = await screen.findByRole("link", { name: /Download pick list/ });
    expect(link).toHaveAttribute("href", "/api/optimization/PLN-TEST000001/export.csv?plan=optimizer");
    expect(screen.getByText(/fingerprint abcdef0123456789abcdef/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print view/ })).toBeInTheDocument();
  });

  it("shows the snapshot fallback label when MongoDB is down", async () => {
    mocks.run.mockImplementation(() => env(makeRun({ data_source: "snapshot", persisted: false })));
    renderAt("/planner");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText(/Offline copy/)).toBeInTheDocument();
    expect(screen.getByText("Not saved")).toBeInTheDocument();
  });

  it("network builder: closing a road and removing a warehouse are sent with the run", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/network");
    expect(await screen.findByText("1. Warehouses (2 of 2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Road W1 to D9: closed" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Road W4 to D9: open" }));
    expect(screen.getByRole("button", { name: "Road W4 to D9: closed" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /W1 · Bhiwandi DC/ }));
    expect(screen.getByText("1. Warehouses (1 of 2)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Run plan with this network/ }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      network: { warehouses: ["W4"], outlets: null, route_overrides: { "W4-D9": false } },
    })));
  });

  it("falls back to a valid business when the remembered one no longer exists", async () => {
    const store: Record<string, string> = { "sahisupply.module": "food" };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; }, clear: () => undefined,
    });
    renderAt("/");
    expect(await screen.findByRole("tab", { name: "Pharmacy" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(mocks.dashboard).toHaveBeenLastCalledWith("pharmacy", true));
    expect(store["sahisupply.module"]).toBe("pharmacy");
    vi.unstubAllGlobals();
  });

  it("chat assistant: opens from any page, sends the question and shows the answer", async () => {
    renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "Ask SahiSupply" }));
    const dlg = await screen.findByRole("dialog", { name: "SahiSupply assistant" });
    expect(dlg).toHaveTextContent("built-in assistant");
    await userEvent.type(within(dlg).getByRole("textbox", { name: "Your question" }), "Why is Chandrapur short?");
    await userEvent.click(within(dlg).getByRole("button", { name: "Send" }));
    expect(await within(dlg).findByText(/gets 73% of what it needs/)).toBeInTheDocument();
    expect(mocks.chat).toHaveBeenCalledWith("pharmacy", [{ role: "user", content: "Why is Chandrapur short?" }], undefined);
  });

  it("what-if shows the live weather forecast with its source", async () => {
    renderAt("/scenarios");
    expect(await screen.findByText(/Live weather \(real forecast\)/)).toBeInTheDocument();
    expect(await screen.findByText(/all roads stay open/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open-Meteo" })).toHaveAttribute("href", "https://open-meteo.com/");
  });

  it("warehouse marker opens the popup with database data, then a 3D warehouse (2D plan without WebGL)", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    const { container } = renderAt("/map");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    await waitFor(() => expect(container.querySelector("[data-testid=leaflet]")).toBeTruthy());
    // open the popup the way a marker click does
    const { WarehousePopup } = await import("../components/warehouse/WarehousePopup");
    const onOpen3D = vi.fn();
    render(<WarehousePopup module="pharmacy" warehouseId="W1" contested onClose={() => undefined} onOpen3D={onOpen3D} />);
    const pop = await screen.findByRole("dialog", { name: "Warehouse details" });
    expect(await within(pop).findByText("Bhiwandi DC")).toBeInTheDocument();
    expect(pop).toHaveTextContent("(simulated)");
    expect(pop).toHaveTextContent("Only 5 of 1200 units left");
    await userEvent.click(within(pop).getByRole("button", { name: /View 3D Warehouse/ }));
    expect(onOpen3D).toHaveBeenCalledTimes(1);

    const { default: Warehouse3DModal } = await import("../components/warehouse/Warehouse3DModal");
    render(<Warehouse3DModal details={onOpen3D.mock.calls[0][0]} onClose={() => undefined} />);
    const modal = await screen.findByRole("dialog", { name: "3D warehouse: Bhiwandi DC" });
    expect(modal).toHaveTextContent("2D plan (3D is not available on this device)");
    await userEvent.click(within(modal).getAllByRole("button", { name: /^Bay C1-01-1/ })[0]);
    expect(modal).toHaveTextContent("B001");
    expect(modal).toHaveTextContent("1,000 units");
    expect(within(modal).getByRole("button", { name: /^Bay Q-01/ })).toBeInTheDocument(); // blocked batch in quarantine
  });
});
