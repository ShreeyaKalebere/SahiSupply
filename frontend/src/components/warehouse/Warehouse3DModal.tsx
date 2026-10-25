import { Box, Building2, Loader2, Map as MapIcon, Snowflake, Truck, TriangleAlert, Warehouse, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WarehouseDetails } from "../../types/api";
import { cx, fmtDate, fmtInt } from "../../utils/format";
import { BLOCK_TEXT } from "../../utils/labels";
import { buildLayout, STATUS_COLOR, STATUS_LABEL, type Bay } from "../../utils/warehouseLayout";
import { Pill } from "../ui";
import { Warehouse2DPlan } from "./Warehouse2DPlan";
import type { Preset, SceneHandle } from "./WarehouseScene";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Immersive 3D warehouse for one warehouse record, with a 2D plan fallback when WebGL is unavailable. */
export default function Warehouse3DModal({ details, onClose }: { details: WarehouseDetails; onClose: () => void }) {
  const layout = useMemo(() => buildLayout(details), [details]);
  const [mode, setMode] = useState<"3d" | "2d">(() => (webglAvailable() ? "3d" : "2d"));
  const [loading, setLoading] = useState(mode === "3d");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Bay | null>(null);
  const [preset, setPreset] = useState<Preset>("overview");
  const asideRef = useRef<HTMLElement>(null);
  // On phones the details panel sits below the scene: show the top of it when a shelf is picked.
  useEffect(() => { asideRef.current?.scrollTo?.({ top: 0 }); }, [selected]);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== "3d" || !hostRef.current) return;
    let live = true;
    setLoading(true);
    setError(null);
    import("./WarehouseScene")
      .then(({ mountWarehouse }) => {
        if (!live || !hostRef.current) return;
        sceneRef.current = mountWarehouse(hostRef.current, layout, {
          onSelect: (b) => live && setSelected(b),
          onReady: () => live && setLoading(false),
        });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "The 3D view could not start.");
        setLoading(false);
      });
    return () => { live = false; sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [mode, layout]);

  const go = (p: Preset) => { setPreset(p); sceneRef.current?.setPreset(p); };
  const pick = (b: Bay) => { setSelected(b); sceneRef.current?.select(b.id); };
  const presets: { key: Preset; label: string; icon: typeof Box; show: boolean }[] = [
    { key: "overview", label: "Overview", icon: Building2, show: true },
    { key: "aisle", label: "Walk the aisle", icon: Warehouse, show: true },
    { key: "cold", label: "Cold zone", icon: Snowflake, show: !!layout.zones.cold },
    { key: "dock", label: "Loading dock", icon: Truck, show: true },
    { key: "quarantine", label: "Quarantine", icon: TriangleAlert, show: !!layout.zones.quarantine },
  ];
  const w = details.warehouse;
  const firstBayOf = (pid: string) => [...layout.bays, ...layout.quarantine].find((b) => b.batch.product_id === pid);

  return (
    <div className="fixed inset-0 z-[1300] flex items-stretch justify-center bg-slate-900/70 sm:p-4" role="dialog" aria-label={`3D warehouse: ${w.name}`}>
      <div className="flex w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-slate-900">{w.name}</h2>
              <Pill tone="blue">{details.industry.name}</Pill>
              <Pill tone="gray">{layout.theme.label}</Pill>
            </div>
            <p className="text-xs text-slate-500">{w.city} · {w.region} · {fmtInt(details.metrics.total_units)} units in {details.metrics.batches} batches</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary py-1.5" onClick={() => setMode(mode === "3d" ? "2d" : "3d")} disabled={mode === "2d" && !webglAvailable()}>
              {mode === "3d" ? <><MapIcon size={14} aria-hidden /> 2D plan</> : <><Box size={14} aria-hidden /> 3D view</>}
            </button>
            <button aria-label="Close 3D warehouse" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative h-[52dvh] min-h-[300px] shrink-0 bg-slate-100 lg:h-auto lg:flex-1">
            {mode === "3d" ? (
              <>
                <div ref={hostRef} className="absolute inset-0" />
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  {presets.filter((p) => p.show).map((p) => (
                    <button key={p.key} onClick={() => go(p.key)}
                      className={cx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-sm",
                        preset === p.key ? "bg-primary-500 text-white" : "bg-white/90 text-slate-700 hover:bg-white")}>
                      <p.icon size={13} aria-hidden /> {p.label}
                    </button>
                  ))}
                </div>
                <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/85 px-2.5 py-1 text-[11px] text-slate-600">
                  Drag to orbit · scroll or pinch to zoom · right-drag or two fingers to pan · tap a shelf for details
                </p>
                {loading && (
                  <div className="absolute inset-0 grid place-items-center bg-slate-100/80" role="status">
                    <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="animate-spin" size={18} aria-hidden /> Building the warehouse…</div>
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 grid place-items-center bg-white p-6 text-center" role="alert">
                    <div>
                      <p className="font-semibold text-slate-800">The 3D view couldn't load.</p>
                      <p className="mt-1 text-sm text-slate-500">{error}</p>
                      <button className="btn-primary mt-4" onClick={() => setMode("2d")}><MapIcon size={14} aria-hidden /> Show 2D plan</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Warehouse2DPlan layout={layout} selectedId={selected?.id ?? null} onSelect={pick} />
            )}
          </div>

          <aside ref={asideRef} className="min-h-0 w-full flex-1 overflow-y-auto border-t border-slate-100 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] lg:w-80 lg:flex-none lg:border-l lg:border-t-0">
            {selected ? <BayDetails bay={selected} total={details.metrics.total_units} onClear={() => { setSelected(null); sceneRef.current?.select(null); }} />
              : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Shelf status</h3>
                  <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                    {(["ok", "expiring", "blocked"] as const).map((s) => (
                      <li key={s} className="flex items-center gap-2"><span className="h-2.5 w-5 rounded-sm" style={{ background: hex(STATUS_COLOR[s]) }} />{STATUS_LABEL[s]}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Products here</h3>
                  <p className="text-xs text-slate-400">Click one to fly to its shelf.</p>
                  <ul className="mt-2 space-y-1">
                    {details.products.map((p) => {
                      const b = firstBayOf(p.product_id);
                      return (
                        <li key={p.product_id}>
                          <button disabled={!b} onClick={() => b && pick(b)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: hex(layout.productColor[p.product_id] ?? 0x94a3b8) }} />
                            <span className="min-w-0 flex-1 truncate text-slate-700">{p.name}</span>
                            <span className="tabular-nums text-xs text-slate-500">{fmtInt(p.units)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  Demonstration layout: rack and bin positions are simulated. Quantities, batches and expiry dates come from the database (synthetic sample data).
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function BayDetails({ bay, total, onClear }: { bay: Bay; total: number; onClear: () => void }) {
  const b = bay.batch;
  const reasons = Object.keys(b.block_reasons).map((k) => BLOCK_TEXT[k.split(" ")[0]] ?? k);
  const rows: [string, string][] = [
    ["Location", bay.zone === "quarantine" ? `Quarantine floor ${bay.id}` : `Bay ${bay.id}`],
    ["Batch", b.batch_id],
    ["Quantity", `${fmtInt(b.quantity)} units (${b.volume_l.toFixed(1)} L)`],
    ["Share of warehouse stock", `${((b.quantity / Math.max(total, 1)) * 100).toFixed(1)}%`],
    ["Expiry", `${fmtDate(b.expiry_date)} · ${b.days_to_expiry} days left`],
    ["Shelf life left", `${b.remaining_life_pct.toFixed(0)}%`],
    ["Storage", b.storage_class === "ambient" ? "Ambient" : b.storage_class === "2-8C" ? "Keep at 2-8 °C" : "Chilled"],
    ["Can be shipped to", `${b.eligible_outlets} of ${b.total_outlets} stores`],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">{b.category}{b.criticality === "critical" ? " · critical" : ""}</div>
          <h3 className="text-base font-semibold text-slate-900">{b.product_name}</h3>
        </div>
        <button className="text-xs text-primary-600 hover:underline" onClick={onClear}>Clear</button>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-white" style={{ background: hex(STATUS_COLOR[b.status]) }}>
        {STATUS_LABEL[b.status]}
      </span>
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v}</dd></div>
        ))}
      </dl>
      {reasons.length > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">Blocked for some stores: {Array.from(new Set(reasons)).join(", ")}.</p>}
      <p className="text-[11px] text-slate-400">Bay position is simulated; batch data is from the database.</p>
    </div>
  );
}
