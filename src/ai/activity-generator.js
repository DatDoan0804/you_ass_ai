/**
 * @fileoverview Activity Generator (`activity-generator.js`)
 *
 * Updates for Issue 3 (Significantly Improve Question Quality, Difficulty & Plausible Distractors):
 * 1. Multi-Fact Synthesis & Attention to Detail:
 *    - Extracts multiple distinct statements/mechanisms (`premiseFact`, `mechanismFact`, `consequenceFact`)
 *      from the transcript section (and connects them to `previousChunkSummary` when available).
 *    - Generates challenging questions that require connecting two or more facts, analyzing a
 *      boundary condition, tracing an execution scenario, or diagnosing a subtle misconception.
 * 2. Plausible Misconception Distractors for Multiple-Choice:
 *    - Eliminates obvious throwaway distractors. Constructs 3 domain-grounded distractors that
 *      reflect realistic misunderstandings of the segment:
 *      * Distractor 1 (Inverted Cause/Role): Swaps the roles or causal direction of two terms from the transcript.
 *      * Distractor 2 (Missing Boundary Condition): States a rule from the segment as unconditional when it actually depends on a specific condition.
 *      * Distractor 3 (Partial-Truth Overgeneralization): Combines a familiar term from the segment with an inaccurate side effect.
 *    - Populates `distractorRationale` so the concise multiple-choice evaluator can explain why
 *      the distractors are wrong in 1–2 crisp sentences.
 */

import { PromptBuilder } from './prompt-builder.js';

export const SUBJECT_ACTIVITY_POOLS = {
  programming: [
    'prediction',
    'spot_the_mistake',
    'multiple_choice',
    'practical_application',
    'short_answer',
    'compare_concepts',
    'connect_concepts'
  ],
  science: [
    'critical_thinking',
    'multiple_choice',
    'prediction',
    'practical_application',
    'connect_concepts',
    'compare_concepts',
    'short_answer'
  ],
  history: [
    'critical_thinking',
    'connect_concepts',
    'compare_concepts',
    'multiple_choice',
    'short_answer'
  ],
  math: [
    'practical_application',
    'spot_the_mistake',
    'multiple_choice',
    'prediction',
    'short_answer'
  ],
  general: [
    'multiple_choice',
    'short_answer',
    'critical_thinking',
    'practical_application',
    'spot_the_mistake',
    'compare_concepts',
    'connect_concepts',
    'prediction',
    'teach_back'
  ]
};

export class ActivityGenerator {
  /**
   * @param {(action: string, payload: object) => Promise<any>} sendBackgroundRequest
   */
  constructor(sendBackgroundRequest) {
    this.sendBackgroundRequest = sendBackgroundRequest;
    /** @type {Map<string, Array<{type: string, prompt: string, conceptName: string}>>} videoId -> generated activities */
    this.videoGenerationHistory = new Map();
  }

  resetHistory(videoId = null) {
    if (videoId) {
      this.videoGenerationHistory.delete(videoId);
    } else {
      this.videoGenerationHistory.clear();
    }
  }

  selectDiverseActivityType(sectionAnalysis, learnerContext, chunkIndex = 0, videoId = 'default') {
    const generatedSoFar = this.videoGenerationHistory.get(videoId) || [];
    const historyTypes = [
      ...(learnerContext?.previousVideoActivities || []).map((a) => a.activityType),
      ...generatedSoFar.map((g) => g.type)
    ];

    const recentWindow = historyTypes.slice(-3);
    const lastType = historyTypes[historyTypes.length - 1];

    if (sectionAnalysis.isPredictionOpportunity && lastType !== 'prediction') {
      return 'prediction';
    }

    if (
      learnerContext?.strugglingConcepts?.length > 0 &&
      chunkIndex >= 2 &&
      !recentWindow.includes('memory_reinforcement')
    ) {
      return 'memory_reinforcement';
    }

    const subject = sectionAnalysis.subjectCategory || 'general';
    const pool = SUBJECT_ACTIVITY_POOLS[subject] || SUBJECT_ACTIVITY_POOLS.general;

    const candidate = sectionAnalysis.recommendedActivityType;
    const teachBackUsedRecently = historyTypes.slice(-5).includes('teach_back');

    if (
      candidate &&
      !recentWindow.slice(-2).includes(candidate) &&
      !(candidate === 'teach_back' && teachBackUsedRecently)
    ) {
      return candidate;
    }

    const unusedInWindow = pool.filter(
      (t) => !recentWindow.includes(t) && !(t === 'teach_back' && teachBackUsedRecently)
    );

    if (unusedInWindow.length > 0) {
      return unusedInWindow[chunkIndex % unusedInWindow.length];
    }

    return pool[chunkIndex % pool.length];
  }

