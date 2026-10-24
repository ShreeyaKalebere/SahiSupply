import { Bot, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { usePlanner } from "../hooks/usePlanner";
import type { ChatTurn } from "../types/api";
import { cx } from "../utils/format";
import { MODULE_LABEL } from "../utils/labels";

const DEFAULT_SUGGESTIONS = [
  "How does SahiSupply work?",
  "Which stores are short and why?",
  "What should I fix first?",
  "Why doesn't Nagpur supply the red stores?",
  "How is this better than manual planning?",
  "What do the lines on the map mean?",
];

/** Floating "Ask SahiSupply" assistant, available on every page. Answers come from the current plan. */
export function ChatWidget() {
  const p = usePlanner();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<"claude" | "built-in" | null>(null);
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTurns([]); }, [p.module]);
  useEffect(() => {
    if (open && engine === null) {
      api.assistantStatus().then((r) => { setEngine(r.data.engine); setSuggestions(r.data.suggestions); }).catch(() => undefined);
    }
  }, [open, engine]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [turns, busy]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api.chat(p.module, next.slice(-20), p.run?.plan_id);
      setEngine(r.data.engine);
      setTurns([...next, { role: "assistant", content: r.data.reply }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong.";
      setTurns([...next, { role: "assistant", content: `Sorry - I couldn't answer (${msg}).` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print">
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask SahiSupply"
          className="fixed bottom-20 right-4 z-[1150] flex items-center gap-2 rounded-full bg-primary-500 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-primary-600 lg:bottom-6 lg:right-6">
          <MessageCircle size={18} aria-hidden /> Ask SahiSupply
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="SahiSupply assistant"
          className="fixed inset-x-2 bottom-20 z-[1150] flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[380px] lg:bottom-6 lg:right-6">
          <header className="flex items-center justify-between bg-gradient-to-r from-primary-500 to-sky-500 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20"><Bot size={17} aria-hidden /></span>
              <div>
                <div className="text-sm font-semibold">Ask SahiSupply</div>
                <div className="text-[11px] text-white/80">
                  {MODULE_LABEL[p.module] ?? p.module} · {engine === "claude" ? "powered by Claude" : "built-in assistant"}
                  {p.run ? "" : " · no plan yet"}
                </div>
              </div>
            </div>
            <button aria-label="Close assistant" className="rounded-lg p-1 hover:bg-white/20" onClick={() => setOpen(false)}><X size={18} /></button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-page px-3 py-3 text-sm">
            {turns.length === 0 && (
              <div className="rounded-xl bg-white p-3 text-slate-600 shadow-card">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900"><Sparkles size={14} className="text-primary-500" aria-hidden /> Hi! I explain everything in simple words.</div>
                <p className="mt-1 text-xs">Ask about your plan, a store (by name), any page, or any word you see. Try one of these:</p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cx("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2",
                  t.role === "user" ? "rounded-br-sm bg-primary-500 text-white" : "rounded-bl-sm bg-white text-slate-700 shadow-card")}>
                  {t.content}
                </div>
              </div>
            ))}
            {busy && <div className="w-16 rounded-2xl bg-white px-3 py-2 text-slate-400 shadow-card" role="status">…</div>}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-100 bg-white px-3 py-2">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void ask(s)} disabled={busy}
                  className="shrink-0 rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-xs text-primary-700 hover:bg-primary-100">{s}</button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
              <input aria-label="Your question" className="input flex-1" placeholder="Type a question…" value={input}
                onChange={(e) => setInput(e.target.value)} maxLength={2000} />
              <button type="submit" className="btn-primary px-3" disabled={busy || !input.trim()} aria-label="Send"><Send size={15} aria-hidden /></button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
