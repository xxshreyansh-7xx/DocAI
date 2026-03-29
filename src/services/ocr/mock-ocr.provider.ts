import type { OcrProvider } from "./ocr-provider";
import type { OCRInputPage, OCRPageResult } from "../../types/ocr";
import { AppError } from "../../utils/app-error";

export class MockOcrProvider implements OcrProvider {
  constructor(private readonly fixtures: Record<number, OCRPageResult>) {}

  async extractPage(page: OCRInputPage): Promise<OCRPageResult> {
    const fixture = this.fixtures[page.pageNumber];
    if (!fixture) {
      throw new AppError({
        code: "OCR_TRANSIENT_FAILURE",
        message: `No mock fixture for page ${page.pageNumber}`,
        statusCode: 502,
        retryable: true,
      });
    }
    return fixture;
  }
}
