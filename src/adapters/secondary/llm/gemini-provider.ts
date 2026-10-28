import { ApiError, GoogleGenAI } from '@google/genai';
import { EXHAUSTED_COOLDOWN_MS, LlmProvider, LlmRequest, LlmResponse, sleep } from './llm-provider';

/** Fournisseur Google Gemini (Google AI Studio), avec enchaînement de modèles */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  /** Modèle surchargeable via GEMINI_MODEL */
  private static readonly DEFAULT_MODEL = 'gemini-3.8-flash';
  /** Modèles de repli (GEMINI_FALLBACK_MODELS, séparés par des virgules) si le modèle principal est saturé ou retiré */
  private static readonly DEFAULT_FALLBACK_MODELS = [
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite'
  ];
  /** Palier gratuit Google AI Studio : 15 requêtes/minute, soit une requête toutes les 4 s au maximum */
  private static readonly MIN_REQUEST_INTERVAL_MS = 4500;
  private static readonly RETRY_DELAYS_MS = [4000, 12000];

  private client: GoogleGenAI | null = null;
  /** Instant à partir duquel la prochaine requête peut partir (cadencement entre pages parallèles) */
  private nextSlotAt = 0;
  /** Modèles dont le quota quotidien du palier gratuit est épuisé, avec l'instant de nouvelle tentative */
  private exhaustedUntil = new Map<string, number>();

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  private get models(): string[] {
    const primary = process.env.GEMINI_MODEL || GeminiProvider.DEFAULT_MODEL;
    const fallbacks = process.env.GEMINI_FALLBACK_MODELS
      ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((name) => name.trim()).filter(Boolean)
      : GeminiProvider.DEFAULT_FALLBACK_MODELS;
    return Array.from(new Set([primary, ...fallbacks]));
  }

  /** Réserve un créneau d'émission : les appels concurrents sont espacés pour rester sous le quota RPM */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + GeminiProvider.MIN_REQUEST_INTERVAL_MS;
    if (startAt > now) await sleep(startAt - now);
  }

  /** Un appel avec nouvelles tentatives sur 429/503 ; lève l'erreur si le modèle reste indisponible */
  private async generateWithModel(model: string, request: LlmRequest): Promise<string> {
    this.client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      try {
        const response = await this.client.models.generateContent({
          model,
          contents: request.user,
          config: {
            systemInstruction: request.system,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
            // 0 : réponses les plus stables possible d'une analyse à l'autre
        temperature: 0,
            maxOutputTokens: 16000
          }
        });

        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) throw new Error(`Requête bloquée par Gemini (${blockReason})`);
        if (!response.text) {
          throw new Error(
            `Réponse vide de Gemini (finishReason: ${response.candidates?.[0]?.finishReason ?? 'inconnu'})`
          );
        }
        return response.text;
      } catch (err) {
        // Quota quotidien : inutile de réessayer, le délai se compte en heures
        if (err instanceof ApiError && err.status === 429 && /per ?day/i.test(err.message)) {
          this.exhaustedUntil.set(model, Date.now() + EXHAUSTED_COOLDOWN_MS);
          throw err;
        }
        const retryable = err instanceof ApiError && (err.status === 429 || err.status === 503);
        const delay = GeminiProvider.RETRY_DELAYS_MS[attempt];
        if (!retryable || delay === undefined) throw err;
        console.warn(`[LlmGateway] ${model} : ${(err as ApiError).status}, nouvel essai dans ${delay / 1000} s`);
        await sleep(delay);
      }
    }
  }

  /** Essaie les modèles dans l'ordre : saturation (429/503) ou modèle introuvable (404) passent au suivant */
  async generate(request: LlmRequest): Promise<LlmResponse> {
    let lastError: unknown;
    for (const model of this.models) {
      if ((this.exhaustedUntil.get(model) ?? 0) > Date.now()) continue;
      try {
        return { text: await this.generateWithModel(model, request), model };
      } catch (err) {
        lastError = err;
        const switchable = err instanceof ApiError && [404, 429, 503].includes(err.status);
        if (!switchable) throw err;
        console.warn(`[LlmGateway] ${model} indisponible (${(err as ApiError).status}), modèle suivant`);
      }
    }
    throw lastError ?? new Error('Quota quotidien Gemini épuisé sur tous les modèles configurés');
  }
}
