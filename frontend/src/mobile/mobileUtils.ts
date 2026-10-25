import { useState } from "react";

/** A remembered per-device choice (selected depot, warehouse...). */
export function usePref(key: string, fallback = ""): [string, (v: string) => void] {
  const k = `sahisupply.mobile.${key}`;
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(k) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (x: string) => {
    setV(x);
    try {
      localStorage.setItem(k, x);
    } catch {
      /* storage unavailable */
    }
  };
  return [v, set];
}

/** Shrink a camera photo to a JPEG data URL (max 1280 px, ~150-300 KB) before upload. */
export async function compressPhoto(file: File, max = 1280, quality = 0.6): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read the photo"));
      i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Could not process the photo");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
