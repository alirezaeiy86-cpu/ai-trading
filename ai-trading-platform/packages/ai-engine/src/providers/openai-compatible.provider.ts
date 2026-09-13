import type { AIAnalysisRequest } from '@trading/types';
import type { AIProvider, AIProviderConfig, RawAIResponse } from '../types';
import { buildMessageArray } from '../prompt';

// =============================================================================
// OPENAI-COMPATIBLE PROVIDER
// Works with any API that follows the OpenAI /chat/completions format:
//   - OpenAI (gpt-4o-mini, gpt-4o)
//   - Groq (llama-3.3-70b-versatile — free tier with rate limits)
//   - Ollama (local models — no rate limits, no API key needed)
//   - Together AI, Perplexity, and other compatible APIs
// =============================================================================

const DEFAULT_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq:   'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
};

interface OpenAIResponse {
  id:      string;
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    total_tokens?:      number;
    prompt_tokens?:     number;
    completion_tokens?: number;
  };
  error?: { message: string; type: string };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: AIProvider['name'];
  private readonly baseUrl: string;
  private readonly apiKey:  string;
  private readonly model:   string;
  private readonly timeout: number;

  constructor(config: AIProviderConfig) {
    this.name    = config.name;
    this.apiKey  = config.apiKey;
    this.model   = config.model;
    this.timeout = config.timeoutMs;
    this.baseUrl = config.baseUrl ?? DEFAULT_URLS[config.name] ?? 'https://api.openai.com/v1';
  }

  async analyse(request: AIAnalysisRequest): Promise<RawAIResponse> {
    const messages  = buildMessageArray(request);
    const startedAt = Date.now();

    try {
      const controller = new AbortController();
      const timerId    = setTimeout(() => controller.abort(), this.timeout);

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model:       this.model,
            messages,
            temperature: 0.1,   // low temperature for consistent structured output
            max_tokens:  512,   // enough for our JSON schema
            stream:      false,
          }),
        });
      } finally {
        clearTimeout(timerId);
      }

      const latencyMs = Date.now() - startedAt;

      // Handle rate limit
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return {
          content:   '',
          latencyMs,
          tokensUsed: null,
          error:     `Rate limited (429). Retry after: ${retryAfter ?? 'unknown'}s`,
        };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          content:   '',
          latencyMs,
          tokensUsed: null,
          error:     `HTTP ${response.status}: ${body.slice(0, 200)}`,
        };
      }

      const data = await response.json() as OpenAIResponse;

      if (data.error) {
        return { content: '', latencyMs, tokensUsed: null, error: data.error.message };
      }

      const content    = data.choices[0]?.message.content ?? '';
      const tokensUsed = data.usage?.total_tokens ?? null;

      return { content, latencyMs, tokensUsed, error: null };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;

      if (err instanceof Error && err.name === 'AbortError') {
        return { content: '', latencyMs, tokensUsed: null, error: `Request timed out after ${this.timeout}ms` };
      }

      return { content: '', latencyMs, tokensUsed: null, error: String(err) };
    }
  }
}
