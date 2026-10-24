import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { Badge, Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { CHART } from "../utils/chart";
import { fmtDate, fmtNum, fmtPct } from "../utils/format";

const MODEL_COLOR: Record<string, string> = { gradient_boosting: CHART.opt, seasonal_naive: CHART.base, moving_average_28: CHART.aqua };
const tickDate = (d: string) => d.slice(5);

export default function ForecastPage() {
  const p = usePlanner();
  const [outlet, setOutlet] = useState<string>("");
  const [product, setProduct] = useState<string>("");
  const fc = useAsync(() => api.forecast(p.module, outlet || null, product || null), [p.module, outlet, product]);
  const d = fc.data;
  const m = d?.metrics;
  const combined = d ? [
    ...d.history.map((h) => ({ date: h.date, actual: h.actual })),
    ...d.forecast.map((f) => ({ date: f.date, forecast: f.forecast, band: [f.lower, f.upper] as [number, number] })),
  ] : [];

  return (
    <div className="space-y-3">
      <PageHeader title="Demand forecasting"
        description="Seasonal naive, 28-day moving average and gradient boosting, compared by a rolling-origin backtest (4 folds × 14 days). The model with the lowest WAPE is selected per industry." />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Outlet" className="input" value={outlet} onChange={(e) => setOutlet(e.target.value)}>
          <option value="">All outlets</option>
          {d?.outlets.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.name}</option>)}
        </select>
        <select aria-label="Product" className="input" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">All products</option>
          {d?.products.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.name}</option>)}
        </select>
        {d && <span className="text-xs text-slate-500">{d.selection.series} series aggregated</span>}
      </div>
      <ErrorBox error={fc.error} onRetry={fc.reload} />
      {fc.loading && !d && <Spinner label="Running the backtest…" />}
      {d && m && (
        <>
          <div className="grid gap-3 xl:grid-cols-3">
            <Card title="Backtest accuracy" subtitle={`Evaluation period ${fmtDate(m.evaluation.start)} - ${fmtDate(m.evaluation.end)} · ${m.evaluation.method}`} className="xl:col-span-2" bodyClass="p-0">
              <table className="tbl">
                <thead><tr><th>Model</th><th className="num">MAE</th><th className="num">RMSE</th><th className="num">WAPE</th><th className="num">vs seasonal naive</th><th>Fold WAPE</th></tr></thead>
                <tbody>
                  {m.models.map((x) => (
                    <tr key={x.model}>
                      <td><span className="mr-2 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: MODEL_COLOR[x.model] }} aria-hidden />{x.label}
                        {x.model === m.selected_model && <Badge color="green" className="ml-2">selected</Badge>}</td>
                      <td className="num">{fmtNum(x.mae, 2)}</td><td className="num">{fmtNum(x.rmse, 2)}</td><td className="num font-medium">{fmtPct(x.wape)}</td>
                      <td className="num">{x.wape_vs_seasonal_naive_pct == null ? "—" : `${x.wape_vs_seasonal_naive_pct >= 0 ? "−" : "+"}${Math.abs(x.wape_vs_seasonal_naive_pct).toFixed(1)}% WAPE`}</td>
                      <td className="text-xs text-slate-500">{x.fold_wape.map((w) => fmtPct(w, 0)).join(" · ")}</td>
                    </tr>
                  ))}
                  {m.noise_floor && (
                    <tr className="text-slate-500"><td>Noise floor (true expected demand)</td><td className="num">{fmtNum(m.noise_floor.mae, 2)}</td>
                      <td className="num">{fmtNum(m.noise_floor.rmse, 2)}</td><td className="num">{fmtPct(m.noise_floor.wape)}</td><td colSpan={2} className="text-xs">best any model could achieve on this synthetic data</td></tr>
                  )}
                </tbody>
              </table>
              <div className="px-4 py-2"><Notice>{m.noise_floor_note} Daily outlet-product counts are small and noisy, so WAPE is high even at the noise floor.</Notice></div>
            </Card>
            <Card title="Target check">
              <div className="space-y-2 text-sm">
                <div>Target: <b>{m.target.description}</b></div>
                <div>Measured: <b>{m.target.improvement_pct == null ? "—" : `${m.target.improvement_pct.toFixed(1)}% lower WAPE`}</b> with {m.selected_label.split(" (")[0]}</div>
                <Badge color={m.target.achieved ? "green" : "amber"}>{m.target.achieved ? "Target met on backtest" : "Target not met"}</Badge>
                <p className="text-xs text-slate-500">Measured on the synthetic backtest only; not a claim about real-world accuracy.</p>
              </div>
            </Card>
          </div>
          <Card title="Forecast vs actual - backtest folds">
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={d.backtest} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="date" tickFormatter={tickDate} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => fmtNum(v, 1)} labelFormatter={(l: string) => fmtDate(l)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="actual" name="Actual" stroke={CHART.actual} strokeWidth={2} dot={false} />
                  {m.models.map((x) => <Line key={x.model} dataKey={x.model} name={x.label.split(" (")[0]} stroke={MODEL_COLOR[x.model]} strokeWidth={2} dot={false} />)}
                  {d.backtest[0]?.expected !== undefined && <Line dataKey="expected" name="True expected (synthetic)" stroke={CHART.expected} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="History and 14-day forecast" subtitle="Band: ±1.28σ of backtest errors (selected model)">
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={combined} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="date" tickFormatter={tickDate} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number | number[]) => Array.isArray(v) ? `${fmtNum(v[0])} - ${fmtNum(v[1])}` : fmtNum(v, 1)} labelFormatter={(l: string) => fmtDate(l)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="band" name="Forecast band" stroke="none" fill={CHART.opt} fillOpacity={0.15} />
                  <Line dataKey="actual" name="Actual" stroke={CHART.actual} strokeWidth={2} dot={false} />
                  <Line dataKey="forecast" name="Forecast" stroke={CHART.opt} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
