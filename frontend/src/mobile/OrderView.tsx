import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Info, Loader2, Navigation, PackageSearch, Route as RouteIcon, ShieldCheck, Siren } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { RouteMap } from "../components/RouteMap";
import { ErrorBox, Notice, Pill, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { RouteMode, SourceResult } from "../types/api";
import { cx, fmtInt, fmtRs } from "../utils/format";
import { usePref } from "./mobileUtils";

const hm = (m: number) => { const t = Math.round(Math.abs(m)); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")} min`; };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const MODES: { value: RouteMode; label: string; icon: typeof Clock }[] = [
  { value: "flexible", label: "Time doesn't matter", icon: RouteIcon },
  { value: "deadline", label: "Time matters", icon: Clock },
  { value: "emergency", label: "Emergency", icon: Siren },
];
const ADVICE = { ok: ["bg-emerald-50 text-emerald-800", CheckCircle2], info: ["bg-sky-50 text-sky-800", Info],
  warning: ["bg-amber-50 text-amber-800", AlertTriangle], flag: ["bg-rose-50 text-rose-800", AlertTriangle] } as const;

/**
 * Field app "Order" tab: a store needs N units - the server finds warehouses with usable stock, splits the order by
 * mode and returns the path. Same API as the website's Order stock tab, laid out for a phone.
 */
export default function OrderView() {
  const p = usePlanner();
  const run = p.run;
  const { net } = useNetwork(p.module);
  const products = useAsync(() => api.products(p.module), [p.module]);
  const [store, setStore] = usePref(`order.store.${p.module}`);
  const [product, setProduct] = usePref(`order.product.${p.module}`);
  const [qty, setQty] = useState(100);
  const [mode, setMode] = useState<RouteMode>("flexible");
  const [deadline, setDeadline] = useState(() => localInput(new Date(Date.now() + 6 * 3600_000)));
  const [deadlineType, setDeadlineType] = useState<"mandatory" | "preferred">("mandatory");
  const [onTop, setOnTop] = useState(true);
  const [res, setRes] = useState<SourceResult | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showStock, setShowStock] = useState(false);

  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = (net?.warehouses ?? []).filter((w) => !keptW || keptW.has(w.warehouse_id));
  const O = (net?.outlets ?? []).filter((o) => !keptD || keptD.has(o.outlet_id));
  const prods = products.data ?? [];
  const storeId = O.some((o) => o.outlet_id === store) ? store : O[0]?.outlet_id ?? "";
  const productId = prods.some((x) => x.product_id === product) ? product
    : (prods.find((x) => x.storage_class === "ambient") ?? prods[0])?.product_id ?? "";

  useEffect(() => {
    if (!run?.optimizer || run.chaos || !storeId || !productId || !(qty > 0)) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = (await api.sourceOrder({
          module: p.module, plan_id: run.plan_id, outlet_id: storeId, product_id: productId, quantity: Math.round(qty),
          on_top_of_plan: onTop, mode, dispatch_at: new Date().toISOString(),
          deadline_at: mode === "deadline" ? new Date(deadline).toISOString() : null, deadline_type: deadlineType,
        })).data;
        if (!live) return;
        setRes(r);
        setSel(r.recommended ?? r.options[0]?.kind ?? null);
      } catch (e) {
        if (live) { setRes(null); setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e))); }
      } finally {
        if (live) setBusy(false);
      }
    }, 450);
    return () => { live = false; window.clearTimeout(t); };
  }, [run?.plan_id, p.module, storeId, productId, qty, onTop, mode, deadline, deadlineType]); // eslint-disable-line react-hooks/exhaustive-deps

  const opt = useMemo(() => res?.options.find((o) => o.kind === sel) ?? null, [res, sel]);
  const labels = useMemo(() => Object.fromEntries((res?.warehouses ?? []).filter((w) => w.allocated).map((w) => [w.warehouse_id, `sends ${w.allocated}`])), [res]);

  if (!run) return p.running ? <Spinner label="Loading this week's plan…" /> : <div className="p-4"><Notice>No delivery plan yet for this week.</Notice></div>;
  if (run.chaos) return <div className="p-4"><Notice tone="warn">A disaster simulation is open on the dashboard. Reset it to order stock against the real plan.</Notice></div>;
  if (!net) return <Spinner />;

  return (
    <div className="space-y-3 p-3">
      <section className="space-y-2.5 rounded-2xl bg-white p-3 shadow-card">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><PackageSearch size={16} aria-hidden />What does the store need?</h2>
        <select aria-label="Store" className="input w-full" value={storeId} onChange={(e) => setStore(e.target.value)}>
          {O.map((o) => <option key={o.outlet_id} value={o.outlet_id}>{o.name} ({o.city})</option>)}
        </select>
        <select aria-label="Product" className="input w-full" value={productId} onChange={(e) => setProduct(e.target.value)}>
          {prods.map((x) => <option key={x.product_id} value={x.product_id}>{x.name}{x.storage_class !== "ambient" ? " (cold)" : ""}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input aria-label="Units needed" type="number" inputMode="numeric" min={1} className="input w-28" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          <span className="text-sm text-slate-500">units</span>
          {[50, 100, 250].map((n) => (
            <button key={n} type="button" onClick={() => setQty(n)} className={cx("rounded-lg px-2 py-1 text-xs font-medium", qty === n ? "bg-primary-500 text-white" : "bg-slate-100 text-slate-600")}>{n}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="How much does time matter?">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)}
              className={cx("flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium leading-tight",
                mode === m.value ? (m.value === "emergency" ? "border-rose-400 bg-rose-50 text-rose-700" : "border-primary-400 bg-primary-50 text-primary-700") : "border-slate-200 text-slate-600")}>
              <m.icon size={16} aria-hidden />{m.label}
            </button>
          ))}
        </div>
        {mode === "deadline" && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-2">
            <label className="block text-xs text-slate-600">Deliver by
              <input type="datetime-local" className="input mt-1 w-full" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <div className="flex gap-3 text-xs">
              {(["mandatory", "preferred"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1"><input type="radio" name="m-dl" checked={deadlineType === t} onChange={() => setDeadlineType(t)} />{t === "mandatory" ? "Mandatory" : "Preferred"}</label>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-start gap-2 text-[11px] text-slate-500">
          <input type="checkbox" className="mt-0.5" checked={onTop} onChange={(e) => setOnTop(e.target.checked)} />
          On top of this week's plan (untick to plan this order on its own)
        </label>
      </section>

      {busy && <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" aria-hidden />Finding stock and the best path…</p>}
      <ErrorBox error={error} />

      {res && (
        <>
          <section className={cx("rounded-2xl p-3 shadow-card", res.shortfall ? "bg-rose-50" : "bg-emerald-50")}>
            <div className="flex items-center justify-between">
              <span className="text-xl font-extrabold text-slate-900">{fmtInt(res.fulfilled)} / {fmtInt(res.requested)}</span>
              {res.shortfall ? <Pill tone="red">{fmtInt(res.shortfall)} short</Pill> : <Pill tone="green">fully covered</Pill>}
            </div>
            <p className="text-xs text-slate-600">{res.product.name} → {res.outlet.name}</p>
            {opt && <p className="mt-1 text-sm text-slate-800">Arrives in about <b>{hm(opt.total_min)}</b> · {fmtInt(opt.distance_km)} km{opt.cost != null ? ` · ${fmtRs(opt.cost)}` : ""}</p>}
            {res.allocation.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {res.warehouses.filter((w) => w.allocated).map((w) => <Pill key={w.warehouse_id} tone="blue">{w.allocated} from {w.name}</Pill>)}
              </div>
            )}
          </section>

          {opt && (
            <div className="overflow-hidden rounded-2xl bg-white shadow-card">
              <RouteMap height={260} warehouses={W} outlets={O} stops={opt.order} urgent={new Set()} onToggle={() => undefined}
                candidates={res.options} selected={opt} labels={labels} />
            </div>
          )}

          {res.options.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {res.options.map((o) => (
                <button key={o.kind} type="button" onClick={() => setSel(o.kind)}
                  className={cx("rounded-xl border-2 p-2 text-left", o.kind === sel ? "border-primary-500 bg-white" : "border-transparent bg-white/70")}>
                  <div className="text-xs font-semibold text-slate-900">{o.label}</div>
                  <div className="text-[11px] text-slate-500">{hm(o.total_min)} · {fmtInt(o.distance_km)} km</div>
                  <div className="mt-1 flex gap-1">
                    {o.recommended && <Pill tone="green">best</Pill>}
                    {o.deadline && <Pill tone={o.deadline.met ? "green" : "red"}>{o.deadline.met ? "on time" : "late"}</Pill>}
                  </div>
                </button>
              ))}
            </div>
          )}

          <ul className="space-y-1.5">
            {res.advice.map((a, i) => {
              const [cls, Icon] = ADVICE[a.level];
              return <li key={i} className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-xs", cls)}><Icon size={14} className="mt-0.5 shrink-0" aria-hidden />{a.text}</li>;
            })}
          </ul>
          {res.check && <p className={cx("flex items-center gap-1.5 px-1 text-[11px]", res.check.valid ? "text-emerald-700" : "text-rose-700")}><ShieldCheck size={13} aria-hidden />Independent checker: {res.check.valid ? "all rules pass" : "rule violations found"}</p>}

          {opt && (
            <section className="rounded-2xl bg-white p-3 shadow-card">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Navigation size={15} aria-hidden />Directions · {opt.label}</h3>
              <ol>
                {opt.timeline.map((s, i) => (
                  <li key={s.stop} className="relative pl-8">
                    <span className={cx("absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold text-white", s.kind === "warehouse" ? "bg-slate-900" : "bg-primary-500")}>{s.letter}</span>
                    <div className="text-sm font-medium text-slate-900">{s.name}</div>
                    <div className="text-[11px] text-slate-500">{i === 0 ? "Leave" : "Arrive"} {when(s.arrive_at)}{s.units ? ` · ${s.kind === "warehouse" ? "load" : "unload"} ${fmtInt(s.units)}` : ""}</div>
                    {i < opt.legs.length && opt.kind !== "parallel" && (
                      <div className="my-1.5 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                        <span className="inline-block text-sm leading-none" style={{ transform: `rotate(${opt.legs[i].bearing_deg}deg)` }} aria-hidden>↑</span>
                        Head {opt.legs[i].direction} · {opt.legs[i].distance_km} km · ~{hm(opt.legs[i].drive_min)}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {opt.kind === "parallel" && (
                <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                  {opt.legs.map((lg) => <li key={`${lg.from}-${lg.to}`}>Truck {lg.from_name} → {lg.to_name}: head {lg.direction}, {lg.distance_km} km, ~{hm(lg.drive_min)}</li>)}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-2xl bg-white shadow-card">
            <button type="button" className="flex w-full items-center justify-between p-3 text-sm font-semibold text-slate-900" onClick={() => setShowStock((v) => !v)} aria-expanded={showStock}>
              Stock in each warehouse <ChevronDown size={16} className={cx("text-slate-400 transition", showStock && "rotate-180")} aria-hidden />
            </button>
            {showStock && (
              <ul className="divide-y divide-slate-100 px-3 pb-2 text-xs">
                {res.warehouses.map((w) => (
                  <li key={w.warehouse_id} className={cx("flex items-center justify-between py-2", w.allocated > 0 && "font-semibold")}>
                    <span>{w.name}<span className="block font-normal text-slate-400">{fmtInt(w.distance_km)} km · {hm(w.direct_min)}</span></span>
                    <span className="text-right">{fmtInt(w.eligible_units)} usable<span className="block font-normal text-slate-400">{fmtInt(w.total_units)} in stock</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="px-1 text-center text-[10px] text-slate-400">Distances are straight-line estimates (no road data); time assumes {res.assumptions.speed_kmh} km/h. Synthetic sample data.</p>
        </>
      )}
    </div>
  );
}
