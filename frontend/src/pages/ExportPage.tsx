import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { api } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { Notice, PageHeader } from "../components/ui";
import type { Run } from "../types/api";
import { fmtDate, fmtInt, fmtRs } from "../utils/format";
import { MODULE_LABEL, SCENARIO_TEXT } from "../utils/labels";

export default function ExportPage() {
  return (
    <div>
      <div className="no-print">
        <PageHeader title="Download plan" description="A pick list for each warehouse, with the oldest stock first. Download it as a spreadsheet or print it." />
      </div>
      <RunRequired>{(run) => <Body run={run} />}</RunRequired>
    </div>
  );
}

function Body({ run }: { run: Run }) {
  const valid = run.status === "VALID" && !!run.optimizer?.check.valid;
  const lines = [...(run.optimizer?.lines ?? [])].sort((a, b) =>
    a.warehouse_name.localeCompare(b.warehouse_name) || a.expiry_date.localeCompare(b.expiry_date) || a.batch_id.localeCompare(b.batch_id));
  return (
    <div className="space-y-4">
      <div className="no-print grid gap-4 sm:grid-cols-2">
        <a className="card flex items-center gap-4 p-5 hover:shadow-md" href={api.exportUrl(run.plan_id, "optimizer")} download>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 text-white"><FileSpreadsheet size={20} aria-hidden /></span>
          <span><span className="block text-sm font-semibold text-slate-900">Download pick list (CSV)</span><span className="text-xs text-slate-500">Opens in Excel or Google Sheets</span></span>
          <Download size={18} className="ml-auto text-slate-400" aria-hidden />
        </a>
        <button className="card flex items-center gap-4 p-5 text-left hover:shadow-md" onClick={() => window.print()}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-500 text-white"><Printer size={20} aria-hidden /></span>
          <span><span className="block text-sm font-semibold text-slate-900">Print view</span><span className="text-xs text-slate-500">For the warehouse team</span></span>
        </button>
      </div>
      {!valid && <Notice tone="danger">This plan failed the safety check. Do not use it for dispatch.</Notice>}
      <article className="card p-6 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-4 border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold">Pick list - {MODULE_LABEL[run.module] ?? run.module_name}</h2>
          <p className="text-sm text-slate-500">
            Week of {fmtDate(run.planning_date)} · {SCENARIO_TEXT[run.scenario_id].name} · {valid ? "✓ All rules checked" : "NOT VALID - DO NOT DISPATCH"} · Sample data
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-400">Plan {run.plan_id} v{run.version} · fingerprint {run.fingerprint}</p>
        </header>
        <div className="overflow-x-auto"><table className="tbl min-w-[640px]">
          <thead><tr><th>Warehouse</th><th>Product</th><th>Batch</th><th>Expires</th><th>Send to</th><th className="num">Units</th><th className="num">Arrives in</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.batch_id}${l.outlet_id}`}>
                <td>{l.warehouse_name}</td><td>{l.product_name}</td><td className="font-mono text-xs">{l.batch_id}</td><td className="whitespace-nowrap">{fmtDate(l.expiry_date)}</td>
                <td>{l.outlet_name}</td><td className="num font-semibold">{fmtInt(l.qty)}</td><td className="num">{l.lead_time_days} d</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="mt-3 text-xs text-slate-500">{lines.length} lines · {fmtInt(lines.reduce((s, l) => s + l.qty, 0))} units · delivery cost {fmtRs(lines.reduce((s, l) => s + l.line_cost, 0))}</p>
      </article>
    </div>
  );
}
