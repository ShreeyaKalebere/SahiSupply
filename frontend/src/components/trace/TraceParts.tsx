import QRCode from "qrcode";
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { TraceEvent, TraceRecord, TraceScanResult } from "../../types/api";
import { fmtDate, fmtDateTime, fmtInt } from "../../utils/format";
import { DELIVERY_TEXT } from "../../utils/labels";
import { Pill } from "../ui";

export const TRACE_NOTICE = "A QR code only verifies information recorded in SahiSupply; it cannot independently prove that the physical product is genuine.";

export function TraceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl bg-amber-50 text-amber-800 ${compact ? "px-3 py-2 text-[11px]" : "px-4 py-3 text-xs"}`}>
      <ShieldAlert size={compact ? 14 : 16} className="mt-0.5 shrink-0" aria-hidden /><span><b>Important:</b> {TRACE_NOTICE}</span>
    </p>
  );
}

/** QR image for a signed batch payload (generated in the browser). */
export function QrImage({ payload, size = 132 }: { payload: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(payload, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#0f2a4a", light: "#ffffff" } })
      .then((u) => live && setSrc(u)).catch(() => live && setSrc(null));
    return () => { live = false; };
  }, [payload, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR code ${payload.split("|")[2] ?? ""}`} className="block" />
    : <div style={{ width: size, height: size }} className="animate-pulse rounded bg-slate-100" />;
}

export const RESULT_STYLE: Record<TraceEvent["result"], { label: string; cls: string; icon: typeof CheckCircle2; tone: "green" | "amber" | "red" | "gray" }> = {
  ok: { label: "Verified", cls: "border-emerald-300 bg-emerald-50 text-emerald-800", icon: ShieldCheck, tone: "green" },
  warning: { label: "Verified with warnings", cls: "border-amber-300 bg-amber-50 text-amber-800", icon: AlertTriangle, tone: "amber" },
  flagged: { label: "Flagged - do not proceed", cls: "border-rose-300 bg-rose-50 text-rose-800", icon: XCircle, tone: "red" },
  invalid: { label: "Invalid code", cls: "border-slate-300 bg-slate-100 text-slate-700", icon: XCircle, tone: "gray" },
};

export function RecordSummary({ r }: { r: TraceRecord }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <dt className="text-slate-500">Product</dt><dd className="font-medium text-slate-900">{r.product_name}</dd>
      <dt className="text-slate-500">Batch</dt><dd className="font-mono">{r.batch_id}</dd>
      <dt className="text-slate-500">Warehouse</dt><dd>{r.warehouse_name} ({r.warehouse_id})</dd>
      <dt className="text-slate-500">Quantity</dt><dd>{fmtInt(r.quantity)} units</dd>
      <dt className="text-slate-500">Expiry</dt>
      <dd className={r.expired ? "font-semibold text-rose-600" : r.days_to_expiry < r.min_life_days ? "font-semibold text-amber-600" : ""}>
        {fmtDate(r.expiry_date)} · {r.expired ? "expired" : `${r.days_to_expiry} days left`}</dd>
      <dt className="text-slate-500">Planned to</dt>
      <dd>{r.planned_destinations.length ? r.planned_destinations.map((d) => `${d.outlet_name} (${fmtInt(d.qty)})`).join(", ") : "not in this week's plan"}</dd>
    </dl>
  );
}

export function ScanResultCard({ res }: { res: TraceScanResult }) {
  const st = RESULT_STYLE[res.result];
  const Icon = st.icon;
  return (
    <div className={`space-y-2 rounded-xl border-2 p-3 ${st.cls}`} role="status">
      <div className="flex items-center gap-2 font-bold"><Icon size={18} aria-hidden />{st.label}
        {res.event.batch_id && <span className="ml-auto font-mono text-xs font-normal">{res.event.batch_id}</span>}</div>
      {res.flags.length > 0 && (
        <ul className="space-y-1 text-xs">{res.flags.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5"><Pill tone={f.level === "flag" ? "red" : "amber"}>{f.code.replace(/_/g, " ")}</Pill><span>{f.message}</span></li>
        ))}</ul>
      )}
      {res.record && <div className="rounded-lg bg-white/70 p-2"><RecordSummary r={res.record} /></div>}
      {res.progress && (
        <div className="text-xs">
          <div className="mb-1 flex justify-between"><span>Batches scanned for this shipment</span><b>{res.progress.scanned} / {res.progress.total}</b></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/70"><div className="h-full bg-emerald-500" style={{ width: `${(100 * res.progress.scanned) / Math.max(1, res.progress.total)}%` }} /></div>
          {res.progress.missing.length > 0 && <div className="mt-1 text-[11px] opacity-80">Still to scan: {res.progress.missing.join(", ")}</div>}
        </div>
      )}
      {res.event.status_change && (
        <p className="flex items-center gap-1.5 text-xs font-semibold"><CheckCircle2 size={14} aria-hidden />
          Shipment status updated: {DELIVERY_TEXT[res.event.status_change.from as keyof typeof DELIVERY_TEXT]?.label ?? res.event.status_change.from} → {DELIVERY_TEXT[res.event.status_change.to as keyof typeof DELIVERY_TEXT]?.label ?? res.event.status_change.to}</p>
      )}
    </div>
  );
}

export function EventRow({ e }: { e: TraceEvent }) {
  const st = RESULT_STYLE[e.result];
  return (
    <tr>
      <td className="whitespace-nowrap text-xs">{fmtDateTime(e.at)}</td>
      <td><Pill tone={st.tone}>{e.result}</Pill></td>
      <td className="capitalize">{e.stage}</td>
      <td className="font-mono text-xs">{e.batch_id ?? "—"}</td>
      <td className="font-mono text-xs">{e.shipment_id ?? "—"}</td>
      <td className="text-xs text-slate-600">
        {e.flags.map((f) => f.message).join("; ") || "Matches plan"}
        {e.status_change && <div className="font-medium text-emerald-700">Status: {e.status_change.from} → {e.status_change.to}</div>}
      </td>
      <td className="text-xs text-slate-500">{e.device ?? ""}{e.actor ? ` · ${e.actor}` : ""}</td>
    </tr>
  );
}
