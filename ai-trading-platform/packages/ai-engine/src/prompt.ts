import type { AIAnalysisRequest } from '@trading/types';

// =============================================================================
// PROMPT BUILDER
// Constructs a tightly constrained prompt that maximises structured JSON output.
// The prompt:
//   1. Sets the AI role (expert quant analyst, NOT a financial advisor)
//   2. Provides structured market context
//   3. Specifies the EXACT JSON schema required
//   4. Adds explicit constraints to prevent hallucination
//
// Design goals:
//   - Works with all providers (Groq, OpenAI, Anthropic, Ollama)
//   - Fits within typical free-tier context windows
//   - Minimises token usage to stay within rate limits
// =============================================================================

export function buildAnalysisPrompt(request: AIAnalysisRequest): string {
  const {
    symbol,
    currentPrice,
    marketRegime,
    strategySignals,
    openPositions,
    riskSettings,
  } = request;

  // Use only the best signal for brevity
  const bestSignal = strategySignals.reduce(
    (best, s) => (s.score > (best?.score ?? -1) ? s : best),
    strategySignals[0],
  );

  const positionSummary = openPositions.length === 0
    ? 'None'
    : openPositions
        .map((p) => `${p.side} ${p.symbol} @ ${p.entryPrice.toFixed(2)} (unrealised: ${p.unrealisedPnl.toFixed(2)})`)
        .join(', ');

  const signalSummary = bestSignal
    ? [
        `Strategy: ${bestSignal.strategyName}`,
        `Direction: ${bestSignal.direction}`,
        `Score: ${bestSignal.score}/100`,
        `Confidence: ${(bestSignal.confidence * 100).toFixed(0)}%`,
        `R:R: ${bestSignal.riskReward.toFixed(2)}`,
        `Stop: ${bestSignal.suggestedStopLoss.toFixed(2)}`,
        `Target: ${bestSignal.suggestedTakeProfit.toFixed(2)}`,
        `Reasons: ${bestSignal.reasons.slice(0, 3).join('; ')}`,
      ].join('\n  ')
    : 'No signal';

  const systemPrompt = `You are an expert quantitative analyst assistant for a personal algorithmic trading system.
Your role is to validate trading signals — not to predict markets or give financial advice.
You must return ONLY a valid JSON object. No explanation, no markdown, no extra text.`;

  const userPrompt = `Analyse this trading opportunity and return a structured decision.

MARKET CONTEXT:
  Symbol:        ${symbol}
  Price:         ${currentPrice.toFixed(2)}
  Market Regime: ${marketRegime}
  Open Positions: ${positionSummary}

STRATEGY SIGNAL:
  ${signalSummary}

RISK SETTINGS:
  Risk per trade: ${(riskSettings.riskPerTradePercent * 100).toFixed(1)}%
  Min R:R:        ${riskSettings.minRiskReward}
  Long enabled:   ${riskSettings.longEnabled}
  Short enabled:  ${riskSettings.shortEnabled}

INSTRUCTIONS:
  1. Evaluate whether the signal is valid given the market regime and context.
  2. Assess risk carefully — capital preservation is the priority.
  3. Return BUY or SELL only if you have high confidence. Otherwise return HOLD or NO_TRADE.
  4. confidence must be between 0.0 and 1.0.
  5. entry, stopLoss, takeProfit must be realistic prices near current price.
  6. reasons must be 2–5 short bullet points.

REQUIRED JSON FORMAT (return ONLY this, no other text):
{
  "decision": "BUY" | "SELL" | "HOLD" | "NO_TRADE",
  "confidence": 0.00,
  "marketRegime": "string",
  "entry": 0.00,
  "stopLoss": 0.00,
  "takeProfit": 0.00,
  "reasons": ["reason1", "reason2"]
}`;

  return JSON.stringify({ system: systemPrompt, user: userPrompt });
}

/**
 * Returns the system and user messages separately for providers
 * that accept a messages array (OpenAI-compatible format).
 */
export function buildMessageArray(request: AIAnalysisRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const combined = JSON.parse(buildAnalysisPrompt(request)) as { system: string; user: string };
  return [
    { role: 'system', content: combined.system },
    { role: 'user',   content: combined.user   },
  ];
}
