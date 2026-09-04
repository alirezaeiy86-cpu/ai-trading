import { z } from 'zod';
import type { AIAnalysisResult } from '@trading/types';
import type { AIOutputSchema, RawAIResponse } from './types';

// =============================================================================
// OUTPUT PARSER
// Validates LLM output against the required schema.
// Never trusts raw LLM text — always validates with Zod.
// =============================================================================

const aiOutputSchema = z.object({
  decision:     z.enum(['BUY', 'SELL', 'HOLD', 'NO_TRADE']),
  confidence:   z.number().min(0).max(1),
  marketRegime: z.string().min(1),
  entry:        z.number().positive(),
  stopLoss:     z.number().positive(),
  takeProfit:   z.number().positive(),
  reasons:      z.array(z.string()).min(1).max(10),
});

export interface ParseResult {
  success:  boolean;
  data?:    AIOutputSchema;
  error?:   string;
}

/**
 * Extract and validate JSON from LLM response text.
 * Handles: clean JSON, JSON inside markdown code blocks, JSON with surrounding text.
 */
export function parseAIOutput(raw: string): ParseResult {
  if (!raw || raw.trim().length === 0) {
    return { success: false, error: 'Empty response from AI provider' };
  }

  // Try to extract JSON from various formats
  const candidates = extractJsonCandidates(raw);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const result = aiOutputSchema.safeParse(parsed);

      if (result.success) {
        return { success: true, data: result.data };
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    success: false,
    error:   `Could not parse valid AI output from: ${raw.slice(0, 200)}`,
  };
}

/**
 * Convert a parsed AIOutputSchema + metadata into the shared AIAnalysisResult type.
 */
export function toAnalysisResult(
  output:    AIOutputSchema,
  raw:       RawAIResponse,
  provider:  string,
  model:     string,
): AIAnalysisResult {
  return {
    decision:     output.decision,
    confidence:   output.confidence,
    marketRegime: output.marketRegime as AIAnalysisResult['marketRegime'],
    entry:        output.entry,
    stopLoss:     output.stopLoss,
    takeProfit:   output.takeProfit,
    reasons:      output.reasons,
    modelUsed:    `${provider}/${model}`,
    latencyMs:    raw.latencyMs,
    timestamp:    new Date(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  // 1. Direct parse of trimmed text
  candidates.push(text.trim());

  // 2. Strip markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    candidates.push(codeBlockMatch[1].trim());
  }

  // 3. Find first { ... } block in the text
  const braceStart = text.indexOf('{');
  const braceEnd   = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(text.slice(braceStart, braceEnd + 1));
  }

  // 4. Remove leading/trailing non-JSON text
  const lines = text.split('\n')
    .filter((l) => l.trim().startsWith('{') || l.trim().startsWith('"') || l.trim().startsWith('}'));
  if (lines.length > 0) {
    candidates.push(lines.join('\n'));
  }

  return [...new Set(candidates)]; // deduplicate
}
