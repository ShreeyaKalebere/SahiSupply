import { useMemo, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { cx, fmtDate, fmtInt } from "../utils/format";

export default function InventoryPage() {
  const p = usePlanner();
  const inv = useAsync(() => api.inventory(p.module, p.scenario, p.contested), [p.module, p.scenario, p.contested]);
  const [wh, setWh] = useState("all");
  const [elig, setElig] = useState("all");
  const [storage, setStorage] = useState("all");
  const [search, setSearch] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const rows = inv.data?.rows ?? [];
  const whs = useMemo(() => Array.from(new Set(rows.map((r) => r.warehouse_id))), [rows]);
  const filtered = rows.filter((r) => (wh === "all" || r.warehouse_id === wh) && (elig === "all" || r.eligibility === elig)
    && (storage === "all" || r.storage_class === storage) && (!riskOnly || r.expiry_risk)
    && (!search || `${r.product_name} ${r.batch_id} ${r.product_id}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-3">
      <PageHeader title="Inventory & batches"
        description={`Batch-level stock with expiry and eligibility under the active rules${inv.data ? ` (${inv.data.rules_enforced.join(", ") || "none"})` : ""}, evaluated for scenario ${p.scenario}.`} />
      <ErrorBox error={inv.error} onRetry={inv.reload} />
      {inv.loading && !inv.data ? <Spinner /> : (
        <Card bodyClass="p-0" title={`${filtered.length} of ${rows.length} batches · ${fmtInt(filtered.reduce((s, r) => s + r.quantity, 0))} units`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Search batches" className="input w-44" placeholder="Search product/batch" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select aria-label="Warehouse filter" className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
                <option value="all">All warehouses</option>{whs.map((w) => <option key={w}>{w}</option>)}
              </select>
              <select aria-label="Eligibility filter" className="input" value={elig} onChange={(e) => setElig(e.target.value)}>
                <option value="all">Any eligibility</option><option value="eligible">Eligible</option>
                <option value="partially_eligible">Partially eligible</option><option value="blocked">Blocked</option>
              </select>
              <select aria-label="Storage filter" className="input" value={storage} onChange={(e) => setStorage(e.target.value)}>
                <option value="all">Any storage</option><option value="ambient">Ambient</option><option value="chilled">Chilled</option><option value="2-8C">2-8 °C</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} /> Expiry risk</label>
            </div>
          }>
          <div className="max-h-[68vh] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Warehouse</th><th>Product</th><th>Batch</th><th className="num">Qty</th><th>Expiry</th><th className="num">Days left</th>
                <th className="num">Life left</th><th>Storage</th><th>Eligibility</th><th>Block reasons (outlets)</th></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.batch_id}>
                    <td>{r.warehouse_id} <span className="text-[11px] text-slate-500">{r.warehouse_name}</span>{r.warehouse_status !== "operational" && <Badge color="red" className="ml-1">{r.warehouse_status}</Badge>}</td>
                    <td>{r.product_name} {r.criticality === "critical" && <Badge color="red">critical</Badge>}</td>
                    <td className="font-mono text-xs">{r.batch_id}</td>
                    <td className="num">{fmtInt(r.quantity)}</td>
                    <td className="whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                    <td className={cx("num", r.expiry_risk && "font-semibold text-red-700")}>{r.days_to_expiry}</td>
                    <td className="num">{r.remaining_life_pct.toFixed(0)}%</td>
                    <td>{r.storage_class === "ambient" ? "Ambient" : <Badge color="blue">{r.storage_class}</Badge>}</td>
                    <td>{r.eligibility === "eligible" ? <Badge color="green">eligible ({r.eligible_outlets}/{r.total_outlets})</Badge>
                      : r.eligibility === "blocked" ? <Badge color="red">blocked</Badge> : <Badge color="amber">{r.eligible_outlets}/{r.total_outlets} outlets</Badge>}</td>
                    <td className="text-[11px] text-slate-500">{Object.entries(r.block_reasons).map(([k, v]) => `${k} ×${v}`).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
