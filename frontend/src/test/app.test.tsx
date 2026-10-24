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
  dashboard: vi.fn(), risks: vi.fn(), override: vi.fn(), exportUrl: vi.fn(), config: vi.fn(),
}));

vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, api: mocks };
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
  mocks.exportUrl.mockImplementation((id: string, plan: string) => `/api/optimization/${id}/export.csv?plan=${plan}`);
});

describe("SahiSupply workspace", () => {
  it("shows loading state and switches modules", async () => {
    renderAt("/");
    expect(await screen.findByRole("tab", { name: "Pharmaceutical Distribution" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(/loading/i);
    await userEvent.click(screen.getByRole("tab", { name: "Grocery Retail" }));
    expect(screen.getByRole("tab", { name: "Grocery Retail" })).toHaveAttribute("aria-selected", "true");
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
    const table = await screen.findByRole("table", { name: "Allocation plan" });
    const row = within(table).getByText("Lifeline Hospital").closest("tr")!;
    expect(row).toHaveTextContent("valid");
    await userEvent.click(row);
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveTextContent("Why demand is unmet");
    expect(drawer).toHaveTextContent("cold capacity full");
    expect(drawer).toHaveTextContent("41 days on arrival < 90");
  });

  it("switches scenario and calls the scenario endpoint", async () => {
    mocks.runScenario.mockImplementation(() => env({
      run: makeRun({ scenario_id: "S3", scenario: { id: "S3", name: "Monsoon closure", priority: "P0", change: "", assumptions: ["Closed 8 routes"], changes: { closed_routes: ["W1-D5"] } } }),
      diff: { changed_rows: [], changed_count: 0, kpi_delta: { fill_rate: -0.05, unmet_units: 10, transport_cost: 5, critical_shortage_units: 1, expiry_risk_units: 0 }, s0_kpis: makeRun().optimizer!.kpis, s0_fingerprint: "x" },
    }));
    renderAt("/scenarios");
    await userEvent.click(await screen.findByRole("button", { name: /S3 · Monsoon closure/ }));
    await waitFor(() => expect(mocks.runScenario).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: "S3" })));
    expect(await screen.findByText("Closed 8 routes")).toBeInTheDocument();
  });

  it("never presents an invalid plan as approved", async () => {
    const bad = makeRun({ status: "INVALID", plan_status: "INVALID" });
    bad.optimizer!.check = { valid: false, violation_count: 1, violations: [{ code: "STOCK", message: "Ships 70 > 60", entity: "B001" }], checked: { lines: 1, constraints: [] }, recomputed: {} };
    mocks.run.mockImplementation(() => env(bad));
    renderAt("/planner");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText(/NOT approved/)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Allocation plan" });
    expect(within(table).getByText("invalid")).toBeInTheDocument();
    expect(within(table).queryByText(/^valid$/)).toBeNull();
  });

  it("renders the baseline comparison with measured deltas", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/comparison");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText("KPI comparison")).toBeInTheDocument();
    expect(screen.getByText("+10.0 pp")).toBeInTheDocument();
    expect(screen.getByText(/Same data fingerprint/)).toBeInTheDocument();
  });

  it("offers CSV export and a print view with fingerprint and status", async () => {
    mocks.run.mockImplementation(() => env(makeRun()));
    renderAt("/export");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    const link = await screen.findByRole("link", { name: /Optimized pick list/ });
    expect(link).toHaveAttribute("href", "/api/optimization/PLN-TEST000001/export.csv?plan=optimizer");
    expect(screen.getByText(/abcdef0123456789abcdef/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print view/ })).toBeInTheDocument();
  });

  it("shows the snapshot fallback label when MongoDB is down", async () => {
    mocks.run.mockImplementation(() => env(makeRun({ data_source: "snapshot", persisted: false })));
    renderAt("/planner");
    await userEvent.click((await screen.findAllByRole("button", { name: /run plan/i }))[0]);
    expect(await screen.findByText(/Snapshot fallback/)).toBeInTheDocument();
    expect(screen.getByText("Not persisted")).toBeInTheDocument();
  });
});
