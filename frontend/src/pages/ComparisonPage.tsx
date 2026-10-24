import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { Badge, Card, Delta, ErrorBox, Kpi, Notice, PageHeader, Spinner, ValidityBadge } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { Evaluation, Kpis, Run } from "../types/api";
import { CHART } from "../utils/chart";
import { fmtInt, fmtNum, fmtPct, fmtRs, shortHash } from "../utils/format";

type Row = { label: string; key: keyof Kpis; fmt: (n: number) => string; good: "up" | "down"; deltaFmt?: (n: number) => string };

const ROWS: Row[] = [
  { label: "Fill rate", key: "fill_rate", fmt: (n) => fmtPct(n), good: "up", deltaFmt: (n) => `${(n * 100).toFixed(1)} pp` },
  { label: "Delivered units", key: "delivered_units", fmt: fmtInt, good: "up" },
  { label: "Unmet demand (units)", key: "unmet_units", fmt: fmtInt, good: "down" },
  { label: "Transport cost", key: "transport_cost", fmt: (n) => fmtRs(n), good: "down" },
  { label: "Cost per delivered unit", key: "cost_per_delivered_unit", fmt: (n) => fmtRs(n, 2), good: "down" },
  { label: "Expiry-risk units", key: "expiry_risk_units", fmt: fmtInt, good: "down" },
  { label: "Critical shortage units", key: "critical_shortage_units", fmt: fmtInt, good: "down" },
  { label: "Freshness on arrival", key: "freshness_on_arrival_pct", fmt: (n) => `${fmtNum(n)}%`, good: "up" },
  { label: "Net margin (synthetic)", key: "net_margin", fmt: (n) => fmtRs(n), good: "up" },
  { label: "Blocked units shipped", key: "blocked_units_shipped", fmt: fmtInt, good: "down" },
];

