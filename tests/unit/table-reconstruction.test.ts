import { describe, expect, it } from "vitest";
import fixture from "../fixtures/sample-ocr-table-page.json";
import alumniFixture from "../fixtures/sample-ocr-alumni-form-page.json";
import noisyFormFixture from "../fixtures/sample-ocr-noisy-form-page.json";
import sparseFormFixture from "../fixtures/sample-ocr-sparse-form-page.json";
import denseInvoiceFixture from "../fixtures/sample-ocr-dense-invoice-page.json";
import { normalizeLayout } from "../../src/services/layout/normalize-blocks";

describe("table reconstruction", () => {
  it("detects and reconstructs table cells from word boxes", () => {
    const blocks = normalizeLayout([fixture], 0.85);
    const tableBlock = blocks.find((block) => block.blockType === "table");

    expect(tableBlock).toBeTruthy();
    expect(tableBlock?.table).toBeTruthy();
    expect(tableBlock?.table?.rows).toBeGreaterThanOrEqual(3);
    expect(tableBlock?.table?.cols).toBeGreaterThanOrEqual(3);
    expect(tableBlock?.table?.rowBoundaries.length).toBe(tableBlock?.table?.rows ? tableBlock.table.rows + 1 : 0);
    expect(tableBlock?.table?.colBoundaries.length).toBe(tableBlock?.table?.cols ? tableBlock.table.cols + 1 : 0);
    expect(tableBlock?.table?.gridConfidence).toBeGreaterThan(0.2);
    expect(tableBlock?.table?.cells.length).toBeGreaterThanOrEqual(6);
    expect(tableBlock?.table?.cellMatrix.length).toBeGreaterThanOrEqual(3);
    expect(tableBlock?.table?.isCanonical).toBe(true);
    expect(tableBlock?.table?.geometryVersion).toBe("v1");
  });

  it("uses deterministic alumni template mapping when available", () => {
    const blocks = normalizeLayout([alumniFixture], 0.85);
    const tableBlock = blocks.find((block) => block.blockType === "table");

    expect(tableBlock?.table).toBeTruthy();
    expect(tableBlock?.table?.rows).toBe(8);
    expect(tableBlock?.table?.cols).toBe(2);

    const emailValue = tableBlock?.table?.cells.find((cell) => cell.row === 3 && cell.col === 1);
    const mobileValue = tableBlock?.table?.cells.find((cell) => cell.row === 4 && cell.col === 1);

    expect(emailValue?.text).toContain("john@example.com");
    expect(mobileValue?.text).toContain("9876543210");
    expect(tableBlock?.table?.diagnostics?.unassignedValueLines).toBeLessThanOrEqual(1);
  });

  it("keeps row and column bbox containment for dense invoice tables", () => {
    const blocks = normalizeLayout([denseInvoiceFixture], 0.85);
    const tableBlock = blocks.find((block) => block.blockType === "table");
    const table = tableBlock?.table;

    expect(table).toBeTruthy();
    expect(table?.rows).toBeGreaterThanOrEqual(4);
    expect(table?.cols).toBeGreaterThanOrEqual(4);

    for (const cell of table?.cells ?? []) {
      expect(cell.bbox.x).toBeGreaterThanOrEqual((table?.tableBBox.x ?? 0) - 1);
      expect(cell.bbox.y).toBeGreaterThanOrEqual((table?.tableBBox.y ?? 0) - 1);
      expect(cell.bbox.x + cell.bbox.width).toBeLessThanOrEqual(
        (table?.tableBBox.x ?? 0) + (table?.tableBBox.width ?? 0) + 1,
      );
      expect(cell.bbox.y + cell.bbox.height).toBeLessThanOrEqual(
        (table?.tableBBox.y ?? 0) + (table?.tableBBox.height ?? 0) + 1,
      );
    }
  });

  it("remains canonical on noisy form scans", () => {
    const blocks = normalizeLayout([noisyFormFixture], 0.85);
    const table = blocks.find((block) => block.blockType === "table")?.table;

    expect(table).toBeTruthy();
    expect(table?.isCanonical).toBe(true);
    expect(table?.rows).toBeGreaterThanOrEqual(6);
    expect(table?.cols).toBe(2);
  });

  it("handles sparse forms without row duplication", () => {
    const blocks = normalizeLayout([sparseFormFixture], 0.85);
    const table = blocks.find((block) => block.blockType === "table")?.table;

    expect(table).toBeTruthy();
    expect(table?.rows).toBe(8);
    expect(table?.cols).toBe(2);
    const nonEmptyValues = (table?.cells ?? []).filter(
      (cell) => cell.col === 1 && cell.text.trim().length > 0,
    ).length;
    expect(nonEmptyValues).toBeGreaterThanOrEqual(4);
  });
});
