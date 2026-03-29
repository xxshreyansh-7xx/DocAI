export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox?: BoundingBox;
}

export interface OCRLine {
  text: string;
  confidence: number;
  words: OCRWord[];
  bbox?: BoundingBox;
}

export interface OCRPageResult {
  pageNumber: number;
  width?: number;
  height?: number;
  lines: OCRLine[];
}

export interface OCRInputPage {
  pageNumber: number;
  storagePath?: string;
  base64Data?: string;
  mimeType?: string;
}
