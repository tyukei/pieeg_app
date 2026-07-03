// FFT + EEG band-power computation, in the browser.
//
// Mirrors server/aggregate.py so the standalone (simulator) mode and the
// server-connected mode show comparable numbers: Hann taper, one-sided PSD,
// trapezoidal band integration over the same δ/θ/α/β/γ ranges.

export const BANDS: Record<string, [number, number]> = {
  delta: [1.0, 4.0],
  theta: [4.0, 8.0],
  alpha: [8.0, 13.0],
  beta: [13.0, 30.0],
  gamma: [30.0, 45.0],
};

export type Bands = Record<string, number>;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// In-place iterative radix-2 Cooley–Tukey FFT. re/im length must be a power of 2.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// One-sided PSD (μV²/Hz) of a single detrended, Hann-tapered channel.
function psd(signal: number[], srate: number): { freqs: number[]; psd: number[] } {
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const nfft = nextPow2(n);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let winPow = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hann
    winPow += w * w;
    re[i] = (signal[i] - mean) * w;
  }
  fft(re, im);
  const norm = winPow * srate;
  const half = nfft / 2;
  const freqs: number[] = new Array(half + 1);
  const out: number[] = new Array(half + 1);
  for (let k = 0; k <= half; k++) {
    let p = (re[k] * re[k] + im[k] * im[k]) / norm;
    if (k !== 0 && k !== half) p *= 2; // one-sided
    freqs[k] = (k * srate) / nfft;
    out[k] = p;
  }
  return { freqs, psd: out };
}

function integrate(freqs: number[], p: number[], lo: number, hi: number): number {
  let sum = 0;
  for (let k = 1; k < freqs.length; k++) {
    const f0 = freqs[k - 1];
    const f1 = freqs[k];
    if (f1 < lo || f0 > hi) continue;
    sum += ((p[k - 1] + p[k]) / 2) * (f1 - f0); // trapezoid
  }
  return sum;
}

// Per-channel band power. window: [N samples][ch].
export function bandPowersPerCh(window: number[][], srate: number): Record<string, number[]> {
  if (window.length < 2) throw new Error("need >= 2 samples");
  const nch = window[0].length;
  const out: Record<string, number[]> = {};
  for (const name of Object.keys(BANDS)) out[name] = new Array(nch).fill(0);
  for (let ch = 0; ch < nch; ch++) {
    const col = window.map((row) => row[ch]);
    const { freqs, psd: p } = psd(col, srate);
    for (const [name, [lo, hi]] of Object.entries(BANDS)) {
      out[name][ch] = integrate(freqs, p, lo, hi);
    }
  }
  return out;
}

// Band power averaged across channels — the headline UI numbers.
export function bandPowersMean(window: number[][], srate: number): Bands {
  const perCh = bandPowersPerCh(window, srate);
  const out: Bands = {};
  for (const [name, vals] of Object.entries(perCh)) {
    out[name] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}
