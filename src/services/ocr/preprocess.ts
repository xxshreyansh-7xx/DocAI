import type { OCRInputPage } from "../../types/ocr";

export interface PreprocessedPage extends OCRInputPage {
  prepNotes: string[];
}

export async function preprocessPage(page: OCRInputPage): Promise<PreprocessedPage> {
  const prepNotes: string[] = ["orientation-check", "contrast-normalization", "denoise-light"];
  return { ...page, prepNotes };
}
