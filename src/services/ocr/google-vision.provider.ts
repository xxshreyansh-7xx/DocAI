import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { protos } from "@google-cloud/vision";
import type { OcrProvider } from "./ocr-provider";
import type { OCRInputPage, OCRLine, OCRPageResult } from "../../types/ocr";
import { AppError } from "../../utils/app-error";

function toBBox(
  vertices: protos.google.cloud.vision.v1.IVertex[] | null | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!vertices || vertices.length === 0) {
    return undefined;
  }
  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function mapVisionResponseToLines(
  pages: protos.google.cloud.vision.v1.IPage[] | undefined,
): OCRLine[] {
  if (!pages || pages.length === 0) {
    return [];
  }

  const lines: OCRLine[] = [];

  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        const words = (paragraph.words ?? []).map((word) => {
          const text = (word.symbols ?? []).map((s) => s.text ?? "").join("");
          return {
            text,
            confidence: word.confidence ?? paragraph.confidence ?? 0,
            bbox: toBBox(word.boundingBox?.vertices),
          };
        });

        lines.push({
          text: words.map((w) => w.text).join(" ").trim(),
          confidence: paragraph.confidence ?? 0,
          words,
          bbox: toBBox(paragraph.boundingBox?.vertices),
        });
      }
    }
  }

  return lines.filter((line) => line.text.length > 0);
}

export class GoogleVisionOcrProvider implements OcrProvider {
  private readonly client: ImageAnnotatorClient;

  constructor(client?: ImageAnnotatorClient) {
    this.client = client ?? new ImageAnnotatorClient();
  }

  async extractPage(page: OCRInputPage): Promise<OCRPageResult> {
    try {
      const image = page.base64Data
        ? { content: page.base64Data }
        : page.storagePath
          ? { source: { imageUri: page.storagePath } }
          : null;

      if (!image) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "OCR page requires storagePath or base64Data",
          statusCode: 400,
        });
      }

      const [result] = await this.client.documentTextDetection({ image });
      const lines = mapVisionResponseToLines(result.fullTextAnnotation?.pages ?? undefined);

      return {
        pageNumber: page.pageNumber,
        width: result.fullTextAnnotation?.pages?.[0]?.width ?? undefined,
        height: result.fullTextAnnotation?.pages?.[0]?.height ?? undefined,
        lines,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown OCR error";
      throw new AppError({
        code: "OCR_TRANSIENT_FAILURE",
        message: `Google Vision OCR failed: ${message}`,
        statusCode: 502,
        retryable: true,
      });
    }
  }
}
