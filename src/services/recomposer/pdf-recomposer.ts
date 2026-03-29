import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import type { OCRPageResult } from "../../types/ocr";
import type { NormalizedBlock } from "../../types/layout";

export interface SourceImage {
  pageNumber: number;
  base64Data?: string;
  mimeType?: string;
}

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: { top: 50, right: 45, bottom: 50, left: 45 },
};

const CONTENT_WIDTH = PAGE.width - PAGE.margin.left - PAGE.margin.right;

const TYPO = {
  title: { size: 13, leading: 18 },
  body: { size: 9.5, leading: 14 },
  label: { size: 8.5, leading: 12 },
  value: { size: 9.5, leading: 14 },
};

const TABLE_CFG = {
  labelRatio: 0.34,
  pad: { top: 7, right: 8, bottom: 5, left: 8 },
  border: 0.6,
  borderColor: rgb(0.3, 0.3, 0.3),
  minRowHeight: 28,
};

/**
 * Standard 14 fonts use WinAnsi; pdf-lib throws on unencodable Unicode (e.g. Greek, CJK, emoji).
 * OCR from real photos often returns such characters.
 */
function sanitizeForStandardFont(text: string): string {
  const smart: Record<string, string> = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2026": "...",
    "\u00a0": " ",
  };
  let s = text;
  for (const [from, to] of Object.entries(smart)) {
    s = s.split(from).join(to);
  }
  s = s.normalize("NFKD").replace(/\p{M}/gu, "");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    if (code === 9 || code === 10 || code === 13) {
      out += " ";
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      out += ch;
      continue;
    }
    out += "?";
  }
  return out;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitizeForStandardFont(text);
  if (!safe.trim()) {
    return [];
  }
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function drawWrappedText(
  page: import("pdf-lib").PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  leading: number,
  x: number,
  yTop: number,
  maxWidth: number,
  color = rgb(0.1, 0.1, 0.1),
): number {
  const lines = wrapText(text, font, size, maxWidth);
  let y = yTop;
  for (const line of lines) {
    page.drawText(line, { x, y, font, size, color });
    y -= leading;
  }
  return y;
}

function textBlockHeight(text: string, font: PDFFont, size: number, leading: number, maxWidth: number): number {
  const count = wrapText(text, font, size, maxWidth).length;
  return Math.max(count, 1) * leading;
}

export interface RenderCommand {
  pageNumber: number;
  kind: "text";
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export function buildRenderPlan(
  pages: OCRPageResult[],
  _blocks: NormalizedBlock[],
): RenderCommand[] {
  const commands: RenderCommand[] = [];

  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.bbox || !line.text.trim()) {
        continue;
      }
      commands.push({
        pageNumber: page.pageNumber,
        kind: "text",
        text: line.text,
        x: Number((line.bbox.x * 0.6).toFixed(2)),
        y: Number((PAGE.height - line.bbox.y * 0.6).toFixed(2)),
        fontSize: 9,
      });
    }
  }

  return commands;
}