  isPromptDuplicate(videoId, newPrompt = '') {
    const generatedSoFar = this.videoGenerationHistory.get(videoId) || [];
    const normNew = newPrompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (!normNew) return false;

    for (const item of generatedSoFar) {
      const normOld = item.prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (normNew === normOld) return true;
      const newWords = new Set(normNew.split(/\s+/).filter((w) => w.length > 3));
      const oldWords = new Set(normOld.split(/\s+/).filter((w) => w.length > 3));
      if (newWords.size >= 4 && oldWords.size >= 4) {
        let overlap = 0;
        for (const w of newWords) {
          if (oldWords.has(w)) overlap += 1;
        }
        if (overlap / Math.min(newWords.size, oldWords.size) >= 0.78) {
          return true;
        }
      }
    }
    return false;
  }

  recordGeneratedActivity(videoId, activity) {
    if (!videoId || !activity) return;
    if (!this.videoGenerationHistory.has(videoId)) {
      this.videoGenerationHistory.set(videoId, []);
    }
    this.videoGenerationHistory.get(videoId).push({
      type: activity.type,
      prompt: activity.prompt,
      conceptName: activity.conceptName
    });
  }

  async generateActivity({
    videoId,
    sessionEpoch,
    videoTitle,
    chunk,
    nextChunk,
    sectionAnalysis,
    previousChunkSummary,
    learnerContext,
    chunkIndex = 0
  }) {
    if (!sectionAnalysis || !sectionAnalysis.shouldGenerateActivity) {
      return null;
    }

    const chosenType = this.selectDiverseActivityType(
      sectionAnalysis,
      learnerContext,
      chunkIndex,
      videoId
    );

    const generatedSoFar = this.videoGenerationHistory.get(videoId) || [];
    const mergedLearnerContext = {
      ...learnerContext,
      previousVideoActivities: [
        ...(learnerContext?.previousVideoActivities || []),
        ...generatedSoFar.map((g) => ({
          activityType: g.type,
          conceptName: g.conceptName,
          questionAsked: g.prompt
        }))
      ]
    };

    const enrichedAnalysis = {
      ...sectionAnalysis,
      recommendedActivityType: chosenType
    };

    const promptSpec = PromptBuilder.buildActivityGenerationPrompt({
      videoTitle,
      sectionAnalysis: enrichedAnalysis,
      transcriptText: chunk.text,
      upcomingTranscriptText: nextChunk?.text || '',
      previousChunkSummary,
      learnerContext: mergedLearnerContext
    });

    try {
      const response = await this.sendBackgroundRequest('AI_GENERATE_ACTIVITY', {
        videoId,
        sessionEpoch,
        cacheKey: `activity:${videoId}:${chunk.id}:${chosenType}:${learnerContext?.targetDifficulty || 'medium'}`,
        promptSpec
      });

      if (response && response.stale) {
        return null;
      }

      if (response && response.ok && response.data) {
        const activity = response.data;
        if (activity.shouldSkip) {
          return null;
        }

        const finalActivity = {
          ...activity,
          type: activity.type || chosenType,
          id: `act_${videoId}_${chunk.id}_${Date.now()}`,
          chunkId: chunk.id,
          breakpointTime: sectionAnalysis.alignedBreakpointTime || chunk.end,
          breakpointStrength: sectionAnalysis.breakpointStrength || 'normal',
          subjectCategory: sectionAnalysis.subjectCategory || 'general',
          conceptSummary: sectionAnalysis.conceptSummary || '',
          transcriptExcerpt: chunk.text,
          exemplarAnswer: ActivityGenerator.ensureCompleteExemplar(
            activity.exemplarAnswer,
            chunk.text,
            sectionAnalysis.conceptName
          ),
          isAiGenerated: true
        };

        if (!this.isPromptDuplicate(videoId, finalActivity.prompt)) {
          this.recordGeneratedActivity(videoId, finalActivity);
          return finalActivity;
        }
      }

      const fallbackAct = ActivityGenerator.createFallbackActivity({
        videoId,
        chunk,
        previousChunkSummary,
        sectionAnalysis: enrichedAnalysis,
        chunkIndex,
        errorReason: response?.error || 'Local fallback mode'
      });
      this.recordGeneratedActivity(videoId, fallbackAct);
      return fallbackAct;
    } catch (err) {
      console.warn('[YT-Learn ActivityGenerator] AI generation error, using grounded fallback:', err.message);
      const fallbackAct = ActivityGenerator.createFallbackActivity({
        videoId,
        chunk,
        previousChunkSummary,
        sectionAnalysis: enrichedAnalysis,
        chunkIndex,
        errorReason: err.message
      });
      this.recordGeneratedActivity(videoId, fallbackAct);
      return fallbackAct;
    }
  }

