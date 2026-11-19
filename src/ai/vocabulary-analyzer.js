/**
 * @fileoverview Vocabulary Analyzer for Gemini (`vocabulary-analyzer.js`)
 *
 * Implements the single, internal instruction and structured JSON schema
 * to analyze complete video subtitles and extract vocabulary cards for language learners.
 * No user prompt builder, prompt templates, or prompt configuration panels.
 */

export const VOCABULARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    vocabulary: {
      type: 'ARRAY',
      description: 'Useful vocabulary words, phrases, and expressions from the video subtitles that a language learner should learn before watching.',
      items: {
        type: 'OBJECT',
        properties: {
          word: {
            type: 'STRING',
            description: 'The original word or expression as it appears in the video subtitles.'
          },
          translation: {
            type: 'STRING',
            description: 'Clear translation or definition of the word or expression.'
          },
          contextualMeaning: {
            type: 'STRING',
            description: 'What the word or expression means specifically in the context of this video.'
          },
          example: {
            type: 'STRING',
            description: 'A short example sentence from the video subtitles showing its usage.'
          }
        },
        required: ['word', 'translation', 'contextualMeaning']
      }
    }
  },
  required: ['vocabulary']
};

export const VOCABULARY_SYSTEM_PROMPT = `You are an expert language teacher preparing a learner to watch a video in its original language.
Analyze the provided complete subtitle text of the video and identify the most useful vocabulary, phrases, idioms, and expressions that appear in it.

Rules:
- Select words and expressions that are unfamiliar or challenging to language learners, yet important for understanding the video's core content.
- Avoid trivial or overly common everyday words that most learners already know.
- Determine the precise meaning of each word in the specific context of this video.
- For each item, provide:
  * "word": The original word or expression from the subtitles.
  * "translation": Clear definition or natural translation.
  * "contextualMeaning": The meaning of the word in this specific video context.
  * "example": A short example sentence from the video subtitles demonstrating how it is used.

Output a valid JSON object matching the requested schema.`;

/**
 * Builds the internal Gemini request spec for vocabulary analysis.
 * Sends the complete subtitle text in a single request.
 * @param {object} params
 * @param {string} params.videoTitle
 * @param {string} params.subtitleText
 * @returns {{systemPrompt: string, userPrompt: string, schema: object}}
 */
export function buildVocabularyPrompt({ videoTitle = '', subtitleText = '' } = {}) {
  const cleanTitle = String(videoTitle || 'YouTube Video').trim();
  let cleanSubtitles = String(subtitleText || '').trim();

  // If subtitles are extremely long (>120,000 chars), truncate gracefully to prevent API timeouts
  const MAX_SUBTITLE_CHARS = 120000;
  if (cleanSubtitles.length > MAX_SUBTITLE_CHARS) {
    cleanSubtitles = cleanSubtitles.slice(0, MAX_SUBTITLE_CHARS) + '\n... [subtitles truncated for length]';
  }

  const userPrompt = `Video Title: "${cleanTitle}"

Complete Subtitles:
"""
${cleanSubtitles}
"""

Analyze the subtitles and identify the useful vocabulary a learner should learn before watching this video.`;

  return {
    systemPrompt: VOCABULARY_SYSTEM_PROMPT,
    userPrompt,
    schema: VOCABULARY_SCHEMA
  };
}

/**
 * Parses and sanitizes the Gemini vocabulary response.
 * @param {object|string} responseData
 * @returns {Array<{word: string, translation: string, meaning: string, contextualMeaning: string, example: string, context: string}>}
 */
export function parseVocabularyResponse(responseData) {
  if (!responseData) {
    throw new Error('Gemini returned empty or invalid response object.');
  }

  let data = responseData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('Gemini returned empty or invalid response object.');
    }
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('Gemini returned empty or invalid response object.');
  }

  const rawList = Array.isArray(data)
    ? data
    : (data.vocabulary || data.vocab || data.words || data.items);

  if (!Array.isArray(rawList)) {
    throw new Error('Gemini response missing vocabulary array.');
  }

  const seen = new Set();
  const items = [];

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const word = typeof raw.word === 'string' ? raw.word.trim()
      : typeof raw.term === 'string' ? raw.term.trim()
      : typeof raw.expression === 'string' ? raw.expression.trim() : '';
    const translation = typeof raw.translation === 'string' ? raw.translation.trim()
      : typeof raw.definition === 'string' ? raw.definition.trim()
      : typeof raw.meaning === 'string' ? raw.meaning.trim() : '';
    const contextualMeaning = typeof raw.contextualMeaning === 'string' ? raw.contextualMeaning.trim()
      : typeof raw.context_meaning === 'string' ? raw.context_meaning.trim() : '';
    const example = typeof raw.example === 'string' ? raw.example.trim()
      : typeof raw.context === 'string' ? raw.context.trim()
      : typeof raw.sentence === 'string' ? raw.sentence.trim() : '';

    if (!word || (!translation && !contextualMeaning)) continue;

    const lowerKey = word.toLowerCase();
    if (seen.has(lowerKey)) continue;
    seen.add(lowerKey);

    items.push({
      word,
      translation: translation || contextualMeaning,
      meaning: translation || contextualMeaning,
      contextualMeaning: contextualMeaning || translation,
      example,
      context: example
    });
  }

  return items;
}
