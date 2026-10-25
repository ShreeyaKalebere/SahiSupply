import {
  Boxes, CalendarDays, Network, CloudLightning, Download, GitCompareArrows, HelpCircle, History, LayoutDashboard, Lightbulb, Map,
  Play, QrCode, Settings2, Truck, Recycle, TrendingUp, } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ChatWidget } from "../components/ChatWidget";
import { HowItWorks } from "../components/HowItWorks";
import { PlanStatusBanner, SourceBadges } from "../components/PlanStatus";
import { ErrorBox, Pill } from "../components/ui";
import { usePlanner } from "../hooks/usePlanner";
import { cx, fmtDate } from "../utils/format";
import { MODULE_LABEL, SCENARIO_TEXT, TAGLINE } from "../utils/labels";

const MAIN = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/planner", label: "Delivery plan", icon: Truck },
  { to: "/network", label: "Network builder", icon: Network },
  { to: "/scenarios", label: "What-if", icon: CloudLightning },
  { to: "/insights", label: "Smart suggestions", icon: Lightbulb },
  { to: "/inventory", label: "Stock & expiry", icon: Boxes },
  { to: "/rescue", label: "Expiry rescue", icon: Recycle },
  { to: "/trace", label: "QR traceability", icon: QrCode },
  { to: "/forecast", label: "Demand forecast", icon: TrendingUp },
];
const MORE = [
  { to: "/comparison", label: "vs. Manual planning", icon: GitCompareArrows },
  { to: "/map", label: "Map", icon: Map },
  { to: "/history", label: "Past plans", icon: History },
  { to: "/export", label: "Download plan", icon: Download },
  { to: "/config", label: "Rules & settings", icon: Settings2 },
];
const MOBILE = [MAIN[0], MAIN[1], MAIN[2], MAIN[4]];

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Truck; end?: boolean }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => cx("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
        isActive ? "bg-primary-50 text-primary-600 before:absolute before:-left-3 before:top-1.5 before:h-7 before:w-1 before:rounded-r before:bg-primary-500"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
      <Icon size={18} aria-hidden /> {label}
    </NavLink>
  );
}

export function AppLayout() {
  const p = usePlanner();
  const [help, setHelp] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-100 bg-white lg:flex">
        <div className="px-6 py-6">
          <img src="/brand/logo.png" alt="SahiSupply" className="h-9 w-auto" />
          <div className="mt-1.5 text-[11px] font-medium tracking-wide text-slate-500">{TAGLINE.join(" ")}</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
          {MAIN.map((n) => <NavItem key={n.to} {...n} />)}
          <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">More</div>
          {MORE.map((n) => <NavItem key={n.to} {...n} />)}
        </nav>
        <div className="m-4 rounded-2xl bg-gradient-to-br from-primary-500 to-sky-500 p-4 text-white">
          <div className="text-sm font-semibold">New here?</div>
          <p className="mt-1 text-xs text-white/85">See in 30 seconds how the weekly plan is made.</p>
          <button className="mt-3 w-full rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-primary-600" onClick={() => setHelp(true)}>How it works</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-[1000] border-b border-slate-100 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
            <img src="/brand/mark.png" alt="SahiSupply" className="h-8 w-8 lg:hidden" />
            <div className="flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Business type">
              {p.modules.map((m) => (
                <button key={m.industry} role="tab" aria-selected={p.module === m.industry} onClick={() => p.setModule(m.industry)}
                  className={cx("rounded-lg px-3 py-1.5 text-sm font-medium",
                    p.module === m.industry ? "bg-white text-primary-600 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                  {MODULE_LABEL[m.industry] ?? m.display_name}
                </button>
              ))}
            </div>
            {p.run && (
              <span className="hidden items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 md:inline-flex">
                <CalendarDays size={15} aria-hidden /> Week of {fmtDate(p.run.planning_date)}
              </span>
            )}
            {p.scenario !== "S0" && <Pill tone="violet">What-if: {SCENARIO_TEXT[p.scenario].name}</Pill>}
            <div className="ml-auto flex items-center gap-2">
              <SourceBadges dataSource={p.run?.data_source} persisted={p.run?.persisted} />
              <button className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="How it works" onClick={() => setHelp(true)}><HelpCircle size={20} /></button>
              <button className="btn-primary" onClick={() => void p.runPlan()} disabled={p.running || !p.modules.length}>
                <Play size={15} aria-hidden /> {p.running ? "Planning…" : "Run plan"}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 space-y-4 px-4 pb-24 pt-6 lg:px-8 lg:pb-8">
          <ErrorBox error={p.bootError} />
          <ErrorBox error={p.runError} />
          {p.run && <PlanStatusBanner run={p.run} />}
          {p.run?.network && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800">
              <span>
                You're viewing <b>your custom network</b>: {p.run.network.summary.warehouses_kept.length} warehouses,{" "}
                {p.run.network.summary.outlets_kept.length} stores, {p.run.network.summary.roads_closed.length + p.run.network.summary.roads_opened.length} road(s) changed.
              </span>
              <span className="flex gap-2">
                <NavLink to="/network" className="btn-secondary py-1.5">Edit network</NavLink>
                <button className="btn-secondary py-1.5" disabled={p.running} onClick={() => { p.setNetwork(null); void p.runPlan({ network: null }); }}>Back to full network</button>
              </span>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-[1000] flex border-t border-slate-100 bg-white lg:hidden" aria-label="Mobile">
        {MOBILE.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cx("flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium", isActive ? "text-primary-500" : "text-slate-500")}>
            <Icon size={20} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
      {help && <HowItWorks onClose={() => setHelp(false)} />}
      <ChatWidget />
    </div>
  );
}
