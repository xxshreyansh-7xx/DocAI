import type { BoundingBox, OCRLine, OCRWord } from "../../types/ocr";
import type { TableCell, TableStructure } from "../../types/layout";
import {
  type FormTemplate,
  detectFormTemplate,
  formLikeScore as templateFormLikeScore,
  isFooterNoise,
  matchLabelToTemplateRow,
  scoreValueByType,
} from "./form-template";

interface LineBand {
  minY: number;
  maxY: number;
  lines: OCRLine[];
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unionBoxes(boxes: BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) {
    return undefined;
  }
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function clusterValues(values: number[], tolerance: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = clusters[clusters.length - 1];
    if (Math.abs(sorted[i] - last) > tolerance) {
      clusters.push(sorted[i]);
    } else {
      clusters[clusters.length - 1] = (last + sorted[i]) / 2;
    }
  }
  return clusters;
}

function buildRowBands(lines: OCRLine[], tolerance: number): LineBand[] {
  const sorted = lines
    .filter((line) => Boolean(line.bbox))
    .sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));
  const bands: LineBand[] = [];

  for (const line of sorted) {
    if (!line.bbox) {
      continue;
    }
    const band = bands[bands.length - 1];
    if (!band || line.bbox.y > band.maxY + tolerance) {
      bands.push({
        minY: line.bbox.y,
        maxY: line.bbox.y + line.bbox.height,
        lines: [line],
      });
      continue;
    }
    band.minY = Math.min(band.minY, line.bbox.y);
    band.maxY = Math.max(band.maxY, line.bbox.y + line.bbox.height);
    band.lines.push(line);
  }

  return bands;
}

