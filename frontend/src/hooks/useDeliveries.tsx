import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { DeliveryStatus, Shipment } from "../types/api";
import { usePlanner } from "./usePlanner";

/** Shipment statuses for the current plan, shared by the delivery table, dashboard and map. */
interface DeliveriesState {
  byId: Record<string, Shipment>;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  pending: Record<string, boolean>;
  actionError: { shipmentId: string; error: ApiError } | null;
  advance: (shipmentIds: string[], status: DeliveryStatus) => Promise<void>;
  clearActionError: () => void;
}

const Ctx = createContext<DeliveriesState | null>(null);

export function DeliveriesProvider({ children }: { children: ReactNode }) {
  const { run } = usePlanner();
  // Simulated (Chaos Mode) plans have no real deliveries to track.
  const planId = run?.status === "VALID" && run.optimizer && !run.chaos ? run.plan_id : null;
  const [byId, setById] = useState<Record<string, Shipment>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<DeliveriesState["actionError"]>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setById({});
    setActionError(null);
    if (!planId) return;
    let live = true;
    setLoading(true);
    setError(null);
    Promise.resolve().then(() => api.deliveries(planId))
      .then((r) => live && setById(Object.fromEntries(r.data.map((s) => [s.shipment_id, s]))))
      .catch((e) => live && setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e))))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [planId, tick]);

  const advance = useCallback(async (ids: string[], status: DeliveryStatus) => {
    if (!planId) return;
    setActionError(null);
    setPending((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    for (const id of ids) {
      try {
        const r = await api.setDeliveryStatus(planId, id, status);
        setById((p) => ({ ...p, [id]: r.data }));
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e));
        setActionError({ shipmentId: id, error: err });
        // Someone else may have moved it: resync from the server.
        if (err.code === "INVALID_TRANSITION") setTick((t) => t + 1);
        break;
      } finally {
        setPending((p) => ({ ...p, [id]: false }));
      }
    }
  }, [planId]);

  const value = useMemo<DeliveriesState>(() => ({
    byId, loading, error, reload: () => setTick((t) => t + 1), pending, actionError, advance,
    clearActionError: () => setActionError(null),
  }), [byId, loading, error, pending, actionError, advance]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeliveries(): DeliveriesState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDeliveries must be used inside DeliveriesProvider");
  return v;
}
