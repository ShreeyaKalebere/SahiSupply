import { Camera, CheckCircle2, ChevronDown, ImageIcon, Loader2, MapPin, Package, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { NetworkMap } from "../components/NetworkMap";
import { ErrorBox, Notice, Pill, Spinner } from "../components/ui";
import { useDeliveries } from "../hooks/useDeliveries";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { Shipment } from "../types/api";
import { fmtDate, fmtInt } from "../utils/format";
import { DELIVERY_ACTION, DELIVERY_ORDER, DELIVERY_TEXT } from "../utils/labels";
import { compressPhoto, usePref } from "./mobileUtils";

/** Driver: today's trips from my depot, step-by-step status, photo proof on delivery, route map. */
export default function DriverView() {
  const p = usePlanner();
  const d = useDeliveries();
  const { net, storeName } = useNetwork(p.module);
  const [depot, setDepot] = usePref(`driver.depot.${p.module}`);
  const [selected, setSelected] = useState<string | null>(null);
  const run = p.run;

  const depots = useMemo(() => {
    const ids = new Set(Object.values(d.byId).map((s) => s.warehouse_id));
    return (net?.warehouses ?? []).filter((w) => ids.has(w.warehouse_id));
  }, [d.byId, net]);
  const wid = depots.some((w) => w.warehouse_id === depot) ? depot : depots[0]?.warehouse_id ?? "";
  const ships = Object.values(d.byId).filter((s) => s.warehouse_id === wid)
    .sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete")
      || DELIVERY_ORDER.indexOf(a.status) - DELIVERY_ORDER.indexOf(b.status) || b.qty - a.qty);
  const done = ships.filter((s) => s.status === "delivered" || s.status === "complete").length;

  if (!run) {
    return p.running ? <Spinner label="Loading this week's plan…" /> : (
      <div className="space-y-3 p-4">
        <Notice>No delivery plan yet for this week.</Notice>
        <ErrorBox error={p.runError} />
        <button type="button" className="btn-primary w-full justify-center" onClick={() => p.runPlan()}>Make this week's plan</button>
      </div>
    );
  }
  if (run.chaos) return <div className="p-4"><Notice tone="warn">A disaster simulation is open on the dashboard. Simulated plans have no real deliveries - reset it to see your trips.</Notice></div>;
  if (run.status !== "VALID") return <div className="p-4"><Notice tone="danger">This week's plan did not pass the rule check, so no trips are released.</Notice></div>;

  const wh = net?.warehouses.find((w) => w.warehouse_id === wid);
  const outlets = (net?.outlets ?? []).filter((o) => ships.some((s) => s.outlet_id === o.outlet_id));

  return (
    <div className="space-y-3 p-3">
      <label className="block rounded-2xl bg-white p-3 shadow-card">
        <span className="text-xs font-medium text-slate-500">My depot (trucks leave from)</span>
        <select className="input mt-1 w-full" value={wid} onChange={(e) => { setDepot(e.target.value); setSelected(null); }}>
          {depots.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_id} · {w.name}</option>)}
        </select>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Week of {fmtDate(run.planning_date)}</span><span><b className="text-slate-900">{done}</b> / {ships.length} delivered</span>
        </div>
      </label>

      <ErrorBox error={d.error} onRetry={d.reload} />
      {d.loading && !ships.length && <Spinner label="Loading trips…" />}

      {wh && ships.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <NetworkMap height={230} warehouses={[wh]} outlets={outlets} closedRoads={[]} fillByOutlet={{}}
            flows={ships.filter((s) => s.status !== "complete").map((s) => ({ w: s.warehouse_id, d: s.outlet_id, qty: s.qty }))}
            selectedShipment={selected} onFlowClick={(sid) => setSelected((c) => (c === sid ? null : sid))}
            flowStatus={(sid) => (d.byId[sid] ? DELIVERY_TEXT[d.byId[sid].status].label : undefined)} />
        </div>
      )}

      {ships.map((s) => (
        <TripCard key={s.shipment_id} ship={s} storeName={storeName(s.outlet_id)} city={net?.outlets.find((o) => o.outlet_id === s.outlet_id)?.city}
          open={selected === s.shipment_id} onToggle={() => setSelected((c) => (c === s.shipment_id ? null : s.shipment_id))} />
      ))}
      {!d.loading && !ships.length && !d.error && <p className="py-6 text-center text-sm text-slate-500">No trips from this depot this week.</p>}
      <p className="px-1 text-center text-[11px] text-slate-400">Synthetic sample network. Statuses and photos are saved to the SahiSupply server.</p>
    </div>
  );
}

