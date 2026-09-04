import type {
  AIAnalysisRequest,
  AIAnalysisResult,
  AIDecision,
  AIUnavailableMode,
} from '@trading/types';

// =============================================================================
// AI ENGINE TYPES
// =============================================================================

// Re-export shared types for convenience
export type { AIAnalysisRequest, AIAnalysisResult, AIDecision, AIUnavailableMode };

export type AIProviderName = 'openai' | 'anthropic' | 'groq' | 'ollama';

export interface AIProviderConfig {
  name:       AIProviderName;
  apiKey:     string;
  model:      string;
  timeoutMs:  number;
  baseUrl?:   string; // for ollama or custom endpoints
}

// =============================================================================
// AI PROVIDER INTERFACE
// =============================================================================

export interface AIProvider {
  readonly name: AIProviderName;

  /**
   * Analyse the current market context and return a structured recommendation.
   * Must never throw — returns an error result instead.
   * Must return valid AIAnalysisResult JSON.
   */
  analyse(request: AIAnalysisRequest): Promise<RawAIResponse>;
}

export interface RawAIResponse {
  content:    string;    // raw LLM text
  latencyMs:  number;
  tokensUsed: number | null;
  error:      string | null;
}

// =============================================================================
// RATE LIMITER TYPES
// =============================================================================

export interface RateLimiterState {
  requestsThisMinute: number;
  requestsToday:      number;
  errorsToday:        number;
  rateLimitHitsToday: number;
  lastRequestAt:      Date | null;
  minuteWindowStart:  Date;
  dayWindowStart:     Date;
}

export interface AIRequestManagerConfig {
  maxPerMinute:  number;
  maxPerDay:     number;
  timeoutMs:     number;
  retryAttempts: number;
  cacheSeconds:  number;
  unavailableMode: AIUnavailableMode;
}

// =============================================================================
// OUTPUT SCHEMA
// =============================================================================

/** The structured JSON the LLM must return */
export interface AIOutputSchema {
  decision:     AIDecision;
  confidence:   number;    // 0.0 – 1.0
  marketRegime: string;
  entry:        number;
  stopLoss:     number;
  takeProfit:   number;
  reasons:      string[];
}
