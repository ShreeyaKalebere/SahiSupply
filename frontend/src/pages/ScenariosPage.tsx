import { CloudLightning } from "lucide-react";
import { Badge, Card, Delta, Kpi, Notice, PageHeader, Spinner } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { ScenarioId } from "../types/api";
import { cx, fmtInt, fmtPct, fmtRs } from "../utils/format";

export default function ScenariosPage() {
  const p = usePlanner();
  const run = p.run;
  const diff = p.scenarioDiff;
  const showing = run && run.scenario_id !== "S0" && diff;
  return (
    <div className="space-y-3">
      <PageHeader title="Scenario simulator"
        description="Each scenario applies an explicit change to the base data, then recomputes need, eligibility, both plans, the checker and KPIs. The changed lines are diffed against a fresh S0 plan on the same settings." />
      <div className="grid gap-3 md:grid-cols-5">
        {p.scenarios.map((s) => (
          <button key={s.id} disabled={p.running} onClick={() => void p.runPlan({ scenario: s.id as ScenarioId })}
            className={cx("rounded-lg border bg-white p-3 text-left hover:border-brand-500 disabled:opacity-60",
              run?.scenario_id === s.id ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200")}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{s.id} · {s.name}</span>
              {s.priority === "P1" && <Badge color="violet">P1</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.change}</p>
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600"><CloudLightning size={12} aria-hidden /> Run</div>
          </button>
        ))}
      </div>
      {p.running && <Spinner label="Re-planning under the scenario…" />}
      {run && (
        <Card title={`Assumptions - ${run.scenario_id} ${run.scenario.name}`}>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-slate-700">
            {run.scenario.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          {Object.keys(run.scenario.changes ?? {}).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(run.scenario.changes, null, 1)}</pre>
          )}
        </Card>
      )}
      {showing && run.optimizer && (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <Kpi label="Fill rate" value={fmtPct(run.optimizer.kpis.fill_rate)} sub={<>vs S0 <Delta value={diff.kpi_delta.fill_rate * 100} format={(n) => `${n.toFixed(1)} pp`} goodWhen="up" /></>} />
            <Kpi label="Unmet units" value={fmtInt(run.optimizer.kpis.unmet_units)} sub={<>vs S0 <Delta value={diff.kpi_delta.unmet_units} format={fmtInt} goodWhen="down" /></>} />
            <Kpi label="Transport cost" value={fmtRs(run.optimizer.kpis.transport_cost)} sub={<>vs S0 <Delta value={diff.kpi_delta.transport_cost} format={(n) => fmtRs(n)} goodWhen="down" /></>} />
            <Kpi label="Critical short" value={fmtInt(run.optimizer.kpis.critical_shortage_units)} sub={<>vs S0 <Delta value={diff.kpi_delta.critical_shortage_units} format={fmtInt} goodWhen="down" /></>} />
            <Kpi label="vs baseline (same scenario)" value={<Delta value={run.comparison!.fill_rate_pp} format={(n) => `${n.toFixed(1)} pp`} goodWhen="up" />} sub="fill-rate difference" />
          </div>
          {run.regret && !run.regret.error && (
            <Card title="Disruption regret (P1)" subtitle={run.regret.method}>
              <div className="mb-3 grid gap-3 md:grid-cols-4">
                <Kpi label="Regret" value={`${run.regret.regret_pp.toFixed(1)} pp`} sub="re-optimized − applied S0 plan" />
                <Kpi label="Applied S0 plan fill" value={fmtPct(run.regret.applied_fill_rate)} sub={`${fmtInt(run.regret.adjustments.removed_units)} removed, ${fmtInt(run.regret.adjustments.trimmed_units)} trimmed`} />
                <Kpi label="Re-optimized fill" value={fmtPct(run.regret.reoptimized_fill_rate)} />
                <Kpi label="Residual shortfall" value={fmtInt(run.regret.residual_shortfall_units)} sub="re-planning cannot close this" />
              </div>
              <table className="tbl">
                <thead><tr><th>Region</th><th className="num">Need</th><th className="num">Applied S0</th><th className="num">Re-optimized</th><th className="num">Regret</th><th className="num">Residual shortfall</th></tr></thead>
                <tbody>
                  {Object.entries(run.regret.by_region).map(([r, v]) => (
                    <tr key={r}><td>{r}</td><td className="num">{fmtInt(v.need_units)}</td><td className="num">{fmtPct(v.applied_fill_rate)}</td>
                      <td className="num">{fmtPct(v.reoptimized_fill_rate)}</td><td className="num">{v.regret_pp.toFixed(1)} pp</td><td className="num">{fmtInt(v.residual_shortfall_units)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card title={`${diff.changed_count} lines changed vs S0`} bodyClass="p-0">
            <div className="max-h-[50vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Destination</th><th>Product</th><th className="num">Need S0 → now</th><th className="num">Allocated S0 → now</th><th className="num">Unmet S0 → now</th><th>Sources S0 → now</th></tr></thead>
                <tbody>
                  {diff.changed_rows.map((r) => (
                    <tr key={`${r.outlet_id}${r.product_id}`}>
                      <td><div className="font-medium">{r.outlet_name}</div><div className="text-[11px] text-slate-500">{r.region}</div></td>
                      <td>{r.product_name}</td>
                      <td className="num">{r.s0_required} → {r.scenario_required}</td>
                      <td className="num">{r.s0_allocated} → {r.scenario_allocated}</td>
                      <td className={cx("num", r.scenario_unmet > r.s0_unmet && "text-red-700 font-medium")}>{r.s0_unmet} → {r.scenario_unmet}</td>
                      <td className="text-xs">{r.s0_sources.join(", ") || "—"} → {r.scenario_sources.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {run && run.scenario_id !== "S0" && !diff && <Notice>This run was restored from history; re-run the scenario to see the line-level diff against S0.</Notice>}
    </div>
  );
}
