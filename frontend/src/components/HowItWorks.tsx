import { BrainCircuit, Route, ShieldCheck, X } from "lucide-react";

const STEPS = [
  { icon: BrainCircuit, title: "1. Predict what each store needs", text: "We look at the last 6 months of sales (or this week's orders for grocery) and estimate how much every store needs this week." },
  { icon: Route, title: "2. Pick the best warehouse and batch", text: "For every store and product we choose which warehouse and which batch to send - cheapest, freshest, and fair when stock is short." },
  { icon: ShieldCheck, title: "3. Double-check every delivery", text: "A separate checker re-verifies stock, expiry dates, fridges and truck space. A plan that breaks a rule is never shown as ready." },
];

const WORDS = [
  ["Orders delivered", "Share of what stores need that this plan actually sends."],
  ["Short", "Units a store needs that we cannot send this week, and why."],
  ["Manual planning", "How a planner using a spreadsheet would split the stock (one warehouse at a time). We compare against it."],
  ["What-if", "Try a problem - a festival rush, a closed warehouse, monsoon roads - and see how the plan changes."],
  ["Smart suggestions", "Small investments (a fridge, a truck, more stock) that would help the most, each tested by re-planning."],
];

export function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1200] grid place-items-center bg-slate-900/30 p-4" onClick={onClose}>
      <div role="dialog" aria-label="How SahiSupply works" className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">How SahiSupply works</h2>
            <p className="mt-1 text-sm text-slate-500">Every week, it tells you what to send from which warehouse to each store - and why.</p>
          </div>
          <button aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-xl bg-slate-50 p-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-500 text-white"><s.icon size={18} aria-hidden /></span>
              <div className="mt-3 text-sm font-semibold text-slate-900">{s.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
        <h3 className="mt-6 text-sm font-semibold text-slate-900">Words you will see</h3>
        <dl className="mt-2 divide-y divide-slate-100 text-sm">
          {WORDS.map(([w, d]) => (
            <div key={w} className="grid grid-cols-3 gap-3 py-2"><dt className="font-medium text-slate-800">{w}</dt><dd className="col-span-2 text-slate-600">{d}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-400">All data is sample data made up for this demo.</p>
        <div className="mt-5 text-right"><button className="btn-primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}
