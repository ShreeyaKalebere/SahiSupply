import { Ban, CheckCircle2, CircleDollarSign, Gauge, Lock, PackageCheck, Truck, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import type { Alternative, Explanation, Run } from "../types/api";
import { fmtDate, fmtInt } from "../utils/format";
import { altSentence, lineStatus, STATUS_TEXT } from "../utils/labels";
import { Details, Notice, Pill } from "./ui";

const ALT_ICON: Record<Alternative["status"], { icon: typeof Ban; cls: string }> = {
  closed: { icon: Lock, cls: "text-rose-500" },
  blocked: { icon: Ban, cls: "text-rose-500" },
  no_stock: { icon: XCircle, cls: "text-slate-400" },
  allocated_elsewhere: { icon: PackageCheck, cls: "text-violet-500" },
  capacity_bound: { icon: Gauge, cls: "text-amber-500" },
  costlier: { icon: CircleDollarSign, cls: "text-primary-500" },
  equal_cost: { icon: CircleDollarSign, cls: "text-slate-400" },
  not_needed: { icon: CheckCircle2, cls: "text-emerald-500" },
  unexplained: { icon: XCircle, cls: "text-slate-400" },
};

function storeLimit(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.includes("cold capacity full")) return "This store's fridge is already full.";
  if (reason.includes("receiving capacity full")) return "This store has no more space to receive goods.";
  return null;
}

