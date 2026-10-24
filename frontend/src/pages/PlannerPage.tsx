import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ExplanationDrawer } from "../components/ExplanationDrawer";
import { PlanMetaStrip } from "../components/PlanStatus";
import { RunRequired } from "../components/RunRequired";
import { Badge, Card, Kpi, PageHeader } from "../components/ui";
import type { Run } from "../types/api";
import { cx, fmtInt, fmtPct, fmtRs } from "../utils/format";

export default function PlannerPage() {
  return (
    <div>
      <PageHeader title="Allocation planner"
        description="Batch-level plan from the MILP optimizer. Click a row for the why / why-not explanation and to override a quantity." />
      <RunRequired>{(run) => <PlannerBody run={run} />}</RunRequired>
    </div>
  );
}

function PlannerBody({ run }: { run: Run }) {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState("all");
  const [critOnly, setCritOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const k = run.optimizer?.kpis;
  const valid = run.status === "VALID";

  const regions = useMemo(() => Array.from(new Set(run.allocation.map((r) => r.region))), [run]);
  const rows = useMemo(() => run.allocation.filter((r) => {
    const s = search.toLowerCase();
    if (s && !`${r.outlet_name} ${r.product_name} ${r.outlet_id} ${r.product_id}`.toLowerCase().includes(s)) return false;
    if (region !== "all" && r.region !== region) return false;
    if (status === "short" && r.unmet === 0) return false;
    if (status === "met" && r.unmet > 0) return false;
    if (critOnly && r.criticality !== "critical") return false;
    return true;
  }), [run, search, region, status, critOnly]);

  const exp = open ? run.explanations.find((e) => `${e.outlet_id}|${e.product_id}` === open) : null;

  if (!run.optimizer) return null;
  return (
    <div className="space-y-3">
      <PlanMetaStrip run={run} />
      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Kpi label="Fill rate" value={fmtPct(k.fill_rate)} sub={`baseline ${fmtPct(run.baseline.kpis.fill_rate)}`} />
          <Kpi label="Delivered" value={fmtInt(k.delivered_units)} sub={`of ${fmtInt(k.need_units)} needed`} />
          <Kpi label="Unmet" value={fmtInt(k.unmet_units)} tone={k.unmet_units ? "warn" : "good"} />
          <Kpi label="Transport cost" value={fmtRs(k.transport_cost)} />
          <Kpi label="Critical short" value={fmtInt(k.critical_shortage_units)} tone={k.critical_shortage_units ? "bad" : "neutral"} />
          <Kpi label="Blocked units shipped" value={fmtInt(k.blocked_units_shipped)} tone={k.blocked_units_shipped ? "bad" : "good"}
            sub={run.rules_off ? `rules-off would ship ${fmtInt(run.rules_off.kpis.blocked_units_shipped)}` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0" title={`${rows.length} of ${run.allocation.length} destination-product lines`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={14} className="absolute left-2 top-2 text-slate-400" aria-hidden />
              <input aria-label="Search lines" className="input w-48 pl-7" placeholder="Search outlet or product" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <select aria-label="Region filter" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="all">All regions</option>
              {regions.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select aria-label="Status filter" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All lines</option><option value="short">Short only</option><option value="met">Met only</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={critOnly} onChange={(e) => setCritOnly(e.target.checked)} /> Critical only</label>
          </div>
        }>
        <div className="max-h-[62vh] overflow-auto">
          <table className="tbl" aria-label="Allocation plan">
            <thead>
              <tr>
                <th>Destination</th><th>Product</th><th className="num">Required</th><th className="num">Allocated</th>
                <th className="num">Unmet</th><th>Source (batch)</th><th className="num">Cost</th><th className="num">Life on arrival</th><th>Validation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.outlet_id}|${r.product_id}`} className="clickable" tabIndex={0}
                  onClick={() => setOpen(`${r.outlet_id}|${r.product_id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpen(`${r.outlet_id}|${r.product_id}`); }}>
                  <td><div className="font-medium text-slate-800">{r.outlet_name}</div><div className="text-[11px] text-slate-500">{r.outlet_id} · {r.outlet_type} · {r.region}</div></td>
                  <td>{r.product_name} {r.criticality === "critical" && <Badge color="red">critical</Badge>}</td>
                  <td className="num">{fmtInt(r.required)}</td>
                  <td className="num">{fmtInt(r.allocated)}</td>
                  <td className={cx("num", r.unmet > 0 && "font-semibold text-red-700")}>{fmtInt(r.unmet)}</td>
                  <td className="text-xs">{r.sources.length ? r.sources.map((s) => <div key={s.batch_id}>{s.warehouse_id} · {s.batch_id} × {s.qty}</div>) : <span className="text-slate-400">—</span>}</td>
                  <td className="num">{fmtRs(r.transport_cost, 2)}</td>
                  <td className="num text-xs">{r.sources.map((s) => <div key={s.batch_id}>{s.life_on_arrival_days} d</div>)}</td>
                  <td>{valid ? <Badge color="green">valid</Badge> : <Badge color="red">invalid</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {exp && <ExplanationDrawer run={run} exp={exp} onClose={() => setOpen(null)} />}
    </div>
  );
}
