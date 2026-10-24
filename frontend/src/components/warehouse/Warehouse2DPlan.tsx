import type { Bay, Layout, Rack } from "../../utils/warehouseLayout";
import { STATUS_COLOR } from "../../utils/warehouseLayout";
import { cx } from "../../utils/format";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** 2D fallback (no WebGL): each rack as a grid of bays (columns) x shelf levels (rows), plus quarantine. */
export function Warehouse2DPlan({ layout, selectedId, onSelect }: { layout: Layout; selectedId: string | null; onSelect: (b: Bay) => void }) {
  const cell = (b: Bay | undefined, key: string) => b ? (
    <button key={key} onClick={() => onSelect(b)} title={`${b.id}: ${b.batch.product_name} (${b.batch.batch_id})`}
      aria-label={`Bay ${b.id}: ${b.batch.product_name}`}
      className={cx("h-7 rounded-sm border-2 transition hover:scale-105", selectedId === b.id && "ring-2 ring-primary-500 ring-offset-1")}
      style={{ background: hex(b.color), borderColor: hex(STATUS_COLOR[b.batch.status]) }} />
  ) : <div key={key} className="h-7 rounded-sm border border-dashed border-slate-300 bg-slate-50" />;

  const rackGrid = (r: Rack, ri: number) => {
    const bays = layout.bays.filter((b) => b.zone === r.zone && b.rack === (r.zone === "cold"
      ? layout.racks.filter((x) => x.zone === "cold").indexOf(r) : ri));
    return (
      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-2">
        <div className="mb-1 text-xs font-semibold text-slate-600">{r.label}</div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${r.bays}, minmax(0, 1fr))` }}>
          {Array.from({ length: r.levels }, (_, li) => r.levels - 1 - li).flatMap((l) =>
            Array.from({ length: r.bays }, (_, s) => cell(bays.find((b) => b.slot === s && b.level === l), `${r.id}-${s}-${l}`)))}
        </div>
      </div>
    );
  };
  const ambient = layout.racks.filter((r) => r.zone === "ambient");
  const cold = layout.racks.filter((r) => r.zone === "cold");
  return (
    <div className="h-full space-y-4 overflow-y-auto bg-slate-100 p-4">
      <p className="text-xs text-slate-500">2D plan (3D is not available on this device). Each square is one shelf bay; colour = product, border = status. Top row = top shelf.</p>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">{layout.theme.ambientLabel}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ambient.map((r, i) => rackGrid(r, i))}</div>
      </section>
      {cold.length > 0 && (
        <section className="rounded-xl bg-sky-50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-sky-800">❄ {layout.theme.coldLabel}</h3>
          <div className="grid gap-3 sm:grid-cols-2">{cold.map((r, i) => rackGrid(r, i))}</div>
        </section>
      )}
      {layout.quarantine.length > 0 && (
        <section className="rounded-xl bg-rose-50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-rose-800">⛔ {layout.theme.quarantineLabel}</h3>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">{layout.quarantine.map((b) => cell(b, b.id))}</div>
        </section>
      )}
    </div>
  );
}
