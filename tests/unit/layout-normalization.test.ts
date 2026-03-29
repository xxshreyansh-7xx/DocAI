import { describe, expect, it } from "vitest";
import fixture from "../fixtures/sample-ocr-page-1.json";
import { normalizeLayout } from "../../src/services/layout/normalize-blocks";

describe("normalizeLayout", () => {
  it("normalizes OCR lines into blocks", () => {
    const blocks = normalizeLayout([fixture], 0.85);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.some((b) => b.blockType === "heading")).toBe(true);
    expect(blocks.some((b) => b.lowConfidenceLineCount > 0)).toBe(true);
  });
});
