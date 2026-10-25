import { Printer, QrCode, RefreshCw, ScanLine, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { RunRequired } from "../components/RunRequired";
import { QrScanner } from "../components/trace/QrScanner";
import { EventRow, QrImage, RecordSummary, ScanResultCard, TraceNotice } from "../components/trace/TraceParts";
import { Card, ErrorBox, Notice, PageHeader, Spinner, Tabs } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useDeliveries } from "../hooks/useDeliveries";
import { useNetwork } from "../hooks/useNetwork";
import type { Run, TraceEvent, TraceRecord, TraceScanResult } from "../types/api";
import { fmtDate, fmtInt } from "../utils/format";
import { DELIVERY_TEXT } from "../utils/labels";

export default function TracePage() {
  return (
    <div>
      <div className="no-print">
        <PageHeader title="QR traceability"
          description="Every batch gets a signed QR code linked to its product, warehouse, quantity, expiry and planned destination. Scan at dispatch and at delivery: wrong or expired batches are flagged, delivery status updates automatically, and every scan is kept in a traceable event log." />
        <div className="mb-4"><TraceNotice /></div>
      </div>
      <RunRequired>{(run) => <TraceBody run={run} />}</RunRequired>
    </div>
  );
}

type Tab = "scan" | "labels" | "log";

function TraceBody({ run }: { run: Run }) {
  const [tab, setTab] = useState<Tab>("scan");
  const [logTick, setLogTick] = useState(0);
  if (run.chaos) return <Notice tone="warn">A disaster simulation is active. Reset it on the dashboard to scan against the real plan.</Notice>;
  if (run.status !== "VALID") return <Notice tone="danger">This plan did not pass the rule check, so it can't be scanned against.</Notice>;
  return (
    <div className="space-y-4">
      <div className="no-print"><Tabs<Tab> label="Traceability" value={tab} onChange={setTab} options={[
        { value: "scan", label: "Scan station" }, { value: "labels", label: "Batch QR labels" }, { value: "log", label: "Event log" }]} /></div>
      {tab === "scan" && <ScanStation run={run} onScanned={() => setLogTick((t) => t + 1)} />}
      {tab === "labels" && <Labels run={run} />}
      {tab === "log" && <EventLog run={run} tick={logTick} />}
    </div>
  );
}

