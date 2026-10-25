import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip as LTooltip, useMap } from "react-leaflet";
import type { Outlet, Route, Run, Warehouse } from "../types/api";
import { fmtInt, fmtPct } from "../utils/format";
import { shipmentId } from "../utils/labels";
import { loadTruckSheet, SPRITE_COUNT, spriteIndex, TRUCK_CREDIT } from "../utils/truckSprites";
import { Notice } from "./ui";

export interface Flow { w: string; d: string; qty: number }
type LatLng = [number, number];

const storeColor = (f: number | undefined) => (f === undefined ? "#94a3b8" : f >= 0.95 ? "#16a34a" : f >= 0.8 ? "#f59e0b" : "#e11d48");

const ARC_LIFT = 0.22;     // how far the arc bows away from the straight line, as a share of its length
const ARC_SEGMENTS = 14;   // pieces per arc, each with its own opacity, so the line fades towards both ends
const TRUCK_PX = 18; // about the size of a map dot

/** Control point of a quadratic arc from a to b, bowed to the side that points "up" (north) on the map. */
function arcControl(a: LatLng, b: LatLng): LatLng {
  const mid: LatLng = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dLat = b[0] - a[0], dLon = b[1] - a[1];
  let nLat = dLon, nLon = -dLat; // perpendicular
  if (nLat < 0 || (nLat === 0 && nLon > 0)) { nLat = -nLat; nLon = -nLon; }
  return [mid[0] + nLat * ARC_LIFT, mid[1] + nLon * ARC_LIFT];
}

