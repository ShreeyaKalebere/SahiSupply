import { Search, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { DeliveryTable } from "../components/DeliveryTable";
import { ExplanationDrawer } from "../components/ExplanationDrawer";
import { PlanTechDetails, RuleCheckBadge } from "../components/PlanStatus";
import { RunRequired } from "../components/RunRequired";
import { Card, PageHeader, Tabs } from "../components/ui";
import { useNetwork } from "../hooks/useNetwork";
import type { Run } from "../types/api";
import { fmtInt, fmtPct, fmtRs } from "../utils/format";
import { lineStatus } from "../utils/labels";

export default function PlannerPage() {
  return (
    <div>
      <PageHeader title="Delivery plan" description="What each store gets this week, and from which warehouse. Click any row to see why." />
      <RunRequired>{(run) => <PlannerBody run={run} />}</RunRequired>
    </div>
  );
}

type Filter = "all" | "short" | "critical";

function PlannerBody({ run }: { run: Run }) {
  const { whName } = useNetwork(run.module);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const k = run.optimizer?.kpis;
  const hasCritical = run.allocation.some((r) => r.criticality === "critical");

  const rows = useMemo(() => run.allocation.filter((r) => {
    const s = search.toLowerCase();
    if (s && !`${r.outlet_name} ${r.product_name}`.toLowerCase().includes(s)) return false;
    if (filter === "short" && r.unmet === 0) return false;
    if (filter === "critical" && r.criticality !== "critical") return false;
    return true;
  }), [run, search, filter]);

  const short = run.allocation.filter((r) => lineStatus(r) !== "full").length;
  const exp = open ? run.explanations.find((e) => `${e.outlet_id}|${e.product_id}` === open) : null;
  if (!run.optimizer || !k) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white px-5 py-4 shadow-card">
        <RuleCheckBadge run={run} />
        <span className="text-sm text-slate-600"><b className="text-slate-900">{fmtPct(k.fill_rate, 0)}</b> of needs delivered</span>
        <span className="text-sm text-slate-600"><b className="text-slate-900">{fmtInt(k.delivered_units)}</b> units sending</span>
        <span className="text-sm text-slate-600"><b className="text-rose-600">{short}</b> orders short</span>
        <span className="text-sm text-slate-600">Delivery cost <b className="text-slate-900">{fmtRs(k.transport_cost)}</b></span>
      </div>

      <Card title="All store orders" icon={Truck} bodyClass="px-2 pb-4 pt-3"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs<Filter> label="Filter orders" value={filter} onChange={setFilter} options={[
              { value: "all", label: "All", count: run.allocation.length },
              { value: "short", label: "Short", count: short },
              ...(hasCritical ? [{ value: "critical" as Filter, label: "Critical", count: run.allocation.filter((r) => r.criticality === "critical").length }] : []),
            ]} />
            <label className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" aria-hidden />
              <input aria-label="Search store or product" className="input w-56 pl-9" placeholder="Search store or product" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
        }>
        <div className="max-h-[64vh] overflow-auto">
          <DeliveryTable rows={rows} whName={whName} label="Delivery plan" onOpen={(r) => setOpen(`${r.outlet_id}|${r.product_id}`)} />
          {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No orders match.</p>}
        </div>
      </Card>
      <PlanTechDetails run={run} />
      {exp && <ExplanationDrawer run={run} exp={exp} onClose={() => setOpen(null)} />}
    </div>
  );
}
