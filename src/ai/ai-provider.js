/**
 * @fileoverview Provider Abstraction & OpenAI-Compatible Provider (`ai-provider.js`)
 *
 * Defines a clean base interface `BaseAIProvider` so the extension is never tightly coupled
 * to a single AI vendor. Also includes `OpenAICompatibleProvider` to support local LLMs
 * (Ollama, LM Studio, vLLM) or OpenRouter/Groq free tiers out of the box.
 */

export class BaseAIProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} config.model
   * @param {string} [config.endpoint]
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || '';
    this.endpoint = config.endpoint || '';
  }

  /**
   * Generates a structured JSON object from a system instruction and user prompt.
   * Subclasses must implement this method.
   *
   * @param {object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {object} [params.responseSchema]
   * @param {number} [params.temperature=0.3]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<object>}
   */
  async generateStructuredJSON(params) {
    throw new Error('generateStructuredJSON() must be implemented by subclass.');
  }

  /**
   * Safely extracts and parses JSON from an LLM text response, even if wrapped in
   * markdown code fences (` ```json ... ``` `).
   * @param {string} rawText
   * @returns {object}
   */
  static parseJSONSafely(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('Empty or non-string response from AI provider.');
    }

    const trimmed = rawText.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // Strip markdown code blocks if present
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (codeBlockMatch && codeBlockMatch[1]) {
        return JSON.parse(codeBlockMatch[1].trim());
      }
      // Attempt to locate outermost JSON braces
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      }
      throw new Error(`Malformed JSON returned by AI model: ${trimmed.slice(0, 160)}...`);
    }
  }
}

/**
 * OpenAI-Compatible Provider for Local Models (Ollama, LM Studio) or OpenRouter/Groq.
 */
export class OpenAICompatibleProvider extends BaseAIProvider {
  constructor(config = {}) {
    super({
      ...config,
      model: config.model || 'llama3.1:8b',
      endpoint: config.endpoint || 'http://localhost:11434/v1/chat/completions'
    });
  }

  async generateStructuredJSON({
    systemPrompt,
    userPrompt,
    temperature = 0.3,
    signal
  }) {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: this.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI-Compatible API Error (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return BaseAIProvider.parseJSONSafely(content);
  }
}