export function ExplanationDrawer({ run, exp, onClose }: { run: Run; exp: Explanation; onClose: () => void }) {
  const { whName } = useNetwork(run.module);
  const st = STATUS_TEXT[lineStatus({ allocated: exp.delivered, unmet: exp.shortage })];
  const limit = storeLimit(exp.shortage_reason);
  return (
    <div className="fixed inset-0 z-[1100] flex justify-end bg-slate-900/25" onClick={onClose}>
      <aside role="dialog" aria-label={`Why: ${exp.product_name} to ${exp.outlet_name}`}
        className="h-full w-full max-w-lg overflow-y-auto bg-page shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <div className="text-xs text-slate-500">Delivery to {exp.outlet_name}</div>
            <h2 className="text-lg font-bold text-slate-900">{exp.product_name}</h2>
            <div className="mt-1 flex gap-1.5"><Pill tone={st.tone}>{st.label}</Pill>{exp.criticality === "critical" && <Pill tone="red">Critical medicine</Pill>}</div>
          </div>
          <button aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-3 gap-3">
            {[["Needed", exp.need, "text-slate-900"], ["Sending", exp.delivered, "text-primary-600"], ["Short", exp.shortage, exp.shortage ? "text-rose-600" : "text-emerald-600"]].map(([l, v, c]) => (
              <div key={l as string} className="card p-3 text-center">
                <div className="text-xs text-slate-500">{l}</div>
                <div className={`text-2xl font-bold tabular-nums ${c}`}>{fmtInt(v as number)}</div>
              </div>
            ))}
          </div>

          {exp.shortage > 0 && (
            <Notice tone="warn">
              <div className="font-semibold">Why {fmtInt(exp.shortage)} units are short</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {limit && <li>{limit}</li>}
                {exp.alternatives.length === 0 && !limit && <li>No other warehouse stocks this product, and the chosen one has run out.</li>}
                {exp.alternatives.map((a) => <li key={a.warehouse_id}>{altSentence(a, whName)}</li>)}
                {exp.sources.length > 0 && !limit && <li>{whName(exp.sources[0].warehouse_id)} sent all it could.</li>}
              </ul>
            </Notice>
          )}

          <section className="card p-4">
            <h3 className="text-sm font-semibold text-slate-900">Where it comes from</h3>
            {exp.sources.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing can be sent this week.</p>}
            <ul className="mt-3 space-y-3">
              {exp.sources.map((s) => (
                <li key={s.batch_id} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-500"><Truck size={16} aria-hidden /></span>
                  <div className="text-sm">
                    <div className="font-medium text-slate-900">{whName(s.warehouse_id)} sends {fmtInt(s.qty)}</div>
                    <div className="text-xs text-slate-500">
                      Arrives in {s.lead_time_days} day{s.lead_time_days > 1 ? "s" : ""} with {s.life_on_arrival_days} days before expiry · ₹{s.unit_cost.toFixed(2)} per unit to deliver
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {s.why.includes("Lowest feasible") ? "✓ The cheapest warehouse that can deliver it fresh." : "✓ Cheaper warehouses couldn't help (see below)."}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {exp.alternatives.length > 0 && (
            <section className="card p-4">
              <h3 className="text-sm font-semibold text-slate-900">Why not the other warehouses?</h3>
              <ul className="mt-3 space-y-2.5">
                {exp.alternatives.map((a) => {
                  const I = ALT_ICON[a.status];
                  return (
                    <li key={a.warehouse_id} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <I.icon size={16} className={`mt-0.5 shrink-0 ${I.cls}`} aria-hidden /> {altSentence(a, whName)}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Details label="Show how the need was calculated">
            <p>{exp.need_text}</p>
            <ul className="mt-2 space-y-1">
              {exp.sources.map((s) => <li key={s.batch_id}>Batch {s.batch_id} from {s.warehouse_id}, expires {fmtDate(s.expiry_date)}. {s.why}</li>)}
              {exp.alternatives.map((a) => <li key={a.warehouse_id}>{a.warehouse_id}: {a.reason}</li>)}
            </ul>
          </Details>

          <OverrideForm run={run} exp={exp} />
        </div>
      </aside>
    </div>
  );
}

function OverrideForm({ run, exp }: { run: Run; exp: Explanation }) {
  const p = usePlanner();
  const { whName } = useNetwork(run.module);
  const [batch, setBatch] = useState(exp.sources[0]?.batch_id ?? "");
  const current = exp.sources.find((s) => s.batch_id === batch)?.qty ?? 0;
  const [qty, setQty] = useState<string>(String(current));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  if (run.status !== "VALID" || exp.sources.length === 0) return null;

  const submit = async () => {
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      const r = await api.override(run.plan_id, { batch_id: batch, outlet_id: exp.outlet_id, new_qty: Number(qty), reason });
      p.setRun(r.data);
      setOkMsg("Saved. We re-checked every rule and your change is safe.");
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };
  const violations = (err?.details as { violations?: { code: string; message: string }[] } | undefined)?.violations;
  return (
    <Details label="Show: change this delivery">
      <div className="space-y-3">
        <p>Want to send a different amount? Enter it below with a short reason. We re-check every rule before saving.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600">From
            <select className="input mt-1 w-full" value={batch} onChange={(e) => { setBatch(e.target.value); setQty(String(exp.sources.find((s) => s.batch_id === e.target.value)?.qty ?? 0)); }}>
              {exp.sources.map((s) => <option key={s.batch_id} value={s.batch_id}>{whName(s.warehouse_id)} (batch {s.batch_id})</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">New quantity
            <input className="input mt-1 w-full" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        </div>
        <label className="block text-xs text-slate-600">Reason
          <input className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Store asked for a smaller delivery" />
        </label>
        <button className="btn-primary" disabled={busy || reason.trim().length < 3 || qty === ""} onClick={() => void submit()}>
          {busy ? "Checking…" : "Check & save"}
        </button>
        {okMsg && <Notice>{okMsg}</Notice>}
        {err && (
          <div className="space-y-1">
            <Notice tone="danger"><b>Not saved - this change would break a rule.</b></Notice>
            <ul className="list-inside list-disc text-xs text-rose-700">
              {(violations ?? [{ code: err.code, message: err.message }]).slice(0, 5).map((v, i) => <li key={i}>{v.message}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Details>
  );
}
