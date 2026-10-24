import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShieldCheck, Trophy } from "lucide-react";
import { api, ApiError } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { Card, Details, ErrorBox, Notice, PageHeader, Pill, Spinner } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { Evaluation, Run } from "../types/api";
import { CHART } from "../utils/chart";
import { fmtInt, fmtPct, fmtRs, shortHash } from "../utils/format";

export default function ComparisonPage() {
  return (
    <div>
      <PageHeader title="Our plan vs. manual planning"
        description="Manual planning = how a planner with a spreadsheet would split stock, one warehouse at a time, biggest orders first. Both plans use exactly the same stock, orders and rules." />
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const opt = run.optimizer;
  if (!opt || !run.comparison) return <Notice tone="danger">No plan to compare.</Notice>;
  const k = opt.kpis, b = run.baseline.kpis, bi = run.comparison.business_impact;
  const rows: { label: string; ours: string; manual: string; better: boolean | null }[] = [
    { label: "Orders delivered", ours: fmtPct(k.fill_rate, 0), manual: fmtPct(b.fill_rate, 0), better: k.fill_rate > b.fill_rate + 1e-9 ? true : k.fill_rate < b.fill_rate - 1e-9 ? false : null },
    { label: "Units short", ours: fmtInt(k.unmet_units), manual: fmtInt(b.unmet_units), better: k.unmet_units < b.unmet_units ? true : k.unmet_units > b.unmet_units ? false : null },
    ...(k.critical_need_units > 0 ? [{ label: "Critical medicines short", ours: fmtInt(k.critical_shortage_units), manual: fmtInt(b.critical_shortage_units),
      better: k.critical_shortage_units < b.critical_shortage_units ? true : k.critical_shortage_units > b.critical_shortage_units ? false : null }] : []),
    { label: "Stock left to expire", ours: fmtInt(k.expiry_risk_units), manual: fmtInt(b.expiry_risk_units), better: k.expiry_risk_units < b.expiry_risk_units ? true : k.expiry_risk_units > b.expiry_risk_units ? false : null },
    { label: "Delivery cost per unit", ours: fmtRs(k.cost_per_delivered_unit, 2), manual: fmtRs(b.cost_per_delivered_unit, 2), better: k.cost_per_delivered_unit < b.cost_per_delivered_unit - 1e-9 ? true : k.cost_per_delivered_unit > b.cost_per_delivered_unit + 1e-9 ? false : null },
  ];
  const chart = Object.entries(k.by_region).map(([region, r]) => ({ region, "Our plan": Math.round(r.fill_rate * 100), "Manual planning": Math.round((b.by_region[region]?.fill_rate ?? 0) * 100) }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="card p-5">
            <div className="text-sm font-medium text-slate-600">{r.label}</div>
            <div className="mt-2 flex items-end justify-between">
              <div><div className="text-xs text-slate-400">Our plan</div><div className="text-2xl font-bold text-slate-900">{r.ours}</div></div>
              <div className="text-right"><div className="text-xs text-slate-400">Manual</div><div className="text-lg font-semibold text-slate-500">{r.manual}</div></div>
            </div>
            <div className="mt-3">{r.better === true ? <Pill tone="green"><Trophy size={12} aria-hidden /> Our plan is better</Pill>
              : r.better === false ? <Pill tone="amber">Manual is better here</Pill> : <Pill>Same</Pill>}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Orders delivered, by area" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="region" tick={{ fontSize: 12, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => `${v}%`} cursor={{ fill: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Our plan" fill={CHART.opt} radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Bar dataKey="Manual planning" fill={CHART.base} radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="What this is worth (sample prices)">
          <div className="text-3xl font-bold text-emerald-600">{fmtRs(bi.net_weekly_benefit)}</div>
          <div className="text-sm text-slate-500">estimated extra value this week</div>
          <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
            <li>+ {fmtRs(bi.lost_margin_avoided)} fewer lost sales</li>
            <li>+ {fmtRs(bi.waste_avoided)} less waste</li>
            <li>{bi.delta_delivery_cost >= 0 ? "−" : "+"} {fmtRs(Math.abs(bi.delta_delivery_cost))} {bi.delta_delivery_cost >= 0 ? "extra" : "lower"} delivery cost</li>
            {bi.critical_units_gained !== 0 && <li>{bi.critical_units_gained > 0 ? "+" : ""}{fmtInt(bi.critical_units_gained)} more critical medicine units delivered</li>}
          </ul>
        </Card>
      </div>

      {run.rules_off && (
        <Card title="What your rules protect you from" icon={ShieldCheck}>
          <p className="text-sm text-slate-700">
            Without the expiry and storage rules, <b className="text-rose-600">{fmtInt(run.rules_off.kpis.blocked_units_shipped)} units</b> would have been sent that are too close to
            expiry or need a fridge the store doesn't have. With the rules on, that number is <b className="text-emerald-600">0</b>.
          </p>
        </Card>
      )}

      <Details label="Show technical details (fairness, all scenarios)">
        <p>Both plans share data fingerprint <span className="font-mono">{shortHash(run.fairness.fingerprint)}</span>; optimizer checker {opt.check.valid ? "valid" : "INVALID"}, manual plan checker {run.baseline.check.valid ? "valid" : "INVALID"}.</p>
        <p className="mt-1">{bi.note}</p>
        {run.equity && <p className="mt-1">Fair-share rule cost: {fmtRs(run.equity.cost_of_fairness, 2)} delivery cost; stores below the floor {run.equity.below_floor_off.length} → {run.equity.below_floor_on.length}.</p>}
        <div className="mt-3"><FairEvaluation /></div>
      </Details>
    </div>
  );
}

function FairEvaluation() {
  const p = usePlanner();
  const [data, setData] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = async () => {
    setBusy(true); setErr(null);
    try { setData((await api.evaluation(p.module)).data); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  const shown = data && data.module === p.module ? data : null;
  return (
    <div className="space-y-2">
      <button className="btn-secondary" onClick={() => void load()} disabled={busy}>{busy ? "Comparing 16 plans…" : "Compare across all what-ifs (pattern on & off)"}</button>
      <ErrorBox error={err} />
      {busy && !shown && <Spinner />}
      {shown && (
        <table className="tbl">
          <thead><tr><th>What-if</th><th>Contested pattern</th><th className="num">Manual</th><th className="num">Our plan</th><th className="num">Difference</th><th>Checks</th></tr></thead>
          <tbody>{shown.rows.map((r) => (
            <tr key={`${r.scenario_id}${r.contested_pattern}`}><td>{r.scenario_id}</td><td>{r.contested_pattern ? "on" : "off"}</td>
              <td className="num">{fmtPct(r.baseline_fill_rate)}</td><td className="num">{fmtPct(r.optimizer_fill_rate)}</td>
              <td className="num">{r.fill_rate_pp >= 0 ? "+" : ""}{r.fill_rate_pp.toFixed(1)} pp</td><td>{r.optimizer_valid && r.baseline_valid ? "both valid" : "violation"}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
