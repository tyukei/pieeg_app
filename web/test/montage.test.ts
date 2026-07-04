import { describe, expect, it } from "vitest";
import { MONTAGE } from "../src/montage";

describe("montage", () => {
  it("has 16 electrodes with sequential channels", () => {
    expect(MONTAGE.length).toBe(16);
    MONTAGE.forEach((e, i) => expect(e.ch).toBe(i));
  });

  it("2D positions sit inside the unit disk", () => {
    for (const e of MONTAGE) {
      expect(e.x * e.x + e.y * e.y).toBeLessThanOrEqual(1.05);
    }
  });

  it("3D positions lie on the unit sphere, upper hemisphere", () => {
    for (const e of MONTAGE) {
      const [x, y, z] = e.pos3;
      const r = Math.sqrt(x * x + y * y + z * z);
      expect(r).toBeCloseTo(1, 2);
      expect(y).toBeGreaterThanOrEqual(0); // up = upper hemisphere
    }
  });

  it("assigns a known region to every electrode", () => {
    const regions = new Set(["frontal", "central", "parietal", "occipital", "temporal"]);
    for (const e of MONTAGE) expect(regions.has(e.region)).toBe(true);
  });
});
