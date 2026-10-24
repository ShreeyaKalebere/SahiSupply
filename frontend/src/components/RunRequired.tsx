import { Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { usePlanner } from "../hooks/usePlanner";
import type { Run } from "../types/api";
import { MODULE_LABEL } from "../utils/labels";
import { EmptyState, Spinner } from "./ui";

/** Renders children with the current plan, or a friendly prompt to make one first. */
export function RunRequired({ children }: { children: (run: Run) => ReactNode }) {
  const p = usePlanner();
  if (p.running && !p.run) return <Spinner label="Making this week's plan… (a few seconds)" />;
  if (!p.run) {
    return (
      <EmptyState icon={Sparkles} title={`No plan yet for ${MODULE_LABEL[p.module] ?? p.module}`}
        action={<button className="btn-primary" onClick={() => void p.runPlan()} disabled={p.running}><Play size={15} aria-hidden /> Make this week's plan</button>}>
        Click the button and SahiSupply will work out what every store needs this week, decide which warehouse sends what,
        and double-check every delivery against your rules.
      </EmptyState>
    );
  }
  return <>{children(p.run)}</>;
}
