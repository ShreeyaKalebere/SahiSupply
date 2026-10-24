// Turns a warehouse's real batches into a rack layout (racks, bays, zones) shared by the 3D scene and
// the 2D fallback. Rack and bin positions are simulated - the data has no locations - but every bay
// holds a real batch with its real quantity, expiry and status.
import type { WarehouseBatch, WarehouseDetails } from "../types/api";

export type Zone = "ambient" | "cold" | "quarantine";

export interface Theme {
  key: string;
  label: string;
  floor: number; upright: number; beam: number; deck: number; wall: number;
  coldTint: number; palette: number[];
  carton: { w: number; h: number; d: number; cols: number; rows: number; layers: number };
  pallets: boolean;            // pallet racking (grocery) vs shelving (pharmacy, cosmetics)
  levels: number;              // shelf levels per ambient rack
  coldLabel: string; ambientLabel: string; quarantineLabel: string;
}

export const THEMES: Record<string, Theme> = {
  grocery: {
    key: "grocery", label: "FMCG pallet racking",
    floor: 0x9ca3af, upright: 0x1d4ed8, beam: 0xf97316, deck: 0x6b7280, wall: 0xe5e7eb, coldTint: 0x7dd3fc,
    palette: [0xc08552, 0xd9a066, 0xb45309, 0xdc2626, 0x16a34a, 0xeab308, 0x2563eb, 0x9a3412, 0xca8a04, 0x65a30d],
    carton: { w: 0.78, h: 0.5, d: 0.5, cols: 3, rows: 2, layers: 2 }, pallets: true, levels: 4,
    coldLabel: "Chilled dairy room", ambientLabel: "Dry goods racking", quarantineLabel: "Hold / expired stock",
  },
  pharmacy: {
    key: "pharmacy", label: "GDP pharmaceutical shelving",
    floor: 0xcbd5e1, upright: 0xf8fafc, beam: 0x0284c7, deck: 0xe2e8f0, wall: 0xf1f5f9, coldTint: 0x38bdf8,
    palette: [0x93c5fd, 0x86efac, 0xfde68a, 0xc4b5fd, 0x67e8f9, 0xfca5a5, 0xfdba74, 0x5eead4, 0xf9a8d4, 0xbef264],
    carton: { w: 0.5, h: 0.32, d: 0.36, cols: 4, rows: 3, layers: 2 }, pallets: false, levels: 5,
    coldLabel: "2-8 °C cold room (reefer vault)", ambientLabel: "Ambient medicine racks", quarantineLabel: "Quarantine - blocked batches",
  },
  cosmetics: {
    key: "cosmetics", label: "Beauty retail shelving",
    floor: 0xe7e5e4, upright: 0xd6d3d1, beam: 0xdb2777, deck: 0xf5f5f4, wall: 0xfafaf9, coldTint: 0xa5f3fc,
    palette: [0xf9a8d4, 0xc4b5fd, 0xfcd34d, 0x86efac, 0xfda4af, 0xa5b4fc, 0xf0abfc, 0xfde68a, 0x99f6e4, 0xfbcfe8],
    carton: { w: 0.42, h: 0.3, d: 0.32, cols: 5, rows: 3, layers: 2 }, pallets: false, levels: 4,
    coldLabel: "Cool cabinet zone (serums)", ambientLabel: "Beauty shelving", quarantineLabel: "Hold - near-expiry stock",
  },
};

export const themeFor = (module: string): Theme => THEMES[module] ?? THEMES.grocery;

// Rack geometry (metres)
export const BAY_W = 2.7;
export const RACK_D = 1.1;
export const LEVEL_H = 1.45;
const BAYS_PER_RACK = 4;
const RACKS_PER_ROW = 3;
const AISLE = 3.2;
const COLD_BAYS = 3;
const COLD_LEVELS = 3;

