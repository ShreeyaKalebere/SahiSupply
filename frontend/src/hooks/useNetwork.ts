import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Outlet, Warehouse } from "../types/api";

const cache: Record<string, { warehouses: Warehouse[]; outlets: Outlet[] }> = {};

/** Warehouse and store names for the current module, so the UI can say "Pune Hub" instead of "W2". */
export function useNetwork(module: string) {
  const [net, setNet] = useState(cache[module] ?? null);
  useEffect(() => {
    if (cache[module]) { setNet(cache[module]); return; }
    let live = true;
    Promise.all([api.warehouses(module), api.outlets(module)])
      .then(([w, o]) => {
        cache[module] = { warehouses: w.data, outlets: o.data };
        if (live) setNet(cache[module]);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [module]);
  const whName = (id: string) => net?.warehouses.find((w) => w.warehouse_id === id)?.name ?? id;
  const storeName = (id: string) => net?.outlets.find((o) => o.outlet_id === id)?.name ?? id;
  return { net, whName, storeName };
}
