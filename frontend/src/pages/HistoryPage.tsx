import { ChevronRight, History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Card, ErrorBox, PageHeader, Pill, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import type { ScenarioId } from "../types/api";
import { fmtDateTime, fmtInt, fmtPct, fmtRs } from "../utils/format";
import { SCENARIO_TEXT } from "../utils/labels";

export default function HistoryPage() {
  const p = usePlanner();
  const nav = useNavigate();
  const h = useAsync(() => api.history(p.module, 100), [p.module, p.run?.plan_id, p.run?.version]);
  const open = async (id: string) => {
    p.setRun((await api.getRun(id)).data);
    nav("/planner");
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Past plans" description="Every plan you made is saved. Click one to open it." />
      <ErrorBox error={h.error} onRetry={h.reload} />
      {h.loading && !h.data ? <Spinner /> : (
        <Card title={`${h.data?.length ?? 0} saved plans`} icon={History} bodyClass="px-2 pb-4 pt-3">
          <div className="max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead><tr><th>When</th><th>Situation</th><th className="num">Delivered</th><th className="num">Short</th><th className="num">Delivery cost</th><th>Status</th><th className="w-8" /></tr></thead>
              <tbody>
                {(h.data ?? []).map((r) => (
                  <tr key={r.plan_id} className="clickable" onClick={() => void open(r.plan_id)}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>{SCENARIO_TEXT[r.scenario_id as ScenarioId]?.name ?? r.scenario_id}{r.version > 1 && <Pill tone="violet" className="ml-2">edited</Pill>}</td>
                    <td className="num font-semibold">{fmtPct(r.optimizer?.kpis?.fill_rate, 0)}</td>
                    <td className="num">{fmtInt(r.optimizer?.kpis?.unmet_units)}</td>
                    <td className="num">{fmtRs(r.optimizer?.kpis?.transport_cost)}</td>
                    <td>{r.status === "VALID" ? <Pill tone="green">Checked</Pill> : <Pill tone="red">Problem</Pill>}{r.persisted === false && <Pill tone="red" className="ml-1">not saved</Pill>}</td>
                    <td className="text-slate-300"><ChevronRight size={16} aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {h.data?.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No plans yet.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
