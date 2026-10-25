import { ArrowDown, ArrowUp, Clock, Flame, Loader2, Navigation, Route as RouteIcon, Siren, Trash2, Waypoints, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { RouteMap } from "../components/RouteMap";
import { Results } from "../components/RouteResults";
import { OrderSourcing } from "../components/OrderSourcing";
import { Card, Details, ErrorBox, Notice, PageHeader, Spinner, Tabs } from "../components/ui";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { RouteMode, RoutePlanResult } from "../types/api";
import { cx } from "../utils/format";

export const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const MODES: { value: RouteMode; label: string; icon: typeof Clock; hint: string }[] = [
  { value: "flexible", label: "Time doesn't matter", icon: RouteIcon, hint: "Cheapest planned cost, then shortest distance. Distance and time are still shown." },
  { value: "deadline", label: "Time matters", icon: Clock, hint: "Set a deadline. Options that miss a mandatory deadline are never recommended." },
  { value: "emergency", label: "Emergency", icon: Siren, hint: "Visit stops marked urgent first, where the roads allow." },
];

type PlannerTab = "order" | "connect";

export default function RoutePlannerPage() {
  const [tab, setTab] = useState<PlannerTab>("order");
  return (
    <div className="space-y-4">
      <PageHeader title="Route planner"
        description="Order stock and let SahiSupply find the warehouses and the path, or connect stops on the map yourself (A → B → C → D)." />
      <Tabs<PlannerTab> label="Route planner mode" value={tab} onChange={setTab} options={[
        { value: "order", label: "Order stock - system finds the path" }, { value: "connect", label: "Connect stops myself" }]} />
      {tab === "order" ? <OrderSourcing /> : <ManualRoutes />}
    </div>
  );
}

function ManualRoutes() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const run = p.run;
  const [stops, setStops] = useState<string[]>([]);
  const [urgent, setUrgent] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RouteMode>("flexible");
  const [dispatch, setDispatch] = useState(() => localInput(new Date()));
  const [deadline, setDeadline] = useState(() => localInput(new Date(Date.now() + 8 * 3600_000)));
  const [deadlineType, setDeadlineType] = useState<"mandatory" | "preferred">("mandatory");
  const [speed, setSpeed] = useState(40);
  const [loadMin, setLoadMin] = useState(30);
  const [unloadMin, setUnloadMin] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<RoutePlanResult | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = (net?.warehouses ?? []).filter((w) => !keptW || keptW.has(w.warehouse_id));
  const O = (net?.outlets ?? []).filter((o) => !keptD || keptD.has(o.outlet_id));
  const name = (id: string) => W.find((w) => w.warehouse_id === id)?.name ?? O.find((o) => o.outlet_id === id)?.name ?? id;
  const selected = useMemo(() => res?.candidates.find((c) => c.kind === sel) ?? null, [res, sel]);

  const changed = () => { setRes(null); setSel(null); setError(null); };
  const toggle = (id: string) => { changed(); setStops((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const move = (i: number, d: -1 | 1) => { changed(); setStops((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; }); };
  const flipUrgent = (id: string) => { changed(); setUrgent((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = (await api.planRoute({
        module: p.module, plan_id: run?.plan_id ?? null, contested_pattern: run?.contested_pattern ?? p.contested,
        stops: stops.map((id) => ({ id, urgent: urgent.has(id) })), mode,
        dispatch_at: new Date(dispatch).toISOString(), deadline_at: mode === "deadline" ? new Date(deadline).toISOString() : null,
        deadline_type: deadlineType, speed_kmh: speed, load_min: loadMin, unload_min: unloadMin,
      })).data;
      setRes(r);
      setSel(r.recommended ?? r.candidates[0]?.kind ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };

  if (!net) return <Spinner />;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-slate-500"><Waypoints size={15} aria-hidden />Connect locations on the map in the order the truck should visit them, choose how much time matters, then compare routes.</p>
      {!run && <Notice>No plan yet: routes still get distance and time, but units and cost need a plan (Run plan, top right).</Notice>}
      {run?.chaos && <Notice tone="warn">A disaster simulation is active, so routes use the simulated network (closed roads and warehouses).</Notice>}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <RouteMap warehouses={W} outlets={O} stops={stops} urgent={urgent} onToggle={toggle}
            candidates={res?.candidates ?? []} selected={selected} />
          <p className="px-5 py-3 text-xs text-slate-500">Click a warehouse (dark) or store (grey) to add it as the next stop; click again to remove it.
            Lines are straight between locations - not road routes.</p>
        </Card>

        <Card title="Your route" icon={Navigation}>
          <div className="space-y-4">
            {stops.length === 0 ? <p className="text-sm text-slate-500">Start by clicking the source on the map - usually a warehouse.</p> : (
              <ol className="space-y-1.5">
                {stops.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                    <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white", id.startsWith("W") ? "bg-slate-900" : "bg-primary-500")}>{String.fromCharCode(65 + i)}</span>
                    <span className="min-w-0 flex-1 truncate">{name(id)}<span className="ml-1 text-[10px] text-slate-400">{i === 0 ? "source" : i === stops.length - 1 ? "destination" : "stop"}</span></span>
                    {mode === "emergency" && !id.startsWith("W") && (
                      <button type="button" title="Mark urgent" aria-pressed={urgent.has(id)} onClick={() => flipUrgent(id)}
                        className={cx("rounded p-1", urgent.has(id) ? "bg-rose-100 text-rose-600" : "text-slate-400 hover:bg-slate-200")}><Flame size={14} /></button>
                    )}
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" aria-label="Remove" onClick={() => toggle(id)} className="rounded p-1 text-slate-400 hover:bg-slate-200"><X size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
            {stops.length > 0 && <button type="button" className="btn-link text-xs" onClick={() => { changed(); setStops([]); setUrgent(new Set()); }}><Trash2 size={12} />Clear route</button>}

            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase text-slate-500">How much does time matter?</legend>
              {MODES.map((m) => (
                <label key={m.value} className={cx("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2", mode === m.value ? "border-primary-400 bg-primary-50" : "border-slate-200")}>
                  <input type="radio" name="route-mode" className="mt-1" checked={mode === m.value} onChange={() => { changed(); setMode(m.value); }} />
                  <span><span className="flex items-center gap-1.5 text-sm font-medium text-slate-900"><m.icon size={14} aria-hidden />{m.label}</span>
                    <span className="block text-xs text-slate-500">{m.hint}</span></span>
                </label>
              ))}
            </fieldset>

            <label className="block text-sm">Truck leaves at
              <input type="datetime-local" className="input mt-1 w-full" value={dispatch} onChange={(e) => { changed(); setDispatch(e.target.value); }} />
            </label>
            {mode === "deadline" && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <label className="block text-sm">Deliver by
                  <input type="datetime-local" className="input mt-1 w-full" value={deadline} onChange={(e) => { changed(); setDeadline(e.target.value); }} />
                </label>
                <div className="flex gap-3 text-sm">
                  {(["mandatory", "preferred"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5"><input type="radio" name="dl-type" checked={deadlineType === t} onChange={() => { changed(); setDeadlineType(t); }} />{t === "mandatory" ? "Mandatory" : "Preferred"}</label>
                  ))}
                </div>
              </div>
            )}
            {mode === "emergency" && <p className="text-xs text-slate-500">Tap the flame next to a store to mark it urgent.</p>}

            <Details label="Assumptions (speed, loading time)">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label>Speed km/h<input type="number" min={5} max={120} className="input mt-1 w-full" value={speed} onChange={(e) => { changed(); setSpeed(Number(e.target.value) || 40); }} /></label>
                <label>Load min<input type="number" min={0} max={600} className="input mt-1 w-full" value={loadMin} onChange={(e) => { changed(); setLoadMin(Number(e.target.value)); }} /></label>
                <label>Unload min<input type="number" min={0} max={600} className="input mt-1 w-full" value={unloadMin} onChange={(e) => { changed(); setUnloadMin(Number(e.target.value)); }} /></label>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Plus 0.02 min handling per unit. No traffic data or rest breaks are modelled.</p>
            </Details>

            <button type="button" className="btn-primary w-full justify-center" disabled={stops.length < 2 || busy} onClick={plan}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RouteIcon size={15} aria-hidden />}Plan route
            </button>
            {stops.length < 2 && <p className="text-center text-xs text-slate-400">Connect at least a source and a destination.</p>}
            <ErrorBox error={error} />
          </div>
        </Card>
      </div>

      {res && <Results res={res} sel={sel} onSelect={setSel} />}
    </div>
  );
}