function TripCard({ ship, storeName, city, open, onToggle }: { ship: Shipment; storeName: string; city?: string; open: boolean; onToggle: () => void }) {
  const p = usePlanner();
  const d = useDeliveries();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [proof, setProof] = useState<{ photo: string; note: string | null } | null>(null);
  const [proofErr, setProofErr] = useState<ApiError | null>(null);
  const busy = !!d.pending[ship.shipment_id];
  const action = DELIVERY_ACTION[ship.status];
  const needsPhoto = action?.to === "delivered";
  const err = d.actionError?.shipmentId === ship.shipment_id ? d.actionError.error : null;
  const lines = (p.run?.optimizer?.lines ?? []).filter((l) => l.warehouse_id === ship.warehouse_id && l.outlet_id === ship.outlet_id);
  const step = DELIVERY_ORDER.indexOf(ship.status);
  const hasProof = ship.history.some((h) => h.proof);

  const onPhoto = async (f: File | undefined) => {
    setPhotoErr(null);
    if (!f) return;
    try {
      setPhoto(await compressPhoto(f));
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : String(e));
    }
  };
  const submit = async () => {
    if (!action) return;
    if (needsPhoto && !photo) { fileRef.current?.click(); return; }
    const ok = await d.advance([ship.shipment_id], action.to, needsPhoto && photo ? { photo, note } : undefined);
    if (ok) { setPhoto(null); setNote(""); }
  };
  const showProof = async () => {
    setProofErr(null);
    try {
      const r = await api.deliveryProof(p.run!.plan_id, ship.shipment_id);
      setProof(r.data);
    } catch (e) {
      setProofErr(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    }
  };

  return (
    <div className={`rounded-2xl bg-white shadow-card ring-2 ${open ? "ring-emerald-400" : "ring-transparent"}`}>
      <button type="button" className="flex w-full items-start gap-3 p-3 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600"><MapPin size={18} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-900">{storeName}</span>
          <span className="block text-xs text-slate-500">{city ? `${city} · ` : ""}{fmtInt(ship.qty)} units · {ship.products} product{ship.products === 1 ? "" : "s"}</span>
          <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{ship.shipment_id}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <Pill tone={DELIVERY_TEXT[ship.status].tone}>{DELIVERY_TEXT[ship.status].label}</Pill>
          <ChevronDown size={16} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      <div className="flex gap-1 px-3" aria-hidden>
        {DELIVERY_ORDER.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-emerald-500" : "bg-slate-200"}`} />)}
      </div>

      <div className="space-y-2 p-3">
        {open && (
          <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 text-sm">
            {lines.map((l) => (
              <li key={l.batch_id} className="flex items-center gap-2 py-2">
                <Package size={14} className="shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{l.product_name}<span className="block font-mono text-[10px] text-slate-400">{l.batch_id} · exp {fmtDate(l.expiry_date)}</span></span>
                <b>{fmtInt(l.qty)}</b>
              </li>
            ))}
          </ul>
        )}

        {needsPhoto && (
          <div className="rounded-xl border border-dashed border-slate-300 p-2">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            {photo ? (
              <div className="space-y-2">
                <div className="relative">
                  <img src={photo} alt="Proof of delivery preview" className="max-h-48 w-full rounded-lg object-cover" />
                  <button type="button" className="absolute right-1 top-1 rounded-full bg-white/90 p-1" aria-label="Remove photo" onClick={() => setPhoto(null)}><X size={14} /></button>
                </div>
                <input className="input w-full" placeholder="Note (optional): received by…" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            ) : (
              <button type="button" className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-primary-600" onClick={() => fileRef.current?.click()}>
                <Camera size={16} aria-hidden />Take proof-of-delivery photo
              </button>
            )}
            {photoErr && <p className="text-xs text-rose-600">{photoErr}</p>}
          </div>
        )}

        {action && (
          <button type="button" disabled={busy || (needsPhoto && !photo)} onClick={submit}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50 ${needsPhoto ? "bg-emerald-600" : "bg-primary-500"}`}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : needsPhoto ? <CheckCircle2 size={16} aria-hidden /> : null}
            {busy ? "Saving…" : needsPhoto && !photo ? "Confirm Delivery (photo needed)" : action.label}
          </button>
        )}
        {err && <p role="alert" className="text-xs text-rose-600">{err.message}</p>}

        {hasProof && (
          proof ? (
            <figure className="space-y-1">
              <img src={proof.photo} alt="Proof of delivery" className="max-h-56 w-full rounded-lg object-cover" />
              {proof.note && <figcaption className="text-xs text-slate-500">“{proof.note}”</figcaption>}
            </figure>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-xs font-medium text-primary-600" onClick={showProof}><ImageIcon size={14} aria-hidden />View proof photo</button>
          )
        )}
        {proofErr && <p className="text-xs text-rose-600">{proofErr.message}</p>}
      </div>
    </div>
  );
}
