import type { AIAnalysisRequest } from '@trading/types';
import type { AIProvider, AIProviderConfig, RawAIResponse } from '../types';
import { buildMessageArray } from '../prompt';

// =============================================================================
// ANTHROPIC PROVIDER
// Uses the Anthropic Messages API (/v1/messages).
// Models: claude-haiku-4-5 (fastest/cheapest), claude-sonnet-4-6
// =============================================================================

interface AnthropicResponse {
  id:      string;
  type:    string;
  content: Array<{ type: string; text: string }>;
  usage?:  { input_tokens: number; output_tokens: number };
  error?:  { type: string; message: string };
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private readonly apiKey:  string;
  private readonly model:   string;
  private readonly timeout: number;

  constructor(config: AIProviderConfig) {
    this.apiKey  = config.apiKey;
    this.model   = config.model;
    this.timeout = config.timeoutMs;
  }

  async analyse(request: AIAnalysisRequest): Promise<RawAIResponse> {
    const messages  = buildMessageArray(request);
    const startedAt = Date.now();

    // Anthropic separates system from user messages
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMsgs  = messages.filter((m) => m.role === 'user');

    try {
      const controller = new AbortController();
      const timerId    = setTimeout(() => controller.abort(), this.timeout);

      let response: Response;
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:      this.model,
            max_tokens: 512,
            system:     systemMsg,
            messages:   userMsgs,
          }),
        });
      } finally {
        clearTimeout(timerId);
      }

      const latencyMs = Date.now() - startedAt;

      if (response.status === 429) {
        return { content: '', latencyMs, tokensUsed: null, error: 'Rate limited (429)' };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return { content: '', latencyMs, tokensUsed: null, error: `HTTP ${response.status}: ${body.slice(0, 200)}` };
      }

      const data = await response.json() as AnthropicResponse;

      if (data.error) {
        return { content: '', latencyMs, tokensUsed: null, error: data.error.message };
      }

      const content    = data.content.find((c) => c.type === 'text')?.text ?? '';
      const tokensUsed = data.usage ? data.usage.input_tokens + data.usage.output_tokens : null;

      return { content, latencyMs, tokensUsed, error: null };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      if (err instanceof Error && err.name === 'AbortError') {
        return { content: '', latencyMs, tokensUsed: null, error: `Timeout after ${this.timeout}ms` };
      }
      return { content: '', latencyMs, tokensUsed: null, error: String(err) };
    }
  }
}
