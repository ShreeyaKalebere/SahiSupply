import {
  BarChart3, Boxes, CloudLightning, Download, GitCompareArrows, History, LayoutDashboard, Lightbulb, Map, Play,
  Settings2, Table2, TrendingUp,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { PlanStatusBanner, SourceBadges } from "../components/PlanStatus";
import { ErrorBox } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import type { ScenarioId } from "../types/api";
import { cx, fmtDate } from "../utils/format";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/planner", label: "Allocation planner", icon: Table2 },
  { to: "/comparison", label: "Baseline comparison", icon: GitCompareArrows },
  { to: "/scenarios", label: "Scenario simulator", icon: CloudLightning },
  { to: "/insights", label: "Value insights", icon: Lightbulb },
  { to: "/forecast", label: "Demand forecasting", icon: TrendingUp },
  { to: "/inventory", label: "Inventory & batches", icon: Boxes },
  { to: "/map", label: "Network map", icon: Map },
  { to: "/config", label: "Industry configuration", icon: Settings2 },
  { to: "/history", label: "Run history", icon: History },
  { to: "/export", label: "Plan export", icon: Download },
];

export function AppLayout() {
  const p = usePlanner();
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-300 lg:flex">
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-white"><BarChart3 size={18} aria-hidden /></div>
            <div>
              <div className="text-sm font-semibold text-white">SahiSupply</div>
              <div className="text-[10px] leading-tight text-slate-400">Right Product. Right Place. Right Time.</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]",
                isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white")}>
              <Icon size={15} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-3 text-[10px] leading-snug text-slate-500">
          All data is synthetic. No regulatory compliance or clinical guidance is claimed.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-[1000] border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="flex rounded-md border border-slate-200 p-0.5" role="tablist" aria-label="Industry module">
              {p.modules.map((m) => (
                <button key={m.industry} role="tab" aria-selected={p.module === m.industry}
                  onClick={() => p.setModule(m.industry)}
                  className={cx("rounded px-3 py-1 text-[13px] font-medium",
                    p.module === m.industry ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100")}>
                  {m.display_name}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Scenario
              <select aria-label="Scenario" className="input py-1" value={p.scenario}
                onChange={(e) => p.setScenario(e.target.value as ScenarioId)}>
                {p.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.id} · {s.name}{s.priority === "P1" ? " (P1)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Contested-supply pattern: remote outlets only reachable from the hub warehouse">
              <input type="checkbox" checked={p.contested} onChange={(e) => p.setContested(e.target.checked)} />
              Contested-supply pattern
            </label>
            <button className="btn-primary" onClick={() => void p.runPlan()} disabled={p.running || !p.modules.length}>
              <Play size={14} aria-hidden /> {p.running ? "Running…" : "Run plan"}
            </button>
            <div className="ml-auto flex items-center gap-3">
              {p.run && <span className="text-xs text-slate-500">Planning week from <b className="text-slate-700">{fmtDate(p.run.planning_date)}</b> · {p.currentModule?.need_source === "orders" ? "orders mode" : "forecast mode"}</span>}
              <SourceBadges dataSource={p.run?.data_source} persisted={p.run?.persisted} />
            </div>
          </div>
        </header>

        <main className="flex-1 space-y-3 px-4 py-4">
          <ErrorBox error={p.bootError} />
          <ErrorBox error={p.runError} />
          {p.run && <PlanStatusBanner run={p.run} />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
