import { BrainCircuit, CalendarRange, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { Card, Details, ErrorBox, PageHeader, Spinner, StatCard } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { CHART } from "../utils/chart";
import { fmtDate, fmtInt, fmtNum, fmtPct } from "../utils/format";

const MODEL_COLOR: Record<string, string> = { gradient_boosting: CHART.opt, seasonal_naive: CHART.base, moving_average_28: CHART.aqua };
const tick = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function ForecastPage() {
  const p = usePlanner();
  const [outlet, setOutlet] = useState("");
  const [product, setProduct] = useState("");
  const fc = useAsync(() => api.forecast(p.module, outlet || null, product || null), [p.module, outlet, product]);
  const d = fc.data;
  const m = d?.metrics;
  const naive = m?.models.find((x) => x.model === "seasonal_naive");
  const sel = m?.models.find((x) => x.model === m.selected_model);
  const week = d ? d.forecast.slice(0, 7).reduce((s, f) => s + f.forecast, 0) : 0;
  const combined = d ? [
    ...d.history.map((h) => ({ date: h.date, actual: h.actual })),
    ...d.forecast.map((f) => ({ date: f.date, forecast: f.forecast, band: [f.lower, f.upper] as [number, number] })),
  ] : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Demand forecast" description="How much stores are expected to need over the next two weeks, learned from the last 6 months of sales." />
      <div className="flex flex-wrap gap-2">
        <select aria-label="Store" className="input" value={outlet} onChange={(e) => setOutlet(e.target.value)}>
          <option value="">All stores</option>{d?.outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select aria-label="Product" className="input" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">All products</option>{d?.products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <ErrorBox error={fc.error} onRetry={fc.reload} />
      {fc.loading && !d && <Spinner label="Loading forecast…" />}
      {d && m && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Expected next 7 days" icon={CalendarRange} tone="blue" value={`${fmtInt(week)} units`} hint="for the selection above" />
            <StatCard label="Better than a simple guess" icon={Target} tone="green" value={m.target.improvement_pct == null ? "—" : `${m.target.improvement_pct.toFixed(0)}% more accurate`}
              hint={'than "same as last week", tested on the last 8 weeks'} />
            <StatCard label="Forecasting method" icon={BrainCircuit} tone="violet" value={m.selected_model === "gradient_boosting" ? "Machine learning" : sel?.label.split(" (")[0] ?? "—"}
              hint="picked automatically because it was the most accurate" />
          </div>
          <Card title="Past 90 days and next 14 days" icon={TrendingUp} subtitle="Shaded area: likely range for the forecast">
            <div className="h-80">
              <ResponsiveContainer>
                <ComposedChart data={combined} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="date" tickFormatter={tick} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number | number[]) => Array.isArray(v) ? `${fmtNum(v[0], 0)} - ${fmtNum(v[1], 0)}` : fmtNum(v, 0)} labelFormatter={(l: string) => fmtDate(l)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="band" name="Likely range" stroke="none" fill={CHART.opt} fillOpacity={0.15} />
                  <Line dataKey="actual" name="Actual sales" stroke={CHART.actual} strokeWidth={2} dot={false} />
                  <Line dataKey="forecast" name="Forecast" stroke={CHART.opt} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Details label="Show technical details (model comparison and backtest)">
            <p className="mb-2">Rolling backtest, 4 folds × 14 days ({fmtDate(m.evaluation.start)} - {fmtDate(m.evaluation.end)}). Lowest WAPE is selected. Seasonal naive WAPE {naive ? fmtPct(naive.wape) : "—"}.</p>
            <table className="tbl">
              <thead><tr><th>Model</th><th className="num">MAE</th><th className="num">RMSE</th><th className="num">WAPE</th></tr></thead>
              <tbody>
                {m.models.map((x) => <tr key={x.model}><td>{x.label}{x.model === m.selected_model ? " (selected)" : ""}</td><td className="num">{fmtNum(x.mae, 2)}</td><td className="num">{fmtNum(x.rmse, 2)}</td><td className="num">{fmtPct(x.wape)}</td></tr>)}
                {m.noise_floor && <tr><td>Noise floor (true expected demand, sample data only)</td><td className="num">{fmtNum(m.noise_floor.mae, 2)}</td><td className="num">{fmtNum(m.noise_floor.rmse, 2)}</td><td className="num">{fmtPct(m.noise_floor.wape)}</td></tr>}
              </tbody>
            </table>
            <div className="mt-3 h-64 rounded-xl bg-white p-2">
              <ResponsiveContainer>
                <LineChart data={d.backtest} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="date" tickFormatter={tick} tick={{ fontSize: 10, fill: CHART.axis }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10, fill: CHART.axis }} />
                  <Tooltip formatter={(v: number) => fmtNum(v, 1)} labelFormatter={(l: string) => fmtDate(l)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="actual" name="Actual" stroke={CHART.actual} strokeWidth={2} dot={false} />
                  {m.models.map((x) => <Line key={x.model} dataKey={x.model} name={x.label.split(" (")[0]} stroke={MODEL_COLOR[x.model]} strokeWidth={1.5} dot={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Details>
        </>
      )}
    </div>
  );
}
