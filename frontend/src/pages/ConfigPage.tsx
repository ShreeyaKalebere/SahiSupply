import { api } from "../api/client";
import { Badge, Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";

export default function ConfigPage() {
  const p = usePlanner();
  const cfg = useAsync(() => api.config(p.module), [p.module]);
  const c = cfg.data;
  return (
    <div className="space-y-3">
      <PageHeader title="Industry configuration"
        description="Each industry is a YAML file selecting rules from a fixed library of typed templates. No code runs from configs. Toggle rules here to change the next run (e.g. switch C1 off to see what it prevents, or enable the C4 equity guardrail)." />
      <ErrorBox error={cfg.error} onRetry={cfg.reload} />
      {cfg.loading && !c ? <Spinner /> : c && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card title="Need source"><div className="text-lg font-semibold">{c.need_source}</div><div className="text-xs text-slate-500">{c.need_source === "orders" ? "q = open order quantity (rationing mode)" : "q = forecast over R+L + z·σ·√(R+L) − usable on-hand"}</div></Card>
            <Card title="Review period"><div className="text-lg font-semibold">{c.review_period_days} days</div></Card>
            <Card title="Service levels (z)"><div className="text-sm">critical {c.service_levels.critical} · standard {c.service_levels.standard}</div></Card>
            <Card title="Destinations"><div className="text-sm">{c.destination_types.join(", ")}</div></Card>
          </div>
          <Card title="Rules" bodyClass="p-0">
            <table className="tbl">
              <thead><tr><th>ID</th><th>Template</th><th>Parameters</th><th>Status</th><th>Enforcement</th><th>Next run</th></tr></thead>
              <tbody>
                {c.rules.map((r) => {
                  const toggled = p.ruleToggles[r.id];
                  const on = toggled ?? r.default_on;
                  return (
                    <tr key={r.id}>
                      <td className="font-mono font-semibold">{r.id}</td>
                      <td className="font-mono text-xs">{r.template}</td>
                      <td className="font-mono text-xs">{JSON.stringify(r.params)}</td>
                      <td>{r.status === "active" ? (r.default_on ? <Badge color="green">Active & enforced</Badge> : <Badge color="blue">Implemented · optional</Badge>)
                        : r.status === "planned" ? <Badge color="amber">Planned</Badge> : <Badge color="gray">Unavailable</Badge>}</td>
                      <td className="text-xs text-slate-600">{r.enforcement}<div className="mt-0.5 font-mono text-[10px] text-slate-400">{r.test}</div><div className="mt-0.5 text-[11px]">{r.description}</div></td>
                      <td>
                        {r.status === "active" ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" aria-label={`Rule ${r.id} on`} checked={on}
                              onChange={(e) => p.setRuleToggle(r.id, e.target.checked === r.default_on ? null : e.target.checked)} />
                            {on ? "on" : "off"}{toggled !== undefined && <Badge color="amber">changed</Badge>}
                          </label>
                        ) : <span className="text-xs text-slate-400">n/a</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Notice>{c.disclaimer}</Notice>
        </>
      )}
    </div>
  );
}
