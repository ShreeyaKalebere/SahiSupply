import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { ModuleSummary, Run, Scenario, ScenarioDiff, ScenarioId } from "../types/api";

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
  runPlan: (opts?: { scenario?: ScenarioId }) => Promise<Run | null>;
  bootError: ApiError | null;
  currentModule: ModuleSummary | undefined;
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
  const [diffs, setDiffs] = useState<Record<string, ScenarioDiff | null>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);
  const [bootError, setBootError] = useState<ApiError | null>(null);

  useEffect(() => {
    Promise.all([api.modules(), api.scenarios()])
      .then(([m, s]) => {
        setModules(m.data);
        setScenarios(s.data);
      })
      .catch((e: ApiError) => setBootError(e));
  }, []);

  // Restore the most recent valid run for the module from MongoDB history.
  useEffect(() => {
    if (runs[module]) return;
    api.history(module, 10)
      .then(async (h) => {
        const latest = h.data.find((r) => r.status === "VALID");
        if (!latest) return;
        const full = await api.getRun(latest.plan_id);
        setRuns((prev) => (prev[module] ? prev : { ...prev, [module]: full.data }));
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

  const runPlan = useCallback(async (opts?: { scenario?: ScenarioId }) => {
    const sid = opts?.scenario ?? scenario;
    setRunning(true);
    setRunError(null);
    try {
      const params = { module, scenario_id: sid, rule_toggles: ruleToggles, contested_pattern: contested, include_insights: true };
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
      if (opts?.scenario) setScenario(sid);
      return run;
    } catch (e) {
      setRunError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
      return null;
    } finally {
      setRunning(false);
    }
  }, [module, scenario, ruleToggles, contested]);

  const setRun = useCallback((r: Run) => setRuns((p) => ({ ...p, [r.module]: r })), []);

  const value = useMemo<PlannerState>(() => ({
    modules, scenarios, module, setModule, scenario, setScenario, contested, setContested,
    ruleToggles, setRuleToggle, run: runs[module] ?? null, setRun, scenarioDiff: diffs[module] ?? null,
    running, runError, runPlan, bootError, currentModule: modules.find((m) => m.industry === module),
  }), [modules, scenarios, module, setModule, scenario, contested, ruleToggles, setRuleToggle, runs, setRun, diffs,
    running, runError, runPlan, bootError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlanner must be used inside PlannerProvider");
  return v;
}