function arcPoint(a: LatLng, c: LatLng, b: LatLng, t: number): LatLng {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

function arcPath(a: LatLng, b: LatLng, n = 32): LatLng[] {
  const c = arcControl(a, b);
  return Array.from({ length: n + 1 }, (_, i) => arcPoint(a, c, b, i / n));
}

/**
 * Small yellow 3D delivery trucks drive slowly and smoothly along each arc from warehouse to store.
 * Busier lanes carry two trucks. Each marker shows its heading by shifting one shared sprite sheet
 * (no image swaps, no fading), and markers move every animation frame outside React. Falls back to
 * dots if the model cannot load; no motion when the user prefers reduced motion.
 */
function TruckLayer({ lanes, selected }: { lanes: { id: string; a: LatLng; b: LatLng; qty: number }[]; selected: string[] }) {
  const map = useMap();
  const [sheet, setSheet] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const markersRef = useRef<{ id: string; marker: L.Marker }[]>([]);
  const [marked, setMarked] = useState(0);
  const key = useMemo(() => lanes.map((l) => `${l.a}|${l.b}|${l.qty}`).join(";"), [lanes]);

  useEffect(() => {
    let live = true;
    loadTruckSheet().then((s) => live && setSheet(s)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!map || lanes.length === 0 || (!sheet && !failed)) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const group = L.layerGroup().addTo(map);
    markersRef.current = [];
    const max = Math.max(1, ...lanes.map((l) => l.qty));
    const movers: { a: LatLng; c: LatLng; b: LatLng; marker: L.Marker; offset: number; dur: number; idx: number }[] = [];
    lanes.forEach((l, i) => {
      const n = 1 + Math.round(l.qty / max);
      for (let k = 0; k < n; k++) {
        const html = sheet
          ? `<span class="truck-sprite" style="width:${TRUCK_PX}px;height:${TRUCK_PX}px;background-image:url(${sheet});background-size:${TRUCK_PX * SPRITE_COUNT}px ${TRUCK_PX}px"></span>`
          : `<span class="truck-dot" style="margin:${TRUCK_PX / 2 - 4}px"></span>`;
        const icon = L.divIcon({ className: "truck-icon", html, iconSize: [TRUCK_PX, TRUCK_PX], iconAnchor: [TRUCK_PX / 2, TRUCK_PX / 2] });
        const marker = L.marker(l.a, { icon, interactive: false, keyboard: false });
        group.addLayer(marker);
        markersRef.current.push({ id: l.id, marker });
        movers.push({ a: l.a, c: arcControl(l.a, l.b), b: l.b, marker, offset: k / n + ((i * 0.173) % 1), dur: 10000 + (i % 5) * 1200, idx: -1 });
      }
    });
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const origin = map.getPixelOrigin();
      // Unrounded layer point: Leaflet's setLatLng snaps markers to whole pixels, which made slow
      // trucks jitter in 1 px steps. Positioning the element directly keeps the motion smooth.
      const layerPoint = (ll: LatLng) => map.project(ll).subtract(origin);
      for (const m of movers) {
        const u = (t / m.dur + m.offset) % 1;
        const p1 = layerPoint(arcPoint(m.a, m.c, m.b, u));
        const el = m.marker.getElement();
        if (el) L.DomUtil.setPosition(el, p1);
        if (!sheet) continue;
        const p2 = layerPoint(arcPoint(m.a, m.c, m.b, Math.min(1, u + 0.02)));
        const idx = spriteIndex(p2.x - p1.x, p2.y - p1.y);
        if (idx !== m.idx) {
          const sprite = m.marker.getElement()?.firstElementChild as HTMLElement | null;
          if (sprite) sprite.style.backgroundPosition = `${-idx * TRUCK_PX}px 0`;
          m.idx = idx;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    setMarked((n) => n + 1);
    return () => { cancelAnimationFrame(raf); group.remove(); markersRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, sheet, failed]);

  // Selected shipment's trucks turn green; only a class toggles, so positions and motion are untouched.
  useEffect(() => {
    for (const { id, marker } of markersRef.current) {
      marker.getElement()?.classList.toggle("truck-selected", selected.includes(id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(","), marked]);
  return null;
}

/**
 * Shared delivery map, drawn like a network: deliveries are curved arcs that fade towards both ends,
 * with a faint straight "shadow" underneath for depth; small 3D trucks drive along them; sending
 * warehouses pulse; closed roads (not connected) are red dotted lines.
 */
export function NetworkMap({ warehouses, outlets, flows, closedRoads, fillByOutlet, closedWarehouses = [], rainSites = [], height = 520, onWarehouseClick, selectedShipment = null, onFlowClick, flowStatus, altShipments = [], lostFlows = [] }: {
  warehouses: Warehouse[]; outlets: Outlet[]; flows: Flow[]; closedRoads: Route[];
  fillByOutlet: Record<string, number | undefined>; closedWarehouses?: string[]; rainSites?: string[]; height?: number;
  onWarehouseClick?: (warehouseId: string) => void;
  /** Shipment id (SHP-{warehouse}-{store}) whose truck and route are highlighted green. */
  selectedShipment?: string | null;
  onFlowClick?: (shipmentId: string) => void;
  flowStatus?: (shipmentId: string) => string | undefined;
  /** Chaos Mode: alternative connections (green) and connections the disruption removed (animated red dashes). */
  altShipments?: string[];
  lostFlows?: Flow[];
}) {
  const [tileError, setTileError] = useState(false);
  const pos = (id: string): LatLng | null => {
    const x = warehouses.find((w) => w.warehouse_id === id) ?? outlets.find((o) => o.outlet_id === id);
    return x ? [x.lat, x.lon] : null;
  };
  const name = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.name ?? outlets.find((o) => o.outlet_id === id)?.name ?? id;
  const maxQty = Math.max(1, ...flows.map((f) => f.qty));
  const rain = new Set(rainSites);
  const sending = new Set(flows.map((f) => f.w));
  const lanes = flows.flatMap((f) => {
    const a = pos(f.w), b = pos(f.d);
    return a && b ? [{ id: shipmentId(f.w, f.d), a, b, qty: f.qty }] : [];
  });

  return (
    <div>
      {tileError && <div className="p-3"><Notice tone="warn">The background map could not load (offline?). Markers and lines still show.</Notice></div>}
      <div className="overflow-hidden rounded-2xl" style={{ height }}>
        <MapContainer center={[19.3, 76.2]} zoom={6.4} zoomSnap={0.2} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer attribution={`&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ${TRUCK_CREDIT}`}
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{ tileerror: () => setTileError(true) }} />
          {closedRoads.map((r) => {
            const a = pos(r.warehouse_id), b = pos(r.outlet_id);
            return a && b ? (
              <Polyline key={`c${r.route_id}`} positions={[a, b]} pathOptions={{ color: "#e11d48", weight: 2, opacity: 0.6, dashArray: "2 7", lineCap: "round" }}>
                <LTooltip sticky>Not connected: road {name(r.warehouse_id)} → {name(r.outlet_id)} is closed</LTooltip>
              </Polyline>
            ) : null;
          })}
          {flows.map((f) => {
            const a = pos(f.w), b = pos(f.d);
            if (!a || !b) return null;
            const sid = shipmentId(f.w, f.d);
            const sel = sid === selectedShipment || altShipments.includes(sid);
            const color = sel ? "#16a34a" : "#2563eb";
            const weight = 1.5 + 3 * (f.qty / maxQty) + (sel ? 1.5 : 0);
            const st = flowStatus?.(sid);
            const path = arcPath(a, b);
            const step = path.length / ARC_SEGMENTS;
            const segments = Array.from({ length: ARC_SEGMENTS }, (_, s) => {
              const pts = path.slice(Math.floor(s * step), Math.min(path.length, Math.floor((s + 1) * step) + 1));
              const mid = (s + 0.5) / ARC_SEGMENTS;
              return { pts, opacity: (sel ? 0.25 : 0.06) + (sel ? 0.7 : 0.5) * Math.sin(Math.PI * mid) };
            });
            return [
              <Polyline key={`s${f.w}${f.d}`} positions={[a, b]} interactive={false}
                pathOptions={{ color: "#0f172a", weight: 1, opacity: 0.07 }} />,
              ...segments.map((sg, s) => (
                <Polyline key={`a${f.w}${f.d}${s}`} positions={sg.pts} interactive={false}
                  pathOptions={{ color, weight, opacity: sg.opacity, lineCap: "round" }} />
              )),
              <Polyline key={`h${f.w}${f.d}`} positions={path} pathOptions={{ color, weight: 12, opacity: 0 }}
                eventHandlers={onFlowClick ? { click: () => onFlowClick(sid) } : undefined}>
                <LTooltip sticky>{sid}: {name(f.w)} → {name(f.d)}, {fmtInt(f.qty)} units{st ? ` · ${st}` : " on the way"}</LTooltip>
              </Polyline>,
            ];
          })}
          {lostFlows.map((f) => {
            const a = pos(f.w), b = pos(f.d);
            return a && b ? (
              <Polyline key={`l${f.w}${f.d}`} positions={arcPath(a, b)}
                pathOptions={{ color: "#e11d48", weight: 3, opacity: 0.85, dashArray: "6 8", lineCap: "round", className: "lost-lane" }}>
                <LTooltip sticky>Lost by the disruption: {name(f.w)} → {name(f.d)} ({fmtInt(f.qty)} units before)</LTooltip>
              </Polyline>
            ) : null;
          })}
          <TruckLayer lanes={lanes} selected={[...altShipments, ...(selectedShipment ? [selectedShipment] : [])]} />
          {outlets.map((o) => (
            <CircleMarker key={o.outlet_id} center={[o.lat, o.lon]} radius={8}
              pathOptions={{ color: rain.has(o.outlet_id) ? "#0ea5e9" : "#fff", weight: rain.has(o.outlet_id) ? 4 : 2, fillColor: storeColor(fillByOutlet[o.outlet_id]), fillOpacity: 1 }}>
              <LTooltip>{o.name} ({o.city}){fillByOutlet[o.outlet_id] !== undefined ? ` - ${fmtPct(fillByOutlet[o.outlet_id], 0)} supplied` : ""}{rain.has(o.outlet_id) ? " · heavy rain forecast" : ""}</LTooltip>
            </CircleMarker>
          ))}
          {warehouses.filter((w) => sending.has(w.warehouse_id)).map((w) => (
            <CircleMarker key={`p${w.warehouse_id}`} center={[w.lat, w.lon]} radius={18} interactive={false}
              pathOptions={{ color: "#38bdf8", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.15, className: "hub-pulse" }} />
          ))}
          {warehouses.map((w) => {
            const closed = closedWarehouses.includes(w.warehouse_id);
            return (
              <CircleMarker key={w.warehouse_id} center={[w.lat, w.lon]} radius={11}
                eventHandlers={onWarehouseClick ? { click: () => onWarehouseClick(w.warehouse_id) } : undefined}
                pathOptions={{ color: rain.has(w.warehouse_id) ? "#0ea5e9" : "#0f172a", weight: 3, fillColor: closed ? "#e11d48" : "#0f172a", fillOpacity: 1, className: onWarehouseClick ? "warehouse-marker" : undefined }}>
                <LTooltip permanent direction="right" offset={[10, 0]}>{w.warehouse_id}{closed ? " (closed)" : ""}</LTooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-3 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><svg width="34" height="12" aria-hidden><path d="M1 11 Q17 -3 33 11" fill="none" stroke="#2563eb" strokeWidth="2" opacity="0.6" /></svg>delivery route (trucks drive along it)</span>
        <span className="flex items-center gap-1.5"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#e11d48" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" /></svg>not connected (road closed)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-900 ring-4 ring-sky-200" />warehouse (glows when sending)</span>
        <span>store: <b className="text-emerald-600">●</b> full · <b className="text-amber-500">●</b> most · <b className="text-rose-600">●</b> short</span>
        {lostFlows.length > 0 && <span className="flex items-center gap-1.5"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#e11d48" strokeWidth="3" strokeDasharray="6 5" /></svg>connection lost in simulation</span>}
        {altShipments.length > 0 && <span className="flex items-center gap-1.5"><svg width="34" height="12" aria-hidden><path d="M1 11 Q17 -3 33 11" fill="none" stroke="#16a34a" strokeWidth="3" /></svg>alternative connection</span>}
        {selectedShipment && <span className="flex items-center gap-1.5"><svg width="34" height="12" aria-hidden><path d="M1 11 Q17 -3 33 11" fill="none" stroke="#16a34a" strokeWidth="3" /></svg>selected delivery</span>}
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
  const scenarioClosed = new Set([...(((run?.scenario.changes as { closed_routes?: string[] })?.closed_routes) ?? []),
    ...(run?.chaos?.closed_routes ?? [])]);
  return routes.filter((r) => (!keptW || keptW.has(r.warehouse_id)) && (!keptD || keptD.has(r.outlet_id))
    && (scenarioClosed.has(r.route_id) || !(ov[r.route_id] ?? r.open)));
}
