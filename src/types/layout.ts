import type { BoundingBox, OCRLine } from "./ocr";

export type BlockType = "heading" | "paragraph" | "table";

export interface InferredStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: "normal" | "bold";
  listLevel: number;
}

export interface TableCell {
  row: number;
  col: number;
  text: string;
  bbox: BoundingBox;
  cellRole: "label" | "value" | "data" | "header";
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "baseline";
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  confidence: number;
  overflow: {
    left: boolean;
    right: boolean;
    top: boolean;
    bottom: boolean;
  };
  overlapRatio?: number;
}

export interface TableStructure {
  rows: number;
  cols: number;
  rowBoundaries: number[];
  colBoundaries: number[];
  tableBBox: BoundingBox;
  geometryVersion: "v1";
  isCanonical: boolean;
  gridConfidence: number;
  cellMatrix: Array<Array<TableCell | null>>;
  cells: TableCell[];
  diagnostics?: {
    formLikeScore?: number;
    excludedTopLines: number;
    excludedBottomLines: number;
    unassignedValueLines: number;
    duplicateLabelRowsMerged: number;
  };
}

export interface NormalizedBlock {
  id: string;
  pageNumber: number;
  blockType: BlockType;
  text: string;
  lines: OCRLine[];
  bbox?: BoundingBox;
  columnIndex: number;
  readingOrder: number;
  style: InferredStyle;
  lowConfidenceLineCount: number;
  table?: TableStructure;
  confidence: number;
  lowConfidence: boolean;
}

export interface ConfidenceSummary {
  threshold: number;
  overallConfidence: number;
  lowConfidenceBlocks: number;
  lowConfidenceLines: number;
  totalBlocks: number;
}
