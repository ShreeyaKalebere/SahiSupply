import { Settings2, ShieldCheck } from "lucide-react";
import { api } from "../api/client";
import { Card, Details, ErrorBox, PageHeader, Pill, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { usePlanner } from "../hooks/usePlanner";
import { cx } from "../utils/format";
import { MODULE_LABEL, RULE_TITLE, ruleSentence } from "../utils/labels";

export default function ConfigPage() {
  const p = usePlanner();
  const cfg = useAsync(() => api.config(p.module), [p.module]);
  const c = cfg.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Rules & settings" description={`The rules every ${MODULE_LABEL[p.module] ?? ""} plan must follow. Switch one off to see what it protects you from, then press Run plan.`} />
      <ErrorBox error={cfg.error} onRetry={cfg.reload} />
      {cfg.loading && !c ? <Spinner /> : c && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {c.rules.map((r) => {
              const on = p.ruleToggles[r.id] ?? r.default_on;
              const changed = p.ruleToggles[r.id] !== undefined;
              const usable = r.status === "active";
              return (
                <div key={r.id} className="card flex items-start gap-4 p-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-500"><ShieldCheck size={18} aria-hidden /></span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">{RULE_TITLE[r.template] ?? r.template}</h2>
                      {!usable ? <Pill tone="gray">Planned - not active yet</Pill> : on ? <Pill tone="green">On</Pill> : <Pill tone="amber">Off</Pill>}
                      {changed && <Pill tone="violet">changed - run plan to apply</Pill>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{ruleSentence(r.template, r.params)}</p>
                  </div>
                  {usable && (
                    <button role="switch" aria-checked={on} aria-label={`${RULE_TITLE[r.template] ?? r.id} on`}
                      onClick={() => p.setRuleToggle(r.id, !on === r.default_on ? null : !on)}
                      className={cx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-primary-500" : "bg-slate-300")}>
                      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", on ? "left-[22px]" : "left-0.5")} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <Card title="Demo settings" icon={Settings2}>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={p.contested} onChange={(e) => p.setContested(e.target.checked)} />
              <span><b>Remote stores share one warehouse</b> (contested supply). In the sample data, far-away stores can only be reached from the Pune hub - the
                situation where manual planning struggles most. Turn off to see results when every road is open.</span>
            </label>
          </Card>

          <Details>
            <p>{c.disclaimer}</p>
            <table className="tbl mt-2">
              <thead><tr><th>ID</th><th>Template</th><th>Parameters</th><th>Status</th><th>Test</th></tr></thead>
              <tbody>{c.rules.map((r) => (
                <tr key={r.id}><td className="font-mono">{r.id}</td><td className="font-mono">{r.template}</td><td className="font-mono">{JSON.stringify(r.params)}</td><td>{r.enforcement}</td><td className="font-mono text-[10px]">{r.test}</td></tr>
              ))}</tbody>
            </table>
            <p className="mt-2">Need source: {c.need_source} · review period {c.review_period_days} days · service level z: critical {c.service_levels.critical}, standard {c.service_levels.standard}.</p>
          </Details>
        </>
      )}
    </div>
  );
}
