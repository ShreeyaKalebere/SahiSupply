import { BrainCircuit, Clock, HeartPulse, IndianRupee, Lightbulb, Package, PackageCheck, PackageX, Play, Route, ShieldCheck, ShoppingCart, Truck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ChaosLauncher, ChaosReport } from "../components/ChaosMode";
import { DeliveryTable } from "../components/DeliveryTable";
import { useDeliveries } from "../hooks/useDeliveries";
import { ExplanationDrawer } from "../components/ExplanationDrawer";
import { PlanTechDetails, RuleCheckBadge } from "../components/PlanStatus";
import { Card, Donut, ErrorBox, Pill, ProgressBar, StatCard } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { Run } from "../types/api";
import { fmtDate, fmtInt, fmtPct, fmtRs } from "../utils/format";
import { DELIVERY_ORDER, DELIVERY_TEXT, greeting, uniqueInsights, lineStatus, MODULE_LABEL, SCENARIO_TEXT, STATUS_TEXT, STORE_WORD } from "../utils/labels";

export default function OverviewPage() {
  const p = usePlanner();
  const dash = useAsync(() => api.dashboard(p.module, p.contested), [p.module, p.contested]);
  const risks = useAsync(() => api.risks(p.module, p.contested), [p.module, p.contested]);
  const d = dash.data;
  const name = MODULE_LABEL[p.module] ?? p.module;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{greeting()}</p>
          <h1 className="text-2xl font-bold text-slate-900">{name} dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your weekly delivery plan for {STORE_WORD[p.module] ?? "your stores"}{d ? `, week of ${fmtDate(d.planning_date)}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {p.run && <RuleCheckBadge run={p.run} />}
          <ChaosLauncher />
        </div>
      </div>
      <ErrorBox error={dash.error} onRetry={dash.reload} />
      {p.chaos && <ChaosReport result={p.chaos} />}

      {p.run?.optimizer ? <PlanSummary run={p.run} /> : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Stock in warehouses" icon={Package} tone="blue" value={d ? `${fmtInt(d.total_inventory_units)} units` : "…"} hint={d ? `${d.batches} batches in ${d.warehouses} warehouses` : undefined} />
            <StatCard label="Ready to ship" icon={PackageCheck} tone="green" value={d ? `${fmtInt(d.eligible_inventory_units)} units` : "…"} hint="fresh enough and allowed to ship" />
            <StatCard label={d?.need_source === "orders" ? "Store orders this week" : "Expected demand (7 days)"} icon={ShoppingCart} tone="violet"
              value={d ? `${fmtInt(d.need_source === "orders" ? d.open_order_units : d.forecast_demand_units)} units` : "…"} hint={d ? `from ${d.outlets} stores` : undefined} />
            <StatCard label="Stock expiring soon" icon={Clock} tone="amber" value={d ? `${fmtInt(d.expiry_risk_units)} units` : "…"} hint={d ? `in ${d.expiry_risk_batches} batches` : undefined} />
          </div>
          <FirstRun />
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Expiring soon" subtitle="Batches to move first" icon={Clock} className="xl:col-span-2"
          actions={<span className="flex gap-3"><Link to="/rescue" className="btn-link">♻️ Expiry rescue</Link><Link to="/inventory" className="btn-link">See all stock</Link></span>}>
          {risks.loading && !risks.data ? <p className="text-sm text-slate-400">Loading…</p> : (
            <ul className="divide-y divide-slate-100">
              {(risks.data?.expiry_risk ?? []).slice(0, 5).map((r) => (
                <li key={r.batch_id} className="flex items-center gap-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Package size={18} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{r.product_name}</div>
                    <div className="text-xs text-slate-500">{fmtInt(r.quantity)} units at {r.warehouse_name} · expires {fmtDate(r.expiry_date)}</div>
                  </div>
                  <div className="w-36">
                    <div className="mb-1 text-right text-xs font-semibold text-slate-700">{r.days_to_expiry} days left</div>
                    <ProgressBar value={r.remaining_life_pct / 100} />
                  </div>
                </li>
              ))}
              {risks.data && risks.data.expiry_risk.length === 0 && <li className="py-3 text-sm text-slate-500">Nothing is close to expiring.</li>}
            </ul>
          )}
        </Card>
        <SuggestionsPreview run={p.run} />
      </div>
    </div>
  );
}

/** Lower is better: green arrow only when strictly better, red when worse, plain hint on a tie. */
function vsManual(ours: number, manual: number) {
  if (ours === manual) return { hint: "same as manual planning" };
  return { trend: { text: `manual planning: ${fmtInt(manual)} units`, good: ours < manual } };
}

function PlanSummary({ run }: { run: Run }) {
  const { whName } = useNetwork(run.module);
  const [open, setOpen] = useState<string | null>(null);
  const k = run.optimizer!.kpis;
  const b = run.baseline.kpis;
  const pp = (k.fill_rate - b.fill_rate) * 100;
  const counts = { full: 0, partial: 0, none: 0 };
  run.allocation.forEach((r) => { counts[lineStatus(r)] += 1; });
  const attention = run.allocation.filter((r) => r.unmet > 0).sort((a, c) =>
    (c.criticality === "critical" ? 1 : 0) - (a.criticality === "critical" ? 1 : 0) || c.unmet - a.unmet).slice(0, 6);
  const shortLines = counts.partial + counts.none;
  const isPharma = k.critical_need_units > 0;
  const exp = open ? run.explanations.find((e) => `${e.outlet_id}|${e.product_id}` === open) : null;

  return (
    <>
      {run.scenario_id !== "S0" && (
        <div className="rounded-xl bg-violet-50 px-4 py-2 text-sm text-violet-700">Showing the <b>{SCENARIO_TEXT[run.scenario_id].name}</b> what-if. {SCENARIO_TEXT[run.scenario_id].text}</div>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Orders delivered" icon={Truck} tone="blue" value={fmtPct(k.fill_rate, 0)}
          trend={{ text: `${pp >= 0 ? "+" : ""}${pp.toFixed(0)}% vs manual planning (${fmtPct(b.fill_rate, 0)})`, good: pp >= 0 }}
          hint={`${fmtInt(k.delivered_units)} of ${fmtInt(k.need_units)} units`} />
        <StatCard label="Short this week" icon={PackageX} tone="red" value={`${fmtInt(k.unmet_units)} units`}
          hint={`${shortLines} of ${run.allocation.length} store orders not fully sent`} />
        {isPharma ? (
          <StatCard label="Critical medicines short" icon={HeartPulse} tone="amber" value={`${fmtInt(k.critical_shortage_units)} units`}
            {...vsManual(k.critical_shortage_units, b.critical_shortage_units)} />
        ) : (
          <StatCard label="Stock expiring soon" icon={Clock} tone="amber" value={`${fmtInt(k.expiry_risk_units)} units`}
            {...vsManual(k.expiry_risk_units, b.expiry_risk_units)} />
        )}
        <StatCard label="Delivery cost" icon={IndianRupee} tone="green" value={fmtRs(k.transport_cost)} hint={`${fmtRs(k.cost_per_delivered_unit, 2)} per unit delivered`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Needs your attention" subtitle="Store orders we can't fully send" icon={PackageX} className="xl:col-span-2" bodyClass="px-2 pb-3 pt-3"
          actions={<Link to="/planner" className="btn-secondary">See full plan</Link>}>
          {attention.length ? (
            <DeliveryTable rows={attention} whName={whName} label="Orders needing attention"
              onOpen={(r) => setOpen(`${r.outlet_id}|${r.product_id}`)} />
          ) : <p className="px-3 text-sm text-slate-500">Every store order is fully covered.</p>}
          <p className="px-3 pt-2 text-xs text-slate-400">Click a row to see why.</p>
        </Card>
        <Card title="Plan health" subtitle={`${run.allocation.length} store orders this week`} icon={ShieldCheck}>
          <Donut center={fmtPct(k.fill_rate, 0)} centerSub="delivered"
            data={(["full", "partial", "none"] as const).map((s) => ({ label: STATUS_TEXT[s].label, value: counts[s], color: STATUS_TEXT[s].color }))} />
          <DeliveryProgress />
          <div className="mt-4"><PlanTechDetails run={run} /></div>
        </Card>
      </div>
      {exp && <ExplanationDrawer run={run} exp={exp} onClose={() => setOpen(null)} />}
    </>
  );
}

function FirstRun() {
  const p = usePlanner();
  const steps = [
    { icon: BrainCircuit, t: "Predict", d: "Estimate what every store needs this week." },
    { icon: Route, t: "Plan", d: "Pick the best warehouse and batch for each delivery." },
    { icon: ShieldCheck, t: "Check", d: "Re-verify expiry, fridges, stock and truck space." },
  ];
  return (
    <div className="card flex flex-col items-center gap-5 p-8 text-center">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Make this week's plan</h2>
        <p className="mt-1 text-sm text-slate-500">One click. Takes a few seconds.</p>
      </div>
      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.t} className="rounded-xl bg-slate-50 p-4">
            <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-primary-500 text-white"><s.icon size={17} aria-hidden /></span>
            <div className="mt-2 text-sm font-semibold">{s.t}</div>
            <div className="text-xs text-slate-500">{s.d}</div>
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={() => void p.runPlan()} disabled={p.running}><Play size={15} aria-hidden /> {p.running ? "Planning…" : "Make this week's plan"}</button>
    </div>
  );
}

function SuggestionsPreview({ run }: { run: Run | null }) {
  const { whName } = useNetwork(usePlanner().module);
  const items = uniqueInsights(run?.insights?.items ?? [], whName).slice(0, 3);
  return (
    <Card title="Smart suggestions" subtitle="Small changes with the biggest effect" icon={Lightbulb}
      actions={items.length > 0 && <Link to="/insights" className="btn-link">See all</Link>}>
      {!run && <p className="text-sm text-slate-500">Make a plan to get suggestions.</p>}
      {run && items.length === 0 && <p className="text-sm text-slate-500">No suggestions this week - nothing small would help much.</p>}
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={`${it.kind}${it.key}`} className="rounded-xl border border-slate-100 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-primary-50 text-xs text-primary-600">{i + 1}</span>
              {it.label}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {it.critical_units_avoided_total > 0 ? `${fmtInt(it.critical_units_avoided_total)} fewer critical shortages` : `${fmtInt(it.extra_units_delivered)} more units delivered`}
              {it.net_margin_total > 0.01 && ` · ₹${fmtInt(it.net_margin_total)} more margin`}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Truck trips by delivery status (same data as the delivery table and map). */
function DeliveryProgress() {
  const d = useDeliveries();
  const ships = Object.values(d.byId);
  if (d.error) return <p className="mt-4 text-xs text-rose-600">Delivery status unavailable: {d.error.message}</p>;
  if (!ships.length) return d.loading ? <p className="mt-4 text-xs text-slate-400">Loading delivery status…</p> : null;
  const n = (s: (typeof DELIVERY_ORDER)[number]) => ships.filter((x) => x.status === s).length;
  return (
    <div className="mt-4" aria-label="Delivery progress">
      <div className="mb-2 text-xs font-medium text-slate-500">Truck trips ({ships.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {DELIVERY_ORDER.map((s) => (
          <Pill key={s} tone={DELIVERY_TEXT[s].tone}>{DELIVERY_TEXT[s].label} · {n(s)}</Pill>
        ))}
      </div>
    </div>
  );
}
