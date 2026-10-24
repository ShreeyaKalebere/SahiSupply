import {
  Compass, Map as MapIcon, Truck, Warehouse as WarehouseIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { DistributionSimulation3D } from "../components/DistributionSimulation3D";
import { closedRoadsFor, flowsFromLines, NetworkMap } from "../components/NetworkMap";
import { Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { WarehouseInterior3D } from "../components/WarehouseInterior3D";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { Warehouse } from "../types/api";
import { cx, fmtInt, fmtPct } from "../utils/format";

interface MapPageProps {
  initialTab?: "simulation" | "interior" | "map2d";
}

export default function MapPage({ initialTab }: MapPageProps) {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const [searchParams, setSearchParams] = useSearchParams();

  const queryTab = searchParams.get("tab") as "simulation" | "interior" | "map2d" | null;
  const [tab, setTab] = useState<"simulation" | "interior" | "map2d">(
    initialTab ?? queryTab ?? "simulation"
  );

  const routes = useAsync(
    () => api.routes(p.module, p.run?.contested_pattern ?? p.contested),
    [p.module, p.run?.contested_pattern, p.contested]
  );
  const run = p.run;

  // Selected warehouse for the 3D Interior inspection
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(
    searchParams.get("wh")
  );

  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = useMemo(() => (net?.warehouses ?? []).filter((w) => !keptW || keptW.has(w.warehouse_id)), [net, keptW]);
  const O = useMemo(() => (net?.outlets ?? []).filter((o) => !keptD || keptD.has(o.outlet_id)), [net, keptD]);

  const selectedWarehouse: Warehouse | undefined = useMemo(() => {
    if (!W.length) return undefined;
    if (selectedWarehouseId) {
      const found = W.find((w) => w.warehouse_id === selectedWarehouseId);
      if (found) return found;
    }
    // Default to the first or hub warehouse
    return W[0];
  }, [W, selectedWarehouseId]);

  if (!net || routes.loading) return <Spinner />;

  const flows = run?.optimizer ? flowsFromLines(run.optimizer.lines) : [];
  const closed = closedRoadsFor(run, routes.data ?? []);
  const fill = Object.fromEntries(
    Object.entries(run?.optimizer?.kpis.by_outlet ?? {}).map(([d, v]) => [d, v.fill_rate])
  );
  const closedW = ((run?.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? [];
  const wName = (id: string) => net.warehouses.find((w) => w.warehouse_id === id)?.name ?? id;

  const handleSelectWarehouse = (w: Warehouse) => {
    setSelectedWarehouseId(w.warehouse_id);
    setTab("interior");
    setSearchParams({ tab: "interior", wh: w.warehouse_id });
  };

  return (
    <div className="space-y-5">
      {/* Page Title & Navigation Modes */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <PageHeader
            title="3D Distribution & Warehouse Interior"
            description="Blender-style 3D viewport: click any warehouse node to inspect its interior industrial racks, reefer vault (2-8°C), and GDP pharmaceutical storage."
          />
        </div>

        {/* View Switcher Tabs */}
        <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-sm">
          <button
            onClick={() => {
              setTab("simulation");
              setSearchParams({ tab: "simulation" });
            }}
            className={cx(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all",
              tab === "simulation"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Compass size={15} /> 1. 3D Distribution Simulation
          </button>
          <button
            onClick={() => {
              setTab("interior");
              setSearchParams({ tab: "interior", wh: selectedWarehouse?.warehouse_id ?? "" });
            }}
            className={cx(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all",
              tab === "interior"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <WarehouseIcon size={15} /> 2. 3D Warehouse Interior
          </button>
          <button
            onClick={() => {
              setTab("map2d");
              setSearchParams({ tab: "map2d" });
            }}
            className={cx(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all",
              tab === "map2d"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <MapIcon size={15} /> 3. 2D Regional Map
          </button>
        </div>
      </div>

      <ErrorBox error={routes.error} onRetry={routes.reload} />
      {!run && (
        <Notice>
          Make a plan (Run plan, top right) to see optimizer dispatch flows and fill rates in 3D. Default regional lines are active.
        </Notice>
      )}

      {/* Main Interactive View based on active Tab */}
      {tab === "simulation" && (
        <div className="space-y-4">
          <DistributionSimulation3D
            warehouses={W}
            outlets={O}
            flows={flows}
            routes={routes.data ?? []}
            onSelectWarehouse={handleSelectWarehouse}
            height={620}
          />
        </div>
      )}

      {tab === "interior" && selectedWarehouse && (
        <div className="space-y-4">
          <WarehouseInterior3D
            warehouse={selectedWarehouse}
            allWarehouses={W}
            onSelectWarehouse={(w) => {
              setSelectedWarehouseId(w.warehouse_id);
              setSearchParams({ tab: "interior", wh: w.warehouse_id });
            }}
            onBackToSimulation={() => {
              setTab("simulation");
              setSearchParams({ tab: "simulation" });
            }}
            height={640}
          />
        </div>
      )}

      {tab === "map2d" && (
        <Card className="p-0 overflow-hidden" bodyClass="p-0">
          <NetworkMap
            warehouses={W}
            outlets={O}
            flows={flows}
            closedRoads={closed}
            fillByOutlet={fill}
            closedWarehouses={closedW}
            height={580}
          />
        </Card>
      )}

      {/* Deliveries List & Quick Warehouse Selection Bar */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Quick Warehouse Selector Cards */}
        <div className="xl:col-span-1 space-y-3">
          <Card
            title="Inspect 3D Warehouse Interior"
            subtitle="Click any warehouse to view interior racks & reefer vault"
            icon={WarehouseIcon}
            bodyClass="p-3"
          >
            <div className="space-y-2">
              {W.map((w) => (
                <button
                  key={w.warehouse_id}
                  onClick={() => handleSelectWarehouse(w)}
                  className={cx(
                    "w-full text-left rounded-xl border p-3 transition-all flex items-center justify-between",
                    selectedWarehouse?.warehouse_id === w.warehouse_id && tab === "interior"
                      ? "border-blue-500 bg-blue-50/80 text-blue-900 shadow-sm ring-1 ring-blue-500/40"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-800"
                  )}
                >
                  <div>
                    <div className="text-xs font-bold">{w.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {w.city}, {w.state ?? "India"} · {w.capacity ?? "300k units"}
                    </div>
                  </div>
                  <span className="rounded-lg bg-blue-100 text-blue-700 px-2 py-1 text-[10px] font-bold shrink-0">
                    3D Inside →
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Deliveries Flow Table */}
        <Card
          title="Deliveries (Optimizer Dispatches)"
          icon={Truck}
          className="xl:col-span-2"
          bodyClass="max-h-[460px] overflow-y-auto p-0"
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>From Warehouse</th>
                <th>To Store</th>
                <th className="num">Dispatched Units</th>
                <th className="num">Fill Rate</th>
              </tr>
            </thead>
            <tbody>
              {[...flows]
                .sort((a, b) => b.qty - a.qty)
                .map((f) => (
                  <tr key={`${f.w}${f.d}`}>
                    <td className="font-medium text-slate-800">{wName(f.w)}</td>
                    <td>{O.find((o) => o.outlet_id === f.d)?.name ?? f.d}</td>
                    <td className="num font-semibold text-slate-900">{fmtInt(f.qty)}</td>
                    <td className="num">{fmtPct(fill[f.d], 0)}</td>
                  </tr>
                ))}
              {flows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-slate-400">
                    Run the optimizer (Run plan, top right) to view computed weekly delivery flows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {closed.length > 0 && (
            <p className="px-4 py-3 text-xs text-slate-500">
              {closed.length} road(s) closed: {closed.slice(0, 12).map((r) => r.route_id).join(", ")}
              {closed.length > 12 ? "…" : ""}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
