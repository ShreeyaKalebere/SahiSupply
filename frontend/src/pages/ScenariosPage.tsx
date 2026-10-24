import { ArrowRight, CalendarCheck, CloudRain, PartyPopper, Snowflake, Warehouse, type LucideIcon } from "lucide-react";
import { LiveWeatherPanel } from "../components/LiveWeatherPanel";
import { Card, Details, PageHeader, Pill, Spinner } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { ScenarioId } from "../types/api";
import { cx, fmtInt, fmtPct, fmtRs } from "../utils/format";
import { SCENARIO_TEXT } from "../utils/labels";

const ICON: Record<ScenarioId, LucideIcon> = { S0: CalendarCheck, S1: PartyPopper, S2: Warehouse, S3: CloudRain, S4: Snowflake };

export default function ScenariosPage() {
  const p = usePlanner();
  const run = p.run;
  const diff = p.scenarioDiff;
  const showing = run && run.scenario_id !== "S0" && diff && run.optimizer;

  return (
    <div className="space-y-5">
      <PageHeader title="What-if" description="Pick a problem that could happen this week. SahiSupply re-plans everything and shows what changes." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(SCENARIO_TEXT) as ScenarioId[]).map((id) => {
          const Icon = ICON[id];
          const active = run?.scenario_id === id;
          return (
            <button key={id} disabled={p.running} onClick={() => void p.runPlan({ scenario: id })}
              className={cx("card flex flex-col items-start p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60",
                active && "ring-2 ring-primary-500")}>
              <span className={cx("grid h-10 w-10 place-items-center rounded-full", active ? "bg-primary-500 text-white" : "bg-primary-50 text-primary-500")}><Icon size={19} aria-hidden /></span>
              <span className="mt-3 text-sm font-semibold text-slate-900">{SCENARIO_TEXT[id].name}</span>
              <span className="mt-1 flex-1 text-xs text-slate-500">{SCENARIO_TEXT[id].text}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-500">{active ? "Showing now" : "Try it"} <ArrowRight size={13} aria-hidden /></span>
            </button>
          );
        })}
      </div>

      <LiveWeatherPanel />

      {p.running && <Spinner label="Re-planning for this situation…" />}

      {showing && (() => {
        const k = run.optimizer!.kpis;
        const s0 = diff.s0_kpis;
        const worse = diff.changed_rows.filter((r) => r.scenario_unmet > r.s0_unmet)
          .sort((a, b) => (b.scenario_unmet - b.s0_unmet) - (a.scenario_unmet - a.s0_unmet)).slice(0, 8);
        const vsManual = run.comparison?.fill_rate_pp ?? 0;
        return (
          <>
            <Card title={`What changes with "${SCENARIO_TEXT[run.scenario_id].name}"`}>
              <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-medium text-slate-500">Normal week</div>
                  <div className="mt-1 text-3xl font-bold text-slate-900">{fmtPct(s0.fill_rate, 0)}</div>
                  <div className="text-xs text-slate-500">orders delivered · {fmtInt(s0.unmet_units)} units short</div>
                </div>
                <ArrowRight className="mx-auto hidden text-slate-300 md:block" size={28} aria-hidden />
                <div className="rounded-xl bg-violet-50 p-4">
                  <div className="text-xs font-medium text-violet-700">{SCENARIO_TEXT[run.scenario_id].name}</div>
                  <div className="mt-1 text-3xl font-bold text-slate-900">{fmtPct(k.fill_rate, 0)}</div>
                  <div className="text-xs text-slate-500">orders delivered · {fmtInt(k.unmet_units)} units short</div>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
                <li>• {diff.changed_count} store orders were re-routed or changed.</li>
                <li>• Delivery cost {diff.kpi_delta.transport_cost >= 0 ? "goes up" : "goes down"} by {fmtRs(Math.abs(diff.kpi_delta.transport_cost))}.</li>
                {k.critical_need_units > 0 && <li>• Critical medicines short: {fmtInt(s0.critical_shortage_units)} → {fmtInt(k.critical_shortage_units)} units.</li>}
                <li>• Even in this situation, our plan delivers <b>{vsManual >= 0 ? `${vsManual.toFixed(0)}% more` : `${Math.abs(vsManual).toFixed(0)}% less`}</b> than manual planning would.</li>
                {run.regret && !run.regret.error && <li>• Re-planning helps: keeping last week's plan unchanged would deliver only {fmtPct(run.regret.applied_fill_rate, 0)}.</li>}
              </ul>
            </Card>

            <Card title="Stores hit the hardest" subtitle="Orders that get shorter because of this situation" bodyClass="px-2 pb-4 pt-3">
              {worse.length === 0 ? <p className="px-3 text-sm text-slate-500">No store order gets shorter - the plan absorbs it by re-routing.</p> : (
                <div className="overflow-x-auto"><table className="tbl min-w-[560px]">
                  <thead><tr><th>Store</th><th>Product</th><th className="num">Short before</th><th className="num">Short now</th><th>Area</th></tr></thead>
                  <tbody>
                    {worse.map((r) => (
                      <tr key={`${r.outlet_id}${r.product_id}`}>
                        <td className="font-medium text-slate-900">{r.outlet_name}</td><td>{r.product_name}</td>
                        <td className="num">{fmtInt(r.s0_unmet)}</td><td className="num font-semibold text-rose-600">{fmtInt(r.scenario_unmet)}</td>
                        <td><Pill>{r.region}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </Card>

            <Details label="Show technical details (assumptions, regret by region)">
              <ul className="list-inside list-disc">{run.scenario.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2">{JSON.stringify(run.scenario.changes, null, 1)}</pre>
              {run.regret && !run.regret.error && (
                <table className="tbl mt-2">
                  <thead><tr><th>Region</th><th className="num">Last week's plan</th><th className="num">Re-planned</th><th className="num">Still short</th></tr></thead>
                  <tbody>{Object.entries(run.regret.by_region).map(([r, v]) => (
                    <tr key={r}><td>{r}</td><td className="num">{fmtPct(v.applied_fill_rate)}</td><td className="num">{fmtPct(v.reoptimized_fill_rate)}</td><td className="num">{fmtInt(v.residual_shortfall_units)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Details>
          </>
        );
      })()}
      {run && run.scenario_id !== "S0" && !diff && !p.running && (
        <p className="text-sm text-slate-500">Click the highlighted card again to see what changed compared with a normal week.</p>
      )}
    </div>
  );
}
