import { Loader2 } from "lucide-react";
import { useDeliveries } from "../hooks/useDeliveries";
import { DELIVERY_ACTION, DELIVERY_TEXT, slowestStatus } from "../utils/labels";
import { Pill } from "./ui";

/**
 * Status badge plus the next action for one or more shipments (an order sent from two warehouses
 * rides on two trucks). The action advances every truck still at the order's slowest status.
 */
export function DeliveryStatusCell({ shipmentIds }: { shipmentIds: string[] }) {
  const d = useDeliveries();
  const ships = shipmentIds.map((id) => d.byId[id]).filter(Boolean);
  if (!shipmentIds.length) return <span className="text-xs text-slate-400">Nothing to ship</span>;
  if (!ships.length) {
    if (d.loading) return <Loader2 size={14} className="animate-spin text-slate-400" aria-label="Loading status" />;
    return <span className="text-xs text-slate-400">{d.error ? "Status unavailable" : "—"}</span>;
  }
  const status = slowestStatus(ships.map((s) => s.status))!;
  const action = DELIVERY_ACTION[status];
  const busy = shipmentIds.some((id) => d.pending[id]);
  const err = d.actionError && shipmentIds.includes(d.actionError.shipmentId) ? d.actionError.error : null;
  const targets = ships.filter((s) => s.status === status).map((s) => s.shipment_id);

  return (
    <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <Pill tone={DELIVERY_TEXT[status].tone} title={ships.map((s) => `${s.shipment_id}: ${DELIVERY_TEXT[s.status].label}`).join("\n")}>
          {DELIVERY_TEXT[status].label}
        </Pill>
        {action && (
          <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={busy}
            onClick={() => d.advance(targets, action.to)}>
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{action.label}
          </button>
        )}
      </div>
      {err && <span role="alert" className="text-xs text-rose-600">{err.message}</span>}
    </div>
  );
}
