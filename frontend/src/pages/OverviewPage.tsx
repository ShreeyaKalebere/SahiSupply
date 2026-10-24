import { AlertTriangle, Clock, PackageX } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { PlanMetaStrip } from "../components/PlanStatus";
import { Badge, Card, ErrorBox, Kpi, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { fmtInt, fmtPct, fmtRs } from "../utils/format";
import { CHART } from "../utils/chart";

export default function OverviewPage() {
  const p = usePlanner();
  const dash = useAsync(() => api.dashboard(p.module, p.contested), [p.module, p.contested]);
  const risks = useAsync(() => api.risks(p.module, p.contested), [p.module, p.contested]);
  const d = dash.data;
  const run = p.run;
  const k = run?.optimizer?.kpis;
  const regionData = k ? Object.entries(k.by_region).map(([region, r]) => ({
    region, Optimized: r.fill_rate * 100, Baseline: (run!.baseline.kpis.by_region[region]?.fill_rate ?? 0) * 100,
  })) : [];

  return (
    <div>
      <PageHeader title={`${p.currentModule?.display_name ?? ""} overview`}
        description={p.currentModule?.description} />
      <ErrorBox error={dash.error} onRetry={dash.reload} />
      {dash.loading && !d ? <Spinner /> : d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Eligible inventory" value={fmtInt(d.eligible_inventory_units)} sub={`of ${fmtInt(d.total_inventory_units)} units in ${d.batches} batches`} />
          <Kpi label="Forecast demand (7 d)" value={fmtInt(d.forecast_demand_units)} sub={d.forecast_model_label.split(" (")[0]} />
          <Kpi label={d.need_source === "orders" ? "Open orders" : "Required replenishment"}
            value={fmtInt(d.need_source === "orders" ? d.open_order_units : d.required_replenishment_units)}
            sub={d.need_source === "orders" ? "orders mode (rationing)" : "forecast-based net need"} />
          <Kpi label="Fill rate" value={k ? fmtPct(k.fill_rate) : "—"} tone={k ? (k.fill_rate >= 0.9 ? "good" : "warn") : "neutral"}
            sub={run ? `baseline ${fmtPct(run.baseline.kpis.fill_rate)}` : "run a plan"} />
          <Kpi label="Unmet demand" value={k ? fmtInt(k.unmet_units) : "—"} sub="units" />
          <Kpi label="Transport cost" value={k ? fmtRs(k.transport_cost) : "—"} sub={k ? `${fmtRs(k.cost_per_delivered_unit, 2)} / unit` : undefined} />
          <Kpi label="Expiry-risk units" value={k ? fmtInt(k.expiry_risk_units) : fmtInt(d.expiry_risk_units)}
            sub={k ? "left after plan" : `${d.expiry_risk_batches} batches flagged`} tone={(k?.expiry_risk_units ?? 0) > 0 ? "warn" : "neutral"} />
          <Kpi label="Critical shortage" value={k ? fmtInt(k.critical_shortage_units) : "—"}
            sub={k && k.critical_need_units ? `of ${fmtInt(k.critical_need_units)} critical units` : "no critical class"} tone={(k?.critical_shortage_units ?? 0) > 0 ? "bad" : "neutral"} />
        </div>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card title="Latest optimization run" className="xl:col-span-2"
          actions={run && <Link className="btn-secondary" to="/planner">Open planner</Link>}>
          {!run ? (
            <p className="text-sm text-slate-500">No plan yet - press <b>Run plan</b> in the header.</p>
          ) : (
            <div className="space-y-3">
              <PlanMetaStrip run={run} />
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={regionData} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="region" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} cursor={{ fill: "#f1f5f9" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Optimized" fill={CHART.opt} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="Baseline" fill={CHART.base} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500">Fill rate by region, optimized vs greedy baseline on identical data (fingerprint {run.fingerprint.slice(0, 10)}…).</p>
            </div>
          )}
        </Card>

        <Card title="Inventory risk alerts" subtitle="Before planning, from current stock and forecast">
          <ErrorBox error={risks.error} />
          {risks.loading && !risks.data ? <Spinner /> : risks.data && (
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><AlertTriangle size={14} className="text-status-critical" aria-hidden />
                <b>{risks.data.stockout_risk.length}</b> outlet-product pairs at stockout risk</li>
              <li className="flex items-center gap-2"><Clock size={14} className="text-status-serious" aria-hidden />
                <b>{risks.data.expiry_risk.length}</b> batches at expiry risk</li>
              <li className="flex items-center gap-2"><PackageX size={14} className="text-status-warning" aria-hidden />
                <b>{risks.data.supply_shortfall.length}</b> products with forecast need above eligible supply</li>
              <li className="border-t border-slate-100 pt-2 text-xs font-semibold uppercase text-slate-500">Top stockout risks</li>
              {risks.data.stockout_risk.slice(0, 5).map((r) => (
                <li key={`${r.outlet_id}${r.product_id}`} className="flex justify-between gap-2 text-xs">
                  <span>{r.outlet_name} · {r.product_name} {r.criticality === "critical" && <Badge color="red">critical</Badge>}</span>
                  <span className="tabular-nums text-slate-500">{r.usable_on_hand} on hand / {r.forecast_over_lead_time.toFixed(0)} needed</span>
                </li>
              ))}
              <li className="border-t border-slate-100 pt-2 text-xs font-semibold uppercase text-slate-500">Nearest expiry</li>
              {risks.data.expiry_risk.slice(0, 4).map((r) => (
                <li key={r.batch_id} className="flex justify-between gap-2 text-xs">
                  <span>{r.batch_id} · {r.product_name} @ {r.warehouse_id}</span>
                  <span className="tabular-nums text-slate-500">{r.days_to_expiry} d · {r.quantity} u</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
