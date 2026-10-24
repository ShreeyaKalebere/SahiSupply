import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip as LTooltip } from "react-leaflet";
import { api } from "../api/client";
import { Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { CHART } from "../utils/chart";
import { fmtInt, fmtPct } from "../utils/format";

const fillColor = (f: number | undefined) => (f === undefined ? "#94a3b8" : f >= 0.95 ? "#0ca30c" : f >= 0.8 ? "#fab219" : "#d03b3b");

export default function MapPage() {
  const p = usePlanner();
  const whs = useAsync(() => api.warehouses(p.module), [p.module]);
  const outs = useAsync(() => api.outlets(p.module), [p.module]);
  const [tileError, setTileError] = useState(false);
  const run = p.run;
  const flows = useMemo(() => {
    if (!run?.optimizer) return [];
    const agg: Record<string, { w: string; d: string; qty: number }> = {};
    for (const ln of run.optimizer.lines) {
      const k = `${ln.warehouse_id}|${ln.outlet_id}`;
      agg[k] = agg[k] ?? { w: ln.warehouse_id, d: ln.outlet_id, qty: 0 };
      agg[k].qty += ln.qty;
    }
    return Object.values(agg);
  }, [run]);
  const maxQty = Math.max(1, ...flows.map((f) => f.qty));
  const closedW = new Set(((run?.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? []);

  if (whs.loading || outs.loading) return <Spinner />;
  const W = whs.data ?? [];
  const O = outs.data ?? [];
  const pos = (id: string): [number, number] | null => {
    const x = W.find((w) => w.warehouse_id === id) ?? O.find((o) => o.outlet_id === id);
    return x ? [x.lat, x.lon] : null;
  };
  const byOutlet = run?.optimizer?.kpis.by_outlet ?? {};

  return (
    <div className="space-y-3">
      <PageHeader title="Network map" description="Warehouses (large dark labelled markers; red when closed) and destinations (small circles, coloured by fill rate). Lines connect each source to the destinations it serves in the current plan; width scales with units." />
      <ErrorBox error={whs.error ?? outs.error} />
      <Notice tone="warn">Lines are straight connections between dataset coordinates, not verified road routes. Distances in the model are haversine × 1.3.</Notice>
      {tileError && <Notice tone="warn">Map tiles could not be loaded (offline?). Markers still show; the table below lists every flow.</Notice>}
      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <div className="h-[560px] overflow-hidden rounded-lg">
            <MapContainer center={[19.3, 76.2]} zoom={6.4} zoomSnap={0.2} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{ tileerror: () => setTileError(true) }} />
              {flows.map((f) => {
                const a = pos(f.w), b = pos(f.d);
                if (!a || !b) return null;
                return (
                  <Polyline key={`${f.w}${f.d}`} positions={[a, b]} pathOptions={{ color: CHART.opt, weight: 1.5 + 6 * (f.qty / maxQty), opacity: 0.55 }}>
                    <LTooltip sticky>{f.w} → {f.d}: {fmtInt(f.qty)} units</LTooltip>
                  </Polyline>
                );
              })}
              {O.map((o) => (
                <CircleMarker key={o.outlet_id} center={[o.lat, o.lon]} radius={8}
                  pathOptions={{ color: "#fff", weight: 2, fillColor: fillColor(byOutlet[o.outlet_id]?.fill_rate), fillOpacity: 1 }}>
                  <LTooltip>{o.outlet_id} {o.name} ({o.type}){byOutlet[o.outlet_id] ? ` - fill ${fmtPct(byOutlet[o.outlet_id].fill_rate)}, critical short ${byOutlet[o.outlet_id].critical_shortage_units}` : ""}</LTooltip>
                </CircleMarker>
              ))}
              {W.map((w) => (
                <CircleMarker key={w.warehouse_id} center={[w.lat, w.lon]} radius={11}
                  pathOptions={{ color: "#0f172a", weight: 3, fillColor: closedW.has(w.warehouse_id) ? "#d03b3b" : "#0f172a", fillOpacity: 1 }}>
                  <LTooltip permanent direction="right" offset={[10, 0]}>{w.warehouse_id}{closedW.has(w.warehouse_id) ? " (closed)" : ""}</LTooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </Card>
        <Card title="Flows (list view)" bodyClass="p-0">
          {!run && <p className="p-4 text-sm text-slate-500">Run a plan to see flows.</p>}
          <div className="max-h-[560px] overflow-auto">
            <table className="tbl">
              <thead><tr><th>From</th><th>To</th><th className="num">Units</th><th className="num">Dest. fill</th></tr></thead>
              <tbody>
                {flows.sort((a, b) => b.qty - a.qty).map((f) => (
                  <tr key={`${f.w}${f.d}`}><td>{f.w}</td><td>{f.d} {O.find((o) => o.outlet_id === f.d)?.name}</td>
                    <td className="num">{fmtInt(f.qty)}</td><td className="num">{fmtPct(byOutlet[f.d]?.fill_rate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
