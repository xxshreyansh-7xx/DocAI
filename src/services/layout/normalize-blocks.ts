import { randomUUID } from "node:crypto";
import type { BoundingBox, OCRLine, OCRPageResult } from "../../types/ocr";
import type { NormalizedBlock } from "../../types/layout";
import { markLowConfidence } from "./confidence";
import { detectFormTemplate } from "./form-template";
import { formLikeScore, reconstructTable, tableLikeScore } from "./table-reconstruction";

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function detectColumnCutX(lines: OCRLine[], pageWidth: number | undefined): number | undefined {
  if (!pageWidth || lines.length < 8) {
    return undefined;
  }

  const xStarts = lines.map((line) => line.bbox?.x).filter((x): x is number => Number.isFinite(x));
  if (xStarts.length < 8) {
    return undefined;
  }
  const sorted = xStarts.sort((a, b) => a - b);

  let largestGap = 0;
  let splitIndex = -1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > largestGap) {
      largestGap = gap;
      splitIndex = i;
    }
  }

  if (largestGap < pageWidth * 0.18 || splitIndex < 0) {
    return undefined;
  }

  const leftCount = splitIndex;
  const rightCount = sorted.length - splitIndex;
  if (leftCount < 3 || rightCount < 3) {
    return undefined;
  }

  return sorted[splitIndex - 1] + largestGap / 2;
}

function assignColumn(line: OCRLine, cutX: number | undefined): number {
  if (!line.bbox || cutX === undefined) {
    return 0;
  }
  const center = line.bbox.x + line.bbox.width / 2;
  return center < cutX ? 0 : 1;
}

