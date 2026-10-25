import { useEffect, useState } from "react";
import { TAGLINE } from "../utils/labels";

const SHOWN_KEY = "sahisupply.splashShown";
const DURATION_MS = 3000;   // logo pop + wipe, shine, tagline slide-up, hold
const FADE_MS = 450;

/** Launch screen for the field app: the logo pops and wipes in, a shine sweeps it, then the tagline slides up. Tap to skip. */
export function SplashScreen() {
  const [phase, setPhase] = useState<"show" | "fade" | "done">(() => {
    try {
      return sessionStorage.getItem(SHOWN_KEY) ? "done" : "show";
    } catch {
      return "show";
    }
  });

  useEffect(() => {
    if (phase !== "show") return;
    try {
      sessionStorage.setItem(SHOWN_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setPhase("fade"), reduced ? 1200 : DURATION_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "fade") return;
    const t = window.setTimeout(() => setPhase("done"), FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;
  return (
    <div className={`splash ${phase === "fade" ? "splash-out" : ""}`} role="img" aria-label={`SahiSupply. ${TAGLINE.join(" ")}`}
      onClick={() => setPhase("fade")}>
      <div className="splash-glow" aria-hidden />
      <div className="splash-logo">
        <img src="/brand/logo.png" alt="" draggable={false} />
        <span className="splash-shine" aria-hidden />
      </div>
      <p className="splash-tagline" aria-hidden>
        {TAGLINE.map((t, i) => (
          <span key={t} className="splash-line"><span style={{ animationDelay: `${1.05 + i * 0.22}s` }}>{t}</span></span>
        ))}
      </p>
      <div className="splash-bar" aria-hidden><span /></div>
    </div>
  );
}
