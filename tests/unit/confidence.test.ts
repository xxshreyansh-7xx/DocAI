import { describe, expect, it } from "vitest";
import { computeConfidenceSummary, markLowConfidence } from "../../src/services/layout/confidence";

describe("confidence logic", () => {
  it("marks low confidence correctly", () => {
    expect(markLowConfidence(0.7, 0.8)).toBe(true);
    expect(markLowConfidence(0.81, 0.8)).toBe(false);
  });

  it("computes summary", () => {
    const summary = computeConfidenceSummary(
      [
        { confidence: 0.9, lowConfidenceLineCount: 0 },
        { confidence: 0.7, lowConfidenceLineCount: 2 },
      ] as never,
      0.8,
    );

    expect(summary.totalBlocks).toBe(2);
    expect(summary.lowConfidenceBlocks).toBe(1);
    expect(summary.lowConfidenceLines).toBe(2);
    expect(summary.overallConfidence).toBe(0.8);
  });
});
