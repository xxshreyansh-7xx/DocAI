import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { OCRPageResult } from "../src/types/ocr";
import alumniFixture from "../tests/fixtures/sample-ocr-alumni-form-page.json";
import noisyFormFixture from "../tests/fixtures/sample-ocr-noisy-form-page.json";
import sparseFormFixture from "../tests/fixtures/sample-ocr-sparse-form-page.json";
import denseInvoiceFixture from "../tests/fixtures/sample-ocr-dense-invoice-page.json";
import { normalizeLayout } from "../src/services/layout/normalize-blocks";
import { rebuildPdf } from "../src/services/recomposer/pdf-recomposer";

interface FixtureEntry {
  name: string;
  page: OCRPageResult;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildOverlaySvg(page: OCRPageResult, blocks: ReturnType<typeof normalizeLayout>): string {
  const width = page.width ?? 1000;
  const height = page.height ?? 1400;
  const tableBlock = blocks.find((block) => block.pageNumber === page.pageNumber && block.blockType === "table");
  const cells = tableBlock?.table?.cells ?? [];

  const rects = cells
    .map((cell) => {
      const stroke = cell.cellRole === "label" ? "#0f766e" : cell.cellRole === "header" ? "#1d4ed8" : "#b45309";
      const fontSize = 9;
      return [
        `<rect x="${cell.bbox.x.toFixed(2)}" y="${cell.bbox.y.toFixed(2)}" width="${cell.bbox.width.toFixed(2)}" height="${cell.bbox.height.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="1"/>`,
        `<text x="${(cell.bbox.x + 2).toFixed(2)}" y="${(cell.bbox.y + fontSize + 1).toFixed(2)}" font-size="${fontSize}" fill="#111827">${escapeXml(`${cell.row},${cell.col} ${cell.text.slice(0, 42)}`)}</text>`,
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    rects,
    "</svg>",
  ].join("");
}

async function main(): Promise<void> {
  const outDir = join(tmpdir(), `docai-visual-smoke-${randomUUID().slice(0, 8)}`);
  await mkdir(outDir, { recursive: true });

  const fixtures: FixtureEntry[] = [
    { name: "alumni", page: alumniFixture as OCRPageResult },
    { name: "noisy-form", page: noisyFormFixture as OCRPageResult },
    { name: "sparse-form", page: sparseFormFixture as OCRPageResult },
    { name: "dense-invoice", page: denseInvoiceFixture as OCRPageResult },
  ];

  for (const fixture of fixtures) {
    const pages = [fixture.page];
    const blocks = normalizeLayout(pages, 0.85);
    const pdf = await rebuildPdf({ pages, blocks });
    const overlaySvg = buildOverlaySvg(fixture.page, blocks);

    await writeFile(join(outDir, `${fixture.name}.rebuilt.pdf`), Buffer.from(pdf));
    await writeFile(join(outDir, `${fixture.name}.overlay.svg`), overlaySvg, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(`Visual smoke artifacts: ${outDir}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