export async function rebuildPdf(params: {
  pages: OCRPageResult[];
  blocks: NormalizedBlock[];
  sourceImages?: SourceImage[];
}): Promise<Uint8Array> {
  const { blocks } = params;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const sortedBlocks = [...blocks].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder,
  );

  if (sortedBlocks.length === 0) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    page.drawText("No layout blocks to render.", {
      x: PAGE.margin.left,
      y: PAGE.height - PAGE.margin.top,
      font: regular,
      size: TYPO.body.size,
      color: rgb(0.2, 0.2, 0.2),
    });
    return pdf.save();
  }

  const byPage = new Map<number, NormalizedBlock[]>();
  for (const block of sortedBlocks) {
    const list = byPage.get(block.pageNumber) ?? [];
    list.push(block);
    byPage.set(block.pageNumber, list);
  }

  for (const [, pageBlocks] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    let cursor = PAGE.height - PAGE.margin.top;

    for (const block of pageBlocks) {
      if (cursor < PAGE.margin.bottom + 40) {
        break;
      }

      if (block.blockType === "heading") {
        const text = sanitizeForStandardFont(block.text.trim());
        if (!text) {
          continue;
        }
        const w = bold.widthOfTextAtSize(text, TYPO.title.size);
        const x = PAGE.margin.left + Math.max(0, (CONTENT_WIDTH - w) / 2);
        cursor -= TYPO.title.leading;
        page.drawText(text, {
          x,
          y: cursor,
          font: bold,
          size: TYPO.title.size,
          color: rgb(0.1, 0.1, 0.1),
        });
        cursor -= TYPO.title.leading * 0.6;
        continue;
      }

      if (block.blockType === "paragraph") {
        const text = sanitizeForStandardFont(block.text.replace(/\n/g, " ").trim());
        if (!text) {
          continue;
        }
        cursor -= 2;
        cursor = drawWrappedText(
          page, text, regular, TYPO.body.size, TYPO.body.leading,
          PAGE.margin.left, cursor, CONTENT_WIDTH,
        );
        cursor -= TYPO.body.leading * 0.4;
        continue;
      }

      if (block.blockType === "table" && block.table) {
        const table = block.table;
        const labelWidth = CONTENT_WIDTH * TABLE_CFG.labelRatio;
        const valueWidth = CONTENT_WIDTH * (1 - TABLE_CFG.labelRatio);
        const labelInner = labelWidth - TABLE_CFG.pad.left - TABLE_CFG.pad.right;
        const valueInner = valueWidth - TABLE_CFG.pad.left - TABLE_CFG.pad.right;

        // Pre-compute row heights based on content.
        const rowHeights: number[] = [];
        for (let r = 0; r < table.rows; r += 1) {
          const labelCell = table.cells.find((c) => c.row === r && c.col === 0);
          const valueCell = table.cells.find((c) => c.row === r && c.col === 1);
          const lh = labelCell
            ? textBlockHeight(labelCell.text, bold, TYPO.label.size, TYPO.label.leading, labelInner)
            : 0;
          const vh = valueCell
            ? textBlockHeight(valueCell.text, regular, TYPO.value.size, TYPO.value.leading, valueInner)
            : 0;
          rowHeights.push(
            Math.max(TABLE_CFG.minRowHeight, lh + TABLE_CFG.pad.top + TABLE_CFG.pad.bottom, vh + TABLE_CFG.pad.top + TABLE_CFG.pad.bottom),
          );
        }

        const totalTableHeight = rowHeights.reduce((s, h) => s + h, 0);
        cursor -= 6;
        const tableTop = cursor;
        const tableLeft = PAGE.margin.left;
        const tableRight = PAGE.margin.left + CONTENT_WIDTH;

        // Draw cell text.
        let rowY = tableTop;
        for (let r = 0; r < table.rows; r += 1) {
          const rh = rowHeights[r];
          const labelCell = table.cells.find((c) => c.row === r && c.col === 0);
          const valueCell = table.cells.find((c) => c.row === r && c.col === 1);

          if (labelCell?.text.trim() && sanitizeForStandardFont(labelCell.text).trim()) {
            drawWrappedText(
              page, labelCell.text, bold, TYPO.label.size, TYPO.label.leading,
              tableLeft + TABLE_CFG.pad.left,
              rowY - TABLE_CFG.pad.top - TYPO.label.size,
              labelInner,
              rgb(0.15, 0.15, 0.15),
            );
          }

          if (valueCell?.text.trim() && sanitizeForStandardFont(valueCell.text).trim()) {
            drawWrappedText(
              page, valueCell.text, regular, TYPO.value.size, TYPO.value.leading,
              tableLeft + labelWidth + TABLE_CFG.pad.left,
              rowY - TABLE_CFG.pad.top - TYPO.value.size,
              valueInner,
              rgb(0.08, 0.08, 0.08),
            );
          }

          rowY -= rh;
        }

        // Draw grid lines.
        const tableBottom = tableTop - totalTableHeight;

        // Horizontal lines.
        let lineY = tableTop;
        for (let r = 0; r <= table.rows; r += 1) {
          page.drawLine({
            start: { x: tableLeft, y: lineY },
            end: { x: tableRight, y: lineY },
            thickness: TABLE_CFG.border,
            color: TABLE_CFG.borderColor,
          });
          if (r < table.rows) {
            lineY -= rowHeights[r];
          }
        }

        // Vertical lines: left, split, right.
        const splitX = tableLeft + labelWidth;
        for (const x of [tableLeft, splitX, tableRight]) {
          page.drawLine({
            start: { x, y: tableTop },
            end: { x, y: tableBottom },
            thickness: TABLE_CFG.border,
            color: TABLE_CFG.borderColor,
          });
        }

        cursor = tableBottom - 8;
        continue;
      }
    }
  }

  return pdf.save();
}
