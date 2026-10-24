import { useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip as LTooltip } from "react-leaflet";
import type { Outlet, Route, Run, Warehouse } from "../types/api";
import { fmtInt, fmtPct } from "../utils/format";
import { Notice } from "./ui";

export interface Flow { w: string; d: string; qty: number }

const storeColor = (f: number | undefined) => (f === undefined ? "#94a3b8" : f >= 0.95 ? "#16a34a" : f >= 0.8 ? "#f59e0b" : "#e11d48");

/**
 * Shared delivery map. Active deliveries animate from warehouse to store (the dash pattern moves along
 * the line); roads that are closed or not connected are drawn as red dotted lines.
 */
export function NetworkMap({ warehouses, outlets, flows, closedRoads, fillByOutlet, closedWarehouses = [], rainSites = [], height = 520 }: {
  warehouses: Warehouse[]; outlets: Outlet[]; flows: Flow[]; closedRoads: Route[];
  fillByOutlet: Record<string, number | undefined>; closedWarehouses?: string[]; rainSites?: string[]; height?: number;
}) {
  const [tileError, setTileError] = useState(false);
  const pos = (id: string): [number, number] | null => {
    const x = warehouses.find((w) => w.warehouse_id === id) ?? outlets.find((o) => o.outlet_id === id);
    return x ? [x.lat, x.lon] : null;
  };
  const name = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.name ?? outlets.find((o) => o.outlet_id === id)?.name ?? id;
  const maxQty = Math.max(1, ...flows.map((f) => f.qty));
  const rain = new Set(rainSites);

  return (
    <div>
      {tileError && <div className="p-3"><Notice tone="warn">The background map could not load (offline?). Markers and lines still show.</Notice></div>}
      <div className="overflow-hidden rounded-2xl" style={{ height }}>
        <MapContainer center={[19.3, 76.2]} zoom={6.4} zoomSnap={0.2} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{ tileerror: () => setTileError(true) }} />
          {closedRoads.map((r) => {
            const a = pos(r.warehouse_id), b = pos(r.outlet_id);
            return a && b ? (
              <Polyline key={`c${r.route_id}`} positions={[a, b]} pathOptions={{ color: "#e11d48", weight: 2, opacity: 0.7, dashArray: "2 7", lineCap: "round" }}>
                <LTooltip sticky>Not connected: road {name(r.warehouse_id)} → {name(r.outlet_id)} is closed</LTooltip>
              </Polyline>
            ) : null;
          })}
          {flows.map((f) => {
            const a = pos(f.w), b = pos(f.d);
            if (!a || !b) return null;
            const weight = 2 + 6 * (f.qty / maxQty);
            return [
              <Polyline key={`b${f.w}${f.d}`} positions={[a, b]} pathOptions={{ color: "#2563eb", weight, opacity: 0.18 }} />,
              <Polyline key={`f${f.w}${f.d}`} positions={[a, b]} pathOptions={{ color: "#2563eb", weight, opacity: 0.85, className: "flow-line", lineCap: "round" }}>
                <LTooltip sticky>{name(f.w)} → {name(f.d)}: {fmtInt(f.qty)} units on the way</LTooltip>
              </Polyline>,
            ];
          })}
          {outlets.map((o) => (
            <CircleMarker key={o.outlet_id} center={[o.lat, o.lon]} radius={8}
              pathOptions={{ color: rain.has(o.outlet_id) ? "#0ea5e9" : "#fff", weight: rain.has(o.outlet_id) ? 4 : 2, fillColor: storeColor(fillByOutlet[o.outlet_id]), fillOpacity: 1 }}>
              <LTooltip>{o.name} ({o.city}){fillByOutlet[o.outlet_id] !== undefined ? ` - ${fmtPct(fillByOutlet[o.outlet_id], 0)} supplied` : ""}{rain.has(o.outlet_id) ? " · heavy rain forecast" : ""}</LTooltip>
            </CircleMarker>
          ))}
          {warehouses.map((w) => {
            const closed = closedWarehouses.includes(w.warehouse_id);
            return (
              <CircleMarker key={w.warehouse_id} center={[w.lat, w.lon]} radius={11}
                pathOptions={{ color: rain.has(w.warehouse_id) ? "#0ea5e9" : "#0f172a", weight: 3, fillColor: closed ? "#e11d48" : "#0f172a", fillOpacity: 1 }}>
                <LTooltip permanent direction="right" offset={[10, 0]}>{w.warehouse_id}{closed ? " (closed)" : ""}</LTooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-3 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#2563eb" strokeWidth="3" className="flow-line" /></svg>moving delivery (thicker = more)</span>
        <span className="flex items-center gap-1.5"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#e11d48" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" /></svg>not connected (road closed)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-900" />warehouse</span>
        <span>store: <b className="text-emerald-600">●</b> full · <b className="text-amber-500">●</b> most · <b className="text-rose-600">●</b> short</span>
        {rainSites.length > 0 && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-sky-500" />heavy rain forecast</span>}
      </div>
    </div>
  );
}

export function flowsFromLines(lines: { warehouse_id: string; outlet_id: string; qty: number }[]): Flow[] {
  const agg: Record<string, Flow> = {};
  for (const ln of lines) {
    const k = `${ln.warehouse_id}-${ln.outlet_id}`;
    agg[k] = agg[k] ?? { w: ln.warehouse_id, d: ln.outlet_id, qty: 0 };
    agg[k].qty += ln.qty;
  }
  return Object.values(agg);
}

/** Roads that are closed in this run: base data (demo setting), what-if closures and the user's network edits. */
export function closedRoadsFor(run: Run | null, routes: Route[]): Route[] {
  const ov = run?.network?.edit.route_overrides ?? {};
  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const scenarioClosed = new Set(((run?.scenario.changes as { closed_routes?: string[] })?.closed_routes) ?? []);
  return routes.filter((r) => (!keptW || keptW.has(r.warehouse_id)) && (!keptD || keptD.has(r.outlet_id))
    && (scenarioClosed.has(r.route_id) || !(ov[r.route_id] ?? r.open)));
}
