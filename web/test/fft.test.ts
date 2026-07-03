import { describe, expect, it } from "vitest";
import { BANDS, bandPowersMean, bandPowersPerCh } from "../src/fft";

const SRATE = 250;

function sine(freq: number, n: number, nch = 16, amp = 10): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * i) / SRATE);
    rows.push(new Array(nch).fill(v));
  }
  return rows;
}

describe("bandPowers", () => {
  it("returns all band keys", () => {
    const out = bandPowersMean(sine(10, SRATE), SRATE);
    expect(Object.keys(out).sort()).toEqual(Object.keys(BANDS).sort());
  });

  it("per-channel arrays match channel count", () => {
    const out = bandPowersPerCh(sine(10, SRATE, 16), SRATE);
    for (const vals of Object.values(out)) expect(vals.length).toBe(16);
  });

  it("10 Hz tone dominates the alpha band", () => {
    const out = bandPowersMean(sine(10, SRATE), SRATE);
    const dominant = Object.entries(out).sort((a, b) => b[1] - a[1])[0][0];
    expect(dominant).toBe("alpha");
    const others = Object.entries(out)
      .filter(([k]) => k !== "alpha")
      .reduce((s, [, v]) => s + v, 0);
    expect(out.alpha).toBeGreaterThan(5 * others);
  });

  it("20 Hz tone dominates the beta band", () => {
    const out = bandPowersMean(sine(20, SRATE), SRATE);
    const dominant = Object.entries(out).sort((a, b) => b[1] - a[1])[0][0];
    expect(dominant).toBe("beta");
  });

  it("6 Hz tone dominates the theta band", () => {
    const out = bandPowersMean(sine(6, SRATE), SRATE);
    const dominant = Object.entries(out).sort((a, b) => b[1] - a[1])[0][0];
    expect(dominant).toBe("theta");
  });

  it("larger amplitude yields more power (∝ amp²)", () => {
    const small = bandPowersMean(sine(10, SRATE, 16, 5), SRATE);
    const big = bandPowersMean(sine(10, SRATE, 16, 10), SRATE);
    expect(big.alpha).toBeGreaterThan(3 * small.alpha);
  });

  it("ignores a DC offset", () => {
    const win = Array.from({ length: SRATE }, () => new Array(16).fill(123.4));
    const out = bandPowersMean(win, SRATE);
    for (const v of Object.values(out)) expect(v).toBeLessThan(1e-6);
  });

  it("throws on too few samples", () => {
    expect(() => bandPowersPerCh([[0, 0]], SRATE)).toThrow();
  });
});
