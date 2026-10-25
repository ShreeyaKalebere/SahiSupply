import { CheckCircle2, Loader2, Recycle } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { Card, ErrorBox, Notice, PageHeader, Pill, StatCard } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { Kpis, RescueBatch, RescueResult, Run } from "../types/api";
import { fmtDate, fmtInt, fmtPct, fmtRs } from "../utils/format";

export default function RescuePage() {
  return (
    <div>
      <PageHeader title="♻️ Expiry Rescue Mission"
        description="Find batches that will expire before the next delivery cycle and let the optimizer re-plan to ship them first, without breaking any demand, capacity, road, shelf-life or storage rule." />
      <RunRequired>{(run) => <RescueBody run={run} />}</RunRequired>
    </div>
  );
}

const URGENCY: Record<RescueBatch["urgency"], { tone: "red" | "amber" | "violet" | "gray"; label: string }> = {
  critical: { tone: "red", label: "≤ 3 days" }, high: { tone: "amber", label: "≤ 7 days" },
  medium: { tone: "violet", label: "next cycle" }, expired: { tone: "gray", label: "expired" },
};
const ACTION_TONE = { dispatch: "green", reallocate: "blue", transfer: "violet", write_off: "red", dispose: "gray" } as const;

function RescueBody({ run }: { run: Run }) {
  const p = usePlanner();
  const base = p.chaos?.before ?? run;
  const [res, setRes] = useState<RescueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [executed, setExecuted] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    setExecuted(null);
    try {
      const r = await api.rescueRun({
        module: base.module, scenario_id: base.scenario_id, rule_toggles: base.rule_toggles, contested_pattern: base.contested_pattern,
        include_insights: false, network: base.network?.edit ?? null, before_plan_id: base.rescue ? null : base.plan_id,
      });
      setRes(r.data);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };
  const execute = () => {
    if (!res) return;
    p.setRun(res.run);
    setExecuted(res.run.plan_id);
  };

  const s = res?.summary;
  return (
    <div className="space-y-4">
      <Card title="Run the rescue" icon={Recycle}>
        <p className="mb-3 text-sm text-slate-600">
          Uses the same OR-Tools optimizer as your plan, with one change: every unit shipped from an at-risk batch is worth its write-off
          value. Expired or rule-blocked stock is never sent anywhere. Product values are synthetic.
        </p>
        {p.chaos && <Notice tone="warn">A disaster simulation is active; the rescue is computed on your original plan's settings.</Notice>}
        <button type="button" className="btn-primary" onClick={go} disabled={busy}>
          {busy ? <><Loader2 size={15} className="animate-spin" aria-hidden />Optimizing rescue…</> : <><Recycle size={15} aria-hidden />Find &amp; rescue at-risk stock</>}
        </button>
        <div className="mt-3"><ErrorBox error={error} onRetry={go} /></div>
      </Card>

      {res && s && (
        <>
          {!res.requirements.feasible && <Notice tone="danger">{res.requirements.message}</Notice>}
          {res.requirements.checker_valid === false && <Notice tone="danger">The independent checker rejected the rescue plan; do not execute it.</Notice>}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Waste avoided" icon={Recycle} tone="green" value={`${fmtInt(s.waste_avoided_units)} units`}
              hint={`at risk: ${fmtInt(s.units_at_risk_before)} → ${fmtInt(s.units_at_risk_after)} units`} />
            <StatCard label="Value recovered" icon={CheckCircle2} tone="blue" value={fmtRs(s.value_recovered)}
              hint={`value at risk ${fmtRs(s.value_at_risk_before)} → ${fmtRs(s.value_at_risk_after)}`} />
            <StatCard label="Batches at risk" icon={Recycle} tone="amber" value={fmtInt(s.batches_at_risk)} hint="fail the shelf-life rule by next cycle" />
            <StatCard label="Already expired" icon={Recycle} tone="red" value={`${fmtInt(s.expired_units)} units`} hint={`${s.expired_batches} batches - cannot be rescued`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Before vs after" subtitle="Current plan vs rescue plan (same inputs)" className="xl:col-span-1">
              <KpiCompare before={s.kpis_before} after={s.kpis_after} />
            </Card>
            <Card title="Execute" className="xl:col-span-2">
              <p className="mb-3 text-sm text-slate-600">
                <b>Execute Rescue Plan</b> adopts the rescue plan ({res.run.plan_id}) as this week's SahiSupply delivery plan
                {res.run.persisted === false ? " (MongoDB unavailable: kept in memory only)" : " (saved in MongoDB)"}. It then drives the delivery
                table, dispatch statuses and map. No warehouse or external system is notified automatically. Transfer suggestions are not part
                of the optimized plan and are not executed.
              </p>
              {executed ? (
                <Notice>Rescue plan {executed} is now the active plan. Re-run the normal plan (Run plan) at any time to go back.</Notice>
              ) : (
                <button type="button" className="btn-primary" onClick={execute} disabled={!res.requirements.feasible || res.requirements.checker_valid === false}>
                  <CheckCircle2 size={15} aria-hidden />Execute Rescue Plan
                </button>
              )}
              <p className="mt-3 text-xs text-slate-400">{res.note}</p>
            </Card>
          </div>

          <Card title="At-risk batches" subtitle="Most urgent first" bodyClass="px-2 pb-4 pt-3">
            {res.batches.length === 0 ? <p className="px-3 text-sm text-slate-500">No batch is at risk of expiring before the next cycle.</p> : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="tbl min-w-[1000px]" aria-label="At-risk batches">
                  <thead><tr><th>Urgency</th><th>Product</th><th>Batch</th><th>Warehouse</th><th className="num">Qty</th><th>Expiry</th>
                    <th className="num">Value at risk</th><th className="num">Shipped before → after</th><th>Recommended action</th></tr></thead>
                  <tbody>
                    {res.batches.map((b) => (
                      <tr key={b.batch_id} className={b.expired ? "opacity-60" : ""}>
                        <td><Pill tone={URGENCY[b.urgency].tone}>{URGENCY[b.urgency].label}</Pill></td>
                        <td className="font-medium text-slate-900">{b.product_name}</td>
                        <td className="font-mono text-xs">{b.batch_id}</td>
                        <td className="text-xs">{b.warehouse_name}</td>
                        <td className="num">{fmtInt(b.quantity)}</td>
                        <td className="text-xs">{fmtDate(b.expiry_date)}<div className="text-slate-400">{b.expired ? "expired" : `${b.days_to_expiry} d · ${b.remaining_life_pct.toFixed(0)}% life`}</div></td>
                        <td className="num">{fmtRs(b.value_at_risk)}</td>
                        <td className="num">{fmtInt(b.shipped_before)} → <b className={b.units_saved > 0 ? "text-emerald-600" : ""}>{fmtInt(b.shipped_after)}</b>
                          {b.units_saved > 0 && <div className="text-xs text-emerald-600">+{fmtInt(b.units_saved)} saved</div>}</td>
                        <td className="space-y-1">{b.actions.map((a, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs"><Pill tone={ACTION_TONE[a.type]}>{a.type.replace("_", " ")}</Pill><span className="text-slate-600">{a.text}</span></div>
                        ))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCompare({ before, after }: { before: Kpis; after: Kpis }) {
  const rows: [string, number, number, (n: number) => string][] = [
    ["Stock at expiry risk", before.expiry_risk_units, after.expiry_risk_units, fmtInt],
    ["Needs delivered", before.fill_rate, after.fill_rate, (n) => fmtPct(n, 1)],
    ["Units short", before.unmet_units, after.unmet_units, fmtInt],
    ["Delivery cost", before.transport_cost, after.transport_cost, (n) => fmtRs(n)],
  ];
  return (
    <table className="tbl" aria-label="Rescue KPIs">
      <thead><tr><th>KPI</th><th className="num">Before</th><th className="num">After</th></tr></thead>
      <tbody>{rows.map(([l, b, a, f]) => <tr key={l}><td>{l}</td><td className="num">{f(b)}</td><td className="num font-semibold">{f(a)}</td></tr>)}</tbody>
    </table>
  );
}
