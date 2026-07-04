import { describe, expect, it } from "vitest";
import { focusOf, mindState, relaxOf, trailingMean } from "../src/mind";

describe("mind indices", () => {
  it("focus rises with beta", () => {
    expect(focusOf(1, 2, 1)).toBeGreaterThan(focusOf(1, 1, 1));
  });

  it("relax is alpha dominance in 0..1", () => {
    expect(relaxOf(1, 0)).toBeCloseTo(1, 3);
    expect(relaxOf(0, 1)).toBeCloseTo(0, 3);
    expect(relaxOf(1, 1)).toBeCloseTo(0.5, 3);
  });

  it("classifies high-beta as focused", () => {
    const ms = mindState({ alpha: 1, beta: 10, theta: 1, delta: 0, gamma: 0 });
    expect(ms.status).toBe("focused");
    expect(ms.label).toBe("集中");
  });

  it("classifies high-alpha as relaxed", () => {
    const ms = mindState({ alpha: 10, beta: 1, theta: 1, delta: 0, gamma: 0 });
    expect(ms.status).toBe("relaxed");
    expect(ms.label).toBe("リラックス");
  });

  it("composite is bounded to [-1, 1]", () => {
    for (const [a, b, t] of [[1, 100, 1], [100, 1, 1], [1, 1, 1]] as const) {
      const ms = mindState({ alpha: a, beta: b, theta: t, delta: 0, gamma: 0 });
      expect(ms.composite).toBeGreaterThanOrEqual(-1);
      expect(ms.composite).toBeLessThanOrEqual(1);
    }
  });

  it("trailingMean averages the last n", () => {
    expect(trailingMean([1, 2, 3, 4], 2)).toBeCloseTo(3.5, 6);
    expect(trailingMean([], 3)).toBe(0);
  });
});
