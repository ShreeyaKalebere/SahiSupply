import { FlaskConical, HardDriveDownload, ShieldCheck, ShieldX } from "lucide-react";
import type { Run } from "../types/api";
import { fmtDateTime, shortHash } from "../utils/format";
import { Details, Notice, Pill } from "./ui";

/** A plan that failed the safety check is never shown as approved. */
export function PlanStatusBanner({ run }: { run: Run }) {
  const opt = run.optimizer;
  if (run.status === "SOLVER_FAILED" || !opt) {
    return <Notice tone="danger"><b>We couldn't build a plan this time.</b> Only the manual-style plan is available, for reference. Please try again.</Notice>;
  }
  if (!opt.check.valid) {
    return (
      <Notice tone="danger">
        <b>Do not use this plan.</b> Our safety check found {opt.check.violation_count} problem(s), for example: {opt.check.violations[0]?.message}.
      </Notice>
    );
  }
  return null;
}

/** One friendly badge: is this plan safe to use? */
export function RuleCheckBadge({ run }: { run: Run }) {
  const ok = run.status === "VALID" && !!run.optimizer?.check.valid;
  return ok ? (
    <Pill tone="green" title="An independent checker re-verified stock, expiry, storage and capacity for every delivery">
      <ShieldCheck size={13} aria-hidden /> All rules checked{run.plan_status === "VALID_WITH_OVERRIDES" ? " (with your edits)" : ""}
    </Pill>
  ) : (
    <Pill tone="red"><ShieldX size={13} aria-hidden /> Failed safety check</Pill>
  );
}

export function PlanTechDetails({ run }: { run: Run }) {
  const s = run.optimizer?.solver;
  return (
    <Details>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>Plan ID: <span className="font-mono">{run.plan_id}</span> (version {run.version})</div>
        <div>Created: {fmtDateTime(run.created_at)}</div>
        <div>Data fingerprint: <span className="font-mono" title={run.fingerprint}>{shortHash(run.fingerprint)}</span></div>
        <div>Solver: {s ? `${s.status} in ${s.solve_seconds.toFixed(2)} s${s.gap != null ? `, gap ${(s.gap * 100).toFixed(2)}%` : ""}` : "—"}</div>
        <div>Rules enforced: {run.rules_enforced.join(", ") || "none"}</div>
        <div>Checker: {run.optimizer?.check.violation_count ?? "—"} violations over {run.optimizer?.check.checked.lines ?? 0} lines</div>
        <div>Contested-supply pattern: {run.contested_pattern ? "on" : "off"}</div>
        <div>Data source: {run.data_source}{run.persisted === false ? " (not saved)" : ""}</div>
      </dl>
    </Details>
  );
}

export function SourceBadges({ dataSource, persisted }: { dataSource?: string; persisted?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Pill tone="amber" title="All data in this app is generated for demonstration"><FlaskConical size={12} aria-hidden /> Sample data</Pill>
      {dataSource === "snapshot" && <Pill tone="red" title="MongoDB is unreachable; showing a read-only copy"><HardDriveDownload size={12} aria-hidden /> Offline copy - database down</Pill>}
      {persisted === false && <Pill tone="red">Not saved</Pill>}
    </div>
  );
}