export interface Bay {
  id: string;            // "A-03-2" style bin code
  zone: Zone;
  rack: number;
  slot: number;
  level: number;
  x: number; y: number; z: number;   // centre of the bay's load space
  fill: number;          // 0-1 share of the bay filled by this batch
  batch: WarehouseBatch;
  color: number;
}

export interface Rack {
  id: string; zone: Zone; x: number; z: number; bays: number; levels: number; label: string;
}

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export interface Layout {
  theme: Theme;
  racks: Rack[];
  bays: Bay[];
  quarantine: Bay[];     // blocked batches stored as floor pallets
  width: number; depth: number;
  zones: { cold: Rect | null; quarantine: Rect | null; dock: Rect };
  productColor: Record<string, number>;
  productSigns: { text: string; x: number; y: number; z: number }[];
}

/** Slots a batch needs (1-4, by volume) and how full each slot is. */
function slotsFor(b: WarehouseBatch, maxVol: number): { n: number; fill: number } {
  const slotCap = Math.max(maxVol / 4, 1e-6);
  const n = Math.min(4, Math.max(1, Math.ceil(b.volume_l / slotCap)));
  return { n, fill: Math.min(1, Math.max(0.25, b.volume_l / (n * slotCap))) };
}

export function buildLayout(details: WarehouseDetails): Layout {
  const theme = themeFor(details.industry.module);
  const productColor: Record<string, number> = {};
  details.products.forEach((p, i) => { productColor[p.product_id] = theme.palette[i % theme.palette.length]; });

  const blocked = details.batches.filter((b) => b.status === "blocked");
  const cold = details.batches.filter((b) => b.status !== "blocked" && b.storage_class !== "ambient");
  const ambient = details.batches.filter((b) => b.status !== "blocked" && b.storage_class === "ambient");
  const maxVol = Math.max(1e-6, ...details.batches.map((b) => b.volume_l));

  const expand = (list: WarehouseBatch[]) => list.flatMap((b) => {
    const { n, fill } = slotsFor(b, maxVol);
    return Array.from({ length: n }, () => ({ batch: b, fill }));
  });
  const ambientSlots = expand(ambient);
  const coldSlots = expand(cold);

  const ambientPerRack = BAYS_PER_RACK * theme.levels;
  const ambientRacks = Math.max(2, Math.ceil(ambientSlots.length / ambientPerRack));
  const coldPerRack = COLD_BAYS * COLD_LEVELS;
  const coldRacks = coldSlots.length ? Math.ceil(coldSlots.length / coldPerRack) : 0;

  // Ambient block: rows of up to 3 racks along X; rows step back along -Z with an aisle in front of each.
  const rackLen = BAYS_PER_RACK * BAY_W;
  const rows = Math.ceil(ambientRacks / RACKS_PER_ROW);
  const ambientW = Math.min(ambientRacks, RACKS_PER_ROW) * (rackLen + 1.2);
  const rowPitch = RACK_D + AISLE;
  const coldRoomW = coldRacks ? COLD_BAYS * BAY_W + 4 : 0;
  const quarantineW = blocked.length ? 8.5 : 0;
  const width = Math.max(ambientW + coldRoomW + 6, 24);
  // Deep enough for the longer of the ambient rows and the cold room, plus a 14 m staging/dock area
  // at the front (+Z) where the quarantine cage sits, so zones never overlap.
  const depth = Math.max(rows, coldRacks) * rowPitch + 14;
  const x0 = -width / 2 + 2;
  const zBack = -depth / 2 + 2;

  const racks: Rack[] = [];
  const bays: Bay[] = [];
  const signs: Layout["productSigns"] = [];
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));

  const placeSlots = (slots: { batch: WarehouseBatch; fill: number }[], zone: Zone, rackDefs: Rack[], bpr: number, levels: number) => {
    let k = 0;
    rackDefs.forEach((r, ri) => {
      for (let s = 0; s < bpr; s++) {
        for (let l = 0; l < levels && k < slots.length; l++, k++) {
          const { batch, fill } = slots[k];
          bays.push({
            id: `${r.id}-${String(s + 1).padStart(2, "0")}-${l + 1}`, zone, rack: ri, slot: s, level: l,
            x: r.x - (bpr * BAY_W) / 2 + BAY_W * (s + 0.5), y: 0.15 + l * LEVEL_H, z: r.z,
            fill, batch, color: productColor[batch.product_id] ?? theme.palette[0],
          });
        }
      }
    });
  };

  for (let i = 0; i < ambientRacks; i++) {
    const row = Math.floor(i / RACKS_PER_ROW), col = i % RACKS_PER_ROW;
    racks.push({ id: letter(i), zone: "ambient", x: x0 + rackLen / 2 + col * (rackLen + 1.2), z: zBack + 1 + row * rowPitch,
      bays: BAYS_PER_RACK, levels: theme.levels, label: `Rack ${letter(i)}` });
  }
  placeSlots(ambientSlots, "ambient", racks.slice(), BAYS_PER_RACK, theme.levels);

  let coldRect: Rect | null = null;
  if (coldRacks) {
    const cx0 = width / 2 - coldRoomW - 1;
    coldRect = { x0: cx0, x1: width / 2 - 1, z0: zBack - 1, z1: zBack - 1 + coldRacks * rowPitch + 2.5 };
    const coldDefs: Rack[] = [];
    for (let i = 0; i < coldRacks; i++) {
      coldDefs.push({ id: `C${i + 1}`, zone: "cold", x: (coldRect.x0 + coldRect.x1) / 2, z: zBack + 1 + i * rowPitch,
        bays: COLD_BAYS, levels: COLD_LEVELS, label: `Cold ${i + 1}` });
    }
    racks.push(...coldDefs);
    placeSlots(coldSlots, "cold", coldDefs, COLD_BAYS, COLD_LEVELS);
  }

  // Quarantine cage near the front-right; blocked batches sit on floor pallets.
  let qRect: Rect | null = null;
  const quarantine: Bay[] = [];
  if (blocked.length) {
    // 1 m in front of the rack/cold-room block (which ends by depth/2 - 10.5) and behind the dock strip (depth/2 - 5)
    qRect = { x0: width / 2 - quarantineW - 1, x1: width / 2 - 1, z0: depth / 2 - 9.5, z1: depth / 2 - 5.2 };
    blocked.forEach((b, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      quarantine.push({ id: `Q-${String(i + 1).padStart(2, "0")}`, zone: "quarantine", rack: -1, slot: col, level: 0,
        x: qRect!.x0 + 1 + col * 1.5, y: 0.15, z: qRect!.z0 + 1.2 + row * 1.6, fill: slotsFor(b, maxVol).fill, batch: b,
        color: productColor[b.product_id] ?? theme.palette[0] });
    });
  }

  // One sign per product, above the first bay it occupies.
  const seen = new Set<string>();
  for (const b of bays) {
    if (seen.has(b.batch.product_id)) continue;
    seen.add(b.batch.product_id);
    signs.push({ text: b.batch.product_name, x: b.x, y: (b.zone === "cold" ? COLD_LEVELS : theme.levels) * LEVEL_H + 0.6, z: b.z + RACK_D / 2 + 0.05 });
  }

  return {
    theme, racks, bays, quarantine, width, depth, productColor, productSigns: signs,
    zones: { cold: coldRect, quarantine: qRect, dock: { x0: -width / 2, x1: width / 2, z0: depth / 2 - 5, z1: depth / 2 } },
  };
}

export const STATUS_COLOR: Record<string, number> = { ok: 0x16a34a, expiring: 0xf59e0b, blocked: 0xdc2626 };
export const STATUS_LABEL: Record<string, string> = { ok: "Good", expiring: "Expiring soon", blocked: "Blocked - can't ship" };
