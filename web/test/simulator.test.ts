import { describe, expect, it } from "vitest";
import { bandPowersMean } from "../src/fft";
import { NCH, SimulatedPiEEG16 } from "../src/simulator";

describe("SimulatedPiEEG16", () => {
  it("produces 16 channels per sample", () => {
    const dev = new SimulatedPiEEG16(250, 1);
    expect(dev.readSample().length).toBe(NCH);
  });

  it("is deterministic for a fixed seed", () => {
    const a = new SimulatedPiEEG16(250, 42);
    const b = new SimulatedPiEEG16(250, 42);
    expect(a.readSample()).toEqual(b.readSample());
  });

  it("stays within a plausible μV range", () => {
    const dev = new SimulatedPiEEG16(250, 1);
    for (const row of dev.readChunk(2500)) {
      for (const v of row) {
        expect(v).toBeGreaterThan(-500);
        expect(v).toBeLessThan(500);
      }
    }
  });

  it("has alpha as a strong band over a burst peak window", () => {
    const dev = new SimulatedPiEEG16(250, 1);
    // Advance ~2.5 s so the alpha envelope is near its peak, then analyze 1 s.
    dev.readChunk(625);
    const win = dev.readChunk(250);
    const bands = bandPowersMean(win, 250);
    // alpha should be one of the two strongest bands during a burst.
    const ranked = Object.entries(bands).sort((a, b) => b[1] - a[1]);
    const topTwo = ranked.slice(0, 2).map(([k]) => k);
    expect(topTwo).toContain("alpha");
  });
});
