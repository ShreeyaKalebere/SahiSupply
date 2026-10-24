import { AlertTriangle, ChevronDown, Info, Loader2, ShieldAlert, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ApiError } from "../api/client";
import { cx } from "../utils/format";

export function Card({ title, subtitle, icon: Icon, actions, children, className, bodyClass }: {
  title?: ReactNode; subtitle?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div className="flex items-center gap-3">
            {Icon && <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-50 text-primary-500"><Icon size={18} aria-hidden /></span>}
            <div>
              {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClass)}>{children}</div>
    </section>
  );
}

const ICON_TONE = {
  blue: "bg-primary-500 text-white",
  green: "bg-emerald-500 text-white",
  red: "bg-rose-500 text-white",
  amber: "bg-amber-400 text-slate-900",
  violet: "bg-violet-500 text-white",
};

/** KPI card in the reference style: label, big value, coloured icon circle, plain-language hint. */
export function StatCard({ label, value, icon: Icon, tone = "blue", hint, trend }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: keyof typeof ICON_TONE; hint?: ReactNode;
  trend?: { text: string; good: boolean } | null;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-slate-600">{label}</div>
        <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", ICON_TONE[tone])}><Icon size={18} aria-hidden /></span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {trend && (
        <div className={cx("mt-2 flex items-center gap-1 text-xs font-medium", trend.good ? "text-emerald-600" : "text-rose-600")}>
          {trend.good ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />} {trend.text}
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const PILL = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-rose-50 text-rose-700",
  blue: "bg-primary-50 text-primary-700",
  gray: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-700",
};

export function Pill({ children, tone = "gray", className, title }: { children: ReactNode; tone?: keyof typeof PILL; className?: string; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", PILL[tone], className)}>{children}</span>;
}

/** Back-compat alias used by a few pages. */
export const Badge = ({ children, color = "gray", className }: { children: ReactNode; color?: "gray" | "green" | "red" | "amber" | "blue" | "violet"; className?: string }) =>
  <Pill tone={color} className={className}>{children}</Pill>;

export function ProgressBar({ value, tone }: { value: number; tone?: "green" | "amber" | "red" | "blue" }) {
  const v = Math.max(0, Math.min(1, value));
  const t = tone ?? (v >= 0.66 ? "green" : v >= 0.33 ? "amber" : "red");
  const color = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-rose-500", blue: "bg-primary-500" }[t];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full", color)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export interface DonutSlice { label: string; value: number; color: string }

/** Donut with a centre figure and a legend that carries labels, counts and percentages (never colour alone). */
export function Donut({ data, center, centerSub }: { data: DonutSlice[]; center: ReactNode; centerSub?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
              {data.map((d) => <Cell key={d.label} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-slate-900">{center}</div>
          {centerSub && <div className="text-[11px] text-slate-500">{centerSub}</div>}
        </div>
      </div>
      <ul className="w-full space-y-2.5 text-sm">
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} aria-hidden />{d.label}</span>
            <span className="tabular-nums font-semibold text-slate-800">{d.value} <span className="font-normal text-slate-400">· {Math.round((d.value / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Details({ label = "Show technical details", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60">
      <button className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-slate-500 hover:text-slate-700"
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? label.replace(/^Show/, "Hide") : label}
        <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="animate-spin" size={16} aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{error.message}</div>
        <div className="text-xs text-rose-700/80">Error code {error.code}{error.status ? ` · HTTP ${error.status}` : ""}</div>
      </div>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "danger" }) {
  const cls = { info: "border-primary-100 bg-primary-50 text-primary-700", warn: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-rose-300 bg-rose-50 text-rose-800" }[tone];
  const Icon = tone === "info" ? Info : tone === "warn" ? AlertTriangle : ShieldAlert;
  return (
    <div className={cx("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm", cls)}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action, icon: Icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-500"><Icon size={22} aria-hidden /></span>}
      <div className="text-base font-semibold text-slate-900">{title}</div>
      {children && <div className="mt-1 max-w-lg text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
          {o.label}{o.count !== undefined && <span className="ml-1.5 text-xs text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Delta({ value, format, goodWhen }: { value: number | null | undefined; format: (n: number) => string; goodWhen: "up" | "down" }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="text-slate-400">—</span>;
  const eps = 1e-9;
  const good = goodWhen === "up" ? value > eps : value < -eps;
  const bad = goodWhen === "up" ? value < -eps : value > eps;
  const sign = value > eps ? "+" : value < -eps ? "−" : "±";
  return (
    <span className={cx("tabular-nums font-semibold", good && "text-emerald-600", bad && "text-rose-600", !good && !bad && "text-slate-500")}>
      {sign}{format(Math.abs(value))}
      <span className="sr-only">{good ? " (better)" : bad ? " (worse)" : " (no change)"}</span>
    </span>
  );
}
