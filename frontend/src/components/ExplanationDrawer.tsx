import { Ban, CheckCircle2, CircleDollarSign, Gauge, Lock, PackageCheck, Truck, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePlanner } from "../hooks/usePlanner";
import type { Alternative, Explanation, Run } from "../types/api";
import { cx, fmtRs } from "../utils/format";
import { Badge, ErrorBox, Notice } from "./ui";

const ALT_STYLE: Record<Alternative["status"], { label: string; color: "gray" | "red" | "amber" | "blue" | "violet" | "green"; icon: typeof Ban }> = {
  closed: { label: "Closed", color: "red", icon: Lock },
  blocked: { label: "Blocked by rule", color: "red", icon: Ban },
  no_stock: { label: "No stock", color: "gray", icon: XCircle },
  allocated_elsewhere: { label: "Allocated elsewhere", color: "violet", icon: PackageCheck },
  capacity_bound: { label: "Capacity-bound", color: "amber", icon: Gauge },
  costlier: { label: "Costlier", color: "blue", icon: CircleDollarSign },
  equal_cost: { label: "Equal cost", color: "gray", icon: CircleDollarSign },
  not_needed: { label: "Not needed", color: "gray", icon: CheckCircle2 },
  unexplained: { label: "Unused", color: "gray", icon: XCircle },
};

export function ExplanationDrawer({ run, exp, onClose }: { run: Run; exp: Explanation; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1100] flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside role="dialog" aria-label={`Explanation for ${exp.outlet_name} ${exp.product_name}`}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <div className="text-xs text-slate-500">{exp.outlet_id} · {exp.product_id}</div>
            <h2 className="text-base font-semibold text-slate-900">{exp.product_name} → {exp.outlet_name}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {exp.status === "met" ? <Badge color="green">Need met</Badge> : <Badge color="red">{exp.shortage} short</Badge>}
              {exp.criticality === "critical" && <Badge color="red">Critical medicine</Badge>}
              <Badge>{exp.delivered} / {exp.need} units</Badge>
            </div>
          </div>
          <button aria-label="Close explanation" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="space-y-4 px-5 py-4 text-sm">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Need</h3>
            <p className="text-slate-700">{exp.need_text}</p>
          </section>

          {exp.shortage_reason && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Why demand is unmet</h3>
              <Notice tone="warn">{exp.shortage_reason}</Notice>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Chosen sources</h3>
            {exp.sources.length === 0 && <p className="text-slate-500">No shipment for this line.</p>}
            <ul className="space-y-2">
              {exp.sources.map((s) => (
                <li key={s.batch_id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Truck size={14} className="text-slate-500" aria-hidden />
                    <b className="text-slate-800">{s.qty} units</b> · batch {s.batch_id} · {s.warehouse_id}
                    <span className="text-slate-500">· {fmtRs(s.unit_cost, 2)}/unit · {s.life_on_arrival_days} d ({s.life_on_arrival_pct.toFixed(0)}%) on arrival · lead {s.lead_time_days} d</span>
                  </div>
                  <p className="mt-1.5 text-slate-700">{s.why}</p>
                  {s.rules_passed.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">{s.rules_passed.map((r) => <Badge key={r} color="green">{r}</Badge>)}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Why not the other warehouses?</h3>
            {exp.alternatives.length === 0 && <p className="text-slate-500">No other warehouse holds this product.</p>}
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {exp.alternatives.map((a) => {
                const st = ALT_STYLE[a.status];
                return (
                  <li key={a.warehouse_id} className="flex items-start gap-3 px-3 py-2">
                    <span className="w-8 shrink-0 font-mono text-xs font-semibold text-slate-700">{a.warehouse_id}</span>
                    <Badge color={st.color}><st.icon size={11} aria-hidden /> {st.label}</Badge>
                    <span className="text-xs text-slate-700">{a.reason}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <OverrideForm run={run} exp={exp} />
        </div>
      </aside>
    </div>
  );
}

function OverrideForm({ run, exp }: { run: Run; exp: Explanation }) {
  const p = usePlanner();
  const [batch, setBatch] = useState(exp.sources[0]?.batch_id ?? "");
  const current = exp.sources.find((s) => s.batch_id === batch)?.qty ?? 0;
  const [qty, setQty] = useState<string>(String(current));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const valid = run.status === "VALID";

  const submit = async () => {
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      const r = await api.override(run.plan_id, { batch_id: batch.trim(), outlet_id: exp.outlet_id, new_qty: Number(qty), reason });
      p.setRun(r.data);
      setOkMsg(`Override accepted and logged. Plan is now version ${r.data.version}; the checker re-validated every constraint.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };

  const violations = (err?.details as { violations?: { code: string; message: string; entity: string }[] } | undefined)?.violations;
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Planner override</h3>
      {!valid ? <p className="text-xs text-slate-500">Overrides are only possible on a valid optimized plan.</p> : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 text-xs text-slate-600">Batch
              <input className="input mt-0.5 w-full font-mono" list={`batches-${exp.outlet_id}-${exp.product_id}`} value={batch}
                onChange={(e) => { setBatch(e.target.value); setQty(String(exp.sources.find((s) => s.batch_id === e.target.value)?.qty ?? 0)); }} />
              <datalist id={`batches-${exp.outlet_id}-${exp.product_id}`}>
                {exp.sources.map((s) => <option key={s.batch_id} value={s.batch_id} />)}
              </datalist>
            </label>
            <label className="text-xs text-slate-600">New quantity
              <input className="input mt-0.5 w-full" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
          </div>
          <label className="block text-xs text-slate-600">Reason (required, logged)
            <input className="input mt-0.5 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Outlet confirmed a smaller delivery window" />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn-primary" disabled={busy || reason.trim().length < 3 || !batch || qty === ""} onClick={() => void submit()}>
              {busy ? "Checking…" : "Validate & apply"}
            </button>
            <span className="text-[11px] text-slate-500">Current: {current} units. The independent checker must pass before the change is accepted.</span>
          </div>
          {okMsg && <Notice>{okMsg}</Notice>}
          {err && (
            <div className={cx("space-y-1")}>
              <ErrorBox error={err} />
              {violations && violations.length > 0 && (
                <ul className="list-inside list-disc text-xs text-red-800">
                  {violations.slice(0, 6).map((v, i) => <li key={i}><b>{v.code}</b> {v.entity}: {v.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
