import { CheckCircle2, Lightbulb, Snowflake, Truck, Package, Warehouse, type LucideIcon } from "lucide-react";
import { RunRequired } from "../components/RunRequired";
import { Details, EmptyState, PageHeader, Pill } from "../components/ui";
import type { InsightItem, Run } from "../types/api";
import { fmtInt, fmtNum, fmtRs } from "../utils/format";
import { useNetwork } from "../hooks/useNetwork";
import { uniqueInsights } from "../utils/labels";

const ICON: Record<InsightItem["kind"], LucideIcon> = { cold: Snowflake, stock: Package, route: Truck, receiving: Warehouse, outbound: Warehouse };
const ACTION: Record<InsightItem["kind"], string> = {
  cold: "Add cold storage", stock: "Order more / move stock", route: "Add a truck on this route", receiving: "Expand receiving space", outbound: "Add dispatch capacity",
};

export default function InsightsPage() {
  return (
    <div>
      <PageHeader title="Smart suggestions" description="Small investments that would help the most this week. Each one was tested by re-making the plan with that change." />
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const ins = run.insights;
  const { whName } = useNetwork(run.module);
  const items = uniqueInsights(ins?.items ?? [], whName);
  if (!ins || items.length === 0) {
    return <EmptyState icon={Lightbulb} title="No suggestions this week">None of the small changes we tested would improve the plan.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((it, i) => {
          const Icon = ICON[it.kind];
          return (
            <article key={`${it.kind}${it.key}`} className={`card p-5 ${i === 0 ? "ring-2 ring-primary-200" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">{it.label}</h2>
                    {i === 0 && <Pill tone="red">Top priority</Pill>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{it.statement}</p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-500 text-white"><Icon size={18} aria-hidden /></span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-sm">
                <div><div className="text-xs text-slate-500">Extra delivered</div><div className="font-semibold text-slate-900">{fmtInt(it.extra_units_delivered)} units</div></div>
                <div><div className="text-xs text-slate-500">{it.critical_units_avoided_total > 0 ? "Critical shortages avoided" : "Extra margin"}</div>
                  <div className="font-semibold text-emerald-600">{it.critical_units_avoided_total > 0 ? fmtInt(it.critical_units_avoided_total) : fmtRs(it.net_margin_total)}</div></div>
                <div><div className="text-xs text-slate-500">Action</div><div className="font-semibold text-slate-900">{ACTION[it.kind]}</div></div>
              </div>
              {it.verified && <div className="mt-3 flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={13} aria-hidden /> Tested: we re-made the plan with this change and double-checked it.</div>}
            </article>
          );
        })}
      </div>
      <Details>
        <p className="mb-2">{ins.notes.join(" ")} Values hold for small changes only.</p>
        <table className="tbl">
          <thead><tr><th>Constraint</th><th className="num">LP dual (ranking)</th><th className="num">Added</th><th className="num">₹ per unit</th><th>Outcome</th></tr></thead>
          <tbody>{ins.candidates.map((c) => (
            <tr key={`${c.kind}${c.key}`}><td>{c.kind} · {c.key}</td><td className="num">{fmtNum(Math.abs(c.lp_dual), 2)}</td><td className="num">{fmtNum(c.added, 0)}</td>
              <td className="num">{c.net_margin_per_unit == null ? "—" : fmtRs(c.net_margin_per_unit, 2)}</td><td>{c.dropped ? `dropped: ${c.dropped}` : "kept"}</td></tr>
          ))}</tbody>
        </table>
      </Details>
    </div>
  );
}
