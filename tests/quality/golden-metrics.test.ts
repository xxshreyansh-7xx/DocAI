import { describe, expect, it } from "vitest";
import fixtureDoc from "../fixtures/sample-ocr-page-1.json";
import fixtureTable from "../fixtures/sample-ocr-table-page.json";
import { normalizeLayout } from "../../src/services/layout/normalize-blocks";
import { computeQualityMetrics } from "../../src/services/quality/metrics";

describe("quality harness metrics", () => {
  it("meets baseline text/geometry thresholds on golden fixtures", () => {
    const pages = [fixtureDoc, fixtureTable];
    const blocks = normalizeLayout(pages, 0.85);
    const metrics = computeQualityMetrics({ ocrPages: pages, blocks });

    expect(metrics.textCoverage).toBeGreaterThanOrEqual(0.95);
    expect(metrics.bboxCoverage).toBeGreaterThanOrEqual(0.9);
    expect(metrics.readingOrderScore).toBeGreaterThanOrEqual(0.95);
    expect(metrics.tableDetectionRate).toBeGreaterThanOrEqual(0.4);
  });
});
