import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Card, ErrorBox, PageHeader, Spinner, ValidityBadge } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { fmtDateTime, fmtInt, fmtPct, fmtRs, shortHash } from "../utils/format";

export default function HistoryPage() {
  const p = usePlanner();
  const nav = useNavigate();
  const h = useAsync(() => api.history(p.module, 100), [p.module, p.run?.plan_id, p.run?.version]);
  const open = async (id: string) => {
    const r = await api.getRun(id);
    p.setRun(r.data);
    nav("/planner");
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Run history" description={`Optimization runs read from MongoDB (${String(h.meta?.source ?? "…")}). Click a run to load it into the planner.`} />
      <ErrorBox error={h.error} onRetry={h.reload} />
      {h.loading && !h.data ? <Spinner /> : (
        <Card bodyClass="p-0">
          <div className="max-h-[75vh] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Plan</th><th>Scenario</th><th>Status</th><th className="num">Fill (opt / base)</th><th className="num">Unmet</th>
                <th className="num">Cost</th><th className="num">Critical short</th><th>Solver</th><th>Fingerprint</th><th>Source</th></tr></thead>
              <tbody>
                {(h.data ?? []).map((r) => (
                  <tr key={`${r.plan_id}`} className="clickable" onClick={() => void open(r.plan_id)}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="font-mono text-xs">{r.plan_id} v{r.version}</td>
                    <td>{r.scenario_id} {r.scenario?.name}{!r.contested_pattern && <Badge color="violet" className="ml-1">pattern off</Badge>}</td>
                    <td>{r.status === "VALID" ? <ValidityBadge valid label={r.plan_status === "VALID_WITH_OVERRIDES" ? "valid + overrides" : "valid"} /> : <ValidityBadge valid={false} label={r.status} />}</td>
                    <td className="num">{fmtPct(r.optimizer?.kpis?.fill_rate)} / {fmtPct(r.baseline?.kpis?.fill_rate)}</td>
                    <td className="num">{fmtInt(r.optimizer?.kpis?.unmet_units)}</td>
                    <td className="num">{fmtRs(r.optimizer?.kpis?.transport_cost)}</td>
                    <td className="num">{fmtInt(r.optimizer?.kpis?.critical_shortage_units)}</td>
                    <td className="text-xs">{r.optimizer?.solver?.status} {r.optimizer?.solver ? `${r.optimizer.solver.solve_seconds.toFixed(2)}s` : ""}</td>
                    <td className="font-mono text-xs">{shortHash(r.fingerprint)}</td>
                    <td>{r.persisted === false ? <Badge color="red">memory only</Badge> : <Badge color="green">MongoDB</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {h.data?.length === 0 && <p className="p-4 text-sm text-slate-500">No runs yet for this module.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
