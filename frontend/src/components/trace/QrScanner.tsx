import jsQR from "jsqr";
import { Camera, Keyboard, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function decodeCanvas(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Reads a QR code from a still photo, trying full size and then a smaller copy (helps with large camera photos). */
async function decodeFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read the photo"));
      i.src = url;
    });
    for (const max of [1600, 900, 600]) {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      const hit = decodeCanvas(c);
      if (hit) return hit;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Camera QR scanner: live camera with the browser's BarcodeDetector (or jsQR as a fallback), plus
 * "take a photo" for devices where live camera access isn't allowed (e.g. plain-HTTP pages) and manual entry.
 */
export function QrScanner({ title, hint, onCode, onClose }: { title: string; hint?: string; onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<"starting" | "on" | "off">("starting");
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(false);

  const finish = (code: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    navigator.vibrate?.(60);
    onCode(code.trim());
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;

    const tick = async () => {
      const v = videoRef.current;
      if (stopped || !v || v.readyState < 2) { timer = window.setTimeout(tick, 200); return; }
      try {
        let hit: string | null = null;
        if (detector) {
          hit = (await detector.detect(v))[0]?.rawValue ?? null;
        } else {
          const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * s);
          canvas.height = Math.round(v.videoHeight * s);
          canvas.getContext("2d", { willReadFrequently: true })?.drawImage(v, 0, 0, canvas.width, canvas.height);
          hit = decodeCanvas(canvas);
        }
        if (hit) { finish(hit); return; }
      } catch {
        /* keep trying */
      }
      timer = window.setTimeout(tick, 180);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setLive("off");
        setMsg("Live camera isn't available here. Take a photo of the label or type the code.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        setLive("on");
        tick();
      } catch {
        setLive("off");
        setMsg("Camera access was blocked or unavailable. Take a photo of the label or type the code.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPhoto = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const code = await decodeFile(f);
      if (code) finish(code);
      else setMsg("No QR code found in that photo. Hold the label flat, fill the frame and try again.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/80 p-3" role="dialog" aria-label={title}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div><h2 className="font-semibold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
          <button type="button" aria-label="Close scanner" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="relative aspect-square bg-slate-900">
          <video ref={videoRef} className={`h-full w-full object-cover ${live === "on" ? "" : "hidden"}`} playsInline muted />
          {live === "on" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="qr-frame h-3/5 w-3/5 rounded-2xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"><span className="qr-laser" /></div>
            </div>
          )}
          {live === "starting" && <div className="absolute inset-0 grid place-items-center text-sm text-white/80"><Loader2 className="animate-spin" aria-hidden /></div>}
          {live === "off" && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">{msg}</div>}
        </div>
        <div className="space-y-2 p-4">
          {live === "on" && <p className="text-center text-xs text-slate-500">Point the camera at the batch QR label.</p>}
          {msg && live === "on" && <p className="text-xs text-rose-600">{msg}</p>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary justify-center" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Camera size={15} aria-hidden />}Take photo
            </button>
            <button type="button" className="btn-secondary justify-center" onClick={() => setShowManual((s) => !s)}><Keyboard size={15} aria-hidden />Type code</button>
          </div>
          {showManual && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) finish(manual); }}>
              <input className="input flex-1 font-mono text-xs" placeholder="SAHI1|pharmacy|B076|…" value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="none" autoCorrect="off" />
              <button type="submit" className="btn-primary">Check</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
