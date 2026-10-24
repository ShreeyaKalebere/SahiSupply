import { Box, Clock, MapPin, Package, PackageX, Snowflake, Warehouse, X } from "lucide-react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import type { WarehouseDetails } from "../../types/api";
import { fmtDate, fmtInt, fmtPct } from "../../utils/format";
import { ErrorBox, Pill, ProgressBar, Spinner } from "../ui";

const STATUS_TONE = { ok: "green", expiring: "amber", blocked: "red", low: "red" } as const;
const STATUS_TEXT = { ok: "OK", expiring: "Expiring", blocked: "Blocked", low: "Low after plan" } as const;

/** Popup for one warehouse marker: identity, stock, capacity, risks, products and the 3D entry point. */
export function WarehousePopup({ module, warehouseId, contested, planId, onClose, onOpen3D }: {
  module: string; warehouseId: string; contested: boolean; planId?: string | null;
  onClose: () => void; onOpen3D: (d: WarehouseDetails) => void;
}) {
  const q = useAsync(() => api.warehouseDetails(module, warehouseId, contested, planId), [module, warehouseId, contested, planId]);
  const d = q.data;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[1250] max-h-[85vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-24 sm:w-[400px] sm:rounded-2xl"
      role="dialog" aria-label="Warehouse details">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-500 text-white"><Warehouse size={19} aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{d?.warehouse.name ?? warehouseId}</h2>
            {d && <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} aria-hidden />{d.warehouse.city} · {d.warehouse.region}</p>}
          </div>
        </div>
        <button aria-label="Close warehouse details" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="space-y-4 px-5 py-4">
        <ErrorBox error={q.error} onRetry={q.reload} />
        {q.loading && !d && <Spinner label="Loading warehouse…" />}
        {d && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="blue">{d.industry.name}</Pill>
              <Pill tone={d.warehouse.status === "operational" ? "green" : "red"}>{d.warehouse.status}</Pill>
              {d.warehouse.cold_storage && <Pill tone="blue"><Snowflake size={11} aria-hidden /> Cold storage</Pill>}
              <Pill tone="gray">ID {d.warehouse.warehouse_id}</Pill>
            </div>
            <p className="text-xs text-slate-500">Operated by: {d.operator}</p>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Inventory</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">{fmtInt(d.metrics.total_units)}</div>
                <div className="text-[11px] text-slate-400">units · {d.metrics.batches} batches</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Capacity</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">{fmtInt(d.metrics.storage_capacity_l)}</div>
                <div className="text-[11px] text-slate-400">litres {d.metrics.storage_capacity_simulated && <span className="text-amber-600">(simulated)</span>}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Utilisation</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">{fmtPct(d.metrics.utilization, 0)}</div>
                <ProgressBar value={d.metrics.utilization ?? 0} tone={(d.metrics.utilization ?? 0) > 0.85 ? "red" : (d.metrics.utilization ?? 0) > 0.65 ? "amber" : "green"} />
              </div>
            </div>

            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><PackageX size={15} className="text-rose-500" aria-hidden /> Stockout risks ({d.stockout_risks.length})</h3>
              {d.stockout_risks.length === 0 ? <p className="mt-1 text-xs text-slate-500">None found.</p> : (
                <ul className="mt-1.5 space-y-1 text-xs">
                  {d.stockout_risks.slice(0, 4).map((r) => <li key={r.product_id} className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-800"><b>{r.name}</b> - {r.reason}</li>)}
                  {d.stockout_risks.length > 4 && <li className="text-slate-400">+{d.stockout_risks.length - 4} more</li>}
                </ul>
              )}
              {!d.plan_id && <p className="mt-1 text-[11px] text-slate-400">Run a plan to also see stock left after this week's deliveries.</p>}
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Clock size={15} className="text-amber-500" aria-hidden /> Expiring or blocked batches ({d.expiring_batches.length})</h3>
              {d.expiring_batches.length === 0 ? <p className="mt-1 text-xs text-slate-500">None.</p> : (
                <ul className="mt-1.5 space-y-1 text-xs">
                  {d.expiring_batches.slice(0, 4).map((b) => (
                    <li key={b.batch_id} className="flex justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-900">
                      <span className="truncate">{b.product_name} · {b.batch_id}</span>
                      <span className="shrink-0 tabular-nums">{b.status === "blocked" ? "blocked" : `${b.days_to_expiry} d`} · {fmtInt(b.quantity)} u</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Package size={15} className="text-primary-500" aria-hidden /> Products available ({d.products.length})</h3>
              <ul className="mt-1.5 divide-y divide-slate-100 text-xs">
                {d.products.slice(0, 6).map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-slate-700">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-slate-500">{fmtInt(p.units)} u · exp {fmtDate(p.nearest_expiry)}</span>
                      <Pill tone={STATUS_TONE[p.status]}>{STATUS_TEXT[p.status]}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
              {d.products.length > 6 && <p className="mt-1 text-[11px] text-slate-400">+{d.products.length - 6} more in the 3D view</p>}
            </section>

            <button className="btn-primary w-full py-3" onClick={() => onOpen3D(d)}><Box size={16} aria-hidden /> View 3D Warehouse</button>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {d.data_notes.from_database} Simulated: {d.data_notes.simulated.join("; ")}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