function unionBoundingBoxes(lines: OCRLine[]): BoundingBox | undefined {
  const boxes = lines.map((line) => line.bbox).filter((bbox): bbox is BoundingBox => Boolean(bbox));
  if (boxes.length === 0) {
    return undefined;
  }
  const minX = Math.min(...boxes.map((bbox) => bbox.x));
  const minY = Math.min(...boxes.map((bbox) => bbox.y));
  const maxX = Math.max(...boxes.map((bbox) => bbox.x + bbox.width));
  const maxY = Math.max(...boxes.map((bbox) => bbox.y + bbox.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function inferStyle(text: string, lines: OCRLine[], baselineHeight: number): NormalizedBlock["style"] {
  const lineHeights = lines.map((line) => line.bbox?.height).filter((height): height is number => Boolean(height));
  const avgHeight =
    lineHeights.reduce((acc, height) => acc + height, 0) / Math.max(lineHeights.length, 1);
  const uppercaseShort = /^[A-Z0-9\s\-:]{3,}$/.test(text.trim()) && text.trim().length < 90;
  const isHeading = uppercaseShort || avgHeight > baselineHeight * 1.25;

  if (text.trim().startsWith("- ") || text.trim().startsWith("•")) {
    return {
      fontSize: Math.max(10, avgHeight * 0.45),
      lineHeight: Math.max(13, avgHeight * 0.7),
      fontWeight: "normal",
      listLevel: 1,
    };
  }

  return {
    fontSize: isHeading ? Math.max(13, avgHeight * 0.52) : Math.max(10, avgHeight * 0.42),
    lineHeight: isHeading ? Math.max(16, avgHeight * 0.76) : Math.max(13, avgHeight * 0.62),
    fontWeight: isHeading ? "bold" : "normal",
    listLevel: 0,
  };
}

function inferBlockType(
  lines: OCRLine[],
  text: string,
  allowTableDetection: boolean,
): "heading" | "paragraph" | "table" {
  if (!allowTableDetection) {
    const trimmed = text.trim();
    if (/^[A-Z0-9\s\-:]{4,}$/.test(trimmed) && trimmed.length < 100) {
      return "heading";
    }
    return "paragraph";
  }
  if (tableLikeScore(lines) >= 0.7 && reconstructTable(lines)) {
    return "table";
  }
  const trimmed = text.trim();
  if (/^[A-Z0-9\s\-:]{4,}$/.test(trimmed) && trimmed.length < 100) {
    return "heading";
  }
  return "paragraph";
}

function shouldStartNewBlock(prev: OCRLine | undefined, current: OCRLine, baselineHeight: number): boolean {
  if (!prev) {
    return true;
  }
  if (!prev.bbox || !current.bbox) {
    return /[.:]$/.test(prev.text);
  }

  const yGap = current.bbox.y - (prev.bbox.y + prev.bbox.height);
  const xShift = Math.abs(current.bbox.x - prev.bbox.x);
  if (yGap > baselineHeight * 1.35) {
    return true;
  }
  if (xShift > Math.max(18, baselineHeight * 1.1)) {
    return true;
  }
  if (current.text.trim().length < 4) {
    return true;
  }
  return false;
}

function lineOverlapRatio(line: OCRLine, container: BoundingBox): number {
  if (!line.bbox) {
    return 0;
  }
  const x1 = Math.max(line.bbox.x, container.x);
  const y1 = Math.max(line.bbox.y, container.y);
  const x2 = Math.min(line.bbox.x + line.bbox.width, container.x + container.width);
  const y2 = Math.min(line.bbox.y + line.bbox.height, container.y + container.height);
  const overlapWidth = Math.max(0, x2 - x1);
  const overlapHeight = Math.max(0, y2 - y1);
  const overlap = overlapWidth * overlapHeight;
  const lineArea = Math.max(1, line.bbox.width * line.bbox.height);
  return overlap / lineArea;
}

function unionCellBoundingBoxes(lines: NonNullable<NormalizedBlock["table"]>["cells"]): BoundingBox | undefined {
  const boxes = lines.map((cell) => cell.bbox);
  if (boxes.length === 0) {
    return undefined;
  }
  const minX = Math.min(...boxes.map((bbox) => bbox.x));
  const minY = Math.min(...boxes.map((bbox) => bbox.y));
  const maxX = Math.max(...boxes.map((bbox) => bbox.x + bbox.width));
  const maxY = Math.max(...boxes.map((bbox) => bbox.y + bbox.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

interface TableDecision {
  kind: "none" | "template" | "generic";
  confidence: number;
  reason: string;
}

function decideTableForPage(params: {
  templateDetected: boolean;
  formScore: number;
  table?: NonNullable<NormalizedBlock["table"]>;
}): TableDecision {
  const { templateDetected, formScore, table } = params;
  if (!table || !table.isCanonical || table.cells.length < 6) {
    return { kind: "none", confidence: 0, reason: "no-canonical-table" };
  }
  if (templateDetected && table.rows >= 6 && table.cols === 2) {
    return {
      kind: "template",
      confidence: Math.max(formScore, table.gridConfidence),
      reason: "template-detected-with-canonical-grid",
    };
  }
  if (table.gridConfidence >= 0.24 && table.rows >= 2 && table.cols >= 2) {
    return {
      kind: "generic",
      confidence: table.gridConfidence,
      reason: "generic-canonical-grid",
    };
  }
  return { kind: "none", confidence: table.gridConfidence, reason: "table-below-quality-gate" };
}

function groupLinesGeometrically(
  lines: Array<{ line: OCRLine; columnIndex: number }>,
  baselineHeight: number,
): Array<{ lines: OCRLine[]; columnIndex: number }> {
  const grouped: Array<{ lines: OCRLine[]; columnIndex: number }> = [];
  let current: { lines: OCRLine[]; columnIndex: number } | null = null;

  for (const entry of lines) {
    const prevLine = current?.lines[current.lines.length - 1];
    const startsNew =
      !current ||
      current.columnIndex !== entry.columnIndex ||
      shouldStartNewBlock(prevLine, entry.line, baselineHeight);
    if (startsNew) {
      if (current) {
        grouped.push(current);
      }
      current = { lines: [entry.line], columnIndex: entry.columnIndex };
    } else if (current) {
      current.lines.push(entry.line);
    }
  }

  if (current?.lines.length) {
    grouped.push(current);
  }

  return grouped;
}

export function normalizeLayout(
  pages: OCRPageResult[],
  threshold: number,
): NormalizedBlock[] {
  const blocks: NormalizedBlock[] = [];
  let readingOrder = 0;

  for (const page of pages) {
    const pageBlocks: Array<Omit<NormalizedBlock, "readingOrder">> = [];
    const lineHeights = page.lines
      .map((line) => line.bbox?.height)
      .filter((height): height is number => Number.isFinite(height));
    const baselineHeight = median(lineHeights) || 22;
    const pageHeight = page.height ?? 0;
    const bodyStartY = pageHeight > 0 ? pageHeight * 0.08 : 0;
    const bodyEndY = pageHeight > 0 ? pageHeight * 0.9 : Number.MAX_SAFE_INTEGER;
    const bodyLines = page.lines.filter((line) => {
      if (!line.bbox) {
        return false;
      }
      const centerY = line.bbox.y + line.bbox.height / 2;
      return centerY >= bodyStartY && centerY <= bodyEndY;
    });

    const candidateLines = bodyLines.length > 0 ? bodyLines : page.lines;
    const template = detectFormTemplate(candidateLines);
    const formScore = formLikeScore(candidateLines, page.width);
    const reconstructedTable = reconstructTable(candidateLines, {
      pageWidth: page.width,
      pageHeight: page.height,
      forceFormGrid: true,
      formScoreHint: formScore,
      template,
    });
    const tableDecision = decideTableForPage({
      templateDetected: Boolean(template),
      formScore,
      table: reconstructedTable,
    });
    const pageTable = tableDecision.kind === "none" ? undefined : reconstructedTable;
    const tableBBox = pageTable ? unionCellBoundingBoxes(pageTable.cells) ?? pageTable.tableBBox : undefined;

    const tableLines = tableBBox
      ? page.lines.filter((line) => lineOverlapRatio(line, tableBBox) >= 0.2)
      : [];
    const nonTableLines = tableBBox
      ? page.lines.filter((line) => lineOverlapRatio(line, tableBBox) < 0.2)
      : page.lines;

    const cutX = detectColumnCutX(page.lines, page.width);
    const regularLines = nonTableLines
      .map((line) => ({ line, columnIndex: assignColumn(line, cutX) }))
      .sort((a, b) => {
        if (a.columnIndex !== b.columnIndex) {
          return a.columnIndex - b.columnIndex;
        }
        const ay = a.line.bbox?.y ?? Number.MAX_SAFE_INTEGER;
        const by = b.line.bbox?.y ?? Number.MAX_SAFE_INTEGER;
        if (ay !== by) {
          return ay - by;
        }
        const ax = a.line.bbox?.x ?? Number.MAX_SAFE_INTEGER;
        const bx = b.line.bbox?.x ?? Number.MAX_SAFE_INTEGER;
        return ax - bx;
      });

    const grouped = groupLinesGeometrically(regularLines, baselineHeight);

    for (const chunk of grouped) {
      const text = chunk.lines.map((line) => line.text.trim()).filter(Boolean).join("\n");
      const confidence = chunk.lines.reduce((acc, line) => acc + line.confidence, 0) / Math.max(chunk.lines.length, 1);
      const blockType = inferBlockType(chunk.lines, text, !pageTable);
      const table = blockType === "table" ? reconstructTable(chunk.lines) : undefined;
      const lowConfidenceLineCount = chunk.lines.filter((line) => line.confidence < threshold).length;
      const style = inferStyle(text, chunk.lines, baselineHeight);

      pageBlocks.push({
        id: randomUUID(),
        pageNumber: page.pageNumber,
        columnIndex: chunk.columnIndex,
        blockType,
        text,
        bbox: unionBoundingBoxes(chunk.lines),
        lines: chunk.lines,
        style,
        table,
        confidence: Number(confidence.toFixed(4)),
        lowConfidenceLineCount,
        lowConfidence: markLowConfidence(confidence, threshold),
      });
    }

    if (pageTable && tableDecision.kind !== "none") {
      const effectiveTableLines =
        tableLines.length > 0
          ? tableLines
          : page.lines.filter((line) => (tableBBox ? lineOverlapRatio(line, tableBBox) >= 0.1 : false));
      const tableText = pageTable.cells
        .filter((cell) => cell.text.trim().length > 0)
        .map((cell) => cell.text.trim())
        .join("\n");
      const tableConfidence =
        pageTable.cells.reduce((acc, cell) => acc + cell.confidence, 0) /
        Math.max(pageTable.cells.length, 1);
      const tableLowConfidenceLines = effectiveTableLines.filter((line) => line.confidence < threshold).length;
      const tableStyle = inferStyle(tableText, effectiveTableLines, baselineHeight);

      pageBlocks.push({
        id: randomUUID(),
        pageNumber: page.pageNumber,
        columnIndex: 0,
        blockType: "table",
        text: tableText,
        bbox: tableBBox,
        lines: effectiveTableLines,
        style: tableStyle,
        table: pageTable,
        confidence: Number(tableConfidence.toFixed(4)),
        lowConfidenceLineCount: tableLowConfidenceLines,
        lowConfidence: markLowConfidence(tableConfidence, threshold),
      });
    }

    const orderedPageBlocks = pageBlocks.sort((a, b) => {
      const ay = a.bbox?.y ?? Number.MAX_SAFE_INTEGER;
      const by = b.bbox?.y ?? Number.MAX_SAFE_INTEGER;
      if (ay !== by) {
        return ay - by;
      }
      return a.columnIndex - b.columnIndex;
    });
    for (const block of orderedPageBlocks) {
      readingOrder += 1;
      blocks.push({
        ...block,
        readingOrder,
      });
    }
  }

  return blocks;
}
