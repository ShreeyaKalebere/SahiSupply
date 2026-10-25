import { CheckCircle2, Loader2, PackageSearch, Settings, Truck, Warehouse, XCircle } from "lucide-react";
import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api, ApiError, getApiBase, isNativeApp, setApiBase } from "../api/client";
import { usePlanner } from "../hooks/usePlanner";
import { MODULE_LABEL, TAGLINE } from "../utils/labels";
import DriverView from "./DriverView";
import OrderView from "./OrderView";
import { SplashScreen } from "./SplashScreen";
import WarehouseView from "./WarehouseView";

/** Mobile app shell (Android APK via Capacitor, or /m in a phone browser): driver, warehouse, settings. */
export default function MobileApp() {
  const p = usePlanner();
  const needsServer = isNativeApp() && !getApiBase();
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-slate-100">
      <SplashScreen />
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white px-4 pb-2.5 pt-[max(env(safe-area-inset-top),12px)] shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/logo.png" alt="SahiSupply" className="h-7 w-auto" />
            <div className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{TAGLINE.join(" ")} · sample data</div>
          </div>
          <select aria-label="Industry" className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-medium text-slate-800" value={p.module} onChange={(e) => p.setModule(e.target.value)}>
            {p.modules.map((m) => <option key={m.industry} value={m.industry} className="text-slate-900">{MODULE_LABEL[m.industry] ?? m.display_name}</option>)}
          </select>
        </div>
      </header>
      <main className="flex-1 pb-20">
        {needsServer ? <SettingsView first /> : (
          <Routes>
            <Route index element={<Navigate to="driver" replace />} />
            <Route path="driver" element={<DriverView />} />
            <Route path="warehouse" element={<WarehouseView />} />
            <Route path="order" element={<OrderView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="driver" replace />} />
          </Routes>
        )}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-[1100] mx-auto flex max-w-md border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]" aria-label="Mobile">
        {[{ to: "driver", label: "Driver", icon: Truck }, { to: "warehouse", label: "Warehouse", icon: Warehouse }, { to: "order", label: "Order", icon: PackageSearch }, { to: "settings", label: "Settings", icon: Settings }].map((t) => (
          <NavLink key={t.to} to={`/m/${t.to}`} className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${isActive ? "text-primary-600" : "text-slate-500"}`}>
            <t.icon size={20} aria-hidden />{t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SettingsView({ first = false }: { first?: boolean }) {
  const [url, setUrl] = useState(getApiBase());
  const [state, setState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");

  const test = async () => {
    const prev = getApiBase();
    setApiBase(url.trim());
    setState("testing");
    try {
      const h = await api.health();
      setState("ok");
      setMsg(`Connected · MongoDB ${h.data.mongodb.connected ? "online" : "offline (fallback)"} · v${h.data.version}`);
      if (first || prev !== getApiBase()) window.location.reload();
    } catch (e) {
      setApiBase(prev);
      setState("fail");
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3 p-3">
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-semibold text-slate-900">{first ? "Connect to your SahiSupply server" : "Server"}</h2>
        <p className="mt-1 text-xs text-slate-500">
          The address of the computer running the SahiSupply backend, e.g. <span className="font-mono">http://192.168.1.20:8000</span>.
          The phone must be on the same Wi-Fi network.
        </p>
        <input className="input mt-3 w-full font-mono" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="http://192.168.1.20:8000"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="btn-primary mt-3 w-full justify-center" onClick={test} disabled={state === "testing" || (isNativeApp() && !url.trim())}>
          {state === "testing" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}Test &amp; save
        </button>
        {state === "ok" && <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 size={14} aria-hidden />{msg}</p>}
        {state === "fail" && <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-600"><XCircle size={14} aria-hidden />{msg}</p>}
      </section>
      {!first && (
        <section className="rounded-2xl bg-white p-4 text-xs text-slate-500 shadow-card">
          <p><b className="text-slate-700">About:</b> SahiSupply field app. All network, stock and order data is a synthetic sample, not a real company's. Delivery statuses and proof photos are stored on the server you connect to.</p>
        </section>
      )}
    </div>
  );
}
