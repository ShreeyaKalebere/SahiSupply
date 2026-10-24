import { CloudRain, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import { fmtDateTime } from "../utils/format";
import { NetworkMap } from "./NetworkMap";
import { Card, ErrorBox, Pill, ProgressBar, Spinner } from "./ui";

/** Real 7-day rain forecast (Open-Meteo) for every warehouse/store; re-plan with the roads heavy rain would close. */
export function LiveWeatherPanel() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const [threshold, setThreshold] = useState(64.5);
  const [applied, setApplied] = useState(64.5);
  const w = useAsync(() => api.liveWeather(p.module, p.contested, applied), [p.module, p.contested, applied]);
  const d = w.data;
  const sites = [...(d?.sites ?? [])].sort((a, b) => b.max_mm - a.max_mm);
  const routes = useAsync(() => api.routes(p.module, p.contested), [p.module, p.contested]);
  const closing = new Set(d?.roads_to_close ?? []);

  const replan = async () => {
    if (!d) return;
    const edit = { warehouses: null, outlets: null, route_overrides: Object.fromEntries(d.roads_to_close.map((r) => [r, false])) };
    p.setNetwork(d.roads_to_close.length ? edit : null);
    await p.runPlan({ scenario: "S0", network: d.roads_to_close.length ? edit : null });
  };

  return (
    <Card title="Live weather (real forecast)" icon={CloudRain}
      subtitle="Real 7-day rain forecast for every warehouse and store city. Heavy rain closes the roads touching that city."
      actions={<button className="btn-secondary" onClick={w.reload} disabled={w.loading}><RefreshCw size={14} aria-hidden /> Refresh</button>}>
      <ErrorBox error={w.error} onRetry={w.reload} />
      {w.loading && !d ? <Spinner label="Getting the live forecast…" /> : d && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <label className="flex items-center gap-3">
              <span className="text-slate-600">Close roads when a day's rain is at least</span>
              <input type="range" min={1} max={120} step={0.5} value={threshold} aria-label="Rain threshold in mm"
                onChange={(e) => setThreshold(Number(e.target.value))} onMouseUp={() => setApplied(threshold)} onTouchEnd={() => setApplied(threshold)}
                onKeyUp={() => setApplied(threshold)} />
              <b className="w-16 tabular-nums text-slate-900">{threshold} mm</b>
            </label>
            <button className="btn-link" onClick={() => { setThreshold(64.5); setApplied(64.5); }}>IMD "heavy rain" = 64.5 mm</button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">Highest daily rain in the next {d.forecast_days} days</div>
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {sites.map((s) => (
                  <li key={s.id}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700">{s.city} <span className="text-xs text-slate-400">{s.kind === "warehouse" ? `warehouse ${s.id}` : s.name}</span></span>
                      <span className={s.heavy ? "font-semibold text-sky-700" : "tabular-nums text-slate-600"}>{s.max_mm.toFixed(1)} mm{s.heavy ? " · heavy" : ""}</span>
                    </div>
                    <ProgressBar value={Math.min(1, s.max_mm / Math.max(applied, 1))} tone={s.heavy ? "blue" : "green"} />
                  </li>
                ))}
              </ul>
            </div>
            {net && (
              <div className="rounded-xl border border-slate-100">
                <NetworkMap warehouses={net.warehouses} outlets={net.outlets} flows={[]} fillByOutlet={{}}
                  closedRoads={(routes.data ?? []).filter((r) => closing.has(r.route_id))} rainSites={d.heavy_sites} height={300} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              {d.roads_to_close.length === 0
                ? <>No city reaches {d.threshold_mm} mm this week, so <b>all roads stay open</b>. Lower the slider to see what heavy rain would do.</>
                : <><b>{d.heavy_sites.length}</b> place(s) with heavy rain → <b>{d.roads_to_close.length}</b> road(s) would close.</>}
            </div>
            <button className="btn-primary" disabled={p.running} onClick={() => void replan()}>
              <CloudRain size={15} aria-hidden /> {p.running ? "Planning…" : "Re-plan with live weather"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill tone="green">Live data</Pill> Source: <a className="underline" href={d.source_url} target="_blank" rel="noreferrer">Open-Meteo</a>
            · fetched {fmtDateTime(d.fetched_at)} · {d.note}
          </div>
        </div>
      )}
    </Card>
  );
}
