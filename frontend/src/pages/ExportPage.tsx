import { Download, Printer } from "lucide-react";
import { api } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { Notice, PageHeader } from "../components/ui";
import type { Run } from "../types/api";
import { fmtDate, fmtInt, fmtRs } from "../utils/format";

export default function ExportPage() {
  return (
    <div>
      <div className="no-print">
        <PageHeader title="Plan export" description="Pick list in FEFO order (by warehouse, then earliest expiry). The CSV and the print view carry the module, scenario, data fingerprint, plan status and generation time." />
      </div>
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const valid = run.status === "VALID" && !!run.optimizer?.check.valid;
  const lines = [...(run.optimizer?.lines ?? [])].sort((a, b) =>
    a.warehouse_id.localeCompare(b.warehouse_id) || a.expiry_date.localeCompare(b.expiry_date) || a.batch_id.localeCompare(b.batch_id));
  const generated = new Date().toISOString();
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap gap-2">
        <a className="btn-primary" href={api.exportUrl(run.plan_id, "optimizer")} download><Download size={14} aria-hidden /> Optimized pick list (CSV)</a>
        <a className="btn-secondary" href={api.exportUrl(run.plan_id, "baseline")} download><Download size={14} aria-hidden /> Baseline (CSV)</a>
        <button className="btn-secondary" onClick={() => window.print()}><Printer size={14} aria-hidden /> Print view</button>
      </div>
      {!valid && <Notice tone="danger">This plan is not valid. Export is labelled INVALID and must not be used for dispatch.</Notice>}
      <article className="rounded-lg border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <header className="mb-4 border-b border-slate-200 pb-3">
          <h2 className="text-lg font-semibold">SahiSupply pick list - {run.module_name}</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-slate-600 md:grid-cols-3">
            <div>Scenario: <b>{run.scenario_id} {run.scenario.name}</b></div>
            <div>Plan: <b>{run.plan_id} v{run.version}</b></div>
            <div>Status: <b className={valid ? "text-emerald-700" : "text-red-700"}>{valid ? run.plan_status : "INVALID - DO NOT DISPATCH"}</b></div>
            <div>Planning week from: <b>{fmtDate(run.planning_date)}</b></div>
            <div className="col-span-2">Data fingerprint: <span className="font-mono">{run.fingerprint}</span></div>
            <div>Generated: {generated}</div>
            <div>Synthetic data - demonstration only</div>
          </dl>
        </header>
        <table className="tbl">
          <thead><tr><th>Warehouse</th><th>Batch</th><th>Expiry</th><th>Product</th><th>Destination</th><th className="num">Qty</th><th className="num">Lead</th><th className="num">Life on arrival</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.batch_id}${l.outlet_id}`}>
                <td>{l.warehouse_id}</td><td className="font-mono text-xs">{l.batch_id}</td><td className="whitespace-nowrap">{l.expiry_date}</td>
                <td>{l.product_name}</td><td>{l.outlet_id} {l.outlet_name}</td><td className="num">{fmtInt(l.qty)}</td>
                <td className="num">{l.lead_time_days} d</td><td className="num">{l.life_on_arrival_days} d</td><td className="num">{fmtRs(l.line_cost, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">{lines.length} lines · {fmtInt(lines.reduce((s, l) => s + l.qty, 0))} units · total delivery cost {fmtRs(lines.reduce((s, l) => s + l.line_cost, 0), 2)}</p>
      </article>
    </div>
  );
}
