import { Lightbulb } from "lucide-react";
import { RunRequired } from "../components/RunRequired";
import { Badge, Card, EmptyState, Notice, PageHeader, ValidityBadge } from "../components/ui";
import type { Run } from "../types/api";
import { fmtNum, fmtRs } from "../utils/format";

export default function InsightsPage() {
  return (
    <div>
      <PageHeader title="Value of one more unit"
        description="LP duals rank binding stock, route and cold-capacity constraints; each top candidate is then measured by re-solving the integer model with more of that resource. Values are valid for small changes." />
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const ins = run.insights;
  if (!ins) return <EmptyState title="Insights not computed for this run" />;
  return (
    <div className="space-y-3">
      {ins.items.length === 0 && <EmptyState title="No constraint shows a measured improvement">Every candidate re-solve produced no gain, so nothing is listed.</EmptyState>}
      <div className="grid gap-3 lg:grid-cols-2">
        {ins.items.map((it, i) => (
          <Card key={`${it.kind}${it.key}`} title={<span className="flex items-center gap-2"><Lightbulb size={14} className="text-amber-500" aria-hidden /> #{i + 1} {it.title}</span>}
            actions={<ValidityBadge valid={it.verified} label={it.verified ? "Reproduced by checker" : "Not reproduced"} />}>
            <p className="text-sm font-medium text-slate-800">{it.statement}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
              <div><dt className="text-slate-400">Added</dt><dd>+{fmtNum(it.added, 0)} {it.added_unit} (limit {fmtNum(it.current_limit, 1)})</dd></div>
              {it.critical_units_avoided_total > 0 && (
                <div><dt className="text-slate-400">Critical units avoided</dt><dd>{fmtNum(it.critical_units_avoided_total, 0)} ({fmtNum(it.critical_units_avoided_per_unit, 2)} per {it.added_unit === "L" ? "L" : "unit"})</dd></div>
              )}
              <div><dt className="text-slate-400">Net margin recovered</dt><dd>{fmtRs(it.net_margin_total)} ({fmtRs(it.net_margin_per_unit, 2)} per {it.added_unit === "L" ? "L" : "unit"})</dd></div>
              <div><dt className="text-slate-400">Extra units delivered</dt><dd>{fmtNum(it.extra_units_delivered, 0)}</dd></div>
              <div><dt className="text-slate-400">LP dual (rank only)</dt><dd className="font-mono">{fmtNum(it.lp_dual, 2)}</dd></div>
              <div><dt className="text-slate-400">Signal</dt><dd><Badge color="blue">{it.signal}</Badge></dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">{it.note} Re-solve status: {it.resolve_status}.</p>
          </Card>
        ))}
      </div>
      <Notice>{ins.notes.join(" ")}</Notice>
      <Card title="Ranked candidates (LP relaxation)" subtitle={`Method: ${ins.method} · ${ins.seconds.toFixed(1)}s`} bodyClass="p-0">
        <table className="tbl">
          <thead><tr><th>Constraint</th><th className="num">|Dual|</th><th className="num">Added</th><th className="num">Critical avoided / unit</th><th className="num">₹ / unit</th><th>Outcome</th></tr></thead>
          <tbody>
            {ins.candidates.map((c) => (
              <tr key={`${c.kind}${c.key}`}>
                <td>{c.kind} · {c.key}</td><td className="num font-mono">{fmtNum(Math.abs(c.lp_dual), 2)}</td><td className="num">{fmtNum(c.added, 0)}</td>
                <td className="num">{c.critical_units_avoided_per_unit == null ? "—" : fmtNum(c.critical_units_avoided_per_unit, 2)}</td>
                <td className="num">{c.net_margin_per_unit == null ? "—" : fmtRs(c.net_margin_per_unit, 2)}</td>
                <td>{c.dropped ? <Badge>dropped: {c.dropped}</Badge> : <Badge color="green">shown if in top 5</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
