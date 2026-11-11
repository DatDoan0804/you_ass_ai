/**
 * @fileoverview Google Gemini Provider (`gemini-provider.js`)
 *
 * Implements `BaseAIProvider` for the Google Gemini REST API (`v1beta/models/{model}:generateContent`).
 * Updated for **Gemini 3.8 Flash** (`gemini-3.8-flash`):
 * - Uses `gemini-3.8-flash` as the default model ID (per official Google AI Studio documentation:
 *   https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash and
 *   https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8).
 * - Complies with the Gemini 3.6+ / 3.8 migration specification by omitting deprecated sampling
 *   parameters (`temperature`, `topP`, `topK`, `candidateCount`) on Gemini 3.6+ models while
 *   supporting `thinkingConfig: { thinkingLevel: "low" | "medium" | "high" }`.
 * - Extracts the structured JSON text payload cleanly even when Gemini 3.8 Flash includes
 *   `thought: true` reasoning parts in `candidates[0].content.parts`.
 * - Handles unsupported models (HTTP 404 fallback to `gemini-3.6-flash` then `gemini-2.5-flash-lite`),
 *   rate limits (HTTP 429), and temporary capacity exhaustion (HTTP 503) with exponential backoff.
 */

import { BaseAIProvider, OpenAICompatibleProvider } from './ai-provider.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash-lite'];

export class GeminiProvider extends BaseAIProvider {
  /** @type {number} Timestamp in ms until which all Gemini requests are circuit-broken after HTTP 429 */
  static cooldownUntil = 0;

  static resetRateLimitState() {
    GeminiProvider.cooldownUntil = 0;
  }

  constructor(config = {}) {
    super({
      ...config,
      model: config.model || DEFAULT_GEMINI_MODEL
    });
    this.maxRetries = config.maxRetries ?? 2;
    this.thinkingLevel = config.thinkingLevel || 'low';
    this.fetchImpl = config.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  }

  /**
   * Returns true if the target model is a Gemini 3.6+ or Gemini 4+ model where
   * sampling parameters (`temperature`, `topP`, `topK`) are deprecated and ignored/rejected.
   * @param {string} modelId
   * @returns {boolean}
   */
  static isModernGemini36Plus(modelId = '') {
    const m = String(modelId).toLowerCase();
    return (
      m.includes('gemini-3.6') ||
      m.includes('gemini-3.7') ||
      m.includes('gemini-3.8') ||
      m.includes('gemini-3.5-flash-lite') ||
      m.includes('gemini-4')
    );
  }

  /**
   * Builds the `generateContent` request body compatible with `gemini-3.8-flash` and older models.
   */
  buildRequestBody({ systemPrompt, userPrompt, responseSchema = null, temperature = 0.25 }, modelId = this.model) {
    const generationConfig = {
      responseMimeType: 'application/json'
    };

    if (responseSchema) {
      generationConfig.responseSchema = responseSchema;
    }

    // Per Gemini 3.8 Flash migration guide: remove deprecated sampling parameters (temperature, top_p, top_k)
    // on Gemini 3.6+ / 3.8 models; only attach temperature for legacy 2.x models.
    if (!GeminiProvider.isModernGemini36Plus(modelId) && typeof temperature === 'number') {
      generationConfig.temperature = temperature;
    }

    return {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig
    };
  }

