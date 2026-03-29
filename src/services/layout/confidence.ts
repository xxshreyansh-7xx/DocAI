import type { ConfidenceSummary, NormalizedBlock } from "../../types/layout";

export function computeConfidenceSummary(
  blocks: NormalizedBlock[],
  threshold: number,
): ConfidenceSummary {
  const totalBlocks = blocks.length;
  if (totalBlocks === 0) {
    return {
      threshold,
      overallConfidence: 0,
      lowConfidenceBlocks: 0,
      lowConfidenceLines: 0,
      totalBlocks: 0,
    };
  }

  const sum = blocks.reduce((acc, block) => acc + block.confidence, 0);
  const lowConfidenceBlocks = blocks.filter((block) => block.confidence < threshold).length;
  const lowConfidenceLines = blocks.reduce((acc, block) => acc + block.lowConfidenceLineCount, 0);

  return {
    threshold,
    overallConfidence: Number((sum / totalBlocks).toFixed(4)),
    lowConfidenceBlocks,
    lowConfidenceLines,
    totalBlocks,
  };
}

export function markLowConfidence(blockConfidence: number, threshold: number): boolean {
  return blockConfidence < threshold;
}
