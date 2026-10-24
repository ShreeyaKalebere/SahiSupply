import { Ban, Boxes, Clock, PackageCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { Card, ErrorBox, PageHeader, Pill, ProgressBar, Spinner, StatCard, Tabs } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import type { InventoryRow } from "../types/api";
import { fmtDate, fmtInt } from "../utils/format";
import { BLOCK_TEXT } from "../utils/labels";

type Filter = "all" | "soon" | "blocked";

function why(r: InventoryRow): string {
  const codes = Object.keys(r.block_reasons).map((k) => k.split(" ")[0]);
  return Array.from(new Set(codes.map((c) => BLOCK_TEXT[c] ?? c))).join(", ");
}

export default function InventoryPage() {
  const p = usePlanner();
  const inv = useAsync(() => api.inventory(p.module, p.scenario, p.contested), [p.module, p.scenario, p.contested]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const rows = inv.data?.rows ?? [];
  const filtered = useMemo(() => rows.filter((r) =>
    (filter === "all" || (filter === "soon" && r.expiry_risk) || (filter === "blocked" && r.eligibility === "blocked"))
    && (!search || `${r.product_name} ${r.warehouse_name}`.toLowerCase().includes(search.toLowerCase()))), [rows, filter, search]);
  const units = (xs: InventoryRow[]) => xs.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Stock & expiry" description="Every batch in your warehouses, how long it lasts, and whether it can be shipped." />
      <ErrorBox error={inv.error} onRetry={inv.reload} />
      {inv.loading && !inv.data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Total stock" icon={Boxes} tone="blue" value={`${fmtInt(units(rows))} units`} hint={`${rows.length} batches`} />
            <StatCard label="Ready to ship" icon={PackageCheck} tone="green" value={`${fmtInt(units(rows.filter((r) => r.eligibility === "eligible")))} units`} hint="can go to every store" />
            <StatCard label="Expiring soon" icon={Clock} tone="amber" value={`${fmtInt(units(rows.filter((r) => r.expiry_risk)))} units`} hint="move these first" />
            <StatCard label="Can't be shipped" icon={Ban} tone="red" value={`${fmtInt(units(rows.filter((r) => r.eligibility === "blocked")))} units`} hint="expire too soon or blocked" />
          </div>
          <Card title="Batches" icon={Boxes} bodyClass="px-2 pb-4 pt-3"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Tabs<Filter> label="Filter batches" value={filter} onChange={setFilter} options={[
                  { value: "all", label: "All", count: rows.length },
                  { value: "soon", label: "Expiring soon", count: rows.filter((r) => r.expiry_risk).length },
                  { value: "blocked", label: "Can't ship", count: rows.filter((r) => r.eligibility === "blocked").length },
                ]} />
                <label className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-slate-400" aria-hidden />
                  <input aria-label="Search product or warehouse" className="input w-52 pl-9" placeholder="Search product or warehouse" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </div>
            }>
            <div className="max-h-[64vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th>Warehouse</th><th className="num">Units</th><th>Expires</th><th className="w-44">Shelf life left</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.batch_id}>
                      <td><div className="font-medium text-slate-900">{r.product_name}</div><div className="text-xs text-slate-400">Batch {r.batch_id}{r.storage_class !== "ambient" ? ` · keep ${r.storage_class === "2-8C" ? "at 2-8 °C" : "chilled"}` : ""}</div></td>
                      <td>{r.warehouse_name}{r.warehouse_status !== "operational" && <Pill tone="red" className="ml-2">closed</Pill>}</td>
                      <td className="num">{fmtInt(r.quantity)}</td>
                      <td className="whitespace-nowrap"><div>{fmtDate(r.expiry_date)}</div><div className="text-xs text-slate-400">in {r.days_to_expiry} days</div></td>
                      <td><div className="mb-1 text-xs text-slate-500">{Math.max(0, r.remaining_life_pct).toFixed(0)}%</div><ProgressBar value={r.remaining_life_pct / 100} /></td>
                      <td>
                        {r.eligibility === "eligible" ? <Pill tone="green">Ready</Pill>
                          : r.eligibility === "blocked" ? <Pill tone="red" title={why(r)}>Can't ship · {why(r)}</Pill>
                          : <Pill tone="amber" title={why(r)}>Some stores only</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No batches match.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
