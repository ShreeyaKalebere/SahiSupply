import { AlertTriangle, CheckCircle2, Info, Navigation, Route as RouteIcon, ShieldCheck } from "lucide-react";
import type { RouteCandidate, RoutePlanResult } from "../types/api";
import { cx, fmtInt, fmtRs } from "../utils/format";
import { Card, Details, Pill } from "./ui";

/** Shared results for the route planner: option comparison, explanation, checker, directions, data notes. */
const hm = (m: number) => {
  const t = Math.round(Math.abs(m));
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")} min`;
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ADVICE_STYLE = {
  ok: { cls: "bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
  info: { cls: "bg-sky-50 text-sky-800", icon: Info },
  warning: { cls: "bg-amber-50 text-amber-800", icon: AlertTriangle },
  flag: { cls: "bg-rose-50 text-rose-800", icon: AlertTriangle },
} as const;

export function Results({ res, sel, onSelect }: { res: RoutePlanResult; sel: string | null; onSelect: (k: string) => void }) {
  const c = res.candidates.find((x) => x.kind === sel) ?? res.candidates[0];
  return (
    <div className="space-y-4">
      <Card title="Compare routes" icon={RouteIcon} bodyClass="px-2 pb-3 pt-3">
        <div className="overflow-x-auto">
          <table className="tbl min-w-[860px]" aria-label="Route options">
            <thead><tr><th>Option</th><th className="num">Distance</th><th className="num">Driving</th><th className="num">Load/unload</th><th className="num">Total</th><th>Arrives</th><th className="num">Cost</th><th>Deadline</th><th /></tr></thead>
            <tbody>
              {res.candidates.map((x) => (
                <tr key={x.kind} className={cx("clickable", x.kind === sel && "bg-primary-50")} tabIndex={0} onClick={() => onSelect(x.kind)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(x.kind); }}>
                  <td className="font-medium text-slate-900">{x.label}<div className="text-[11px] font-normal text-slate-400">{x.order.join(" → ")}</div></td>
                  <td className="num">{fmtInt(x.distance_km)} km</td><td className="num">{hm(x.drive_min)}</td><td className="num">{hm(x.handling_min)}</td>
                  <td className="num font-semibold">{hm(x.total_min)}</td><td className="text-xs">{when(x.eta)}</td>
                  <td className="num">{x.cost == null ? "—" : fmtRs(x.cost)}<div className="text-[11px] text-slate-400">{fmtInt(x.units)} units</div></td>
                  <td>{!x.feasible_route ? <Pill tone="red">road closed</Pill> : x.deadline ? (x.deadline.met
                    ? <Pill tone="green">met · {hm(x.deadline.slack_min)} spare</Pill> : <Pill tone="red">missed by {hm(-x.deadline.slack_min)}</Pill>) : <span className="text-xs text-slate-400">no deadline</span>}</td>
                  <td>{x.recommended && <Pill tone="green">recommended</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {res.recommended === null && <p className="px-3 pt-2 text-sm font-medium text-rose-700">No option is recommended: none meets the requirements. See the explanation below.</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="What this means" icon={Info}>
          <ul className="space-y-2">
            {res.advice.map((a, i) => {
              const s = ADVICE_STYLE[a.level];
              return <li key={i} className={cx("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", s.cls)}><s.icon size={15} className="mt-0.5 shrink-0" aria-hidden />{a.text}</li>;
            })}
          </ul>
          {res.check && (
            <p className={cx("mt-3 flex items-center gap-1.5 text-xs", res.check.valid ? "text-emerald-700" : "text-rose-700")}>
              <ShieldCheck size={14} aria-hidden />Independent checker: {res.check.lines_checked} planned lines on the recommended trip {res.check.valid ? "pass every rule" : `have ${res.check.violations.length} violation(s)`}.
            </p>
          )}
        </Card>
        <Card title={`Directions · ${c.label}`} icon={Navigation} className="xl:col-span-2">
          <Directions c={c} />
        </Card>
      </div>

      <Details label="Data sources and assumptions">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{res.data_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        {res.plan_id && <p className="mt-2 text-xs text-slate-400">Plan {res.plan_id}. Shipments on this trip: {c.shipments.join(", ") || "none"}.</p>}
      </Details>
    </div>
  );
}

function Directions({ c }: { c: RouteCandidate }) {
  return (
    <ol className="space-y-0">
      {c.timeline.map((s, i) => (
        <li key={s.stop} className="relative pl-9">
          <span className={cx("absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white", s.kind === "warehouse" ? "bg-slate-900" : s.urgent ? "bg-rose-600" : "bg-primary-500")}>{s.letter}</span>
          <div className="text-sm font-medium text-slate-900">{s.name}{s.urgent && <Pill tone="red" className="ml-2">urgent</Pill>}</div>
          <div className="text-xs text-slate-500">
            {i === 0 ? "Depart" : "Arrive"} {when(s.arrive_at)}{s.handling_min > 0 && ` · ${s.kind === "warehouse" ? "load" : "unload"} ${fmtInt(s.units)} units (${Math.round(s.handling_min)} min)`}
            {s.warning && <span className="ml-1 text-rose-600">{s.warning}</span>}
          </div>
          {i < c.legs.length && (
            <div className={cx("my-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs", c.legs[i].blocked ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600")}>
              <span className="inline-block text-base leading-none" style={{ transform: `rotate(${c.legs[i].bearing_deg}deg)` }} aria-hidden>↑</span>
              Head {c.legs[i].direction} · {c.legs[i].distance_km} km · ~{hm(c.legs[i].drive_min)}
              <span className="text-[10px] text-slate-400">({c.legs[i].basis}{c.legs[i].lead_time_days ? `; planning lead time ${c.legs[i].lead_time_days} d` : ""})</span>
              {c.legs[i].blocked && <b className="ml-1">{c.legs[i].blocked}</b>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
