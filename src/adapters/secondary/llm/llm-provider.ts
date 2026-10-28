/** Requête neutre vis-à-vis du fournisseur : le contrat JSON est décrit par un JSON Schema */
export interface LlmRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
}

export interface LlmResponse {
  /** Texte brut renvoyé par le modèle (JSON attendu) */
  text: string;
  /** Modèle ayant réellement répondu */
  model: string;
}

/** Fournisseur de génération de texte structuré (Gemini, endpoint compatible OpenAI…) */
export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'LlmHttpError';
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Quota quotidien épuisé : inutile de réessayer avant plusieurs heures */
export const DAILY_QUOTA_PATTERN = /per ?day|daily|par jour/i;

/** Durée pendant laquelle un modèle au quota quotidien épuisé est ignoré */
export const EXHAUSTED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
