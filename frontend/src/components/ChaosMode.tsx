import { AlertTriangle, Loader2, RotateCcw, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { ChaosKind, ChaosResult, Kpis } from "../types/api";
import { fmtInt, fmtPct, fmtRs } from "../utils/format";
import { shipmentId } from "../utils/labels";
import { closedRoadsFor, flowsFromLines, NetworkMap } from "./NetworkMap";
import { Card, ErrorBox, Notice, Pill } from "./ui";

const KINDS: { kind: ChaosKind; label: string; needs: "warehouse" | "route" | "region" | null; hint: string }[] = [
  { kind: "warehouse_offline", label: "Warehouse suddenly goes offline", needs: "warehouse", hint: "None of its stock can ship this cycle." },
  { kind: "demand_surge", label: "Demand increases by 50%", needs: "region", hint: "Forecast and open orders x1.5 for every product." },
  { kind: "road_closed", label: "Major road becomes unavailable", needs: "route", hint: "Busiest roads in the current plan are listed first." },
  { kind: "supplier_delay", label: "Supplier shipment is delayed", needs: "warehouse", hint: "Simulated: the newest third of that warehouse's batches arrive after this week." },
  { kind: "fuel_cost", label: "Fuel / transport costs increase by 30%", needs: null, hint: "Every road's cost per litre x1.3." },
];

export const SIM_LABEL = "Controlled simulation on synthetic data - not real-time disruption detection.";

/** The prominent dashboard button plus the disaster picker. */
export function ChaosLauncher() {
  const p = usePlanner();
  const base = p.chaos?.before ?? p.run;
  const { net, whName, storeName } = useNetwork(p.module);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChaosKind>("warehouse_offline");
  const [warehouse, setWarehouse] = useState("");
  const [route, setRoute] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const keptW = base?.network ? new Set(base.network.summary.warehouses_kept) : null;
  const closedW = new Set(((base?.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? []);
  const warehouses = (net?.warehouses ?? []).filter((w) => (!keptW || keptW.has(w.warehouse_id)) && !closedW.has(w.warehouse_id) && w.status !== "closed");
  const regions = Array.from(new Set((net?.outlets ?? []).map((o) => o.region))).sort();
  const roads = useMemo(() => (base?.optimizer ? flowsFromLines(base.optimizer.lines) : []).sort((a, b) => b.qty - a.qty), [base]);
  const spec = KINDS.find((k) => k.kind === kind)!;

  if (!base?.optimizer) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.chaosRun({
        module: base.module, scenario_id: base.scenario_id, rule_toggles: base.rule_toggles, contested_pattern: base.contested_pattern,
        include_insights: false, network: base.network?.edit ?? null, before_plan_id: base.plan_id,
        chaos: {
          kind, warehouse_id: spec.needs === "warehouse" ? warehouse || warehouses[0]?.warehouse_id : null,
          route_id: spec.needs === "route" ? route || (roads[0] ? `${roads[0].w}-${roads[0].d}` : null) : null,
          region: spec.needs === "region" ? region || null : null,
        },
      });
      p.startChaos(r.data);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 px-5 py-3 text-sm font-extrabold tracking-wide text-white shadow-lg shadow-rose-500/30 transition hover:scale-[1.02] hover:shadow-rose-500/50">
        <Zap size={18} aria-hidden className="fill-yellow-300 text-yellow-300" /> SIMULATE DISASTER
      </button>
      {open && (
        <div className="fixed inset-0 z-[1300] grid place-items-center bg-slate-900/50 p-4" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-label="Simulate disaster" className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><Zap size={18} className="text-rose-600" aria-hidden />Chaos Mode - break the supply chain</h2>
                <p className="text-xs text-slate-500">{SIM_LABEL} Your current plan is kept and can be restored.</p>
              </div>
              <button type="button" className="text-slate-400 hover:text-slate-700" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
            </header>
            <div className="space-y-4 px-5 py-4">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold uppercase text-slate-500">Disaster</legend>
                {KINDS.map((k) => (
                  <label key={k.kind} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${kind === k.kind ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}>
                    <input type="radio" name="chaos-kind" className="mt-1" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                    <span><span className="block text-sm font-medium text-slate-900">{k.label}</span><span className="block text-xs text-slate-500">{k.hint}</span></span>
                  </label>
                ))}
              </fieldset>
              {spec.needs === "warehouse" && (
                <label className="block text-sm">Affected warehouse
                  <select className="input mt-1 w-full" value={warehouse || warehouses[0]?.warehouse_id || ""} onChange={(e) => setWarehouse(e.target.value)}>
                    {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_id} · {w.name}</option>)}
                  </select>
                </label>
              )}
              {spec.needs === "route" && (
                <label className="block text-sm">Road to close
                  <select className="input mt-1 w-full" value={route || (roads[0] ? `${roads[0].w}-${roads[0].d}` : "")} onChange={(e) => setRoute(e.target.value)}>
                    {roads.map((f) => <option key={`${f.w}-${f.d}`} value={`${f.w}-${f.d}`}>{whName(f.w)} → {storeName(f.d)} ({fmtInt(f.qty)} units)</option>)}
                  </select>
                </label>
              )}
              {spec.needs === "region" && (
                <label className="block text-sm">Where
                  <select className="input mt-1 w-full" value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">Whole network</option>
                    {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              )}
              <ErrorBox error={error} />
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary bg-rose-600 hover:bg-rose-700" onClick={run} disabled={busy}>
                {busy ? <><Loader2 size={15} className="animate-spin" aria-hidden />Re-planning…</> : <><Zap size={15} aria-hidden />Unleash it</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

const KPI_ROWS: { key: keyof Kpis; label: string; fmt: (n: number) => string; good: "up" | "down" }[] = [
  { key: "fill_rate", label: "Needs delivered", fmt: (n) => fmtPct(n, 1), good: "up" },
  { key: "unmet_units", label: "Units short", fmt: fmtInt, good: "down" },
  { key: "critical_shortage_units", label: "Critical units short", fmt: fmtInt, good: "down" },
  { key: "transport_cost", label: "Delivery cost", fmt: (n) => fmtRs(n), good: "down" },
  { key: "expiry_risk_units", label: "Stock at expiry risk", fmt: fmtInt, good: "down" },
];

/** Results of the active simulation: KPIs, explanation, shortages, changed allocations and the map. */
export function ChaosReport({ result }: { result: ChaosResult }) {
  const p = usePlanner();
  const { net, whName } = useNetwork(p.module);
  const routes = useAsync(() => api.routes(result.after.module, result.after.contested_pattern), [result.after.plan_id]);
  const im = result.impact;
  const req = result.requirements;
  const after = result.after;
  const flows = after.optimizer ? flowsFromLines(after.optimizer.lines) : [];
  const lost = (im?.lost_lanes ?? []).map((l) => ({ w: l.warehouse_id, d: l.outlet_id, qty: l.qty }));
  const alt = (im?.new_lanes ?? []).map((l) => shipmentId(l.warehouse_id, l.outlet_id));
  const keptW = after.network ? new Set(after.network.summary.warehouses_kept) : null;
  const keptD = after.network ? new Set(after.network.summary.outlets_kept) : null;
  const closedW = [...(((after.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? []), ...result.chaos.offline_warehouses];
  const fill = Object.fromEntries(Object.entries(after.optimizer?.kpis.by_outlet ?? {}).map(([d, v]) => [d, v.fill_rate]));

  return (
    <Card title={`⚡ Disaster simulation: ${result.chaos.label}`}
      subtitle={SIM_LABEL} icon={AlertTriangle}
      actions={<button type="button" className="btn-primary" onClick={p.resetChaos}><RotateCcw size={15} aria-hidden />Reset Scenario</button>}>
      <div className="space-y-4">
        <Notice tone="warn">Every page now shows the simulated plan. <b>Reset Scenario</b> restores your original plan ({result.before.plan_id}); stored data was not changed.</Notice>
        {!req.feasible && <Notice tone="danger"><b>No feasible plan.</b> {req.message} Solver status: {req.solver_status ?? "unknown"}.</Notice>}
        {req.feasible && req.checker_valid === false && <Notice tone="danger">The independent checker rejected the simulated plan ({req.violations?.length ?? 0} violation(s)); it is not a valid recovery.</Notice>}

        {im && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="tbl" aria-label="Before and after KPIs">
                <thead><tr><th>KPI</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th></tr></thead>
                <tbody>
                  {KPI_ROWS.map((k) => {
                    const b = im.kpis_before[k.key] as number, a = im.kpis_after[k.key] as number;
                    const d = a - b;
                    const worse = k.good === "up" ? d < -1e-9 : d > 1e-9;
                    return (
                      <tr key={k.key}><td>{k.label}</td><td className="num">{k.fmt(b)}</td><td className="num font-semibold">{k.fmt(a)}</td>
                        <td className={`num ${Math.abs(d) < 1e-9 ? "text-slate-400" : worse ? "text-rose-600" : "text-emerald-600"}`}>
                          {Math.abs(d) < 1e-9 ? "—" : `${d > 0 ? "+" : "−"}${k.fmt(Math.abs(d))}`}</td></tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Pill tone="violet">{im.affected_outlets.length} destinations affected</Pill>
                <Pill tone="amber">{im.delayed_deliveries.length} delayed deliveries</Pill>
                <Pill tone="red">{im.newly_short.length} orders newly short</Pill>
                <Pill tone="blue">{im.diff.changed_count} allocations changed</Pill>
                <Pill tone="green">{im.new_lanes.length} alternative connections</Pill>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">How the optimizer responded</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{im.explanation.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          </div>
        )}

        {net && (
          <NetworkMap height={420} flows={flows} lostFlows={lost} altShipments={alt} fillByOutlet={fill} closedWarehouses={closedW}
            closedRoads={closedRoadsFor(after, routes.data ?? [])}
            warehouses={net.warehouses.filter((w) => !keptW || keptW.has(w.warehouse_id))}
            outlets={net.outlets.filter((o) => !keptD || keptD.has(o.outlet_id))} />
        )}

        {req.feasible && (req.top_shortages?.length ?? 0) > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Remaining shortages ({fmtInt(req.unmet_units)} units, {req.short_orders} orders{req.below_fill_floor ? `, ${req.below_fill_floor} below the fill-rate floor` : ""})</h3>
            <div className="max-h-64 overflow-auto">
              <table className="tbl" aria-label="Remaining shortages">
                <thead><tr><th>Store</th><th>Product</th><th className="num">Needed</th><th className="num">Sending</th><th className="num">Short</th></tr></thead>
                <tbody>{req.top_shortages!.map((r) => (
                  <tr key={`${r.outlet_id}|${r.product_id}`}><td>{r.outlet_name}</td><td>{r.product_name}{r.criticality === "critical" && <Pill tone="red" className="ml-2">critical</Pill>}</td>
                    <td className="num">{fmtInt(r.required)}</td><td className="num">{fmtInt(r.allocated)}</td><td className="num font-semibold text-rose-600">{fmtInt(r.unmet)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {im && im.diff.changed_count > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Changed allocations ({im.diff.changed_count})</summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="tbl" aria-label="Changed allocations">
                <thead><tr><th>Store</th><th>Product</th><th className="num">Before</th><th className="num">After</th><th>From (before → after)</th></tr></thead>
                <tbody>{im.diff.changed_rows.map((r) => (
                  <tr key={`${r.outlet_id}|${r.product_id}`}><td>{r.outlet_name}</td><td>{r.product_name}</td>
                    <td className="num">{fmtInt(r.s0_allocated)}/{fmtInt(r.s0_required)}</td><td className="num">{fmtInt(r.scenario_allocated)}/{fmtInt(r.scenario_required)}</td>
                    <td className="text-xs text-slate-500">{uniqW(r.s0_sources).map(whName).join(", ") || "—"} → {uniqW(r.scenario_sources).map(whName).join(", ") || "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        )}
        {im && im.delayed_deliveries.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Delayed deliveries ({im.delayed_deliveries.length})</summary>
            <ul className="mt-2 space-y-0.5 text-sm text-slate-600">{im.delayed_deliveries.slice(0, 40).map((d, i) => (
              <li key={i}>{d.outlet_name} · {d.product_name}: {d.lead_before} → <b>{d.lead_after} days</b></li>
            ))}</ul>
          </details>
        )}
      </div>
    </Card>
  );
}

const uniqW = (sources: string[]) => Array.from(new Set(sources.map((s) => s.split(":")[0])));
