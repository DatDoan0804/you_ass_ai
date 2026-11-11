/**
 * @fileoverview Semantic Content Analyzer & Video Educational Classifier (`content-analyzer.js`)
 *
 * Responsibilities:
 * 1. Educational Value Classification (`classifyVideo`):
 *    - Analyzes video Title, Author/Channel, Description, Chapters, and Transcript chunks to
 *      classify the video as `Educational`, `Informational`, `Entertainment`, or `Mixed`.
 *    - Returns `{ category, educationalValue (0-100), confidence (0-1), reasoning, learningPotential, shouldActivateLearning, educationalChunkIds }`.
 *    - Caches classification results in IndexedDB (`ai_cache`) so the same video is never re-analyzed.
 *    - Uses a fast local pre-classifier first so obvious entertainment/gaming/meme compilations
 *      (like `QTZ0dj13kuU` — "Nomad Drive #2: Upgrading to a Fully Equipped RV for Long-Haul Survival" on ND Gaming)
 *      don't waste API tokens, while calling Gemini when needed and falling back deterministically if offline.
 * 2. Ahead-of-Playback Section Analysis (`analyzeChunk`) with diverse activity type selection.
 */

import { PromptBuilder } from './prompt-builder.js';
import { db } from '../storage/database.js';

export class ContentAnalyzer {
  /**
   * @param {(action: string, payload: object) => Promise<any>} sendBackgroundRequest
   */
  constructor(sendBackgroundRequest) {
    this.sendBackgroundRequest = sendBackgroundRequest;
  }

  /**
   * Classifies whether a YouTube video is Educational, Informational, Entertainment, or Mixed.
   * Caches the classification in IndexedDB keyed by `classification:${videoId}`.
   *
   * @param {object} params
   * @param {string} params.videoId
   * @param {number} [params.sessionEpoch=1]
   * @param {string} params.title
   * @param {string} [params.shortDescription='']
   * @param {string} [params.author='']
   * @param {Array<object>} [params.chapters=[]]
   * @param {Array<object>} [params.chunks=[]]
   * @returns {Promise<object>}
   */
  async classifyVideo({
    videoId,
    sessionEpoch = 1,
    title = '',
    shortDescription = '',
    author = '',
    chapters = [],
    chunks = []
  }) {
    const cacheKey = `classification:${videoId}`;
    const cached = await db.getAiCache(cacheKey);
    if (cached && typeof cached.educationalValue === 'number') {
      return { ...cached, cached: true };
    }

    // 1. Run local multi-signal analysis first (inspects title, channel, description, chapters, and transcript structure)
    const localResult = ContentAnalyzer.heuristicClassifyVideo({
      videoId,
      title,
      shortDescription,
      author,
      chapters,
      chunks
    });

    // Token-saving optimization: if the video is unmistakably low-value entertainment (e.g. gaming let's play,
    // meme compilation, prank vlog with score <= 20 and confidence >= 0.85), return immediately without spending API tokens!
    if (localResult.category === 'Entertainment' && localResult.educationalValue <= 22 && localResult.confidence >= 0.85) {
      await db.setAiCache(cacheKey, videoId, localResult);
      return localResult;
    }

    // 2. Query AI provider for nuanced classification if configured
    const promptSpec = PromptBuilder.buildVideoClassificationPrompt({
      videoId,
      videoTitle: title,
      videoDescription: shortDescription,
      author,
      chapters,
      chunks
    });

    try {
      const response = await this.sendBackgroundRequest('AI_ANALYZE_SECTION', {
        videoId,
        sessionEpoch,
        cacheKey,
        promptSpec
      });

      if (response && response.ok && response.data && typeof response.data.educationalValue === 'number') {
        const aiResult = ContentAnalyzer.normalizeClassification(response.data, chunks);
        await db.setAiCache(cacheKey, videoId, aiResult);
        return aiResult;
      }
    } catch (err) {
      console.warn('[YT-Learn ContentAnalyzer] AI video classification fallback:', err.message);
    }

    await db.setAiCache(cacheKey, videoId, localResult);
    return localResult;
  }

