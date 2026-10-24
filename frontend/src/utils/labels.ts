// Plain-language wording used across the UI. Technical terms stay behind "details" toggles.
import type { AllocationRow, Alternative, InsightItem, ScenarioId } from "../types/api";

export const MODULE_LABEL: Record<string, string> = { pharmacy: "Pharmacy", grocery: "Grocery", cosmetics: "Cosmetics" };
export const STORE_WORD: Record<string, string> = { pharmacy: "pharmacies, clinics & hospitals", grocery: "kiranas & supermarkets", cosmetics: "beauty stores, salons & department stores" };

export const SCENARIO_TEXT: Record<ScenarioId, { name: string; text: string }> = {
  S0: { name: "Normal week", text: "No problems - a regular week." },
  S1: { name: "Festival rush", text: "Demand jumps 40% for the 5 best-selling products at the 4 busiest stores." },
  S2: { name: "Warehouse closed", text: "The biggest warehouse is shut for the week." },
  S3: { name: "Monsoon road closures", text: "Heavy rain closes the roads from 2 warehouses into Western Maharashtra." },
  S4: { name: "Fridge breakdown", text: "One clinic's fridge stops working, so it can't take cold items." },
};

export type LineStatus = "full" | "partial" | "none";
export const lineStatus = (r: Pick<AllocationRow, "allocated" | "unmet">): LineStatus =>
  r.unmet <= 0 ? "full" : r.allocated > 0 ? "partial" : "none";

export const STATUS_TEXT: Record<LineStatus, { label: string; tone: "green" | "amber" | "red"; color: string }> = {
  full: { label: "Fully sent", tone: "green", color: "#16a34a" },
  partial: { label: "Partly sent", tone: "amber", color: "#f59e0b" },
  none: { label: "Not sent", tone: "red", color: "#e11d48" },
};

/** Turn a "why not this warehouse?" record into one plain sentence. */
export function altSentence(a: Alternative, whName: (id: string) => string): string {
  const w = whName(a.warehouse_id);
  const after = (s: string) => s.includes(":") ? s.slice(s.indexOf(":") + 1).trim() : s;
  switch (a.status) {
    case "closed": return a.reason.includes("Route") ? `${w}: the road to this store is closed.` : `${w} is closed this week.`;
    case "blocked": {
      const r = a.reason.toLowerCase();
      if (r.includes("storage")) return `${w}: this store has no suitable cold storage for it.`;
      if (r.includes("expires before")) return `${w}: its stock would expire before it arrives.`;
      return `${w}: its stock expires too soon (${after(a.reason).replace(/\(best batch.*\)/, "").replace(/^.*?- /, "").trim()}).`;
    }
    case "no_stock": return `${w} has none in stock.`;
    case "allocated_elsewhere": return `${w}: its stock already went to other stores${a.allocated_to?.length ? ` (${a.allocated_to.map((x) => x.outlet_id).join(", ")})` : ""}.`;
    case "capacity_bound": return `${w}: couldn't send more - ${after(a.reason).replace(/\s*\(.*?\)/g, "")}.`;
    case "costlier": return `${w}: costs ₹${(a.delta_per_unit ?? 0).toFixed(2)} more per unit.`;
    case "equal_cost": return `${w}: same cost - not needed.`;
    case "not_needed": return `${w}: not needed, the order is already covered.`;
    default: return `${w}: has some stock left but wasn't needed by the plan.`;
  }
}

export function ruleSentence(template: string, params: Record<string, unknown>): string {
  switch (template) {
    case "min_life_on_arrival":
      return params.min_days !== undefined
        ? `Products must still have at least ${params.min_days} days before expiry when they reach the store.`
        : `Products must still have at least ${params.min_pct}% of their shelf life left when they reach the store.`;
    case "storage_match": return (params.classes as string[]).includes("2-8C")
      ? "Medicines that must stay at 2-8 °C only go to stores with the right fridge."
      : "Temperature-sensitive items only go to stores with cool storage.";
    case "shortage_weight": return `When stock is short, critical items get ${(params.weights as Record<string, number>).critical}× priority over standard items.`;
    case "fefo": return "Send the stock that expires first, first (FEFO).";
    case "min_fill_floor": return `Fair share: every store gets at least ${params.floor_pct}% of its critical items whenever stock allows.`;
    default: return template;
  }
}

export const RULE_TITLE: Record<string, string> = {
  min_life_on_arrival: "Fresh on arrival", storage_match: "Right storage only", shortage_weight: "Critical items first",
  fefo: "Oldest stock first", min_fill_floor: "Fair share for every store",
};

export const BLOCK_TEXT: Record<string, string> = {
  MIN_LIFE: "expires too soon", STORAGE: "needs a fridge the store lacks", EXPIRED: "expires before arrival",
  ROUTE_CLOSED: "road closed", NO_ROUTE: "no route", WAREHOUSE_CLOSED: "warehouse closed", NO_STOCK: "no stock",
};

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Turn an insight's constraint title into an action, e.g. "Add fridge space at ...". */
export function friendlyTitle(kind: string, title: string): string {
  if (kind === "cold") return title.replace("Cold capacity at", "Add fridge space at");
  if (kind === "stock") return "Restock " + title.replace("Stock of ", "").replace(/ \(batch .*\)/, "");
  if (kind === "route") return title.replace("Route capacity", "Add a truck:");
  if (kind === "receiving") return title.replace("Receiving capacity at", "More receiving space at");
  if (kind === "outbound") return title.replace("Outbound capacity at", "More dispatch capacity at");
  return title;
}

const WAREHOUSE_ID = /\bW\d+\b/g;

/** One card per action: several batches of the same product at the same warehouse read as duplicates. */
export function uniqueInsights(items: InsightItem[], whName: (id: string) => string): (InsightItem & { label: string })[] {
  const seen = new Set<string>();
  const out: (InsightItem & { label: string })[] = [];
  for (const it of items) {
    const label = friendlyTitle(it.kind, it.title).replace(WAREHOUSE_ID, (w) => whName(w));
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ ...it, label, statement: it.statement.replace(WAREHOUSE_ID, (w) => whName(w)) });
  }
  return out;
}
