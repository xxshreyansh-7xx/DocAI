import { describe, expect, it } from "vitest";
import { mapVisionResponseToLines } from "../../src/services/ocr/google-vision.provider";

describe("mapVisionResponseToLines", () => {
  it("maps paragraph words and confidence", () => {
    const lines = mapVisionResponseToLines([
      {
        blocks: [
          {
            paragraphs: [
              {
                confidence: 0.91,
                words: [
                  {
                    confidence: 0.9,
                    symbols: [{ text: "H" }, { text: "i" }],
                    boundingBox: { vertices: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 45 }, { x: 10, y: 45 }] },
                  },
                  {
                    confidence: 0.9,
                    symbols: [{ text: "!" }],
                    boundingBox: { vertices: [{ x: 35, y: 20 }, { x: 45, y: 20 }, { x: 45, y: 45 }, { x: 35, y: 45 }] },
                  },
                ],
                boundingBox: {
                  vertices: [
                    { x: 10, y: 20 },
                    { x: 60, y: 20 },
                    { x: 60, y: 45 },
                    { x: 10, y: 45 },
                  ],
                },
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Hi !");
    expect(lines[0].confidence).toBe(0.91);
    expect(lines[0].bbox).toEqual({ x: 10, y: 20, width: 50, height: 25 });
    expect(lines[0].words[0].bbox).toEqual({ x: 10, y: 20, width: 20, height: 25 });
  });
});