function mergeClosestBands(bands: LineBand[]): LineBand[] {
  if (bands.length <= 1) {
    return bands;
  }
  let bestIdx = 0;
  let bestGap = Number.POSITIVE_INFINITY;

  for (let i = 0; i < bands.length - 1; i += 1) {
    const gap = bands[i + 1].minY - bands[i].maxY;
    if (gap < bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  const merged: LineBand[] = [];
  for (let i = 0; i < bands.length; i += 1) {
    if (i === bestIdx) {
      const left = bands[i];
      const right = bands[i + 1];
      merged.push({
        minY: Math.min(left.minY, right.minY),
        maxY: Math.max(left.maxY, right.maxY),
        lines: [...left.lines, ...right.lines],
      });
      i += 1;
      continue;
    }
    merged.push(bands[i]);
  }

  return merged;
}

function splitLargestBand(bands: LineBand[], minSplitHeight: number): LineBand[] {
  if (bands.length === 0) {
    return bands;
  }
  let bestIdx = -1;
  let bestHeight = -1;

  for (let i = 0; i < bands.length; i += 1) {
    const height = bands[i].maxY - bands[i].minY;
    if (height > bestHeight && height >= minSplitHeight) {
      bestHeight = height;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) {
    return bands;
  }

  const band = bands[bestIdx];
  const midY = (band.minY + band.maxY) / 2;
  const topLines = band.lines.filter((line) => (line.bbox ? line.bbox.y + line.bbox.height / 2 <= midY : false));
  const bottomLines = band.lines.filter((line) => (line.bbox ? line.bbox.y + line.bbox.height / 2 > midY : false));

  if (topLines.length === 0 || bottomLines.length === 0) {
    return bands;
  }

  const topBand: LineBand = {
    minY: Math.min(...topLines.map((line) => line.bbox?.y ?? midY)),
    maxY: Math.max(...topLines.map((line) => (line.bbox?.y ?? midY) + (line.bbox?.height ?? 0))),
    lines: topLines,
  };
  const bottomBand: LineBand = {
    minY: Math.min(...bottomLines.map((line) => line.bbox?.y ?? midY)),
    maxY: Math.max(...bottomLines.map((line) => (line.bbox?.y ?? midY) + (line.bbox?.height ?? 0))),
    lines: bottomLines,
  };

  const result: LineBand[] = [];
  for (let i = 0; i < bands.length; i += 1) {
    if (i === bestIdx) {
      result.push(topBand, bottomBand);
      continue;
    }
    result.push(bands[i]);
  }

  return result.sort((a, b) => a.minY - b.minY);
}

function normalizeBandCount(
  inputBands: LineBand[],
  targetRows: number,
  minSplitHeight: number,
): LineBand[] {
  let bands = [...inputBands].sort((a, b) => a.minY - b.minY);
  if (targetRows <= 0) {
    return bands;
  }

  while (bands.length > targetRows) {
    bands = mergeClosestBands(bands);
  }

  while (bands.length < targetRows) {
    const next = splitLargestBand(bands, minSplitHeight);
    if (next.length === bands.length) {
      break;
    }
    bands = next;
  }

  return bands;
}

function deriveBoundariesFromBands(
  bands: LineBand[],
  minEdge: number,
  maxEdge: number,
  padTop: number,
  padBottom: number,
): number[] {
  if (bands.length === 0) {
    return [minEdge, maxEdge];
  }

  const boundaries: number[] = [clamp(bands[0].minY - padTop, minEdge, maxEdge)];
  for (let i = 0; i < bands.length - 1; i += 1) {
    const midpoint = (bands[i].maxY + bands[i + 1].minY) / 2;
    boundaries.push(clamp(midpoint, minEdge, maxEdge));
  }
  boundaries.push(clamp(bands[bands.length - 1].maxY + padBottom, minEdge, maxEdge));

  for (let i = 1; i < boundaries.length; i += 1) {
    if (boundaries[i] <= boundaries[i - 1]) {
      boundaries[i] = boundaries[i - 1] + 1;
    }
  }

  return boundaries;
}

function deriveBoundaries(centers: number[], minEdge: number, maxEdge: number): number[] {
  if (centers.length === 0) {
    return [minEdge, maxEdge];
  }
  const sortedCenters = [...centers].sort((a, b) => a - b);
  const boundaries: number[] = [minEdge];
  for (let i = 0; i < sortedCenters.length - 1; i += 1) {
    boundaries.push((sortedCenters[i] + sortedCenters[i + 1]) / 2);
  }
  boundaries.push(maxEdge);
  return boundaries;
}

function getCellBBox(
  rowBoundaries: number[],
  colBoundaries: number[],
  row: number,
  col: number,
): BoundingBox {
  return {
    x: colBoundaries[col],
    y: rowBoundaries[row],
    width: Math.max(1, colBoundaries[col + 1] - colBoundaries[col]),
    height: Math.max(1, rowBoundaries[row + 1] - rowBoundaries[row]),
  };
}

function intersectionArea(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  return width * height;
}

function area(box: BoundingBox): number {
  return Math.max(1, box.width * box.height);
}

function buildEmptyCellMatrix(rows: number, cols: number): Array<Array<TableCell | null>> {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function cellOverflow(content: BoundingBox | undefined, cellBox: BoundingBox): {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
} {
  if (!content) {
    return { left: false, right: false, top: false, bottom: false };
  }
  return {
    left: content.x < cellBox.x,
    right: content.x + content.width > cellBox.x + cellBox.width,
    top: content.y < cellBox.y,
    bottom: content.y + content.height > cellBox.y + cellBox.height,
  };
}

function lineCenterX(line: OCRLine): number {
  return line.bbox ? line.bbox.x + line.bbox.width / 2 : 0;
}

function lineCenterY(line: OCRLine): number {
  return line.bbox ? line.bbox.y + line.bbox.height / 2 : 0;
}

function locateBandIndex(value: number, boundaries: number[]): number {
  const rows = Math.max(1, boundaries.length - 1);
  for (let i = 0; i < rows; i += 1) {
    if (value >= boundaries[i] && value <= boundaries[i + 1]) {
      return i;
    }
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows; i += 1) {
    const center = (boundaries[i] + boundaries[i + 1]) / 2;
    const distance = Math.abs(value - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function interpolateCentersFromAnchors(
  anchorMap: Map<number, number>,
  totalRows: number,
  minCenter: number,
  maxCenter: number,
): number[] {
  const centers = new Array<number>(totalRows).fill(0);
  const anchors = Array.from(anchorMap.entries()).sort((a, b) => a[0] - b[0]);
  if (anchors.length === 0) {
    const gap = (maxCenter - minCenter) / Math.max(totalRows, 1);
    for (let i = 0; i < totalRows; i += 1) {
      centers[i] = minCenter + gap * (i + 0.5);
    }
    return centers;
  }

  for (const [idx, center] of anchors) {
    centers[idx] = center;
  }

  if (anchors.length === 1) {
    const [idx, center] = anchors[0];
    const step = (maxCenter - minCenter) / Math.max(totalRows, 1);
    for (let i = idx - 1; i >= 0; i -= 1) {
      centers[i] = center - step * (idx - i);
    }
    for (let i = idx + 1; i < totalRows; i += 1) {
      centers[i] = center + step * (i - idx);
    }
    return centers.map((c) => clamp(c, minCenter, maxCenter));
  }

  for (let a = 0; a < anchors.length - 1; a += 1) {
    const [i1, y1] = anchors[a];
    const [i2, y2] = anchors[a + 1];
    const span = Math.max(1, i2 - i1);
    const step = (y2 - y1) / span;
    for (let i = i1 + 1; i < i2; i += 1) {
      centers[i] = y1 + step * (i - i1);
    }
  }

  const [firstIdx, firstCenter] = anchors[0];
  const [secondIdx, secondCenter] = anchors[1];
  const headStep = (secondCenter - firstCenter) / Math.max(1, secondIdx - firstIdx);
  for (let i = firstIdx - 1; i >= 0; i -= 1) {
    centers[i] = centers[i + 1] - headStep;
  }

  const [lastIdx, lastCenter] = anchors[anchors.length - 1];
  const [prevIdx, prevCenter] = anchors[anchors.length - 2];
  const tailStep = (lastCenter - prevCenter) / Math.max(1, lastIdx - prevIdx);
  for (let i = lastIdx + 1; i < totalRows; i += 1) {
    centers[i] = centers[i - 1] + tailStep;
  }

  return centers.map((c) => clamp(c, minCenter, maxCenter));
}

function detectTableFromLineBBoxes(lines: OCRLine[]): {
  rowBands: LineBand[];
  tableBBox?: BoundingBox;
  medianHeight: number;
} {
  const lineBoxes = lines.map((line) => line.bbox).filter((box): box is BoundingBox => Boolean(box));
  if (lineBoxes.length < 2) {
    return { rowBands: [], tableBBox: undefined, medianHeight: 0 };
  }
  const rowHeights = lineBoxes.map((box) => box.height);
  const medianHeight = median(rowHeights);
  const rowTolerance = Math.max(6, medianHeight * 0.55);
  const rowBands = buildRowBands(lines, rowTolerance);
  const tableBBox = unionBoxes(lineBoxes);
  return { rowBands, tableBBox, medianHeight };
}

function buildTemplateTable(
  lines: OCRLine[],
  template: FormTemplate,
  options: ReconstructTableOptions,
): TableStructure | undefined {
  const withBoxes = lines.filter((line) => Boolean(line.bbox) && !isFooterNoise(line.text));
  if (withBoxes.length < 4) {
    return undefined;
  }

  const tableBBox = unionBoxes(
    withBoxes.map((line) => line.bbox).filter((bbox): bbox is BoundingBox => Boolean(bbox)),
  );
  if (!tableBBox) {
    return undefined;
  }

  const medianHeight = median(withBoxes.map((line) => line.bbox?.height ?? 16)) || 16;

  const allLabelMatches = withBoxes
    .map((line) => ({ line, row: matchLabelToTemplateRow(line.text, template) }))
    .filter((item): item is { line: OCRLine; row: FormTemplate["rows"][number] } => Boolean(item.row))
    .sort((a, b) => lineCenterY(a.line) - lineCenterY(b.line));

  if (allLabelMatches.length < 3) {
    return undefined;
  }

  const rows = template.rows.length;

  // Monotonic first-match anchoring: walk template rows in order, take the
  // first Y-sorted match for each key whose Y exceeds the previous anchor.
  // This inherently rejects duplicate matches in footers / noise regions.
  const anchorByRowIndex = new Map<number, number>();
  const anchorLabelLines = new Map<number, OCRLine>();
  const usedLines = new Set<OCRLine>();
  let lastAnchorY = -Infinity;
  let duplicateLabelRowsMerged = 0;

  for (let i = 0; i < template.rows.length; i += 1) {
    const rowKey = template.rows[i].key;
    const candidates = allLabelMatches.filter(
      (item) => item.row.key === rowKey && !usedLines.has(item.line),
    );
    const match = candidates.find((item) => lineCenterY(item.line) > lastAnchorY);
    if (match) {
      const cy = lineCenterY(match.line);
      anchorByRowIndex.set(i, cy);
      anchorLabelLines.set(i, match.line);
      lastAnchorY = cy;
      usedLines.add(match.line);
      duplicateLabelRowsMerged += candidates.length - 1;
    }
  }

  if (anchorByRowIndex.size < 3) {
    return undefined;
  }

  const anchoredIndices = Array.from(anchorByRowIndex.keys()).sort((a, b) => a - b);
  const firstAnchorLine = anchorLabelLines.get(anchoredIndices[0])!;
  const lastAnchorLine = anchorLabelLines.get(anchoredIndices[anchoredIndices.length - 1])!;

  const topY = Math.max(0, (firstAnchorLine.bbox?.y ?? tableBBox.y) - medianHeight * 0.5);
  const bottomY = Math.min(
    options.pageHeight ?? tableBBox.y + tableBBox.height,
    (lastAnchorLine.bbox?.y ?? 0) + (lastAnchorLine.bbox?.height ?? medianHeight) + medianHeight * 2.5,
  );

  const tableLines = withBoxes.filter((line) => {
    const y = lineCenterY(line);
    return y >= topY && y <= bottomY;
  });

  // Derive column split from label right edges vs value left edges.
  const anchorLines = Array.from(anchorLabelLines.values());
  const labelRight = median(
    anchorLines
      .map((line) => (line.bbox ? line.bbox.x + line.bbox.width : tableBBox.x + tableBBox.width * 0.3))
      .filter((value) => Number.isFinite(value)),
  );
  const possibleValueLeft = median(
    tableLines
      .filter((line) => lineCenterX(line) > labelRight + 4)
      .map((line) => line.bbox?.x ?? 0),
  );

  let splitX = Number.isFinite(possibleValueLeft) && possibleValueLeft > 0
    ? (labelRight + possibleValueLeft) / 2
    : labelRight + 12;
  splitX = clamp(splitX, tableBBox.x + tableBBox.width * 0.18, tableBBox.x + tableBBox.width * 0.78);

  // Derive row boundaries directly from label anchor positions.
  // Centers come from anchors; unmatched rows are interpolated.
  const rowCenters = interpolateCentersFromAnchors(
    anchorByRowIndex,
    rows,
    topY + medianHeight * 0.5,
    bottomY - medianHeight * 0.5,
  );
  const rowBoundaries = deriveBoundaries(rowCenters, topY, bottomY);

  if (rowBoundaries.length !== rows + 1) {
    return undefined;
  }

  const colBoundaries = [tableBBox.x, splitX, tableBBox.x + tableBBox.width];
  const cols = 2;
  const cellMatrix = buildEmptyCellMatrix(rows, cols);
  const cells: TableCell[] = [];

  // Pure geometric value assignment: each value goes to the row band it sits in.
  const assignments = new Map<number, OCRLine[]>();
  let unassignedValueLines = 0;

  const valueCandidates = tableLines.filter((line) => {
    if (lineCenterX(line) <= splitX + 3) {
      return false;
    }
    if (matchLabelToTemplateRow(line.text, template)) {
      return false;
    }
    const y = lineCenterY(line);
    return y >= rowBoundaries[0] - medianHeight * 0.5 && y <= rowBoundaries[rowBoundaries.length - 1] + medianHeight * 0.5;
  });

  for (const line of valueCandidates) {
    const centerY = lineCenterY(line);
    const rowIndex = locateBandIndex(centerY, rowBoundaries);
    if (rowIndex < 0 || rowIndex >= rows) {
      unassignedValueLines += 1;
      continue;
    }
    const existing = assignments.get(rowIndex) ?? [];
    existing.push(line);
    assignments.set(rowIndex, existing);
  }

  for (let row = 0; row < rows; row += 1) {
    const rowCfg = template.rows[row];
    const labelCellBox = getCellBBox(rowBoundaries, colBoundaries, row, 0);
    const labelCell: TableCell = {
      row,
      col: 0,
      text: rowCfg.label,
      bbox: labelCellBox,
      cellRole: "label",
      textAlign: "left",
      verticalAlign: "top",
      padding: { top: 4, right: 3, bottom: 2, left: 3 },
      confidence: 1,
      overflow: { left: false, right: false, top: false, bottom: false },
      overlapRatio: 1,
    };
    cells.push(labelCell);
    cellMatrix[row][0] = labelCell;

    const values = (assignments.get(row) ?? []).sort((a, b) => lineCenterY(a) - lineCenterY(b));
    if (values.length === 0) {
      continue;
    }

    const kept = rowCfg.multiline ? values.slice(0, rowCfg.maxLines) : values.slice(0, 1);
    const text = kept.map((line) => line.text.trim()).filter(Boolean).join(" ");
    const merged = unionBoxes(kept.map((line) => line.bbox).filter((bbox): bbox is BoundingBox => Boolean(bbox)));
    const valueCellBox = getCellBBox(rowBoundaries, colBoundaries, row, 1);
    const confidence = kept.reduce((acc, line) => acc + line.confidence, 0) / Math.max(kept.length, 1);

    const valueCell: TableCell = {
      row,
      col: 1,
      text,
      bbox: valueCellBox,
      cellRole: "value",
      textAlign: "left",
      verticalAlign: "top",
      padding: { top: 4, right: 4, bottom: 2, left: 4 },
      confidence: Number(confidence.toFixed(4)),
      overflow: cellOverflow(merged, valueCellBox),
      overlapRatio: merged ? intersectionArea(merged, valueCellBox) / area(merged) : 0,
    };
    cells.push(valueCell);
    cellMatrix[row][1] = valueCell;
  }

  const filledValueRows = cells.filter((cell) => cell.col === 1 && cell.text.trim().length > 0).length;
  const density = filledValueRows / Math.max(rows, 1);
  const gridConfidence = Number((Math.max(0.45, density) * 0.85 + 0.15).toFixed(4));

  return {
    rows,
    cols,
    rowBoundaries,
    colBoundaries,
    tableBBox: {
      x: tableBBox.x,
      y: topY,
      width: tableBBox.width,
      height: Math.max(1, bottomY - topY),
    },
    geometryVersion: "v1",
    isCanonical: true,
    gridConfidence,
    cellMatrix,
    cells: cells.sort((a, b) => a.row - b.row || a.col - b.col),
    diagnostics: {
      formLikeScore: options.formScoreHint,
      excludedTopLines: withBoxes.filter((line) => (line.bbox?.y ?? 0) < topY).length,
      excludedBottomLines: withBoxes.filter((line) => (line.bbox?.y ?? 0) > bottomY).length,
      unassignedValueLines,
      duplicateLabelRowsMerged,
    },
  };
}

function buildTableFromWordAssignments(params: {
  linesWithBbox: OCRLine[];
  candidateWords: OCRWord[];
  tableBBox: BoundingBox;
  rowBands: LineBand[];
  medianHeight: number;
}): TableStructure | undefined {
  const { linesWithBbox, candidateWords, tableBBox, rowBands, medianHeight } = params;
  if (rowBands.length < 2) {
    return undefined;
  }

  const rowBoundaries = deriveBoundariesFromBands(
    rowBands,
    tableBBox.y,
    tableBBox.y + tableBBox.height,
    Math.max(1, medianHeight * 0.15),
    Math.max(1, medianHeight * 0.15),
  );
  const rows = Math.max(1, rowBoundaries.length - 1);

  const avgWordWidth =
    candidateWords.reduce((acc, word) => acc + (word.bbox?.width ?? 0), 0) /
    Math.max(candidateWords.length, 1);
  const colTolerance = Math.max(18, avgWordWidth * 1.25);
  const colCenters = clusterValues(
    candidateWords.map((word) => (word.bbox?.x ?? 0) + (word.bbox?.width ?? 0) / 2),
    colTolerance,
  ).slice(0, 8);
  if (colCenters.length < 2) {
    return undefined;
  }

  const colBoundaries = deriveBoundaries(colCenters, tableBBox.x, tableBBox.x + tableBBox.width);
  const cols = Math.max(1, colBoundaries.length - 1);
  const cellMatrix = buildEmptyCellMatrix(rows, cols);
  const cells: TableCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cellBox = getCellBBox(rowBoundaries, colBoundaries, row, col);
      const words = candidateWords.filter((word) => {
        if (!word.bbox) {
          return false;
        }
        const overlap = intersectionArea(word.bbox, cellBox);
        return overlap / area(word.bbox) >= 0.12;
      });
      if (words.length === 0) {
        continue;
      }

      const text = words
        .sort((a, b) => {
          const ay = a.bbox?.y ?? 0;
          const by = b.bbox?.y ?? 0;
          if (Math.abs(ay - by) > 2) {
            return ay - by;
          }
          return (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0);
        })
        .map((word) => word.text)
        .join(" ")
        .trim();
      const confidence = words.reduce((acc, word) => acc + word.confidence, 0) / Math.max(words.length, 1);
      const merged = unionBoxes(words.map((word) => word.bbox).filter((bbox): bbox is BoundingBox => Boolean(bbox)));

      const cell: TableCell = {
        row,
        col,
        text,
        bbox: cellBox,
        cellRole: row === 0 ? "header" : "data",
        textAlign: "left",
        verticalAlign: "middle",
        padding: { top: 2, right: 3, bottom: 2, left: 3 },
        confidence: Number(confidence.toFixed(4)),
        overflow: cellOverflow(merged, cellBox),
        overlapRatio: merged ? intersectionArea(merged, cellBox) / area(merged) : 0,
      };
      cells.push(cell);
      cellMatrix[row][col] = cell;
    }
  }

  const density = cells.filter((cell) => cell.text.length > 0).length / Math.max(rows * cols, 1);
  if (density < 0.14) {
    return undefined;
  }

  return {
    rows,
    cols,
    rowBoundaries,
    colBoundaries,
    tableBBox,
    geometryVersion: "v1",
    isCanonical: true,
    gridConfidence: Number((density * 0.75 + 0.2).toFixed(4)),
    cellMatrix,
    cells: cells.sort((a, b) => a.row - b.row || a.col - b.col),
    diagnostics: {
      excludedTopLines: 0,
      excludedBottomLines: 0,
      unassignedValueLines: 0,
      duplicateLabelRowsMerged: 0,
    },
  };
}

export interface ReconstructTableOptions {
  pageWidth?: number;
  pageHeight?: number;
  forceFormGrid?: boolean;
  formScoreHint?: number;
  template?: FormTemplate;
}

export function reconstructTable(
  lines: OCRLine[],
  options: ReconstructTableOptions = {},
): TableStructure | undefined {
  const linesWithBbox = lines.filter((line) => Boolean(line.bbox) && !isFooterNoise(line.text));
  if (linesWithBbox.length < 2) {
    return undefined;
  }

  const template = options.template ?? detectFormTemplate(linesWithBbox);
  if (template && options.forceFormGrid) {
    const templated = buildTemplateTable(linesWithBbox, template, options);
    if (templated) {
      return templated;
    }
  }

  const detected = detectTableFromLineBBoxes(linesWithBbox);
  if (!detected.tableBBox) {
    return undefined;
  }

  const candidateWords = linesWithBbox.flatMap((line) => line.words.filter((word) => Boolean(word.bbox)));
  if (candidateWords.length < 3) {
    return undefined;
  }

  return buildTableFromWordAssignments({
    linesWithBbox,
    candidateWords,
    tableBBox: detected.tableBBox,
    rowBands: detected.rowBands,
    medianHeight: detected.medianHeight,
  });
}

export function formLikeScore(lines: OCRLine[], pageWidth?: number): number {
  return templateFormLikeScore(lines, pageWidth);
}

export function tableLikeScore(lines: OCRLine[]): number {
  if (lines.length < 2) {
    return 0;
  }
  const wordCounts = lines.map((line) => line.words.length);
  const wordMedian = median(wordCounts);
  const lineWithBBoxes = lines.filter((line) => line.words.some((word) => Boolean(word.bbox)));
  const bboxRatio = lineWithBBoxes.length / lines.length;
  return Number(((wordMedian >= 3 ? 0.55 : 0.2) + bboxRatio * 0.45).toFixed(4));
}
