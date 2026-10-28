import {
  DAILY_QUOTA_PATTERN,
  EXHAUSTED_COOLDOWN_MS,
  LlmHttpError,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  sleep
} from './llm-provider';

type ResponseMode = 'json_schema' | 'json_object';

/**
 * Fournisseur pour tout endpoint compatible avec l'API « chat completions » d'OpenAI :
 * OmniRoute, OpenRouter, LiteLLM, Ollama, vLLM, OpenAI, etc.
 *
 * Variables : LLM_BASE_URL (ex. http://localhost:20128/v1), LLM_MODEL, LLM_API_KEY (optionnelle en local),
 * LLM_FALLBACK_MODELS, LLM_MAX_TOKENS, LLM_MIN_INTERVAL_MS.
 */
/** Réponse coupée par la limite de jetons (finish_reason = length) */
class TruncatedResponseError extends Error {}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  private static readonly RETRY_DELAYS_MS = [4000, 12000];
  private static readonly REQUEST_TIMEOUT_MS = 120_000;
  private static readonly DEFAULT_MAX_TOKENS = 8000;
  /** Statuts pour lesquels on tente le modèle suivant plutôt que d'abandonner le fournisseur */
  private static readonly SWITCHABLE_STATUSES = [402, 404, 408, 429, 500, 502, 503, 504];

  private nextSlotAt = 0;
  private exhaustedUntil = new Map<string, number>();
  /**
   * Mode de sortie JSON. `json_schema` (schéma imposé) est essayé d'abord ; si l'endpoint le refuse,
   * on passe en `json_object` et le schéma est décrit dans le prompt. Mémorisé pour les appels suivants.
   */
  private mode: ResponseMode = 'json_schema';

  isConfigured(): boolean {
    return Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL);
  }

  private get endpoint(): string {
    return `${(process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')}/chat/completions`;
  }

  private get models(): string[] {
    const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    return Array.from(new Set([process.env.LLM_MODEL as string, ...fallbacks]));
  }

  private get maxTokens(): number {
    return Number(process.env.LLM_MAX_TOKENS) || OpenAiCompatibleProvider.DEFAULT_MAX_TOKENS;
  }

  /** Espacement minimal entre deux requêtes (quota RPM du fournisseur), 0 par défaut */
  private async waitForSlot(): Promise<void> {
    const interval = Number(process.env.LLM_MIN_INTERVAL_MS) || 0;
    if (interval <= 0) return;
    const now = Date.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + interval;
    if (startAt > now) await sleep(startAt - now);
  }

  private async post(model: string, request: LlmRequest, mode: ResponseMode, maxTokens = this.maxTokens): Promise<string> {
    const system =
      mode === 'json_object'
        ? `${request.system}\n\nRéponds uniquement par un objet JSON valide, sans texte autour, qui respecte ce JSON Schema :\n${JSON.stringify(request.jsonSchema)}`
        : request.system;

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: request.user }
        ],
        // 0 : réponses les plus stables possible d'une analyse à l'autre
        temperature: 0,
        max_tokens: maxTokens,
        response_format:
          mode === 'json_schema'
            ? {
                type: 'json_schema',
                json_schema: { name: 'editorial_analysis', strict: true, schema: request.jsonSchema }
              }
            : { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(OpenAiCompatibleProvider.REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LlmHttpError(`HTTP ${response.status} ${body.slice(0, 300)}`.trim(), response.status);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const raw = choice?.message?.content;
    const content = Array.isArray(raw)
      ? raw.map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''))).join('')
      : typeof raw === 'string'
        ? raw
        : '';

    if (choice?.finish_reason === 'length') {
      throw new TruncatedResponseError(`Réponse tronquée par ${model} (augmentez LLM_MAX_TOKENS)`);
    }
    if (!content.trim()) throw new Error(`Réponse vide de ${model}`);
    return content;
  }

  private async generateWithModel(model: string, request: LlmRequest): Promise<string> {
    let maxTokens = this.maxTokens;
    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      try {
        return await this.post(model, request, this.mode, maxTokens);
      } catch (err) {
        // Réponse coupée : un seul nouvel essai avec deux fois plus de jetons, puis l'erreur remonte (l'appelant
        // passe alors en heuristique, et l'origine de l'analyse l'affiche)
        if (err instanceof TruncatedResponseError && maxTokens === this.maxTokens) {
          maxTokens = Math.min(this.maxTokens * 2, 32000);
          console.warn(`[LlmGateway] ${model} : réponse tronquée, nouvel essai avec ${maxTokens} jetons`);
          attempt--;
          continue;
        }
        if (err instanceof LlmHttpError) {
          // L'endpoint refuse le schéma imposé : repli unique sur le mode JSON simple
          if (err.status === 400 && this.mode === 'json_schema' && /response_format|json_schema|schema/i.test(err.message)) {
            console.warn('[LlmGateway] json_schema refusé par l’endpoint, repli sur json_object');
            this.mode = 'json_object';
            attempt--;
            continue;
          }
          if (err.status === 429 && DAILY_QUOTA_PATTERN.test(err.message)) {
            this.exhaustedUntil.set(model, Date.now() + EXHAUSTED_COOLDOWN_MS);
            throw err;
          }
        }
        const retryable = err instanceof LlmHttpError && (err.status === 429 || err.status === 503);
        const delay = OpenAiCompatibleProvider.RETRY_DELAYS_MS[attempt];
        if (!retryable || delay === undefined) throw err;
        console.warn(`[LlmGateway] ${model} : ${(err as LlmHttpError).status}, nouvel essai dans ${delay / 1000} s`);
        await sleep(delay);
      }
    }
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    let lastError: unknown;
    for (const model of this.models) {
      if ((this.exhaustedUntil.get(model) ?? 0) > Date.now()) continue;
      try {
        return { text: await this.generateWithModel(model, request), model };
      } catch (err) {
        lastError = err;
        const switchable =
          err instanceof LlmHttpError && OpenAiCompatibleProvider.SWITCHABLE_STATUSES.includes(err.status);
        if (!switchable) throw err;
        console.warn(`[LlmGateway] ${model} indisponible (${(err as LlmHttpError).status}), modèle suivant`);
      }
    }
    throw lastError ?? new Error('Quota quotidien épuisé sur tous les modèles configurés');
  }
}
