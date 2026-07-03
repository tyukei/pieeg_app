// Canvas rendering: 16ch stacked waveform + band-power bars. No dependencies.

import type { Bands } from "./fft";

const BAND_ORDER = ["delta", "theta", "alpha", "beta", "gamma"];
const BAND_COLORS: Record<string, string> = {
  delta: "#6366f1",
  theta: "#0ea5e9",
  alpha: "#22c55e",
  beta: "#f59e0b",
  gamma: "#ef4444",
};

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 300;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Stacked 16-channel waveform, autoscaled to a shared per-frame amplitude.
export function drawWaveform(canvas: HTMLCanvasElement, raw: number[][]): void {
  const ctx = fitCanvas(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (!raw || raw.length < 2) return;

  const nch = raw[0].length;
  const rowH = h / nch;
  // Shared amplitude scale: 99th-percentile-ish via max abs (cheap + robust enough).
  let maxAbs = 1e-6;
  for (const row of raw) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scale = (rowH * 0.45) / maxAbs;

  ctx.lineWidth = 1;
  ctx.font = "10px system-ui, sans-serif";
  for (let ch = 0; ch < nch; ch++) {
    const yMid = rowH * (ch + 0.5);
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath();
    ctx.moveTo(0, yMid);
    ctx.lineTo(w, yMid);
    ctx.stroke();

    ctx.strokeStyle = `hsl(${(ch * 360) / nch}, 70%, 60%)`;
    ctx.beginPath();
    for (let i = 0; i < raw.length; i++) {
      const x = (i / (raw.length - 1)) * w;
      const y = yMid - raw[i][ch] * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`ch${String(ch).padStart(2, "0")}`, 4, yMid - rowH * 0.3);
  }
}

// Horizontal-ish band bars with log-scaled height (band power spans orders of mag).
export function drawBands(canvas: HTMLCanvasElement, bands: Bands): void {
  const ctx = fitCanvas(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const vals = BAND_ORDER.map((b) => bands[b] ?? 0);
  const logv = vals.map((v) => Math.log10(1 + Math.max(0, v)));
  const maxLog = Math.max(...logv, 1e-6);
  const n = BAND_ORDER.length;
  const gap = 14;
  const barW = (w - gap * (n + 1)) / n;
  const bottom = h - 26;

  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    const name = BAND_ORDER[i];
    const x = gap + i * (barW + gap);
    const barH = (logv[i] / maxLog) * (bottom - 22); // leave headroom for the value label
    ctx.fillStyle = BAND_COLORS[name];
    ctx.fillRect(x, bottom - barH, barW, barH);
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(name, x + barW / 2, h - 10);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(vals[i].toExponential(1), x + barW / 2, bottom - barH - 6);
  }
}

export { BAND_ORDER, BAND_COLORS };
