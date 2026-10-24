import { Map as MapIcon } from "lucide-react";
import { api } from "../api/client";
import { closedRoadsFor, flowsFromLines, NetworkMap } from "../components/NetworkMap";
import { Card, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useNetwork } from "../hooks/useNetwork";
import { usePlanner } from "../hooks/usePlanner";
import { fmtInt, fmtPct } from "../utils/format";

export default function MapPage() {
  const p = usePlanner();
  const { net } = useNetwork(p.module);
  const routes = useAsync(() => api.routes(p.module, p.run?.contested_pattern ?? p.contested), [p.module, p.run?.contested_pattern, p.contested]);
  const run = p.run;

  if (!net || routes.loading) return <Spinner />;
  const keptW = run?.network ? new Set(run.network.summary.warehouses_kept) : null;
  const keptD = run?.network ? new Set(run.network.summary.outlets_kept) : null;
  const W = net.warehouses.filter((w) => !keptW || keptW.has(w.warehouse_id));
  const O = net.outlets.filter((o) => !keptD || keptD.has(o.outlet_id));
  const flows = run?.optimizer ? flowsFromLines(run.optimizer.lines) : [];
  const closed = closedRoadsFor(run, routes.data ?? []);
  const fill = Object.fromEntries(Object.entries(run?.optimizer?.kpis.by_outlet ?? {}).map(([d, v]) => [d, v.fill_rate]));
  const closedW = ((run?.scenario.changes as { closed_warehouses?: string[] })?.closed_warehouses) ?? [];
  const wName = (id: string) => net.warehouses.find((w) => w.warehouse_id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <PageHeader title="Map" description="Watch this week's deliveries move from warehouses to stores. Red dotted lines are roads that are closed, so those places are not connected." />
      <ErrorBox error={routes.error} onRetry={routes.reload} />
      {!run && <Notice>Make a plan (Run plan, top right) to see deliveries moving on the map.</Notice>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClass="p-0">
          <NetworkMap warehouses={W} outlets={O} flows={flows} closedRoads={closed} fillByOutlet={fill} closedWarehouses={closedW} height={560} />
        </Card>
        <Card title="Deliveries (list)" icon={MapIcon} bodyClass="max-h-[620px] overflow-y-auto p-0">
          <table className="tbl">
            <thead><tr><th>From</th><th>To</th><th className="num">Units</th><th className="num">Store got</th></tr></thead>
            <tbody>
              {[...flows].sort((a, b) => b.qty - a.qty).map((f) => (
                <tr key={`${f.w}${f.d}`}><td>{wName(f.w)}</td><td>{O.find((o) => o.outlet_id === f.d)?.name ?? f.d}</td>
                  <td className="num">{fmtInt(f.qty)}</td><td className="num">{fmtPct(fill[f.d], 0)}</td></tr>
              ))}
            </tbody>
          </table>
          {closed.length > 0 && <p className="px-4 py-3 text-xs text-slate-500">{closed.length} road(s) closed: {closed.slice(0, 12).map((r) => r.route_id).join(", ")}{closed.length > 12 ? "…" : ""}</p>}
        </Card>
      </div>
      <p className="text-xs text-slate-400">Lines are straight between locations - they are not actual road routes.</p>
    </div>
  );
}
