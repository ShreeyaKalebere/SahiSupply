import { AlertTriangle, Ban, Box, Clock, PackageX, RefreshCw, ScanLine, Snowflake } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { QrScanner } from "../components/trace/QrScanner";
import { RecordSummary, RESULT_STYLE, TraceNotice } from "../components/trace/TraceParts";
import { ErrorBox, Pill, ProgressBar, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import { lazy, Suspense, useState, type ReactNode } from "react";
import type { TraceEvent, TraceRecord, WarehouseBatch, WarehouseDetails } from "../types/api";
import { fmtDate, fmtDateTime, fmtInt, fmtPct } from "../utils/format";
import { usePref } from "./mobileUtils";

// three.js loads only when the 3D view is opened.
const Warehouse3DModal = lazy(() => import("../components/warehouse/Warehouse3DModal"));

/** Warehouse staff: expiry, blocked-stock and stock-out alerts for one warehouse, from the live database. */
export default function WarehouseView() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const [pref, setPref] = usePref(`warehouse.${p.module}`);
  const whs = net?.warehouses ?? [];
  const wid = whs.some((w) => w.warehouse_id === pref) ? pref : whs[0]?.warehouse_id ?? "";
  const contested = p.run?.contested_pattern ?? p.contested;
  const planId = p.run && !p.run.chaos ? p.run.plan_id : undefined;
  const q = useAsync(() => (wid ? api.warehouseDetails(p.module, wid, contested, planId) : Promise.resolve({ data: null as WarehouseDetails | null, meta: {} })), [p.module, wid, contested, planId]);
  const det = q.data;
  const [view3d, setView3d] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [found, setFound] = useState<{ record: TraceRecord; events: TraceEvent[] } | null>(null);
  const [scanErr, setScanErr] = useState<ApiError | null>(null);
  const onCode = async (code: string) => {
    setScanOpen(false);
    setScanErr(null);
    setFound(null);
    try {
      setFound((await api.traceResolve(code, planId)).data);
    } catch (e) {
      setScanErr(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    }
  };

  const expiring = (det?.expiring_batches ?? []).filter((b) => b.status === "expiring").sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  const blocked = (det?.expiring_batches ?? []).filter((b) => b.status === "blocked");
  const low = (det?.products ?? []).filter((x) => x.status === "low");
  const alertCount = expiring.length + blocked.length + (det?.stockout_risks.length ?? 0);

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-2xl bg-white p-3 shadow-card">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">My warehouse</span>
          <select className="input mt-1 w-full" value={wid} onChange={(e) => setPref(e.target.value)}>
            {whs.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_id} · {w.name}</option>)}
          </select>
        </label>
        {det && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Tile label="Units" value={fmtInt(det.metrics.total_units)} />
            <Tile label="Batches" value={fmtInt(det.metrics.batches)} />
            <Tile label="Alerts" value={String(alertCount)} tone={alertCount ? "text-rose-600" : "text-emerald-600"} />
          </div>
        )}
        {det?.metrics.utilization != null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Space used (capacity simulated)</span><b className="text-slate-800">{fmtPct(det.metrics.utilization, 0)}</b></div>
            <ProgressBar value={det.metrics.utilization} tone={det.metrics.utilization > 0.85 ? "red" : det.metrics.utilization > 0.65 ? "amber" : "green"} />
          </div>
        )}
        <button type="button" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary-600" onClick={q.reload}><RefreshCw size={13} aria-hidden />Refresh</button>
      </div>

      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.loading && !det && <Spinner label="Loading stock…" />}

      {det && (
        <>
          <Section icon={Clock} title="Expiring soon" count={expiring.length} tone="amber" empty="Nothing is close to expiring.">
            {expiring.map((b) => <BatchRow key={b.batch_id} b={b} />)}
          </Section>
          <Section icon={Ban} title="Blocked - can't ship" count={blocked.length} tone="red" empty="No blocked batches.">
            {blocked.map((b) => <BatchRow key={b.batch_id} b={b} />)}
          </Section>
          <Section icon={PackageX} title="Stock-out risk" count={det.stockout_risks.length} tone="red" empty="No stock-out risks.">
            {det.stockout_risks.map((r) => (
              <li key={r.product_id} className="py-2.5">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-900">{r.name}</span>
                  {r.units_left != null && <Pill tone="red">{fmtInt(r.units_left)} left</Pill>}</div>
                <p className="text-xs text-slate-500">{r.reason}</p>
              </li>
            ))}
          </Section>
          {low.length > 0 && (
            <Section icon={AlertTriangle} title="Low after this week's plan" count={low.length} tone="amber" empty="">
              {low.map((x) => (
                <li key={x.product_id} className="flex items-center justify-between py-2.5">
                  <span className="text-slate-900">{x.name}</span><span className="text-xs text-slate-500">{fmtInt(x.units_after_plan)} of {fmtInt(x.units)} left</span>
                </li>
              ))}
            </Section>
          )}
          <section className="space-y-2 rounded-2xl bg-white p-3 shadow-card">
            <button type="button" onClick={() => setScanOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary-500 py-2.5 text-sm font-bold text-primary-600">
              <ScanLine size={17} aria-hidden />Scan a batch QR
            </button>
            {scanErr && <p role="alert" className="text-xs text-rose-600">{scanErr.message}</p>}
            {found && (
              <div className={`space-y-2 rounded-xl border-2 p-3 ${found.record.expired ? RESULT_STYLE.flagged.cls : RESULT_STYLE.ok.cls}`}>
                <p className="text-sm font-bold">{found.record.expired ? "Expired batch - do not ship" : "Code verified for this system"}</p>
                <RecordSummary r={found.record} />
                {found.events.length > 0 && (
                  <ul className="border-t border-black/10 pt-2 text-[11px]">
                    {found.events.slice(0, 5).map((e) => <li key={e.event_id}>{fmtDateTime(e.at)} · {e.stage} · {e.result}{e.shipment_id ? ` · ${e.shipment_id}` : ""}</li>)}
                  </ul>
                )}
              </div>
            )}
            <TraceNotice compact />
          </section>
          {scanOpen && <QrScanner title="Scan a batch" hint="Look up its record and scan history" onCode={onCode} onClose={() => setScanOpen(false)} />}
          <button type="button" onClick={() => setView3d(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-500 py-3 text-sm font-bold text-white">
            <Box size={17} aria-hidden />View 3D Warehouse
          </button>
          <Link to="/rescue" className="block rounded-2xl bg-emerald-600 py-3 text-center text-sm font-bold text-white">♻️ Open Expiry Rescue</Link>
          <p className="px-1 text-center text-[11px] text-slate-400">{det.operator}. Planning date {fmtDate(det.planning_date)}.</p>
        </>
      )}
      {view3d && det && (
        <Suspense fallback={<div className="fixed inset-0 z-[1300] grid place-items-center bg-slate-900/60"><Spinner label="Opening 3D warehouse…" /></div>}>
          <Warehouse3DModal details={det} onClose={() => setView3d(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-xl bg-slate-50 py-2"><div className={`text-lg font-bold ${tone}`}>{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>;
}

function Section({ icon: Icon, title, count, tone, empty, children }: {
  icon: typeof Clock; title: string; count: number; tone: "amber" | "red"; empty: string; children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-3 shadow-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon size={16} className={tone === "red" ? "text-rose-600" : "text-amber-500"} aria-hidden />{title}
        <Pill tone={count ? tone : "gray"} className="ml-auto">{count}</Pill>
      </h2>
      {count ? <ul className="mt-1 divide-y divide-slate-100 text-sm">{children}</ul> : <p className="mt-2 text-xs text-slate-500">{empty}</p>}
    </section>
  );
}

function BatchRow({ b }: { b: WarehouseBatch }) {
  const reasons = Object.keys(b.block_reasons ?? {});
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-slate-900">{b.product_name}</span>
        <Pill tone={b.status === "blocked" ? "red" : b.days_to_expiry <= 3 ? "red" : "amber"}>{b.days_to_expiry <= 0 ? "expired" : `${b.days_to_expiry} d left`}</Pill>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
        <span className="font-mono">{b.batch_id}</span><span>{fmtInt(b.quantity)} units</span><span>exp {fmtDate(b.expiry_date)}</span>
        {b.storage_class !== "ambient" && <Snowflake size={12} className="text-sky-500" aria-label="cold storage" />}
      </div>
      {b.status === "blocked" && reasons.length > 0 && <p className="text-[11px] text-rose-600">{reasons.join(", ").replace(/_/g, " ")}</p>}
    </li>
  );
}
