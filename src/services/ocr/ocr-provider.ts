import type { OCRInputPage, OCRPageResult } from "../../types/ocr";

export interface OcrProvider {
  extractPage(page: OCRInputPage): Promise<OCRPageResult>;
}
