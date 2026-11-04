import { AnthropicProvider } from './anthropic.ts';
import { GeminiProvider } from './gemini.ts';
import { MockProvider } from './mock.ts';
import { OpenAICompatibleProvider } from './openaiCompatible.ts';
import type { Provider } from './types.ts';

// Builds the provider set from environment variables. A provider is switched on only when
// its key (or URL, for self-hosted) is configured, never hard-coded.
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, Provider> {
  const providers: Record<string, Provider> = { mock: new MockProvider() };
  const openai = (name: string, baseUrl: string, apiKey?: string, timeoutMs?: number) =>
    (providers[name] = new OpenAICompatibleProvider({ name, baseUrl, apiKey, timeoutMs }));

  if (env.GROQ_API_KEY) openai('groq', 'https://api.groq.com/openai/v1', env.GROQ_API_KEY);
  if (env.OPENROUTER_API_KEY) openai('openrouter', 'https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY);
  if (env.HF_TOKEN) openai('huggingface', 'https://router.huggingface.co/v1', env.HF_TOKEN);
  // Self-hosted: Ollama (and vLLM) expose the same OpenAI API, so only the URL differs.
  // Local CPU inference is slow, hence the longer timeout.
  if (env.OLLAMA_BASE_URL) openai('ollama', `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`, undefined, 120_000);
  if (env.VLLM_BASE_URL) openai('vllm', `${env.VLLM_BASE_URL.replace(/\/$/, '')}/v1`, env.VLLM_API_KEY, 120_000);
  if (env.GEMINI_API_KEY) providers.gemini = new GeminiProvider({ apiKey: env.GEMINI_API_KEY });
  if (env.ANTHROPIC_API_KEY) providers.anthropic = new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });

  return providers;
}