function ScanStation({ run, onScanned }: { run: Run; onScanned: () => void }) {
  const d = useDeliveries();
  const { storeName, whName } = useNetwork(run.module);
  const ships = useMemo(() => Object.values(d.byId).sort((a, b) => a.shipment_id.localeCompare(b.shipment_id, undefined, { numeric: true })), [d.byId]);
  const [sid, setSid] = useState("");
  const [stage, setStage] = useState<"dispatch" | "delivery">("dispatch");
  const [actor, setActor] = useState("");
  const [scanning, setScanning] = useState<null | "scan" | "lookup">(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TraceScanResult | null>(null);
  const [lookup, setLookup] = useState<{ record: TraceRecord; events: TraceEvent[] } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const ship = d.byId[sid];

  const onCode = async (code: string) => {
    const mode = scanning;
    setScanning(null);
    setBusy(true);
    setError(null);
    setRes(null);
    setLookup(null);
    try {
      if (mode === "lookup") {
        setLookup((await api.traceResolve(code, run.plan_id)).data);
      } else {
        const r = (await api.traceScan({ code, plan_id: run.plan_id, stage, shipment_id: sid || null, actor: actor || null, device: "web" })).data;
        setRes(r);
        if (r.event.status_change) d.reload();
        onScanned();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Scan a batch" icon={ScanLine}>
        <div className="space-y-3">
          <label className="block text-sm">Shipment (truck trip)
            <select className="input mt-1 w-full" value={sid} onChange={(e) => setSid(e.target.value)}>
              <option value="">Choose a shipment…</option>
              {ships.map((s) => <option key={s.shipment_id} value={s.shipment_id}>{s.shipment_id} · {whName(s.warehouse_id)} → {storeName(s.outlet_id)} · {DELIVERY_TEXT[s.status].label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs<"dispatch" | "delivery"> label="Scan stage" value={stage} onChange={setStage}
              options={[{ value: "dispatch", label: "At dispatch" }, { value: "delivery", label: "At delivery" }]} />
            <input className="input w-44" placeholder="Your name (optional)" maxLength={80} value={actor} onChange={(e) => setActor(e.target.value)} />
          </div>
          {ship && <p className="text-xs text-slate-500">{ship.products} batch line(s), {fmtInt(ship.qty)} units · status <b>{DELIVERY_TEXT[ship.status].label}</b>.
            {stage === "dispatch" ? " When every batch is scanned OK, the shipment becomes Dispatched." : " When every batch is scanned OK, the shipment becomes Delivered."}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={!sid || busy} onClick={() => setScanning("scan")}><ScanLine size={15} aria-hidden />Scan at {stage}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setScanning("lookup")}><Search size={15} aria-hidden />Look up a code</button>
          </div>
          {busy && <Spinner label="Checking code…" />}
          <ErrorBox error={error} />
          {res && <ScanResultCard res={res} />}
          {lookup && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">Code is genuine for this system - batch record:</p>
              <RecordSummary r={lookup.record} />
              <p className="text-xs text-slate-500">{lookup.events.length} scan event(s) recorded for this batch.</p>
            </div>
          )}
        </div>
      </Card>
      <Card title="How scanning works" icon={QrCode}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Print the batch labels (Batch QR labels tab) and stick one on each batch.</li>
          <li>At the warehouse, pick the truck's shipment and <b>scan at dispatch</b>. A batch that isn't planned for this truck, or is expired, is <b>flagged</b> and doesn't count.</li>
          <li>When every planned batch is scanned, the shipment becomes <b>Dispatched</b> automatically.</li>
          <li>At the store, <b>scan at delivery</b>. When all batches match, it becomes <b>Delivered</b>.</li>
          <li>Every scan - good or flagged - is saved in the <b>event log</b> with time, stage, device and person.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-400">Codes are signed by this server (HMAC), so codes not issued by SahiSupply are rejected as invalid.</p>
      </Card>
      {scanning && <QrScanner title={scanning === "lookup" ? "Look up a batch code" : `Scan at ${stage}`} hint={sid ? `Shipment ${sid}` : undefined}
        onCode={onCode} onClose={() => setScanning(null)} />}
    </div>
  );
}

function Labels({ run }: { run: Run }) {
  const { net } = useNetwork(run.module);
  const d = useDeliveries();
  const [wid, setWid] = useState("");
  const [sid, setSid] = useState("");
  const whs = net?.warehouses ?? [];
  const w = wid || whs[0]?.warehouse_id || "";
  const q = useAsync(() => (w ? api.traceLabels(run.module, run.plan_id, w, sid || null) : Promise.resolve({ data: [], meta: {} })), [run.plan_id, w, sid]);
  const ships = Object.values(d.byId).filter((s) => s.warehouse_id === w);

  return (
    <Card title="Batch QR labels" icon={QrCode} bodyClass="px-4 pb-4 pt-3"
      actions={<button type="button" className="btn-secondary no-print" onClick={() => window.print()} disabled={!q.data?.length}><Printer size={15} aria-hidden />Print labels</button>}>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <select className="input" aria-label="Warehouse" value={w} onChange={(e) => { setWid(e.target.value); setSid(""); }}>
          {whs.map((x) => <option key={x.warehouse_id} value={x.warehouse_id}>{x.warehouse_id} · {x.name}</option>)}
        </select>
        <select className="input" aria-label="Shipment" value={sid} onChange={(e) => setSid(e.target.value)}>
          <option value="">All batches in this warehouse</option>
          {ships.map((s) => <option key={s.shipment_id} value={s.shipment_id}>Only {s.shipment_id}</option>)}
        </select>
      </div>
      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Spinner /> : (
        <div className="label-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(q.data ?? []).map((l) => (
            <div key={l.payload} className="label-card flex gap-3 rounded-xl border border-slate-200 p-3">
              <QrImage payload={l.payload} />
              <div className="min-w-0 text-xs">
                <img src="/brand/logo.png" alt="SahiSupply" className="mb-1 h-4 w-auto" />
                <div className="font-semibold text-slate-900">{l.record.product_name}</div>
                <div className="font-mono text-slate-700">{l.record.batch_id}</div>
                <div className="text-slate-500">{l.record.warehouse_name}</div>
                <div>{fmtInt(l.record.quantity)} units · exp <b className={l.record.expired ? "text-rose-600" : ""}>{fmtDate(l.record.expiry_date)}</b></div>
                <div className="mt-1 text-slate-500">To: {l.record.planned_destinations.map((x) => x.outlet_name).join(", ") || "not planned this week"}</div>
              </div>
            </div>
          ))}
          {q.data && q.data.length === 0 && <p className="text-sm text-slate-500">No batches here.</p>}
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-400">Synthetic sample data. A QR code only verifies information recorded in SahiSupply; it cannot prove the physical product is genuine.</p>
    </Card>
  );
}

function EventLog({ run, tick }: { run: Run; tick: number }) {
  const [sid, setSid] = useState("");
  const d = useDeliveries();
  const q = useAsync(() => api.traceEvents({ plan_id: run.plan_id, shipment_id: sid || null, limit: 500 }), [run.plan_id, sid, tick]);
  return (
    <Card title="Traceable event log" subtitle="Every scan, newest first (stored in MongoDB)" bodyClass="px-2 pb-4 pt-3"
      actions={<div className="flex gap-2">
        <select className="input" aria-label="Filter by shipment" value={sid} onChange={(e) => setSid(e.target.value)}>
          <option value="">All shipments</option>
          {Object.keys(d.byId).sort().map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={q.reload}><RefreshCw size={15} aria-hidden />Refresh</button>
      </div>}>
      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Spinner /> : (q.data?.length ?? 0) === 0 ? <p className="px-3 text-sm text-slate-500">No scans yet for this plan.</p> : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="tbl min-w-[900px]" aria-label="Scan events">
            <thead><tr><th>Time</th><th>Result</th><th>Stage</th><th>Batch</th><th>Shipment</th><th>Details</th><th>By</th></tr></thead>
            <tbody>{q.data!.map((e) => <EventRow key={e.event_id} e={e} />)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
