import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiError } from "../api/client";
import { cx } from "../utils/format";

export function Card({ title, subtitle, actions, children, className, bodyClass }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = "neutral", hint }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "neutral" | "good" | "bad" | "warn"; hint?: string;
}) {
  const toneCls = { neutral: "text-slate-900", good: "text-emerald-700", bad: "text-red-700", warn: "text-amber-700" }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3" title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 text-xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const BADGE = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ children, color = "gray", className }: { children: ReactNode; color?: keyof typeof BADGE; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", BADGE[color], className)}>
      {children}
    </span>
  );
}

export function ValidityBadge({ valid, label }: { valid: boolean; label?: string }) {
  return valid ? (
    <Badge color="green"><CheckCircle2 size={12} aria-hidden /> {label ?? "Checker: valid"}</Badge>
  ) : (
    <Badge color="red"><XCircle size={12} aria-hidden /> {label ?? "Checker: INVALID"}</Badge>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500 justify-center">
      <Loader2 className="animate-spin" size={16} aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{error.message}</div>
        <div className="text-xs text-red-700/80">Code: {error.code}{error.status ? ` · HTTP ${error.status}` : ""}</div>
      </div>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "danger" }) {
  const cls = { info: "border-blue-200 bg-blue-50 text-blue-900", warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-300 bg-red-50 text-red-900" }[tone];
  const Icon = tone === "info" ? Info : tone === "warn" ? AlertTriangle : ShieldAlert;
  return (
    <div className={cx("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", cls)}>
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
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
    <span className={cx("tabular-nums font-medium", good && "text-emerald-700", bad && "text-red-700", !good && !bad && "text-slate-500")}>
      {sign}{format(Math.abs(value))}
      <span className="sr-only">{good ? " (better)" : bad ? " (worse)" : " (no change)"}</span>
    </span>
  );
}
