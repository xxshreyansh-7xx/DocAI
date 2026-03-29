import type { NormalizedBlock } from "../../types/layout";
import type { OCRPageResult } from "../../types/ocr";

export interface QualityMetrics {
  textCoverage: number;
  bboxCoverage: number;
  readingOrderScore: number;
  tableDetectionRate: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function computeQualityMetrics(params: {
  ocrPages: OCRPageResult[];
  blocks: NormalizedBlock[];
}): QualityMetrics {
  const { ocrPages, blocks } = params;

  const sourceText = normalizeWhitespace(
    ocrPages.flatMap((page) => page.lines.map((line) => line.text)).join(" "),
  );
  const rebuiltText = normalizeWhitespace(blocks.map((block) => block.text).join(" "));
  const textCoverage =
    sourceText.length === 0 ? 1 : Number(Math.min(1, rebuiltText.length / sourceText.length).toFixed(4));

  const sourceLineCount = ocrPages.reduce((acc, page) => acc + page.lines.length, 0);
  const linesWithBBox = ocrPages.reduce(
    (acc, page) => acc + page.lines.filter((line) => Boolean(line.bbox)).length,
    0,
  );
  const bboxCoverage = sourceLineCount === 0 ? 1 : Number((linesWithBBox / sourceLineCount).toFixed(4));

  const ordered = [...blocks].sort((a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder);
  let orderViolations = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (curr.pageNumber < prev.pageNumber) {
      orderViolations += 1;
      continue;
    }
    if (curr.pageNumber === prev.pageNumber && curr.readingOrder < prev.readingOrder) {
      orderViolations += 1;
    }
  }
  const readingOrderScore =
    ordered.length <= 1
      ? 1
      : Number((1 - orderViolations / (ordered.length - 1)).toFixed(4));

  const tableCandidates = blocks.filter(
    (block) => block.lines.length >= 2 && block.lines.some((line) => line.words.length >= 3),
  ).length;
  const detectedTables = blocks.filter((block) => block.blockType === "table" && block.table).length;
  const tableDetectionRate =
    tableCandidates === 0 ? 1 : Number((detectedTables / tableCandidates).toFixed(4));

  return {
    textCoverage,
    bboxCoverage,
    readingOrderScore,
    tableDetectionRate,
  };
}
