import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { ChaosResult, ModuleSummary, NetworkEdit, Run, Scenario, ScenarioDiff, ScenarioId } from "../types/api";

interface PlannerState {
  modules: ModuleSummary[];
  scenarios: Scenario[];
  module: string;
  setModule: (m: string) => void;
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  contested: boolean;
  setContested: (b: boolean) => void;
  ruleToggles: Record<string, boolean>;
  setRuleToggle: (id: string, on: boolean | null) => void;
  run: Run | null;
  setRun: (r: Run) => void;
  scenarioDiff: ScenarioDiff | null;
  running: boolean;
  runError: ApiError | null;
  runPlan: (opts?: { scenario?: ScenarioId; network?: NetworkEdit | null }) => Promise<Run | null>;
  network: NetworkEdit | null;
  setNetwork: (n: NetworkEdit | null) => void;
  fullRun: Run | null;
  bootError: ApiError | null;
  currentModule: ModuleSummary | undefined;
  /** Active Chaos Mode simulation: its plan is shown everywhere until reset. */
  chaos: ChaosResult | null;
  startChaos: (r: ChaosResult) => void;
  resetChaos: () => void;
}

const Ctx = createContext<PlannerState | null>(null);

const readPref = (k: string, d: string) => {
  try {
    return localStorage.getItem(`sahisupply.${k}`) ?? d;
  } catch {
    return d;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(`sahisupply.${k}`, v);
  } catch {
    /* storage unavailable */
  }
};

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [module, setModuleState] = useState(readPref("module", "pharmacy"));
  const [scenario, setScenario] = useState<ScenarioId>("S0");
  const [contested, setContested] = useState(true);
  const [toggles, setToggles] = useState<Record<string, Record<string, boolean>>>({});
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [fullRuns, setFullRuns] = useState<Record<string, Run>>({});
  const [networks, setNetworks] = useState<Record<string, NetworkEdit | null>>({});
  const [diffs, setDiffs] = useState<Record<string, ScenarioDiff | null>>({});
  const [chaosByModule, setChaosByModule] = useState<Record<string, ChaosResult | null>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);
  const [bootError, setBootError] = useState<ApiError | null>(null);

  useEffect(() => {
    Promise.all([api.modules(), api.scenarios()])
      .then(([m, s]) => {
        setModules(m.data);
        setScenarios(s.data);
        // A remembered module may no longer exist (e.g. Food Distribution was replaced): fall back to a valid one.
        setModuleState((cur) => {
          if (m.data.some((x) => x.industry === cur)) return cur;
          const next = m.data.find((x) => x.industry === "pharmacy")?.industry ?? m.data[0]?.industry ?? cur;
          writePref("module", next);
          return next;
        });
      })
      .catch((e: ApiError) => setBootError(e));
  }, []);

  // Restore the most recent valid run for the module from MongoDB history.
  useEffect(() => {
    if (runs[module]) return;
    api.history(module, 10)
      .then(async (h) => {
        // Prefer the latest normal-week plan so the dashboard opens on the regular situation.
        const normal = h.data.filter((r) => !r.chaos && !r.rescue);
        const latest = normal.find((r) => r.status === "VALID" && r.scenario_id === "S0" && !r.network)
          ?? normal.find((r) => r.status === "VALID" && !r.network);
        if (!latest) return;
        const full = await api.getRun(latest.plan_id);
        setRuns((prev) => (prev[module] ? prev : { ...prev, [module]: full.data }));
        setFullRuns((prev) => (prev[module] ? prev : { ...prev, [module]: full.data }));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  const setModule = useCallback((m: string) => {
    setModuleState(m);
    writePref("module", m);
    setRunError(null);
  }, []);

  const ruleToggles = toggles[module] ?? {};
  const setRuleToggle = useCallback((id: string, on: boolean | null) => {
    setToggles((prev) => {
      const cur = { ...(prev[module] ?? {}) };
      if (on === null) delete cur[id];
      else cur[id] = on;
      return { ...prev, [module]: cur };
    });
  }, [module]);

  const network = networks[module] ?? null;
  const setNetwork = useCallback((n: NetworkEdit | null) => setNetworks((p) => ({ ...p, [module]: n })), [module]);

  const runPlan = useCallback(async (opts?: { scenario?: ScenarioId; network?: NetworkEdit | null }) => {
    const sid = opts?.scenario ?? scenario;
    const net = opts?.network !== undefined ? opts.network : network;
    setRunning(true);
    setRunError(null);
    try {
      const params = { module, scenario_id: sid, rule_toggles: ruleToggles, contested_pattern: contested, include_insights: true, network: net };
      let run: Run;
      if (sid === "S0") {
        run = (await api.run(params)).data;
        setDiffs((p) => ({ ...p, [module]: null }));
      } else {
        const r = (await api.runScenario(params)).data;
        run = r.run;
        setDiffs((p) => ({ ...p, [module]: r.diff }));
      }
      setRuns((p) => ({ ...p, [module]: run }));
      setChaosByModule((p) => ({ ...p, [module]: null }));
      if (!run.network) setFullRuns((p) => ({ ...p, [module]: run }));
      if (opts?.scenario) setScenario(sid);
      return run;
    } catch (e) {
      setRunError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
      return null;
    } finally {
      setRunning(false);
    }
  }, [module, scenario, ruleToggles, contested, network]);

  const setRun = useCallback((r: Run) => {
    setRuns((p) => ({ ...p, [r.module]: r }));
    setChaosByModule((p) => ({ ...p, [r.module]: null }));
  }, []);

  // Chaos runs never replace the original plan: it is kept in the result and restored on reset.
  const startChaos = useCallback((r: ChaosResult) => {
    setRuns((p) => ({ ...p, [r.after.module]: r.after }));
    setChaosByModule((p) => ({ ...p, [r.after.module]: r }));
  }, []);
  const resetChaos = useCallback(() => {
    const c = chaosByModule[module];
    if (c) setRuns((p) => ({ ...p, [module]: c.before }));
    setChaosByModule((p) => ({ ...p, [module]: null }));
  }, [chaosByModule, module]);

  const value = useMemo<PlannerState>(() => ({
    modules, scenarios, module, setModule, scenario, setScenario, contested, setContested,
    ruleToggles, setRuleToggle, run: runs[module] ?? null, setRun, scenarioDiff: diffs[module] ?? null,
    running, runError, runPlan, bootError, currentModule: modules.find((m) => m.industry === module),
    network, setNetwork, fullRun: fullRuns[module] ?? null,
    chaos: chaosByModule[module] ?? null, startChaos, resetChaos,
  }), [modules, scenarios, module, setModule, scenario, contested, ruleToggles, setRuleToggle, runs, setRun, diffs,
    running, runError, runPlan, bootError, network, setNetwork, fullRuns, chaosByModule, startChaos, resetChaos]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlanner must be used inside PlannerProvider");
  return v;
}
