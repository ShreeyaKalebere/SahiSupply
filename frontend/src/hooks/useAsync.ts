import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  meta: Record<string, unknown> | null;
}

/** Load data from the API whenever `deps` change. Stale responses are ignored. */
export function useAsync<T>(fn: () => Promise<{ data: T; meta: Record<string, unknown> }>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    fn()
      .then((r) => {
        if (id === seq.current) {
          setData(r.data);
          setMeta(r.meta);
        }
      })
      .catch((e: unknown) => {
        if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, meta };
}
