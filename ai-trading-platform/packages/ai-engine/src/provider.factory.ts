import type { Config } from '@trading/config';
import type { AIProvider } from './types';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { AnthropicProvider }        from './providers/anthropic.provider';

// =============================================================================
// AI PROVIDER FACTORY
// Reads AI_PROVIDER from config and constructs the correct implementation.
// Adding a new provider = implement AIProvider + add a case here.
// =============================================================================

export function createAIProvider(config: Config): AIProvider {
  const apiKey   = config.AI_API_KEY ?? '';
  const model    = config.AI_MODEL;
  const timeout  = config.AI_REQUEST_TIMEOUT_MS;
  const provider = config.AI_PROVIDER;

  switch (provider) {
    case 'openai':
      return new OpenAICompatibleProvider({ name: 'openai', apiKey, model, timeoutMs: timeout });

    case 'groq':
      return new OpenAICompatibleProvider({ name: 'groq', apiKey, model, timeoutMs: timeout });

    case 'ollama':
      // Ollama runs locally — no API key needed
      return new OpenAICompatibleProvider({
        name:    'ollama',
        apiKey:  'ollama',   // placeholder — Ollama ignores this
        model,
        timeoutMs: timeout,
        baseUrl:   'http://localhost:11434/v1',
      });

    case 'anthropic':
      return new AnthropicProvider({ name: 'anthropic', apiKey, model, timeoutMs: timeout });

    default:
      throw new Error(
        `Unknown AI_PROVIDER: "${provider}". Supported: openai, groq, ollama, anthropic`,
      );
  }
}
