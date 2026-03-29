import { describe, expect, it } from "vitest";
import fixture from "../fixtures/sample-ocr-page-1.json";
import alumniFixture from "../fixtures/sample-ocr-alumni-form-page.json";
import { normalizeLayout } from "../../src/services/layout/normalize-blocks";
import { buildRenderPlan } from "../../src/services/recomposer/pdf-recomposer";

describe("recomposer render plan", () => {
  it("creates geometry-based render commands from OCR lines", () => {
    const blocks = normalizeLayout([fixture], 0.85);
    const plan = buildRenderPlan([fixture], blocks);

    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].kind).toBe("text");
    expect(plan[0].x).toBeGreaterThan(0);
    expect(plan[0].y).toBeGreaterThan(0);
    expect(plan[0].fontSize).toBeGreaterThan(0);
    expect(plan.every((cmd) => cmd.pageNumber === 1)).toBe(true);
  });

  it("produces one text command per OCR line with a bbox", () => {
    const blocks = normalizeLayout([alumniFixture], 0.85);
    const plan = buildRenderPlan([alumniFixture], blocks);

    const linesWithBbox = alumniFixture.lines.filter(
      (line) => line.bbox && line.text.trim().length > 0,
    );
    expect(plan.length).toBe(linesWithBbox.length);
    for (const cmd of plan) {
      expect(cmd.kind).toBe("text");
      expect(cmd.text.length).toBeGreaterThan(0);
    }
  });
});
