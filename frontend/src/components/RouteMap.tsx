import L from "leaflet";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip as LTooltip, useMap } from "react-leaflet";
import type { Outlet, RouteCandidate, Warehouse } from "../types/api";
import { ARC_SEGMENTS, arcControl, arcPath, arcPoint, TruckLayer } from "./NetworkMap";

type LatLng = [number, number];

const letterIcon = (letter: string, kind: "warehouse" | "store", urgent: boolean) => L.divIcon({
  className: "route-stop-icon",
  html: `<span class="route-stop ${kind === "warehouse" ? "route-stop-w" : ""} ${urgent ? "route-stop-urgent" : ""}">${letter}</span>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
});

const arrowIcon = (deg: number, text: string) => L.divIcon({
  className: "route-leg-icon",
  html: `<span class="route-leg"><span class="route-arrow" style="transform:rotate(${deg}deg)">&#8593;</span>${text}</span>`,
  iconSize: [0, 0], iconAnchor: [0, 0],
});

/** Zoom to the selected route (only when it changes, so the user's own panning is kept while connecting). */
function FitRoute({ path, k }: { path: LatLng[]; k: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    // Re-measure first: the container may have been resized (or hidden) since the map was created.
    map.invalidateSize();
    if (map.getSize().x > 50) map.fitBounds(L.latLngBounds(path), { padding: [48, 48], maxZoom: 11 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, k]);
  return null;
}

/**
 * Map for the route planner: click warehouses and stores to connect them in order (A, B, C, ...).
 * Shows the connected path while building, then the selected option with leg distances and
 * direction arrows; other options as faint dashed lines; closed legs in red. Lines are straight
 * between locations - not road routes.
 */
export function RouteMap({ warehouses, outlets, stops, urgent, onToggle, candidates, selected, height = 520, labels = {} }: {
  warehouses: Warehouse[]; outlets: Outlet[]; stops: string[]; urgent: Set<string>; onToggle: (id: string) => void;
  candidates: RouteCandidate[]; selected: RouteCandidate | null; height?: number;
  /** Extra text after a warehouse id on the map, e.g. available units. */
  labels?: Record<string, string>;
}) {
  const pos = (id: string): LatLng | null => {
    const x = warehouses.find((w) => w.warehouse_id === id) ?? outlets.find((o) => o.outlet_id === id);
    return x ? [x.lat, x.lon] : null;
  };
  const kind = (id: string) => (id.startsWith("W") ? "warehouse" : "store") as "warehouse" | "store";
  const order = selected?.order ?? stops;
  const path = order.map(pos).filter(Boolean) as LatLng[];

  return (
    <div className="overflow-hidden rounded-2xl" style={{ height }}>
      <MapContainer center={[19.3, 76.2]} zoom={6.4} zoomSnap={0.2} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {candidates.filter((c) => c !== selected).map((c) => (
          <Polyline key={c.kind} positions={c.order.map(pos).filter(Boolean) as LatLng[]} interactive={false}
            pathOptions={{ color: "#64748b", weight: 2, opacity: 0.45, dashArray: "6 8" }} />
        ))}
        {selected ? selected.legs.map((lg, i) => {
          const a = pos(lg.from), b = pos(lg.to);
          if (!a || !b) return null;
          const tip = <LTooltip sticky>{lg.from_name} → {lg.to_name}: {lg.distance_km} km {lg.direction}, ~{Math.round(lg.drive_min)} min{lg.blocked ? ` · ${lg.blocked}` : ""}</LTooltip>;
          if (lg.blocked) {
            return <Polyline key={`l${i}`} positions={[a, b]} pathOptions={{ color: "#e11d48", weight: 4, opacity: 0.85, dashArray: "4 8" }}>{tip}</Polyline>;
          }
          // Same network look as the Map page: a curved arc that fades towards both ends, over a faint straight shadow.
          const color = selected.recommended ? "#16a34a" : "#2563eb";
          const arc = arcPath(a, b);
          const step = arc.length / ARC_SEGMENTS;
          const mid = arcPoint(a, arcControl(a, b), b, 0.5);
          return [
            <Polyline key={`s${i}`} positions={[a, b]} interactive={false} pathOptions={{ color: "#0f172a", weight: 1, opacity: 0.1 }} />,
            ...Array.from({ length: ARC_SEGMENTS }, (_, k) => (
              <Polyline key={`a${i}-${k}`} interactive={false}
                positions={arc.slice(Math.floor(k * step), Math.min(arc.length, Math.floor((k + 1) * step) + 1))}
                pathOptions={{ color, weight: 5, opacity: 0.2 + 0.7 * Math.sin(Math.PI * (k + 0.5) / ARC_SEGMENTS), lineCap: "round" }} />
            )),
            <Polyline key={`h${i}`} positions={arc} pathOptions={{ color, weight: 14, opacity: 0 }}>{tip}</Polyline>,
            <Marker key={`m${i}`} position={mid} interactive={false} icon={arrowIcon(lg.bearing_deg, `${Math.round(lg.distance_km)} km`)} />,
          ];
        }) : path.length > 1 && (
          <Polyline positions={path} interactive={false} pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.7, dashArray: "2 8", lineCap: "round" }} />
        )}
        {outlets.map((o) => (
          <CircleMarker key={o.outlet_id} center={[o.lat, o.lon]} radius={7} eventHandlers={{ click: () => onToggle(o.outlet_id) }}
            pathOptions={{ color: "#fff", weight: 2, fillColor: stops.includes(o.outlet_id) ? "#2563eb" : "#94a3b8", fillOpacity: 1, className: "warehouse-marker" }}>
            <LTooltip>{o.name} ({o.city}) · {o.outlet_id}{stops.includes(o.outlet_id) ? " · click to remove" : " · click to add"}</LTooltip>
          </CircleMarker>
        ))}
        {warehouses.map((w) => (
          <CircleMarker key={w.warehouse_id} center={[w.lat, w.lon]} radius={11} eventHandlers={{ click: () => onToggle(w.warehouse_id) }}
            pathOptions={{ color: "#0f172a", weight: 3, fillColor: w.status === "closed" ? "#e11d48" : "#0f172a", fillOpacity: 1, className: "warehouse-marker" }}>
            <LTooltip permanent direction="right" offset={[10, 0]}>{w.warehouse_id}{labels[w.warehouse_id] ? ` · ${labels[w.warehouse_id]}` : ""}</LTooltip>
          </CircleMarker>
        ))}
        {selected && (
          <TruckLayer
            lanes={selected.legs.filter((lg) => !lg.blocked).flatMap((lg) => {
              const a = pos(lg.from), b = pos(lg.to);
              return a && b ? [{ id: `${lg.from}-${lg.to}`, a, b, qty: 0 }] : [];   // one truck per leg
            })}
            selected={selected.recommended ? selected.legs.map((lg) => `${lg.from}-${lg.to}`) : []} />
        )}
        {selected && <FitRoute path={path} k={`${selected.kind}|${selected.order.join(",")}`} />}
        {order.map((id, i) => {
          const p = pos(id);
          return p ? <Marker key={`s${id}`} position={p} icon={letterIcon(String.fromCharCode(65 + i), kind(id), urgent.has(id))}
            eventHandlers={{ click: () => onToggle(id) }} /> : null;
        })}
      </MapContainer>
    </div>
  );
}
