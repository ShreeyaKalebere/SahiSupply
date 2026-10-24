import { ChevronRight } from "lucide-react";
import type { AllocationRow } from "../types/api";
import { fmtInt } from "../utils/format";
import { lineStatus, STATUS_TEXT } from "../utils/labels";
import { Pill } from "./ui";

export function DeliveryTable({ rows, onOpen, whName, label = "Deliveries" }: {
  rows: AllocationRow[]; onOpen: (r: AllocationRow) => void; whName: (id: string) => string; label?: string;
}) {
  return (
    <div className="overflow-x-auto">
    <table className="tbl min-w-[640px]" aria-label={label}>
      <thead>
        <tr><th>Store</th><th>Product</th><th className="num">Needed</th><th className="num">Sending</th><th>From</th><th>Status</th><th className="w-8"><span className="sr-only">Open</span></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const st = STATUS_TEXT[lineStatus(r)];
          const from = Array.from(new Set(r.sources.map((s) => whName(s.warehouse_id))));
          return (
            <tr key={`${r.outlet_id}|${r.product_id}`} className="clickable" tabIndex={0} onClick={() => onOpen(r)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(r); }}>
              <td><div className="font-medium text-slate-900">{r.outlet_name}</div><div className="text-xs capitalize text-slate-400">{r.outlet_type} · {r.region}</div></td>
              <td>{r.product_name}{r.criticality === "critical" && <Pill tone="red" className="ml-2">critical</Pill>}</td>
              <td className="num">{fmtInt(r.required)}</td>
              <td className="num font-semibold text-slate-900">{fmtInt(r.allocated)}</td>
              <td className="text-xs text-slate-600">{from.length ? from.join(", ") : <span className="text-slate-400">—</span>}</td>
              <td><Pill tone={st.tone}>{st.label}{r.unmet > 0 ? ` · ${fmtInt(r.unmet)} short` : ""}</Pill></td>
              <td className="text-slate-300"><ChevronRight size={16} aria-hidden /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
