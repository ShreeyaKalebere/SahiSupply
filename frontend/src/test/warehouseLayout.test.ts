import { describe, expect, it } from "vitest";
import type { WarehouseBatch, WarehouseDetails } from "../types/api";
import { buildLayout, themeFor } from "../utils/warehouseLayout";

const batch = (i: number, over: Partial<WarehouseBatch> = {}): WarehouseBatch => ({
  batch_id: `B${String(i).padStart(3, "0")}`, product_id: `P${String((i % 5) + 1).padStart(2, "0")}`, product_name: `Product ${i % 5}`,
  category: "Cat", storage_class: "ambient", criticality: "standard", quantity: 50 + i * 7, volume_l: 5 + i,
  expiry_date: "2027-06-01", days_to_expiry: 200, remaining_life_pct: 60, eligible_outlets: 12, total_outlets: 12,
  block_reasons: {}, status: "ok", ...over,
});

function details(module: string, batches: WarehouseBatch[]): WarehouseDetails {
  const pids = Array.from(new Set(batches.map((b) => b.product_id)));
  return {
    warehouse: { warehouse_id: "W1", name: "Test DC", city: "X", region: "R", lat: 19, lon: 73, status: "operational", cold_storage: true, outbound_capacity_l: 100 },
    industry: { module, name: module }, operator: "sample",
    metrics: { total_units: 0, total_volume_l: 0, cold_volume_l: 0, ambient_volume_l: 0, storage_capacity_l: 160, storage_capacity_simulated: true, utilization: 0.5, batches: batches.length, products: pids.length, expiring_batches: 0 },
    products: pids.map((p) => ({ product_id: p, name: p, category: "Cat", storage_class: "ambient", criticality: "standard", units: 1, volume_l: 1, batches: 1, nearest_expiry: "2027-01-01", status: "ok", shipped_this_week: null, units_after_plan: null })),
    batches, stockout_risks: [], expiring_batches: [], plan_id: null, planning_date: "2026-10-26", data_source: "mongodb",
    data_notes: { from_database: "", simulated: [] },
  };
}

const overlaps = (a: { x0: number; x1: number; z0: number; z1: number }, b: typeof a) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

describe("warehouse layout", () => {
  it("places every real batch, cold stock in the cold room and blocked stock in quarantine", () => {
    const bs = [
      ...Array.from({ length: 30 }, (_, i) => batch(i)),
      ...Array.from({ length: 12 }, (_, i) => batch(100 + i, { storage_class: "2-8C" })),
      batch(200, { status: "blocked" }), batch(201, { status: "expiring" }),
    ];
    const L = buildLayout(details("pharmacy", bs));
    const placed = new Set([...L.bays, ...L.quarantine].map((b) => b.batch.batch_id));
    expect(placed.size).toBe(bs.length);
    expect(L.bays.filter((b) => b.batch.storage_class === "2-8C").every((b) => b.zone === "cold")).toBe(true);
    expect(L.quarantine.map((b) => b.batch.batch_id)).toEqual(["B200"]);
    expect(new Set(L.bays.map((b) => b.id)).size).toBe(L.bays.length); // unique bin codes
    expect(L.bays.every((b) => b.fill > 0 && b.fill <= 1)).toBe(true);
    expect(L.zones.cold && L.zones.quarantine && overlaps(L.zones.cold, L.zones.quarantine)).toBe(false);
  });

  it("gives each industry its own theme and rack style", () => {
    const g = themeFor("grocery"), p = themeFor("pharmacy"), c = themeFor("cosmetics");
    expect(new Set([g.beam, p.beam, c.beam]).size).toBe(3);
    expect(g.pallets).toBe(true);
    expect(p.pallets).toBe(false);
    expect(buildLayout(details("cosmetics", [batch(1)])).theme.key).toBe("cosmetics");
  });

  it("no cold room or quarantine when there is no such stock", () => {
    const L = buildLayout(details("grocery", Array.from({ length: 5 }, (_, i) => batch(i))));
    expect(L.zones.cold).toBeNull();
    expect(L.zones.quarantine).toBeNull();
    expect(L.racks.filter((r) => r.zone === "ambient").length).toBeGreaterThanOrEqual(2);
  });
});
