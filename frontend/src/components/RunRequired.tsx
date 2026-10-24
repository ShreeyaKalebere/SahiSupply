import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { usePlanner } from "../hooks/usePlanner";
import type { Run } from "../types/api";
import { EmptyState, Spinner } from "./ui";

/** Renders children with the current run, or a prompt to run a plan first. */
export function RunRequired({ children }: { children: (run: Run) => ReactNode }) {
  const p = usePlanner();
  if (p.running && !p.run) return <Spinner label="Forecasting, optimizing and checking the plan…" />;
  if (!p.run) {
    return (
      <EmptyState title={`No plan yet for ${p.currentModule?.display_name ?? p.module}`}
        action={<button className="btn-primary" onClick={() => void p.runPlan()} disabled={p.running}><Play size={14} aria-hidden /> Run plan</button>}>
        Running a plan forecasts demand, computes net need, solves the batch-level optimizer and the greedy baseline on
        identical inputs, and validates both with the independent checker.
      </EmptyState>
    );
  }
  return <>{children(p.run)}</>;
}
