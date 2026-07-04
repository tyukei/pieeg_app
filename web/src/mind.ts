// Mental-state indices from band powers. Ported from eeg_roomba MindState.
//
//   focus = β / (α + θ)   — Pope engagement index; rises with concentration.
//   relax = α / (α + β)    — alpha dominance; rises when relaxed. 0..1.
//   composite ∈ [-1, +1]   — >0.15 focused, <-0.15 relaxed, else neutral.

import type { Bands } from "./fft";

const EPS = 1e-6;

export interface MindState {
  focus: number;
  relax: number;
  composite: number;
  status: "focused" | "relaxed" | "neutral";
  label: string;
}

export function focusOf(alpha: number, beta: number, theta: number): number {
  return beta / (alpha + theta + EPS);
}

export function relaxOf(alpha: number, beta: number): number {
  return alpha / (alpha + beta + EPS);
}

export function mindState(bands: Bands): MindState {
  const a = bands.alpha ?? 0;
  const b = bands.beta ?? 0;
  const t = bands.theta ?? 0;
  const focus = focusOf(a, b, t);
  const relax = relaxOf(a, b);
  // focus spans ~0..2, relax ~0..1; scale relax ×2 so they weigh comparably.
  const cf = focus;
  const cr = relax * 2;
  const composite = cf + cr > EPS ? (cf - cr) / (cf + cr) : 0;
  const status = composite > 0.15 ? "focused" : composite < -0.15 ? "relaxed" : "neutral";
  const label = status === "focused" ? "集中" : status === "relaxed" ? "リラックス" : "中立";
  return { focus, relax, composite, status, label };
}

// Trailing simple moving average to de-flicker a scalar series.
export function trailingMean(xs: number[], n: number): number {
  if (xs.length === 0) return 0;
  const k = Math.min(n, xs.length);
  let s = 0;
  for (let i = xs.length - k; i < xs.length; i++) s += xs[i];
  return s / k;
}