export default function ComparisonPage() {
  return (
    <div>
      <PageHeader title="Baseline comparison"
        description="Greedy spreadsheet-style baseline vs batch-level optimizer, computed on identical inputs (same fingerprint, same rules). Differences are reported as measured - including where the optimizer is worse." />
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const opt = run.optimizer;
  const base = run.baseline;
  if (!opt) return <Notice tone="danger">No optimized plan in this run; only the baseline is available.</Notice>;
  const cmp = run.comparison!;
  const bi = cmp.business_impact;
  const chart = [
    { metric: "Fill rate %", Optimized: opt.kpis.fill_rate * 100, Baseline: base.kpis.fill_rate * 100 },
    ...(opt.kpis.critical_need_units ? [{ metric: "Critical fill %", Optimized: (opt.kpis.critical_fill_rate ?? 0) * 100, Baseline: (base.kpis.critical_fill_rate ?? 0) * 100 }] : []),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <Badge color="blue">Same data fingerprint: <span className="font-mono">{shortHash(run.fairness.fingerprint)}</span></Badge>
        <ValidityBadge valid={opt.check.valid} label={`Optimizer ${opt.check.valid ? "valid" : "INVALID"}`} />
        <ValidityBadge valid={base.check.valid} label={`Baseline ${base.check.valid ? "valid" : "INVALID"}`} />
        <span>{run.scenario_id} · {run.scenario.name} · contested pattern {run.contested_pattern ? "on" : "off"}</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card title="KPI comparison" className="xl:col-span-2" bodyClass="p-0">
          <table className="tbl">
            <thead><tr><th>KPI</th><th className="num">Greedy baseline</th><th className="num">Optimized</th><th className="num">Difference</th></tr></thead>
            <tbody>
              {ROWS.map((r) => {
                const a = opt.kpis[r.key] as number | null;
                const b = base.kpis[r.key] as number | null;
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num">{b == null ? "—" : r.fmt(b)}</td>
                    <td className="num font-medium text-slate-900">{a == null ? "—" : r.fmt(a)}</td>
                    <td className="num"><Delta value={a == null || b == null ? null : a - b} format={r.deltaFmt ?? r.fmt} goodWhen={r.good} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Fill rate, optimized vs baseline">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="metric" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} cursor={{ fill: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Optimized" fill={CHART.opt} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="Baseline" fill={CHART.base} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Kpi label="Lost margin avoided" value={fmtRs(bi.lost_margin_avoided)} sub="Δ short × margin × 0.40" />
        <Kpi label="Waste avoided" value={fmtRs(bi.waste_avoided)} sub="Δ expiry-risk × unit cost" />
        <Kpi label="Δ delivery cost" value={fmtRs(bi.delta_delivery_cost)} />
        <Kpi label="Net weekly benefit" value={fmtRs(bi.net_weekly_benefit)} tone={bi.net_weekly_benefit > 0 ? "good" : "bad"} sub="illustrative, synthetic prices" />
        <Kpi label="Critical units gained" value={fmtInt(bi.critical_units_gained)} sub="units, not rupees" tone={bi.critical_units_gained > 0 ? "good" : bi.critical_units_gained < 0 ? "bad" : "neutral"} />
      </div>
      <Notice>{bi.note}</Notice>

      <div className="grid gap-3 xl:grid-cols-2">
        {run.rules_off && (
          <Card title="Rules-off diagnostic (not the fair baseline)" subtitle={`Same optimizer with ${run.rules_off.disabled_rules.join(", ")} switched off`}>
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Blocked units shipped" value={fmtInt(run.rules_off.kpis.blocked_units_shipped)} tone="bad" sub="rules-on: 0" />
              <Kpi label="Fill rate (rules off)" value={fmtPct(run.rules_off.kpis.fill_rate)} />
              <Kpi label="Fill rate (rules on)" value={fmtPct(opt.kpis.fill_rate)} />
            </div>
            {run.rules_off.kpis.blocked_lines.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {run.rules_off.kpis.blocked_lines.slice(0, 5).map((b, i) => (
                  <li key={i}><b>{b.qty}</b> × {b.batch_id} → {b.outlet_id}: {b.reason}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">{run.rules_off.note}</p>
          </Card>
        )}
        {run.equity && (
          <Card title={`Equity guardrail (C4) - ${run.equity.floor_pct}% floor for ${run.equity.classes.join(", ")}`}>
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Cost of fairness" value={fmtRs(run.equity.cost_of_fairness, 2)} sub="delivery cost on − off" />
              <Kpi label="Below floor (on)" value={run.equity.below_floor_on.length} sub={`off: ${run.equity.below_floor_off.length}`} />
              <Kpi label="Critical short (on)" value={fmtInt(run.equity.critical_shortage_on)} sub={`off: ${fmtInt(run.equity.critical_shortage_off)}`} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{run.equity.note}</p>
          </Card>
        )}
      </div>
      <FairEvaluation />
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
    <Card title="Fair evaluation: S0-S3, contested-supply pattern on and off"
      subtitle="North-star: fill rate under disruption with zero violations, optimizer vs baseline on identical data"
      actions={<button className="btn-secondary" onClick={() => void load()} disabled={busy}>{busy ? "Solving 16 plans…" : shown ? "Recompute" : "Run evaluation"}</button>}>
      <ErrorBox error={err} />
      {busy && !shown && <Spinner label="Solving optimizer + baseline for 8 scenario/pattern combinations…" />}
      {!shown && !busy && <p className="text-sm text-slate-500">Runs S0-S3 with the pattern on and off and reports measured differences.</p>}
      {shown && (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <Badge color={shown.north_star.target_met ? "green" : "amber"}>Target ({shown.north_star.target}): {shown.north_star.target_met ? "met" : "not met"}</Badge>
            <Badge>pattern on: {shown.north_star.scenarios_meeting_target_pattern_on}/3 scenarios ≥ +5 pp</Badge>
            <Badge>pattern off: {shown.north_star.scenarios_meeting_target_pattern_off}/3</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Scenario</th><th>Pattern</th><th className="num">Baseline fill</th><th className="num">Optimized fill</th><th className="num">Δ pp</th>
                <th className="num">Critical short (base → opt)</th><th className="num">Cost/unit (base → opt)</th><th>Checker</th><th className="num">Solve</th></tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={`${r.scenario_id}${r.contested_pattern}`}>
                    <td>{r.scenario_id}</td><td>{r.contested_pattern ? "on" : "off"}</td>
                    <td className="num">{fmtPct(r.baseline_fill_rate)}</td><td className="num">{fmtPct(r.optimizer_fill_rate)}</td>
                    <td className="num"><Delta value={r.fill_rate_pp} format={(n) => n.toFixed(1)} goodWhen="up" /></td>
                    <td className="num">{fmtInt(r.baseline_critical_shortage)} → {fmtInt(r.optimizer_critical_shortage)}</td>
                    <td className="num">{fmtRs(r.baseline_cost_per_unit, 2)} → {fmtRs(r.optimizer_cost_per_unit, 2)}</td>
                    <td><ValidityBadge valid={r.optimizer_valid && r.baseline_valid} label={r.optimizer_valid && r.baseline_valid ? "both valid" : "violation"} /></td>
                    <td className="num">{r.solve_seconds.toFixed(2)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{shown.note}</p>
        </>
      )}
    </Card>
  );
}