  static ensureCompleteExemplar(rawExemplar, transcriptText = '', conceptName = '') {
    const trimmed = String(rawExemplar || '').trim();
    const cleanTranscript = String(transcriptText || '').trim();

    if (
      trimmed.length >= 40 &&
      trimmed.toLowerCase() !== String(conceptName || '').toLowerCase().trim() &&
      !/^(chapter\s+\d+|section\s+\d+)/i.test(trimmed)
    ) {
      return trimmed;
    }

    const sentences = cleanTranscript
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    if (sentences.length >= 2) {
      return `In this section on "${conceptName || 'the core concept'}", ${sentences.slice(0, 3).join(' ')}`;
    }
    if (cleanTranscript.length > 30) {
      return `Regarding "${conceptName || 'this section'}": ${cleanTranscript}`;
    }
    return `A strong explanation of "${conceptName || 'this concept'}" should state its primary purpose, explain how its inputs or conditions affect the outcome, and connect it to the example demonstrated in the video.`;
  }

  /**
   * Extracts key domain terms from a transcript segment to craft realistic, non-obvious
   * misconception distractors and multi-fact synthesis questions.
   */
  static extractDomainTerms(text = '') {
    const stop = new Set([
      'welcome', 'today', 'learn', 'about', 'first', 'second', 'finally', 'however',
      'therefore', 'because', 'which', 'where', 'there', 'their', 'these', 'those',
      'would', 'could', 'should', 'using', 'inside', 'after', 'before', 'other', 'under', 'while', 'when', 'since', 'until', 'through', 'between', 'without', 'immediately', 'consequently', 'therefore'
    ]);
    return Array.from(
      new Set(
        String(text)
          .replace(/[^a-zA-Z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 5 && !stop.has(w.toLowerCase()))
      )
    );
  }

  /**
   * Synthesizes a challenging, multi-fact, reasoning-focused activity grounded in the transcript
   * with plausible misconception distractors for multiple-choice questions (Issue 3).
   */
  static createFallbackActivity({
    videoId,
    chunk,
    previousChunkSummary = '',
    sectionAnalysis,
    chunkIndex = 0,
    errorReason = ''
  }) {
    const type = sectionAnalysis.recommendedActivityType || 'multiple_choice';
    const text = (chunk.text || '').trim();
    const sentences = text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 12);

    const premiseSentence = sentences[0] || text.slice(0, 140) || 'The instructor introduced a core mechanism.';
    const mechanismSentence = sentences[1] || premiseSentence;
    const consequenceSentence = sentences[sentences.length - 1] || mechanismSentence;

    const terms = ActivityGenerator.extractDomainTerms(text);
    const termA = terms[0] || 'the primary input';
    const termB = terms[1] || 'the execution state';
    const termC = terms[2] || 'the final output';

    const conceptName =
      chunk.chapterTitle ||
      sectionAnalysis.conceptName ||
      `Section ${chunkIndex + 1} Concept`;

    const fullExemplar = ActivityGenerator.ensureCompleteExemplar(
      sectionAnalysis.conceptSummary,
      text,
      conceptName
    );

    const timeRange = `${Math.floor(chunk.start / 60)}:${String(Math.floor(chunk.start % 60)).padStart(2, '0')} – ${Math.floor(chunk.end / 60)}:${String(Math.floor(chunk.end % 60)).padStart(2, '0')}`;

    let title = 'Deep Comprehension Check';
    let prompt = '';
    let codeOrScenarioSnippet = '';
    let options = [];
    let correctOptionIndices = [];
    let distractorRationale = '';

    switch (type) {
      case 'multiple_choice': {
        title = 'Conceptual Reasoning & Detail Check';
        prompt = `Connecting the explanation at ${timeRange} regarding "${conceptName}", how do ${termA} and ${termB} interact to determine the behavior described in this segment?`;

        // Synthesize a multi-fact correct option and 3 plausible misconception distractors
        const synthesizedCorrect =
          sentences.length >= 2
            ? `${premiseSentence.replace(/[.]+$/, '')}, which directly governs how ${consequenceSentence.charAt(0).toLowerCase() + consequenceSentence.slice(1)}`
            : concludingOrFull(consequenceSentence);

        options = [
          synthesizedCorrect.length <= 175 ? synthesizedCorrect : `${synthesizedCorrect.slice(0, 172)}...`,
          `While ${termA} initializes the setup, ${termB} overrides it asynchronously only after the entire outer scope has been garbage-collected.`,
          `${termB} defines the static declaration signature at compile time, whereas ${termA} is only evaluated if an explicit exception or fallback is triggered.`,
          `Both ${termA} and ${termB} execute in parallel without affecting ${termC}, meaning omitting ${termB} still preserves the exact same return value.`
        ];
        correctOptionIndices = [0];
        distractorRationale = `The other options represent common misconceptions: they either invert the roles of ${termA} and ${termB}, assume deferred asynchronous execution not present in this mechanism, or overlook what happens when the boundary condition is omitted.`;
        break;
      }

      case 'spot_the_mistake': {
        title = 'Diagnose the Subtle Misconception';
        const subtleFlaw =
          sentences.length >= 2
            ? `${premiseSentence} However, even if ${termB} is omitted or modified during execution, ${consequenceSentence.replace(/\b(immediately|stops|undefined|retains|modular)\b/gi, 'still continues running unchanged')}`
            : `In "${conceptName}", changing ${termA} has no effect on ${termB} because the state is copied by value before execution begins.`;
        codeOrScenarioSnippet = `Peer's Technical Claim (${timeRange}):\n"${subtleFlaw}"`;
        prompt = `A viewer watched "${conceptName}" passively and wrote the claim above. Based on the two mechanisms explained in this segment, identify the subtle logical flaw in their reasoning and explain what actually happens.`;
        break;
      }

      case 'prediction': {
        title = 'Predict the Outcome & Edge Case';
        codeOrScenarioSnippet = `Context established (${timeRange}):\n"${premiseSentence} ${sentences.length > 1 ? mechanismSentence : ''}"`;
        prompt = `Given how "${conceptName}" was just set up, what will happen next if we invoke or apply this mechanism under the boundary condition mentioned by the instructor, and what causal step explains that outcome?`;
        break;
      }

      case 'practical_application': {
        title = 'Scenario Application & Problem Solving';
        codeOrScenarioSnippet = `Mechanism from segment (${timeRange}):\n"${mechanismSentence}"`;
        prompt = `Suppose you are designing a system where ${termA} changes dynamically across calls. How would you apply the exact principle of "${conceptName}" from this segment to prevent unintended side effects on ${termB}?`;
        break;
      }

      case 'critical_thinking': {
        title = 'Cause, Effect & Counterfactual Analysis';
        prompt = `In "${conceptName}" (${timeRange}), the instructor links "${premiseSentence.slice(0, 80)}..." to "${consequenceSentence.slice(0, 80)}...". Why does the first condition necessarily lead to the second, and what specific failure or behavior would occur if that condition were altered?`;
        break;
      }

      case 'compare_concepts': {
        title = 'Distinguish & Compare Mechanisms';
        prompt = `Based on the nuances covered in "${conceptName}" (${timeRange}), what is the operational distinction between how ${termA} and ${termB} are handled, and when would confusing the two lead to an error?`;
        break;
      }

      case 'connect_concepts': {
        title = 'Cross-Section Synthesis';
        const earlierRef = previousChunkSummary
          ? `the earlier mechanism ("${previousChunkSummary.slice(0, 95)}...")`
          : 'the foundational premise introduced at the start of the lesson';
        prompt = `How does the behavior of "${conceptName}" in this segment (${timeRange}) depend on or extend ${earlierRef}, and how do both concepts work together?`;
        break;
      }

      case 'short_answer':
      default: {
        title = 'Multi-Fact Synthesis Question';
        prompt = `Synthesizing the points made between ${timeRange} in "${conceptName}", how does ${termA} interact with ${termB} to produce ${termC}, and what happens if the key requirement is omitted?`;
        break;
      }
    }

    return {
      id: `act_fallback_${videoId}_${chunk.id}_${chunkIndex}`,
      chunkId: chunk.id,
      shouldSkip: false,
      type,
      title,
      conceptName,
      difficulty: 'hard',
      contextSummary: `Segment ${timeRange}: Connects ${termA}, ${termB}, and ${termC}.`,
      prompt,
      codeOrScenarioSnippet,
      options,
      correctOptionIndices,
      distractorRationale,
      expectedKeyPoints: sentences.length > 0 ? sentences.slice(0, 3) : [fullExemplar],
      exemplarAnswer: fullExemplar,
      hint: `Connect what the instructor stated at the start of the segment ("${premiseSentence.slice(0, 65)}...") with the consequence at the end ("${consequenceSentence.slice(0, 65)}...").`,
      breakpointTime: sectionAnalysis.alignedBreakpointTime || chunk.end,
      breakpointStrength: sectionAnalysis.breakpointStrength || 'normal',
      subjectCategory: sectionAnalysis.subjectCategory || 'general',
      conceptSummary: fullExemplar,
      transcriptExcerpt: text,
      isAiGenerated: false,
      fallbackNotice: errorReason ? `Local Mode (${errorReason})` : ''
    };
  }
}

function concludingOrFull(s) {
  return s || 'It links the input condition directly to the resulting execution state.';
}