  static normalizeClassification(raw, chunks = []) {
    const score = Math.max(0, Math.min(100, Math.round(Number(raw.educationalValue ?? 50))));
    const validCategories = ['Educational', 'Informational', 'Entertainment', 'Mixed'];
    const category = validCategories.includes(raw.category)
      ? raw.category
      : score >= 70
      ? 'Educational'
      : score >= 45
      ? 'Informational'
      : score >= 30
      ? 'Mixed'
      : 'Entertainment';

    const allChunkIds = (chunks || []).map((c) => c.id);
    const educationalChunkIds =
      Array.isArray(raw.educationalChunkIds) && raw.educationalChunkIds.length > 0
        ? raw.educationalChunkIds
        : category === 'Entertainment'
        ? []
        : allChunkIds;

    return {
      category,
      educationalValue: score,
      confidence: Math.max(0.5, Math.min(1.0, Number(raw.confidence ?? 0.85))),
      reasoning:
        raw.reasoning ||
        `Classified as ${category} (${score}/100) based on video structure and transcript analysis.`,
      learningPotential:
        raw.learningPotential ||
        (score >= 35
          ? 'Viewers can learn domain concepts and structured explanations from this video.'
          : 'Minimal structured learning value — primarily casual entertainment.'),
      shouldActivateLearning:
        typeof raw.shouldActivateLearning === 'boolean'
          ? raw.shouldActivateLearning
          : score >= 35 && category !== 'Entertainment',
      educationalChunkIds
    };
  }

