export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-IN");

export const fmtNum = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

export const fmtPct = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(d)}%`;

export const fmtRs = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}`;

export const fmtSigned = (n: number | null | undefined, f: (x: number) => string) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${f(Math.abs(n))}`;

export const fmtDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}…` : "—");

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