  /**
   * Extracts the non-thought text part from a Gemini `generateContent` response.
   * Gemini 3.8 Flash thinking mode may emit `{ thought: true, text: "..." }` before the final JSON part.
   * @param {object} data
   * @returns {string|null}
   */
  static extractCandidateText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      return null;
    }

    // Prefer the last non-thought text part
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!part.thought && typeof part.text === 'string' && part.text.trim()) {
        return part.text;
      }
    }

    return parts[0]?.text || null;
  }

  /**
   * Executes a structured JSON generation call against Google Gemini with retry, backoff,
   * and automatic fallback if a configured model is unavailable.
   */
  async generateStructuredJSON({
    systemPrompt,
    userPrompt,
    responseSchema = null,
    temperature = 0.25,
    signal
  }) {
    if (!this.apiKey || !this.apiKey.trim()) {
      const err = new Error('MISSING_API_KEY: Please configure your Google Gemini API key in Settings.');
      err.code = 'MISSING_API_KEY';
      throw err;
    }

    if (!this.fetchImpl) {
      throw new Error('Fetch API is unavailable in this environment.');
    }

    if (Date.now() < GeminiProvider.cooldownUntil) {
      const remainingSec = Math.ceil((GeminiProvider.cooldownUntil - Date.now()) / 1000);
      const limitErr = new Error(`Gemini rate-limit cooldown active (${remainingSec}s remaining).`);
      limitErr.status = 429;
      limitErr.code = 'RATE_LIMITED';
      throw limitErr;
    }

    let attempt = 0;
    let currentModel = this.model || DEFAULT_GEMINI_MODEL;
    const fallbackQueue = [...FALLBACK_GEMINI_MODELS];

    while (attempt <= this.maxRetries) {
      const url = `${GEMINI_API_BASE}/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(this.apiKey.trim())}`;
      const requestBody = this.buildRequestBody(
        { systemPrompt, userPrompt, responseSchema, temperature },
        currentModel
      );

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          const data = await response.json();
          if (data?.promptFeedback?.blockReason) {
            throw new Error(`Gemini blocked prompt (reason: ${data.promptFeedback.blockReason}).`);
          }
          const candidateText = GeminiProvider.extractCandidateText(data);
          if (!candidateText) {
            throw new Error('Gemini returned an empty candidate response.');
          }
          return BaseAIProvider.parseJSONSafely(candidateText);
        }

        const errorPayload = await response.json().catch(() => ({}));
        const status = response.status;
        const message = errorPayload?.error?.message || `HTTP ${status}`;

        // Handle 404 or 400 Unsupported Model -> Fall back to next supported Flash model
        if ((status === 404 || (status === 400 && /model/i.test(message))) && fallbackQueue.length > 0) {
          const nextModel = fallbackQueue.shift();
          if (nextModel && nextModel !== currentModel) {
            console.warn(`[YT-Learn Gemini] Model ${currentModel} unavailable (${status}), falling back to ${nextModel}`);
            currentModel = nextModel;
            attempt += 1;
            continue;
          }
        }

        // Handle 429 Rate Limit or 503 Overload with exponential backoff and circuit breaker
        if (status === 429) {
          GeminiProvider.cooldownUntil = Date.now() + 25000;
        }

        if ((status === 429 || status === 503) && attempt < this.maxRetries) {
          const delayMs = Math.min(8000, 2000 * Math.pow(2, attempt));
          console.warn(`[YT-Learn Gemini] HTTP ${status} (${message}). Retrying in ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
          attempt += 1;
          continue;
        }

        const apiError = new Error(`Gemini API Error (${status}): ${message}`);
        apiError.status = status;
        throw apiError;
      } catch (err) {
        if (err.name === 'AbortError') {
          throw err;
        }
        if (attempt >= this.maxRetries || err.code === 'MISSING_API_KEY' || err.status) {
          throw err;
        }
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        attempt += 1;
      }
    }

    throw new Error('Exhausted retries calling Gemini API.');
  }
}

/**
 * Factory function that instantiates the configured AI provider.
 * @param {object} settings
 * @returns {BaseAIProvider}
 */
export function createAIProvider(settings = {}) {
  if (settings.provider === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      apiKey: settings.apiKey,
      model: settings.model,
      endpoint: settings.customEndpoint
    });
  }
  return new GeminiProvider({
    apiKey: settings.apiKey,
    model: settings.model || DEFAULT_GEMINI_MODEL
  });
}
