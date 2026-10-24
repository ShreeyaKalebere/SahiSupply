import { Ban, Check, Network, Play, RotateCcw, Store, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip as LTooltip } from "react-leaflet";
import { api } from "../api/client";
import { Card, ErrorBox, Notice, PageHeader, Pill, ProgressBar, Spinner, StatCard } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { NetworkEdit, Route, Run } from "../types/api";
import { cx, fmtInt, fmtPct, fmtRs } from "../utils/format";

const byNum = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));

export default function NetworkPage() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const routesQ = useAsync(() => api.routes(p.module, p.contested), [p.module, p.contested]);

  const allW = useMemo(() => (net?.warehouses ?? []).map((w) => w.warehouse_id).sort(byNum), [net]);
  const allD = useMemo(() => (net?.outlets ?? []).map((o) => o.outlet_id).sort(byNum), [net]);
  const [keepW, setKeepW] = useState<string[]>([]);
  const [keepD, setKeepD] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Start from the saved custom network for this module, or from the full network.
  useEffect(() => {
    setKeepW(p.network?.warehouses ?? allW);
    setKeepD(p.network?.outlets ?? allD);
    setOverrides(p.network?.route_overrides ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.module, allW.join(), allD.join()]);

  const routeOf = (w: string, d: string): Route | undefined => routesQ.data?.find((r) => r.warehouse_id === w && r.outlet_id === d);
  const isOpen = (r: Route) => overrides[r.route_id] ?? r.open;
  const toggleRoad = (r: Route) => {
    const next = !isOpen(r);
    setOverrides((o) => {
      const c = { ...o };
      if (next === r.open) delete c[r.route_id]; else c[r.route_id] = next;
      return c;
    });
  };
  const toggle = (set: (fn: (prev: string[]) => string[]) => void, id: string) =>
    set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort(byNum)));

  const changedRoads = Object.keys(overrides).filter((id) => {
    const [w, d] = id.split("-");
    return keepW.includes(w) && keepD.includes(d);
  });
  const isDefault = keepW.length === allW.length && keepD.length === allD.length && Object.keys(overrides).length === 0;
  const edit: NetworkEdit | null = isDefault ? null : {
    warehouses: keepW.length === allW.length ? null : keepW,
    outlets: keepD.length === allD.length ? null : keepD,
    route_overrides: Object.fromEntries(changedRoads.map((id) => [id, overrides[id]])),
  };
  const canRun = keepW.length > 0 && keepD.length > 0 && !p.running;
  const run = async () => {
    p.setNetwork(edit);
    await p.runPlan({ network: edit });
  };
  const reset = () => { setKeepW(allW); setKeepD(allD); setOverrides({}); };

  const wName = (id: string) => net?.warehouses.find((w) => w.warehouse_id === id)?.name ?? id;
  const dInfo = (id: string) => net?.outlets.find((o) => o.outlet_id === id);

  return (
    <div className="space-y-5">
      <PageHeader title="Network builder"
        description="Build your own delivery network: choose which warehouses and stores take part, and open or close any road. Then press Run to see how the plan changes." />
      <ErrorBox error={routesQ.error} onRetry={routesQ.reload} />
      {!net || routesQ.loading ? <Spinner /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`1. Warehouses (${keepW.length} of ${allW.length})`} icon={WarehouseIcon} subtitle="Click to use or remove a warehouse. Removing it also removes its stock.">
              <div className="flex flex-wrap gap-2">
                {allW.map((id) => {
                  const on = keepW.includes(id);
                  return (
                    <button key={id} aria-pressed={on} onClick={() => toggle(setKeepW, id)}
                      className={cx("rounded-xl border px-3 py-2 text-left text-sm", on ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 bg-white text-slate-400 line-through")}>
                      <div className="font-semibold">{id} · {wName(id)}</div>
                      <div className="text-xs no-underline">{on ? "in use" : "removed"}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
            <Card title={`2. Stores (${keepD.length} of ${allD.length})`} icon={Store} subtitle="Click to include or leave out a store.">
              <div className="flex flex-wrap gap-1.5">
                {allD.map((id) => {
                  const on = keepD.includes(id);
                  const o = dInfo(id);
                  return (
                    <button key={id} aria-pressed={on} onClick={() => toggle(setKeepD, id)} title={o?.name}
                      className={cx("rounded-lg border px-2.5 py-1.5 text-xs", on ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-400 line-through")}>
                      {o?.city ?? id}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card title="3. Roads" icon={Network}
            subtitle="Each box is the road from a warehouse (column) to a store (row). Click a box to close or open that road."
            actions={<div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setOverrides(Object.fromEntries((routesQ.data ?? []).filter((r) => !r.open).map((r) => [r.route_id, true])))}>Open all roads</button>
              <button className="btn-secondary" onClick={reset}><RotateCcw size={14} aria-hidden /> Reset</button>
            </div>}>
            {p.contested && (
              <Notice tone="warn">
                The demo setting <b>"Remote stores share one warehouse"</b> is on, so roads to the far-away stores start <b>closed</b> except from Pune Hub.
                That's why Nagpur doesn't supply them. Click those boxes to open the roads.
              </Notice>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[640px] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="px-2 text-left font-medium text-slate-500">Store ↓ / Warehouse →</th>
                    {keepW.map((w) => <th key={w} className="px-1 text-center font-semibold text-slate-700">{w}<div className="font-normal text-slate-400">{wName(w).split(" ")[0]}</div></th>)}
                  </tr>
                </thead>
                <tbody>
                  {keepD.map((d) => (
                    <tr key={d}>
                      <td className="whitespace-nowrap px-2 py-1 text-sm text-slate-700">{dInfo(d)?.name ?? d}<span className="ml-1 text-xs text-slate-400">{dInfo(d)?.city}</span></td>
                      {keepW.map((w) => {
                        const r = routeOf(w, d);
                        if (!r) return <td key={w} />;
                        const open = isOpen(r);
                        const changed = overrides[r.route_id] !== undefined;
                        return (
                          <td key={w} className="p-0">
                            <button onClick={() => toggleRoad(r)} aria-label={`Road ${w} to ${d}: ${open ? "open" : "closed"}`}
                              title={`${wName(w)} → ${dInfo(d)?.name}: ${Math.round(r.distance_km)} km, ${r.lead_time_days} day(s). Click to ${open ? "close" : "open"}.`}
                              className={cx("flex h-9 w-full min-w-[64px] items-center justify-center gap-1 rounded-lg font-medium",
                                open ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-rose-50 text-rose-600 hover:bg-rose-100",
                                changed && "ring-2 ring-violet-400")}>
                              {open ? <Check size={13} aria-hidden /> : <Ban size={13} aria-hidden />}{open ? "Open" : "Closed"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500"><span className="mr-1 inline-block h-3 w-3 rounded ring-2 ring-violet-400 align-middle" /> = changed by you</p>
          </Card>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="text-sm text-slate-600">
              <b className="text-slate-900">4. Your network:</b> {keepW.length} warehouses · {keepD.length} stores · {changedRoads.length} road(s) changed
              {isDefault && <span className="ml-2 text-slate-400">(same as the full network)</span>}
            </div>
            <button className="btn-primary" disabled={!canRun} onClick={() => void run()}>
              <Play size={15} aria-hidden /> {p.running ? "Planning…" : "Run plan with this network"}
            </button>
          </div>

          {p.run && !p.running && <Result run={p.run} fullRun={p.fullRun} routes={routesQ.data ?? []} />}
        </>
      )}
    </div>
  );
}

function Result({ run, fullRun, routes }: { run: Run; fullRun: Run | null; routes: Route[] }) {
  const { net, whName } = useNetwork(run.module);
  const k = run.optimizer?.kpis;
  if (!k || !net) return null;
  const keptW = new Set(run.network?.summary.warehouses_kept ?? net.warehouses.map((w) => w.warehouse_id));
  const keptD = new Set(run.network?.summary.outlets_kept ?? net.outlets.map((o) => o.outlet_id));
  const ov = run.network?.edit.route_overrides ?? {};
  const W = net.warehouses.filter((w) => keptW.has(w.warehouse_id));
  const O = net.outlets.filter((o) => keptD.has(o.outlet_id));
  const pos = (id: string): [number, number] | null => {
    const x = net.warehouses.find((w) => w.warehouse_id === id) ?? net.outlets.find((o) => o.outlet_id === id);
    return x ? [x.lat, x.lon] : null;
  };
  const flows: Record<string, { w: string; d: string; qty: number }> = {};
  for (const ln of run.optimizer!.lines) {
    const key = `${ln.warehouse_id}-${ln.outlet_id}`;
    flows[key] = flows[key] ?? { w: ln.warehouse_id, d: ln.outlet_id, qty: 0 };
    flows[key].qty += ln.qty;
  }
  const maxQty = Math.max(1, ...Object.values(flows).map((f) => f.qty));
  const closed = routes.filter((r) => keptW.has(r.warehouse_id) && keptD.has(r.outlet_id) && !(ov[r.route_id] ?? r.open));
  const fill = (d: string) => k.by_outlet[d]?.fill_rate;
  const color = (f: number | undefined) => (f === undefined ? "#94a3b8" : f >= 0.95 ? "#16a34a" : f >= 0.8 ? "#f59e0b" : "#e11d48");
  const fullyServed = O.filter((o) => (fill(o.outlet_id) ?? 0) >= 0.999).length;
  const isFull = !run.network;
  const diff = fullRun && !isFull ? (k.fill_rate - (fullRun.optimizer?.kpis.fill_rate ?? 0)) * 100 : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Result {isFull ? "(full network)" : "with your network"}</h2>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Orders delivered" icon={Truck} tone="blue" value={fmtPct(k.fill_rate, 0)}
          trend={diff === null ? null : { text: `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}% vs full network (${fmtPct(fullRun!.optimizer!.kpis.fill_rate, 0)})`, good: diff >= 0 }} />
        <StatCard label="Short" icon={Ban} tone="red" value={`${fmtInt(k.unmet_units)} units`} />
        <StatCard label="Stores fully supplied" icon={Store} tone="green" value={`${fullyServed} of ${O.length}`} />
        <StatCard label="Delivery cost" icon={Truck} tone="amber" value={fmtRs(k.transport_cost)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <div className="h-[460px] overflow-hidden rounded-2xl">
            <MapContainer center={[19.3, 76.2]} zoom={6.4} zoomSnap={0.2} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {closed.map((r) => {
                const a = pos(r.warehouse_id), b = pos(r.outlet_id);
                return a && b ? (
                  <Polyline key={`c${r.route_id}`} positions={[a, b]} pathOptions={{ color: "#e11d48", weight: 1.5, opacity: 0.5, dashArray: "4 6" }}>
                    <LTooltip sticky>Closed road: {whName(r.warehouse_id)} → {r.outlet_id}</LTooltip>
                  </Polyline>
                ) : null;
              })}
              {Object.values(flows).map((f) => {
                const a = pos(f.w), b = pos(f.d);
                return a && b ? (
                  <Polyline key={`f${f.w}${f.d}`} positions={[a, b]} pathOptions={{ color: "#2563eb", weight: 1.5 + 6 * (f.qty / maxQty), opacity: 0.6 }}>
                    <LTooltip sticky>{whName(f.w)} → {f.d}: {fmtInt(f.qty)} units</LTooltip>
                  </Polyline>
                ) : null;
              })}
              {O.map((o) => (
                <CircleMarker key={o.outlet_id} center={[o.lat, o.lon]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: color(fill(o.outlet_id)), fillOpacity: 1 }}>
                  <LTooltip>{o.name}: {fmtPct(fill(o.outlet_id), 0)} supplied</LTooltip>
                </CircleMarker>
              ))}
              {W.map((w) => (
                <CircleMarker key={w.warehouse_id} center={[w.lat, w.lon]} radius={11} pathOptions={{ color: "#0f172a", weight: 3, fillColor: "#0f172a", fillOpacity: 1 }}>
                  <LTooltip permanent direction="right" offset={[10, 0]}>{w.warehouse_id}</LTooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div className="flex flex-wrap gap-4 px-5 py-3 text-xs text-slate-600">
            <span><span className="mr-1 inline-block h-0.5 w-5 bg-primary-500 align-middle" />delivery (thicker = more)</span>
            <span><span className="mr-1 inline-block w-5 border-t-2 border-dashed border-rose-500 align-middle" />closed road</span>
            <span>● green = full · amber = most · red = short</span>
          </div>
        </Card>
        <Card title="Each store" bodyClass="max-h-[520px] overflow-y-auto">
          <ul className="space-y-3">
            {O.map((o) => {
              const f = fill(o.outlet_id);
              const from = Array.from(new Set(Object.values(flows).filter((x) => x.d === o.outlet_id).map((x) => whName(x.w))));
              return (
                <li key={o.outlet_id}>
                  <div className="flex justify-between text-sm"><span className="font-medium text-slate-800">{o.name}</span><span className="tabular-nums font-semibold">{fmtPct(f, 0)}</span></div>
                  <ProgressBar value={f ?? 0} />
                  <div className="mt-0.5 text-xs text-slate-400">{from.length ? `from ${from.join(", ")}` : "nothing can reach it"}</div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      {run.network && (
        <div className="flex flex-wrap gap-2 text-xs">
          {run.network.summary.warehouses_removed.length > 0 && <Pill tone="gray">Removed warehouses: {run.network.summary.warehouses_removed.join(", ")}</Pill>}
          {run.network.summary.outlets_removed.length > 0 && <Pill tone="gray">Left out stores: {run.network.summary.outlets_removed.length}</Pill>}
          {run.network.summary.roads_closed.length > 0 && <Pill tone="red">You closed: {run.network.summary.roads_closed.join(", ")}</Pill>}
          {run.network.summary.roads_opened.length > 0 && <Pill tone="green">You opened: {run.network.summary.roads_opened.join(", ")}</Pill>}
        </div>
      )}
    </div>
  );
}
