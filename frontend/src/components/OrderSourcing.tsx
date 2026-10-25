import { Clock, Loader2, PackageSearch, Route as RouteIcon, Siren, Store, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { RouteMode, RoutePlanResult, SourceResult } from "../types/api";
import { cx, fmtInt } from "../utils/format";
import { RouteMap } from "./RouteMap";
import { Results } from "./RouteResults";
import { Card, ErrorBox, Notice, Pill, Spinner } from "./ui";

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const hm = (m: number) => { const t = Math.round(Math.abs(m)); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")} min`; };

const MODES: { value: RouteMode; label: string; icon: typeof Clock; hint: string }[] = [
  { value: "flexible", label: "Time doesn't matter", icon: RouteIcon, hint: "Cheapest planned lane cost from warehouses that have the stock; fewest trucks." },
  { value: "deadline", label: "Time matters", icon: Clock, hint: "Only warehouses that can reach the store by your deadline (mandatory), or late ones as a last resort (preferred)." },
  { value: "emergency", label: "Emergency", icon: Siren, hint: "Fastest warehouses first - may split the order to get it there sooner." },
];

const BLOCK_TEXT: Record<string, string> = {
  MIN_LIFE: "too close to expiry for the rules", EXPIRED: "expires before arrival", STORAGE: "store can't keep this cold",
  ROUTE_CLOSED: "road closed", NO_ROUTE: "no road", WAREHOUSE_CLOSED: "warehouse closed",
};

/**
 * "A store needs N units": the shop owner picks the product and quantity, and the system finds which warehouses
 * actually have usable stock (after this week's plan), splits the order by the chosen mode, and builds the path.
 */
export function OrderSourcing() {
  const p = usePlanner();
  const run = p.run;
  const { net } = useNetwork(p.module);
  const products = useAsync(() => api.products(p.module), [p.module]);
  const [store, setStore] = useState("");
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState(100);
  const [onTop, setOnTop] = useState(true);
  const [mode, setMode] = useState<RouteMode>("flexible");
  const [dispatch, setDispatch] = useState(() => localInput(new Date()));
  const [deadline, setDeadline] = useState(() => localInput(new Date(Date.now() + 6 * 3600_000)));
  const [deadlineType, setDeadlineType] = useState<"mandatory" | "preferred">("mandatory");
  const [res, setRes] = useState<SourceResult | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = (net?.warehouses ?? []).filter((w) => !keptW || keptW.has(w.warehouse_id));
  const O = (net?.outlets ?? []).filter((o) => !keptD || keptD.has(o.outlet_id));
  const prods = products.data ?? [];
  const storeId = store || O[0]?.outlet_id || "";
  const productId = product || prods[0]?.product_id || "";

  // Recalculate automatically whenever the order changes (debounced).
  useEffect(() => {
    if (!run?.optimizer || !storeId || !productId || !(qty > 0)) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = (await api.sourceOrder({
          module: p.module, plan_id: run.plan_id, outlet_id: storeId, product_id: productId, quantity: Math.round(qty),
          on_top_of_plan: onTop, mode, dispatch_at: new Date(dispatch).toISOString(),
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
  }, [run?.plan_id, p.module, storeId, productId, qty, onTop, mode, dispatch, deadline, deadlineType]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => res?.options.find((o) => o.kind === sel) ?? null, [res, sel]);
  const labels = useMemo(() => Object.fromEntries((res?.warehouses ?? []).map((w) => [w.warehouse_id,
    w.allocated ? `sending ${w.allocated}` : `${w.eligible_units} usable`])), [res]);
  const asPlan: RoutePlanResult | null = res && {
    mode: res.mode, candidates: res.options, recommended: res.recommended, plan_id: res.plan_id, stops: [],
    advice: res.advice, check: res.check, assumptions: res.assumptions, data_notes: res.data_notes,
  };

  if (!run?.optimizer) return <Notice>Make this week's plan first (Run plan, top right): availability is worked out from the plan.</Notice>;
  if (!net) return <Spinner />;
  return (
    <div className="space-y-4">
      {run.chaos && <Notice tone="warn">A disaster simulation is active, so availability uses the simulated network.</Notice>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <RouteMap warehouses={W} outlets={O} stops={selected?.order ?? [storeId]} urgent={new Set()} onToggle={(id) => { if (id.startsWith("D")) setStore(id); }}
            candidates={res?.options ?? []} selected={selected} labels={labels} />
          <p className="px-5 py-3 text-xs text-slate-500">Click a store on the map to order for it. Warehouse labels show usable units for this product. Lines are straight - not road routes.</p>
        </Card>

        <Card title="What does the store need?" icon={PackageSearch}>
          <div className="space-y-3">
            <label className="block text-sm"><span className="flex items-center gap-1.5"><Store size={14} aria-hidden />Store</span>
              <select className="input mt-1 w-full" value={storeId} onChange={(e) => setStore(e.target.value)}>
                {O.map((o) => <option key={o.outlet_id} value={o.outlet_id}>{o.name} ({o.city})</option>)}
              </select>
            </label>
            <label className="block text-sm">Product
              <select className="input mt-1 w-full" value={productId} onChange={(e) => setProduct(e.target.value)}>
                {prods.map((x) => <option key={x.product_id} value={x.product_id}>{x.name}{x.storage_class !== "ambient" ? " (cold)" : ""}</option>)}
              </select>
            </label>
            <label className="block text-sm">Units needed
              <input type="number" min={1} className="input mt-1 w-full" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase text-slate-500">How much does time matter?</legend>
              {MODES.map((m) => (
                <label key={m.value} className={cx("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2", mode === m.value ? "border-primary-400 bg-primary-50" : "border-slate-200")}>
                  <input type="radio" name="order-mode" className="mt-1" checked={mode === m.value} onChange={() => setMode(m.value)} />
                  <span><span className="flex items-center gap-1.5 text-sm font-medium text-slate-900"><m.icon size={14} aria-hidden />{m.label}</span>
                    <span className="block text-xs text-slate-500">{m.hint}</span></span>
                </label>
              ))}
            </fieldset>
            <label className="block text-sm">Truck leaves at
              <input type="datetime-local" className="input mt-1 w-full" value={dispatch} onChange={(e) => setDispatch(e.target.value)} />
            </label>
            {mode === "deadline" && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <label className="block text-sm">Deliver by
                  <input type="datetime-local" className="input mt-1 w-full" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </label>
                <div className="flex gap-3 text-sm">
                  {(["mandatory", "preferred"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5"><input type="radio" name="order-dl" checked={deadlineType === t} onChange={() => setDeadlineType(t)} />{t === "mandatory" ? "Mandatory" : "Preferred"}</label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={onTop} onChange={(e) => setOnTop(e.target.checked)} />
              <span><b>On top of this week's plan</b> - use only stock and store space left after the planned deliveries. Untick to plan this order on its own.</span>
            </label>
            {busy && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" aria-hidden />Finding stock and the best path…</p>}
            <ErrorBox error={error} />
          </div>
        </Card>
      </div>

      {res && (
        <>
          <div className={cx("flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-5 py-4 shadow-card", res.shortfall ? "bg-rose-50" : "bg-emerald-50")}>
            <span className="text-lg font-bold text-slate-900">{fmtInt(res.fulfilled)} / {fmtInt(res.requested)} units</span>
            <span className="text-sm text-slate-700">{res.product.name} → {res.outlet.name}</span>
            {res.shortfall > 0 ? <Pill tone="red">{fmtInt(res.shortfall)} units short</Pill> : <Pill tone="green">fully covered</Pill>}
            {res.options.find((o) => o.recommended) && <span className="text-sm text-slate-700">Arrives in about <b>{hm(res.options.find((o) => o.recommended)!.total_min)}</b></span>}
          </div>

          <Card title="Stock in each warehouse for this order" icon={Warehouse} bodyClass="px-2 pb-3 pt-3">
            <div className="overflow-x-auto">
              <table className="tbl min-w-[900px]" aria-label="Warehouse availability">
                <thead><tr><th>Warehouse</th><th className="num">In stock</th><th className="num">{res.on_top_of_plan ? "In this week's plan" : "Planned (ignored)"}</th><th className="num">Usable for this store</th><th>Not usable</th><th className="num">Distance</th><th className="num">Direct trip</th><th className="num">Sending</th></tr></thead>
                <tbody>
                  {res.warehouses.map((w) => (
                    <tr key={w.warehouse_id} className={w.allocated ? "bg-emerald-50" : ""}>
                      <td className="font-medium text-slate-900">{w.warehouse_id} · {w.name}{w.status !== "operational" && <Pill tone="red" className="ml-2">{w.status}</Pill>}</td>
                      <td className="num">{fmtInt(w.total_units)}</td><td className="num">{fmtInt(w.committed_units)}</td>
                      <td className="num font-semibold">{fmtInt(w.eligible_units)}</td>
                      <td className="text-xs text-slate-500">{Object.entries(w.blocked).map(([k, v]) => `${fmtInt(v)} ${BLOCK_TEXT[k] ?? k.toLowerCase()}`).join("; ") || "—"}</td>
                      <td className="num">{fmtInt(w.distance_km)} km</td><td className="num">{hm(w.direct_min)}</td>
                      <td className="num font-bold text-emerald-700">{w.allocated ? fmtInt(w.allocated) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-3 pt-2 text-xs text-slate-500">Store space left this week: {res.store_capacity.receiving_left_l} L{res.store_capacity.cold_left_l != null ? ` (cold: ${res.store_capacity.cold_left_l} L)` : ""} · {res.product.unit_volume_l} L per unit.</p>
          </Card>

          {res.options.length > 0 && asPlan ? <Results res={asPlan} sel={sel} onSelect={setSel} /> : (
            <Card title="What this means">
              <ul className="space-y-2 text-sm">{res.advice.map((a, i) => <li key={i} className={cx("rounded-lg px-3 py-2", a.level === "flag" ? "bg-rose-50 text-rose-800" : "bg-sky-50 text-sky-800")}>{a.text}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
