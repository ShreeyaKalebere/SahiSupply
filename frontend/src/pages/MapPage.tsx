import { Map as MapIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { api } from "../api/client";
import { closedRoadsFor, flowsFromLines, NetworkMap } from "../components/NetworkMap";
import { Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { DeliveryStatusCell } from "../components/DeliveryStatusCell";
import { WarehousePopup } from "../components/warehouse/WarehousePopup";
import { useAsync } from "../hooks/useAsync";
import { useDeliveries } from "../hooks/useDeliveries";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { WarehouseDetails } from "../types/api";
import { fmtInt, fmtPct } from "../utils/format";
import { DELIVERY_TEXT, shipmentId } from "../utils/labels";

// three.js and the scene code load only when someone opens a 3D warehouse.
const Warehouse3DModal = lazy(() => import("../components/warehouse/Warehouse3DModal"));

export default function MapPage() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const routes = useAsync(() => api.routes(p.module, p.run?.contested_pattern ?? p.contested), [p.module, p.run?.contested_pattern, p.contested]);
  const run = p.run;
  const [openWh, setOpenWh] = useState<string | null>(null);
  const [view3d, setView3d] = useState<WarehouseDetails | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const deliveries = useDeliveries();
  const toggleSelect = (sid: string) => setSelected((cur) => (cur === sid ? null : sid));
  const flowStatus = (sid: string) => { const s = deliveries.byId[sid]; return s ? DELIVERY_TEXT[s.status].label : undefined; };

  if (!net || routes.loading) return <Spinner />;
  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = net.warehouses.filter((w) => !keptW || keptW.has(w.warehouse_id));
  const O = net.outlets.filter((o) => !keptD || keptD.has(o.outlet_id));
  const flows = run?.optimizer ? flowsFromLines(run.optimizer.lines) : [];
  const selectedShipment = selected && flows.some((f) => shipmentId(f.w, f.d) === selected) ? selected : null;
  const closed = closedRoadsFor(run, routes.data ?? []);
  const fill = Object.fromEntries(Object.entries(run?.optimizer?.kpis.by_outlet ?? {}).map(([d, v]) => [d, v.fill_rate]));
  const closedW = [...(((run?.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? []), ...(run?.chaos?.offline_warehouses ?? [])];
  const chaosImpact = p.chaos?.impact;
  const lostFlows = (chaosImpact?.lost_lanes ?? []).map((l) => ({ w: l.warehouse_id, d: l.outlet_id, qty: l.qty }));
  const altShipments = (chaosImpact?.new_lanes ?? []).map((l) => shipmentId(l.warehouse_id, l.outlet_id));
  const wName = (id: string) => net.warehouses.find((w) => w.warehouse_id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <PageHeader title="Map" description="Watch this week's deliveries move from warehouses to stores. Red dotted lines are closed roads. Click any warehouse (dark circle) to see its stock and open it in 3D. Click a delivery (in the list or on the map) to highlight its truck and route in green." />
      <ErrorBox error={routes.error} onRetry={routes.reload} />
      {!run && <Notice>Make a plan (Run plan, top right) to see deliveries moving on the map.</Notice>}
      {p.chaos && (
        <Notice tone="warn">⚡ Showing the simulated disaster <b>{p.chaos.chaos.label}</b> (controlled simulation, not real-time detection). Red marching dashes = connections lost; green = alternative connections.{" "}
          <button type="button" className="btn-link" onClick={p.resetChaos}>Reset Scenario</button></Notice>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <NetworkMap warehouses={W} outlets={O} flows={flows} closedRoads={closed} fillByOutlet={fill} closedWarehouses={closedW} height={560}
            onWarehouseClick={setOpenWh} selectedShipment={selectedShipment} onFlowClick={toggleSelect} flowStatus={flowStatus}
            lostFlows={lostFlows} altShipments={altShipments} />
        </Card>
        <Card title="Deliveries (list)" icon={MapIcon} bodyClass="max-h-[620px] overflow-y-auto p-0"
          actions={selectedShipment ? <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setSelected(null)}>Clear selection</button> : undefined}>
          <ErrorBox error={deliveries.error} onRetry={deliveries.reload} />
          <table className="tbl" aria-label="Deliveries">
            <thead><tr><th>From</th><th>To</th><th className="num">Units</th><th className="num">Store got</th><th>Status</th></tr></thead>
            <tbody>
              {[...flows].sort((a, b) => b.qty - a.qty).map((f) => {
                const sid = shipmentId(f.w, f.d);
                const sel = sid === selectedShipment;
                return (
                  <tr key={sid} className={`clickable ${sel ? "bg-emerald-50" : ""}`} tabIndex={0} aria-selected={sel}
                    onClick={() => toggleSelect(sid)} onKeyDown={(e) => { if (e.key === "Enter") toggleSelect(sid); }}>
                    <td>{wName(f.w)}<div className="text-[10px] text-slate-400">{sid}</div></td><td>{O.find((o) => o.outlet_id === f.d)?.name ?? f.d}</td>
                    <td className="num">{fmtInt(f.qty)}</td><td className="num">{fmtPct(fill[f.d], 0)}</td>
                    <td><DeliveryStatusCell shipmentIds={[sid]} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {closed.length > 0 && <p className="px-4 py-3 text-xs text-slate-500">{closed.length} road(s) closed: {closed.slice(0, 12).map((r) => r.route_id).join(", ")}{closed.length > 12 ? "…" : ""}</p>}
        </Card>
      </div>
      <p className="text-xs text-slate-400">Lines are straight between locations - they are not actual road routes.</p>
      {openWh && (
        <WarehousePopup module={p.module} warehouseId={openWh} contested={run?.contested_pattern ?? p.contested}
          planId={run?.plan_id} onClose={() => setOpenWh(null)} onOpen3D={setView3d} />
      )}
      {view3d && (
        <Suspense fallback={<div className="fixed inset-0 z-[1300] grid place-items-center bg-slate-900/60"><Spinner label="Opening 3D warehouse…" /></div>}>
          <Warehouse3DModal details={view3d} onClose={() => setView3d(null)} />
        </Suspense>
      )}
    </div>
  );
}
