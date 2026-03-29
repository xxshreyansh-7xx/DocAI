import type { OCRLine } from "../../types/ocr";

export type FormRowKey =
  | "name"
  | "year"
  | "address"
  | "email"
  | "mobile"
  | "working_place"
  | "area_of_interest"
  | "present_status";

export type ValueType = "name" | "year" | "address" | "email" | "phone" | "text";

export interface FormTemplateRow {
  key: FormRowKey;
  label: string;
  aliases: string[];
  valueType: ValueType;
  multiline: boolean;
  maxLines: number;
}

export interface FormTemplate {
  id: string;
  titleHints: string[];
  rows: FormTemplateRow[];
}

export const ALUMNI_REGISTRATION_TEMPLATE: FormTemplate = {
  id: "alumni-registration-v1",
  titleHints: ["ALUMINI REGISTRATION FORM", "ALUMNI REGISTRATION FORM"],
  rows: [
    {
      key: "name",
      label: "NAME OF STUDENT",
      aliases: ["NAME OF STUDENT", "STUDENT NAME"],
      valueType: "name",
      multiline: false,
      maxLines: 1,
    },
    {
      key: "year",
      label: "YEAR OF LEAVING SCHOOL / COLLEGE",
      aliases: ["YEAR OF LEAVING SCHOOL / COLLEGE", "YEAR OF LEAVING SCHOOL", "LEAVING SCHOOL / COLLEGE"],
      valueType: "year",
      multiline: false,
      maxLines: 1,
    },
    {
      key: "address",
      label: "ADDRESS ( FOR CORRESPONDENCE )",
      aliases: ["ADDRESS", "CORRESPONDENCE"],
      valueType: "address",
      multiline: true,
      maxLines: 2,
    },
    {
      key: "email",
      label: "EMAIL ID",
      aliases: ["EMAIL ID", "E MAIL ID"],
      valueType: "email",
      multiline: false,
      maxLines: 1,
    },
    {
      key: "mobile",
      label: "MOBILE NUMBER",
      aliases: ["MOBILE NUMBER", "MOBILE NO", "MOBILE NUM"],
      valueType: "phone",
      multiline: false,
      maxLines: 1,
    },
    {
      key: "working_place",
      label: "PRESENT WORKING PLACE",
      aliases: ["PRESENT WORKING PLACE", "WORKING PLACE PRESENT"],
      valueType: "text",
      multiline: true,
      maxLines: 2,
    },
    {
      key: "area_of_interest",
      label: "AREA OF INTEREST",
      aliases: ["AREA OF INTEREST"],
      valueType: "text",
      multiline: true,
      maxLines: 1,
    },
    {
      key: "present_status",
      label: "PRESENT STATUS",
      aliases: ["PRESENT STATUS"],
      valueType: "text",
      multiline: false,
      maxLines: 1,
    },
  ],
};

export function normalizeText(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectFormTemplate(lines: OCRLine[]): FormTemplate | undefined {
  const normalizedLines = lines.map((line) => normalizeText(line.text));
  const hasTitleHint = ALUMNI_REGISTRATION_TEMPLATE.titleHints.some((hint) =>
    normalizedLines.some((line) => line.includes(normalizeText(hint))),
  );

  let aliasHits = 0;
  for (const row of ALUMNI_REGISTRATION_TEMPLATE.rows) {
    const hit = row.aliases.some((alias) =>
      normalizedLines.some((line) => line.includes(normalizeText(alias))),
    );
    if (hit) {
      aliasHits += 1;
    }
  }

  if (hasTitleHint && aliasHits >= 3) {
    return ALUMNI_REGISTRATION_TEMPLATE;
  }

  // Fallback for noisy OCR titles: enough field-label hits can still identify the template.
  return aliasHits >= 6 ? ALUMNI_REGISTRATION_TEMPLATE : undefined;
}

export function matchLabelToTemplateRow(
  text: string,
  template: FormTemplate,
): FormTemplateRow | undefined {
  const normalized = normalizeText(text);
  if (normalized.length < 6) {
    return undefined;
  }

  const normalizedTokens = normalized.split(" ").filter(Boolean);
  let best: { row: FormTemplateRow; score: number } | undefined;

  for (const row of template.rows) {
    for (const alias of row.aliases) {
      const normAlias = normalizeText(alias);
      let score = 0;
      if (normalized === normAlias) {
        score = 100;
      } else if (normAlias.length >= 10 && normalized.includes(normAlias) && normalized.length <= normAlias.length + 18) {
        score = 88;
      } else if (
        normAlias.length >= 12 &&
        normAlias.includes(normalized) &&
        normalized.length >= 8
      ) {
        score = 82;
      } else {
        const aliasTokens = normAlias.split(" ").filter(Boolean);
        if (aliasTokens.length >= 2) {
          const overlapCount = aliasTokens.filter((token) => normalizedTokens.includes(token)).length;
          const overlapRatio = overlapCount / aliasTokens.length;
          if (overlapRatio >= 0.75) {
            score = 80;
          }
        }
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { row, score };
      }
    }
  }

  return best?.score && best.score >= 80 ? best.row : undefined;
}

export function isFooterNoise(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes("AFTER FILL THE FORM") ||
    normalized.includes("WHATSAPP") ||
    (normalized.includes("EMAIL ID") && normalized.includes("SEND THIS FORM"))
  );
}

export function scoreValueByType(valueType: ValueType, text: string): number {
  const normalized = text.trim();
  const upper = normalizeText(normalized);
  if (!normalized) {
    return -100;
  }

  if (valueType === "year") {
    return /(?:^|\D)(19|20)\d{2}(?:\D|$)/.test(normalized) ? 20 : -8;
  }
  if (valueType === "email") {
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized) ? 24 : -10;
  }
  if (valueType === "phone") {
    const digits = normalized.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? 22 : -10;
  }
  if (valueType === "name") {
    return !/\d/.test(normalized) && normalized.split(/\s+/).length >= 2 ? 16 : -8;
  }
  if (valueType === "address") {
    return upper.length > 10 && /[,.-]/.test(normalized) ? 14 : 2;
  }
  return Math.min(10, upper.length / 8);
}

export function formLikeScore(lines: OCRLine[], pageWidth?: number): number {
  if (lines.length === 0) {
    return 0;
  }
  const width =
    pageWidth ??
    Math.max(
      ...lines.map((line) => {
        if (!line.bbox) {
          return 0;
        }
        return line.bbox.x + line.bbox.width;
      }),
      1,
    );

  const leftRatio =
    lines.filter((line) => {
      if (!line.bbox) {
        return false;
      }
      return line.bbox.x + line.bbox.width / 2 < width * 0.45;
    }).length /
    Math.max(lines.length, 1);
  const hasTitle = detectFormTemplate(lines) ? 1 : 0;
  const labelHits = lines.filter((line) => matchLabelToTemplateRow(line.text, ALUMNI_REGISTRATION_TEMPLATE)).length;
  const labelRatio = labelHits / Math.max(ALUMNI_REGISTRATION_TEMPLATE.rows.length, 1);

  return Number((hasTitle * 0.45 + leftRatio * 0.2 + Math.min(1, labelRatio) * 0.35).toFixed(4));
}
