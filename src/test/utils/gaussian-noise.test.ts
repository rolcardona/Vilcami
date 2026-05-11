import { describe, it, expect } from "vitest";
import { generateGaussianNoise } from "../../utils/gaussian-noise.util";

describe("generateGaussianNoise", () => {
  it("should return a number", () => {
    const result = generateGaussianNoise();
    expect(typeof result).toBe("number");
  });

  it("should return different values on successive calls (not constant)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) {
      values.add(generateGaussianNoise());
    }
    // With 20 samples, extremely unlikely to all be identical
    expect(values.size).toBeGreaterThan(1);
  });

  it("should produce values with mean ~0 over many samples", () => {
    const sampleCount = 10000;
    let sum = 0;
    for (let i = 0; i < sampleCount; i++) {
      sum += generateGaussianNoise();
    }
    const mean = sum / sampleCount;
    // Mean should be very close to 0 (within 0.05 for 10k samples)
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });

  it("should produce values with stddev ~1 over many samples", () => {
    const sampleCount = 10000;
    const values: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      values.push(generateGaussianNoise());
    }
    const mean = values.reduce((a, b) => a + b, 0) / sampleCount;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sampleCount;
    const standardDeviation = Math.sqrt(variance);
    // standardDeviation should be close to 1 (within 0.05 for 10k samples)
    expect(Math.abs(standardDeviation - 1)).toBeLessThan(0.05);
  });

  it("should produce values roughly in range [-4, 4] for moderate sample sizes", () => {
    // With 1000 samples from N(0,1), values outside [-4,4] are extremely rare
    const iterationCount = 1000;
    for (let i = 0; i < iterationCount; i++) {
      const value = generateGaussianNoise();
      const absoluteValue = Math.abs(value);
      expect(absoluteValue).toBeLessThan(5); // Very safe bound
    }
  });
});