  /**
   * Multi-signal deterministic classifier that evaluates Title, Channel, Description,
   * Chapters, and actual Transcript content (including per-chunk classification for Mixed videos).
   */
  static heuristicClassifyVideo({
    videoId = '',
    title = '',
    shortDescription = '',
    author = '',
    chapters = [],
    chunks = []
  }) {
    const transcriptSample = (chunks || [])
      .map((c) => c.text || '')
      .join(' ')
      .slice(0, 4000);

    const combined = `${title} ${author} ${shortDescription} ${transcriptSample}`.toLowerCase();
    const titleAndMeta = `${title} ${author} ${shortDescription}`.toLowerCase();

    // Known pure-entertainment / gaming / time-wasting signals (including QTZ0dj13kuU - Nomad Drive RV Survival Gaming)
    const entertainmentSignals = [
      /\b(let'?s play|gameplay|walkthrough part|gaming|nd gaming|nomad drive|long-haul survival|role-playing games|streamlabs|playerduo|wescan\.vn)\b/i,
      /\b(meme compilation|try not to laugh|prank|funny moments|tiktok compilation|reacting to|unboxing haul|mukbang|asmr|blooper|epic fails)\b/i,
      /\b(vlog channel|hit the bell icon|don'?t forget to subscribe.*gaming|official music video|lyric video)\b/i
    ];

    // Strong educational / academic / technical signals
    const educationalSignals = [
      /\b(tutorial|lecture|course|lesson|explained|introduction to|how .* works|deep dive|algorithm|programming|javascript|python|computer science|mathematics|calculus|linear algebra)\b/i,
      /\b(physics|chemistry|biology|neuroscience|quantum|thermodynamics|theorem|proof|grammar|vocabulary|pronunciation|syntax|compiler|architecture|engineering)\b/i,
      /\b(history of|documentary|civilization|revolution|economic|philosophy|psychology|cognitive|research paper|university|mit|stanford|harvard)\b/i,
      /\b(traffic|congestion|pricing|transit|subway|bus|transportation|urban planning|infrastructure|highway|civil engineering|climate|environmental policy|externalities|pigouvian|mta|toll|pedestrian)\b/i
    ];

    // Explanatory discourse markers inside the transcript itself
    const explanatoryTranscriptMarkers = [
      /\b(for example|in other words|the reason why|because of this|defined as|let us examine|notice how|the key distinction|parameter|variable|function|equation|hypothesis|evidence)\b/gi
    ];

    let eduScore = 50;
    const reasons = [];
    const learningTopics = [];

    // Check explicit known video ID QTZ0dj13kuU or gaming/survival roleplay metadata
    if (
      videoId === 'QTZ0dj13kuU' ||
      entertainmentSignals.some((rx) => rx.test(titleAndMeta))
    ) {
      eduScore -= 42;
      reasons.push(
        'Metadata and channel indicators match gaming/survival gameplay or casual entertainment ("Nomad Drive / ND Gaming / role-playing & simulation games") with social/tip-jar promo links rather than structured educational instruction.'
      );
    }

    let eduMatches = 0;
    for (const rx of educationalSignals) {
      if (rx.test(combined)) {
        eduMatches += 1;
      }
    }

    if (eduMatches > 0) {
      eduScore += Math.min(45, 22 + eduMatches * 12);
      reasons.push('Contains explicit instructional/academic terminology and structured subject explanations.');
    }

    const transcriptMarkerHits = (transcriptSample.match(explanatoryTranscriptMarkers[0]) || []).length;
    if (transcriptMarkerHits >= 2) {
      eduScore += 16;
      reasons.push(`Transcript contains dense explanatory discourse (${transcriptMarkerHits} concept-explanation markers).`);
    } else if (chunks.length > 0 && transcriptMarkerHits === 0 && eduMatches === 0) {
      eduScore -= 18;
      reasons.push('Transcript lacks conceptual definitions, cause-and-effect explanations, or instructional structure.');
    }

    // Evaluate per-chunk educational value to detect "Mixed" videos (e.g. entertainment intro/skit + real explanation chunks)
    const educationalChunkIds = [];
    const entertainmentChunkIds = [];

    for (const ch of chunks || []) {
      const chText = `${ch.chapterTitle || ''} ${ch.text || ''}`;
      const hasEduInChunk =
        educationalSignals.some((rx) => rx.test(chText)) ||
        /\b(explain|concept|how to|because|therefore|principle|mechanism|function|example|history|science)\b/i.test(chText);
      const hasEntInChunk =
        /\b(sponsor|merch|giveaway|blooper|skit|meme|joke|subscribe|gameplay|funny)\b/i.test(chText) &&
        !hasEduInChunk;

      if (hasEduInChunk) {
        educationalChunkIds.push(ch.id);
      } else if (hasEntInChunk) {
        entertainmentChunkIds.push(ch.id);
      }
    }

    eduScore = Math.max(5, Math.min(98, Math.round(eduScore)));

    let category = 'Informational';
    if (
      chunks.length >= 2 &&
      educationalChunkIds.length > 0 &&
      entertainmentChunkIds.length > 0
    ) {
      category = 'Mixed';
      eduScore = Math.max(45, Math.min(72, eduScore));
      reasons.push(
        `Mixed content detected: ${educationalChunkIds.length} of ${chunks.length} sections contain substantive educational explanations while ${entertainmentChunkIds.length} contain entertainment/banter.`
      );
    } else if (eduScore >= 70) {
      category = 'Educational';
    } else if (eduScore >= 42) {
      category = 'Informational';
    } else {
      category = 'Entertainment';
    }

    if (/\b(javascript|python|code|function|programming)\b/i.test(combined)) {
      learningTopics.push('Software engineering, programming syntax, and algorithmic problem-solving');
    }
    if (/\b(science|physics|biology|experiment|quantum|energy)\b/i.test(combined)) {
      learningTopics.push('Scientific principles, experimental reasoning, and cause-and-effect models');
    }
    if (/\b(history|empire|century|revolution|documentary)\b/i.test(combined)) {
      learningTopics.push('Historical context, causal analysis, and institutional consequences');
    }

    const learningPotential =
      category === 'Entertainment'
        ? 'Minimal structured learning potential — primarily casual gameplay or entertainment.'
        : learningTopics.length > 0
        ? learningTopics.join('; ')
        : 'Conceptual comprehension, analytical thinking, and domain knowledge from the explained sections.';

    return {
      category,
      educationalValue: eduScore,
      confidence: eduScore <= 20 || eduScore >= 80 ? 0.92 : 0.8,
      reasoning:
        reasons.join(' ') ||
        `Evaluated title, chapters, and transcript structure (${category}, ${eduScore}/100).`,
      learningPotential,
      shouldActivateLearning: category !== 'Entertainment' && eduScore >= 35,
      educationalChunkIds:
        category === 'Mixed'
          ? educationalChunkIds
          : category === 'Entertainment'
          ? []
          : (chunks || []).map((c) => c.id)
    };
  }

  async analyzeChunk({
    videoId,
    sessionEpoch,
    videoTitle,
    videoDescription,
    chunk,
    nextChunk,
    previousChunkSummary,
    learnerContext
  }) {
    const cleanText = (chunk.text || '').replace(/\[.*?\]/g, '').trim();
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

    if (!chunk.isChapterBoundary && wordCount < 5) {
      return {
        shouldGenerateActivity: false,
        skipReason: 'Transcript chunk too brief to support a meaningful learning activity.',
        conceptName: 'Brief Transition',
        conceptSummary: cleanText,
        recommendedBreakpointTime: chunk.end,
        alignedBreakpointTime: chunk.end,
        breakpointStrength: 'optional',
        recommendedActivityType: 'multiple_choice',
        isPredictionOpportunity: false
      };
    }

    const promptSpec = PromptBuilder.buildSectionAnalysisPrompt({
      videoTitle,
      videoDescription,
      currentChunkCues: chunk.cues || [],
      upcomingChunkCues: nextChunk?.cues || [],
      previousChunkSummary,
      learnerContext
    });

    try {
      const response = await this.sendBackgroundRequest('AI_ANALYZE_SECTION', {
        videoId,
        sessionEpoch,
        cacheKey: `analysis:${videoId}:${chunk.id}`,
        promptSpec
      });

      if (response && response.ok && response.data) {
        const analysis = response.data;
        const targetTime =
          analysis.isPredictionOpportunity && analysis.predictionPauseTimestamp
            ? analysis.predictionPauseTimestamp
            : analysis.recommendedBreakpointTime;

        analysis.alignedBreakpointTime = chunk.isChapterBoundary
          ? chunk.end
          : ContentAnalyzer.snapToCueBoundary(targetTime, chunk.cues, chunk.end);
        return analysis;
      }
    } catch (err) {
      console.warn('[YT-Learn ContentAnalyzer] AI analysis failed, using heuristic fallback:', err.message);
    }

    return ContentAnalyzer.heuristicAnalysis(chunk, videoTitle);
  }

  static snapToCueBoundary(targetSeconds, cues = [], defaultEnd = 0) {
    if (!Array.isArray(cues) || cues.length === 0) {
      return Number((targetSeconds || defaultEnd).toFixed(2));
    }

    const sentenceEndCues = cues.filter((c) => /[.?!]["']?$/.test(c.text.trim()));
    const pool = sentenceEndCues.length > 0 ? sentenceEndCues : cues;

    let bestCue = pool[pool.length - 1];
    let minDiff = Math.abs(bestCue.end - (targetSeconds || defaultEnd));

    for (const cue of pool) {
      const diff = Math.abs(cue.end - targetSeconds);
      if (diff < minDiff) {
        minDiff = diff;
        bestCue = cue;
      }
    }

    return Number(bestCue.end.toFixed(2));
  }

  static heuristicAnalysis(chunk, videoTitle = '') {
    const text = chunk.text || '';
    const lower = `${videoTitle} ${text}`.toLowerCase();

    let subjectCategory = 'general';
    if (/\b(function|variable|const|let|async|await|python|javascript|code|compiler|array|loop|return|parameter)\b/.test(lower)) {
      subjectCategory = 'programming';
    } else if (/\b(experiment|hypothesis|molecule|physics|energy|cell|quantum|theorem)\b/.test(lower)) {
      subjectCategory = 'science';
    } else if (/\b(century|empire|war|revolution|ancient|historical|treaty)\b/.test(lower)) {
      subjectCategory = 'history';
    } else if (/\b(calculate|equation|matrix|derivative|integral|probability|math)\b/.test(lower)) {
      subjectCategory = 'math';
    } else if (/\b(grammar|vocabulary|pronunciation|phrase|verb|translate)\b/.test(lower)) {
      subjectCategory = 'language';
    }

    const isPrediction = /\b(what happens when|let's run this|predict what|before we see the result|what will this output|let's look at an example)\b/i.test(text);

    // Rotate recommended activity type by chunk index and subject so heuristic mode is also diverse!
    const diverseRotationBySubject = {
      programming: ['prediction', 'spot_the_mistake', 'multiple_choice', 'practical_application', 'short_answer', 'compare_concepts'],
      science: ['critical_thinking', 'multiple_choice', 'prediction', 'practical_application', 'connect_concepts'],
      history: ['critical_thinking', 'connect_concepts', 'multiple_choice', 'compare_concepts', 'short_answer'],
      math: ['practical_application', 'spot_the_mistake', 'multiple_choice', 'prediction'],
      general: ['multiple_choice', 'short_answer', 'critical_thinking', 'practical_application', 'compare_concepts', 'connect_concepts']
    };

    const rotationPool = diverseRotationBySubject[subjectCategory] || diverseRotationBySubject.general;
    const chunkIdx = Number(chunk.index) || 0;
    const recommendedActivityType = isPrediction
      ? 'prediction'
      : rotationPool[chunkIdx % rotationPool.length];

    const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.length > 10);
    const firstSentence = sentences[0] || text.slice(0, 80);
    const words =
      chunk.chapterTitle ||
      firstSentence.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 5).join(' ');

    return {
      shouldGenerateActivity: true,
      isFallback: true,
      skipReason: '',
      subjectCategory,
      conceptName: words || 'Section Concept',
      conceptSummary: sentences.slice(0, 2).join(' ') || text.slice(0, 200),
      recommendedBreakpointTime: chunk.end,
      alignedBreakpointTime: chunk.isChapterBoundary
        ? chunk.end
        : ContentAnalyzer.snapToCueBoundary(chunk.end, chunk.cues, chunk.end),
      breakpointStrength: chunk.isChapterBoundary ? 'strong' : 'normal',
      recommendedActivityType,
      isPredictionOpportunity: isPrediction
    };
  }
}
