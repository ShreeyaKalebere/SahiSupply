import { Database, FlaskConical, HardDriveDownload, ShieldCheck, ShieldX } from "lucide-react";
import type { Run } from "../types/api";
import { fmtDateTime, shortHash } from "../utils/format";
import { Badge, Notice } from "./ui";

/** Plan-level status banner. An invalid or failed plan is never presented as approved. */
export function PlanStatusBanner({ run }: { run: Run }) {
  const opt = run.optimizer;
  if (run.status === "SOLVER_FAILED" || !opt) {
    return (
      <Notice tone="danger">
        <b>No optimized plan.</b> {run.optimizer_error?.message ?? "The solver did not return a feasible plan."} The greedy
        baseline below is shown for reference only and is labelled as such.
      </Notice>
    );
  }
  if (!opt.check.valid) {
    return (
      <Notice tone="danger">
        <b>Plan rejected by the independent checker - NOT approved.</b> {opt.check.violation_count} violation(s), e.g.{" "}
        {opt.check.violations.slice(0, 2).map((v) => `${v.code}: ${v.message}`).join("; ")}.
      </Notice>
    );
  }
  return null;
}

export function PlanMetaStrip({ run }: { run: Run }) {
  const opt = run.optimizer;
  const valid = !!opt && opt.check.valid && run.status === "VALID";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      {valid ? (
        <Badge color="green"><ShieldCheck size={12} aria-hidden /> {run.plan_status === "VALID_WITH_OVERRIDES" ? "Valid (with overrides)" : "Valid plan"} · 0 violations</Badge>
      ) : (
        <Badge color="red"><ShieldX size={12} aria-hidden /> {run.status === "SOLVER_FAILED" ? "Solver failed" : "Invalid plan"}</Badge>
      )}
      <span className="font-mono" title={run.fingerprint}>fp {shortHash(run.fingerprint)}</span>
      <span>·</span>
      <span>{run.plan_id} v{run.version}</span>
      <span>·</span>
      <span>{run.scenario_id} {run.scenario.name}</span>
      {opt && <><span>·</span><span>{opt.solver.status} in {opt.solver.solve_seconds.toFixed(2)}s{opt.solver.gap != null ? ` · gap ${(opt.solver.gap * 100).toFixed(2)}%` : ""}</span></>}
      <span>·</span>
      <span>{fmtDateTime(run.created_at)}</span>
      {!run.contested_pattern && <Badge color="violet">pattern off</Badge>}
      {Object.entries(run.rule_toggles).filter(([, on]) => !on).length > 0 && (
        <Badge color="amber">rules switched off: {Object.entries(run.rule_toggles).filter(([, on]) => !on).map(([id]) => id).join(", ")}</Badge>
      )}
      {Object.entries(run.rule_toggles).filter(([, on]) => on).map(([id]) => <Badge key={id} color="blue">{id} on</Badge>)}
    </div>
  );
}

export function SourceBadges({ dataSource, persisted }: { dataSource?: string; persisted?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge color="amber"><FlaskConical size={12} aria-hidden /> Synthetic data</Badge>
      {dataSource === "snapshot" ? (
        <Badge color="red"><HardDriveDownload size={12} aria-hidden /> Snapshot fallback - MongoDB down</Badge>
      ) : dataSource ? (
        <Badge color="green"><Database size={12} aria-hidden /> MongoDB</Badge>
      ) : null}
      {persisted === false && <Badge color="red">Not persisted</Badge>}
    </div>
  );
}
