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
        if (activity.shouldSkip || activity.inScopeValidation === false) {
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
          inScopeValidation: true,
          transcriptVerification: activity.transcriptVerification || chunk.text.slice(0, 120),
          gradingRubric: activity.gradingRubric || {
            essentialPoints: activity.expectedKeyPoints || [activity.exemplarAnswer || ''],
            acceptableAlternatives: [activity.exemplarAnswer || ''],
            commonMisconceptions: []
          },
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
        errorReason: response?.error || 'Local fallback mode',
        learnerContext: mergedLearnerContext
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
        errorReason: err.message,
        learnerContext: mergedLearnerContext
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

  static cleanConceptName(name = '') {
    return String(name || '')
      .replace(/^(chapter|section|part)\s+\d+[:\s-]*/i, '')
      .replace(/[.]+$/, '')
      .trim();
  }

  static cleanSentence(s = '') {
    return String(s || '')
      .replace(/^(chapter|section|part)\s+\d+[:\s-]*/i, '')
      .replace(/^[.?!:,\s-]+/, '')
      .replace(/[.?!:,\s-]+$/, '')
      .trim();
  }

  static sanitizePrompt(rawPrompt = '') {
    let p = String(rawPrompt || '').trim();
    if (!p) return '';

    // 1. Strip repetitive / nested 'Synthesizing the concepts of...' prefixes
    p = p.replace(/(?:Synthesizing the concepts of\s+[^:]+:\s*)+/gi, '').trim();

    // 2. Clean chapter prefixes and trailing ellipsis inside quotes, e.g. "Chapter 3: Wir zerlegen den Radweg...."
    p = p.replace(/"(?:chapter|section|part)\s+\d+[:\s-]*(.*?)\.*"/gi, '"$1"');

    // 3. Resolve self-referential tautologies where instructor links identical phrases
    p = p.replace(
      /the instructor links\s+"([^"]+)"\s+to\s+"\1"/gi,
      'the instructor explains "$1"'
    );

    // 4. Clean up cause-and-effect wording if tautology was fixed or condition is singular
    p = p.replace(
      /Why does the first condition necessarily lead to the second,\s+and what specific failure/gi,
      'Why is this condition necessary, and what specific failure'
    );
    p = p.replace(
      /Why does the first condition necessarily lead to the second/gi,
      'Why is this condition necessary'
    );

    // 5. Clean up duplicate punctuation, leading colons, and excessive whitespace
    p = p.replace(/^[:\s-]+/, '').replace(/\s+/g, ' ').replace(/\s+([.,?!:])/g, '$1').trim();

    return p;
  }

  /**
   * Extracts key domain terms from a transcript segment to craft realistic, non-obvious
   * misconception distractors and multi-fact synthesis questions.
   */
  static extractDomainTerms(text = '', conceptName = '') {
    const stop = new Set([
      'welcome', 'today', 'learn', 'learning', 'about', 'first', 'second', 'finally', 'however',
      'therefore', 'because', 'which', 'where', 'there', 'their', 'these', 'those', 'they', 'them',
      'would', 'could', 'should', 'using', 'inside', 'after', 'before', 'other', 'under',
      'while', 'when', 'since', 'until', 'through', 'between', 'without', 'immediately',
      'consequently', 'chapter', 'section', 'part', 'instructor', 'speaker', 'video', 'introduces',
      'introducing', 'introduction', 'explains', 'explaining', 'explanation', 'demonstrates',
      'demonstrating', 'demonstration', 'operates', 'operating', 'definitions', 'mechanism',
      'mechanisms', 'practical', 'application', 'segment', 'concept', 'concepts', 'lesson',
      'tutorial', 'overview', 'review', 'summary', 'example', 'examples', 'discusses',
      'discussing', 'principles', 'principle', 'core', 'step', 'steps', 'details', 'detail',
      'topic', 'topics', 'with', 'from', 'into', 'onto', 'than', 'then', 'also', 'just', 'more',
      'most', 'some', 'such', 'only', 'same', 'have', 'having', 'been', 'were', 'will',
      'kapitel', 'abschnitt', 'beispiel'
    ]);

    const conceptWords = new Set(
      String(conceptName || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    );

    return Array.from(
      new Set(
        String(text)
          .replace(/[^a-zA-Z\s-]/g, ' ')
          .split(/\s+/)
          .filter(
            (w) =>
              w.length >= 4 &&
              !stop.has(w.toLowerCase()) &&
              !conceptWords.has(w.toLowerCase())
          )
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
    errorReason = '',
    learnerContext = null
  }) {
    const type = sectionAnalysis.recommendedActivityType || 'multiple_choice';
    const text = (chunk.text || '').trim();
    const rawSentences = text
      .split(/(?<=[.?!])\s+/)
      .map((s) => ActivityGenerator.cleanSentence(s))
      .filter((s) => s.length > 12);

    const validSentences = rawSentences.filter(
      (s) => !/^(chapter|section|part)\s+\d+[:\s-]*$/i.test(s)
    );

    const rawConceptName =
      chunk.chapterTitle ||
      sectionAnalysis.conceptName ||
      `Section ${chunkIndex + 1} Concept`;
    const conceptName =
      ActivityGenerator.cleanConceptName(rawConceptName) || `Section ${chunkIndex + 1} Concept`;

    const hasDistinctPair =
      validSentences.length >= 2 &&
      validSentences[0].toLowerCase() !== validSentences[validSentences.length - 1].toLowerCase() &&
      !validSentences[0].toLowerCase().includes(validSentences[validSentences.length - 1].toLowerCase()) &&
      !validSentences[validSentences.length - 1].toLowerCase().includes(validSentences[0].toLowerCase());

    const premiseSentence =
      validSentences[0] ||
      (text.length > 25 ? ActivityGenerator.cleanSentence(text) : `The instructor explains the core principle of "${conceptName}".`);
    const mechanismSentence = validSentences[1] || premiseSentence;
    const consequenceSentence = hasDistinctPair
      ? validSentences[validSentences.length - 1]
      : (text.length > 40 ? ActivityGenerator.cleanSentence(text) : `the core principle governs how "${conceptName}" operates in practice.`);

    const terms = ActivityGenerator.extractDomainTerms(text, conceptName);
    const termA = terms[0] || 'the primary factor';
    const termB = terms[1] || (terms[0] ? 'the resulting outcome' : 'the core requirement');
    const termC = terms[2] || 'the overall context';

    const fullExemplar = ActivityGenerator.ensureCompleteExemplar(
      sectionAnalysis.conceptSummary,
      text,
      conceptName
    );

    const timeRange = `${Math.floor(chunk.start / 60)}:${String(Math.floor(chunk.start % 60)).padStart(2, '0')} – ${Math.floor(chunk.end / 60)}:${String(Math.floor(chunk.end % 60)).padStart(2, '0')}`;
    const isProgramming = (sectionAnalysis.subjectCategory || 'general') === 'programming';

    let title = 'Deep Comprehension Check';
    let prompt = '';
    let codeOrScenarioSnippet = '';
    let options = [];
    let correctOptionIndices = [];
    let distractorRationale = '';

    switch (type) {
      case 'multiple_choice': {
        title = 'Conceptual Reasoning & Detail Check';
        if (terms.length >= 2 && termA.toLowerCase() !== termB.toLowerCase()) {
          prompt = `Connecting the explanation at ${timeRange} regarding "${conceptName}", how do ${termA} and ${termB} interact to determine the outcome described in this segment?`;
        } else {
          prompt = `Connecting the explanation at ${timeRange} regarding "${conceptName}", what primary principle governs the outcome described by the instructor?`;
        }

        let synthesizedCorrect;
        if (hasDistinctPair) {
          synthesizedCorrect = `${premiseSentence.replace(/[.]+$/, '')}, which directly governs how ${consequenceSentence.charAt(0).toLowerCase() + consequenceSentence.slice(1)}`;
        } else if (text.length > 30) {
          synthesizedCorrect = `The instructor demonstrates that ${conceptName} requires satisfying the primary condition to achieve the expected result.`;
        } else {
          synthesizedCorrect = concludingOrFull(consequenceSentence);
        }

        const correctText = synthesizedCorrect.length <= 165 ? synthesizedCorrect : `${synthesizedCorrect.slice(0, 162)}...`;

        let distractor1, distractor2, distractor3;
        if (isProgramming) {
          distractor1 = `While ${termA} initializes the setup, ${termB} alters the outcome only when the outer boundary condition is omitted.`;
          distractor2 = `${termB} defines the primary execution state, whereas ${termA} is only evaluated if an explicit exception occurs.`;
          distractor3 = `Both ${termA} and ${termB} execute independently in parallel without affecting the resulting behavior of ${termC}.`;
        } else {
          distractor1 = `While ${termA} establishes the initial setup, ${termB} only affects the outcome when the primary constraint is omitted.`;
          distractor2 = `${termB} dictates the outcome independently, whereas ${termA} is merely an optional detail that does not change the result.`;
          distractor3 = `Both ${termA} and ${termB} operate independently without directly influencing each other or the overall result.`;
        }

        const allOptions = [correctText, distractor1, distractor2, distractor3];
        const targetIndex = chunkIndex % 4;
        
        if (targetIndex !== 0) {
          const temp = allOptions[targetIndex];
          allOptions[targetIndex] = correctText;
          allOptions[0] = temp;
        }

        options = allOptions;
        correctOptionIndices = [targetIndex];
        distractorRationale = `The incorrect options represent plausible misunderstandings: they either invert the operational relationship between factors, assume conditional-only relevance, or assume factors operate independently without interaction.`;
        break;
      }

      case 'spot_the_mistake': {
        title = 'Diagnose the Subtle Misconception';
        let subtleFlaw;
        if (hasDistinctPair) {
          subtleFlaw = `${premiseSentence}. However, even if ${termB} is omitted or modified, ${consequenceSentence.replace(/\b(immediately|stops|undefined|retains|modular)\b/gi, 'still continues running unchanged')}`;
        } else if (isProgramming) {
          subtleFlaw = `In "${conceptName}", modifying ${termA} has no effect on ${termB} because the underlying state remains unchanged during execution.`;
        } else {
          subtleFlaw = `In "${conceptName}", the core principle described by the instructor applies identically in all cases, regardless of whether the primary condition is met.`;
        }
        codeOrScenarioSnippet = `Peer's Claim (${timeRange}):\n"${subtleFlaw}"`;
        prompt = `A viewer watched "${conceptName}" and wrote the claim above. Identify the subtle flaw or misconception in their reasoning and explain what actually happens.`;
        break;
      }

      case 'prediction': {
        title = 'Predict the Outcome & Edge Case';
        codeOrScenarioSnippet = hasDistinctPair
          ? `Context established (${timeRange}):\n"${premiseSentence} ${mechanismSentence}"`
          : `Segment context (${timeRange}):\n"${premiseSentence}"`;
        prompt = `Given what the instructor sets up in "${conceptName}" (${timeRange}), what outcome or consequence is expected to occur next, and what causal step explains that result?`;
        break;
      }

      case 'practical_application': {
        title = 'Scenario Application & Problem Solving';
        codeOrScenarioSnippet = `Concept from segment (${timeRange}):\n"${mechanismSentence}"`;
        if (isProgramming) {
          prompt = `Suppose you are designing a system where ${termA} changes dynamically. How would you apply the exact principle of "${conceptName}" from this segment to prevent unintended side effects on ${termB}?`;
        } else {
          prompt = `Suppose you need to apply the principle of "${conceptName}" in a real-world scenario. How would you use what the instructor explained between ${timeRange} to ensure the desired outcome and avoid common errors?`;
        }
        break;
      }

      case 'critical_thinking': {
        title = 'Cause, Effect & Counterfactual Analysis';
        if (hasDistinctPair) {
          prompt = `In "${conceptName}" (${timeRange}), the instructor explains how "${premiseSentence.slice(0, 80)}..." relates to "${consequenceSentence.slice(0, 80)}...". Why does the first condition lead to the second, and what specific failure would occur if that condition were altered?`;
        } else {
          prompt = `Based on the segment covering "${conceptName}" (${timeRange}), why is this principle essential to the topic, and what specific failure or problem occurs if its core requirements are altered?`;
        }
        break;
      }

      case 'compare_concepts': {
        title = 'Distinguish & Compare Mechanisms';
        if (terms.length >= 2 && termA.toLowerCase() !== termB.toLowerCase()) {
          prompt = `Based on the explanation covered in "${conceptName}" (${timeRange}), what is the key distinction between ${termA} and ${termB}, and when would confusing the two lead to an error?`;
        } else {
          prompt = `Based on the explanation in "${conceptName}" (${timeRange}), how does the instructor distinguish this concept from common alternatives, and why is that distinction important?`;
        }
        break;
      }

      case 'connect_concepts': {
        title = 'Cross-Section Synthesis';
        const earlierRef = previousChunkSummary
          ? `the earlier topic ("${previousChunkSummary.slice(0, 80).replace(/[.]+$/, '')}...")`
          : 'the foundational premise introduced earlier in the lesson';
        prompt = `How does the explanation of "${conceptName}" in this segment (${timeRange}) depend on or build upon ${earlierRef}, and how do both ideas connect?`;
        break;
      }

      case 'short_answer':
      default: {
        title = 'Multi-Fact Synthesis Question';
        if (terms.length >= 2 && termA.toLowerCase() !== termB.toLowerCase()) {
          prompt = `In "${conceptName}" (${timeRange}), how does ${termA} relate to or affect ${termB}, and what happens if the core requirement is omitted?`;
        } else {
          prompt = `Based on the explanation between ${timeRange} in "${conceptName}", what is the primary mechanism or rule explained by the instructor, and why is it necessary?`;
        }
        break;
      }
    }

    const cleanPrompt = ActivityGenerator.sanitizePrompt(prompt);
    const cleanHint = hasDistinctPair
      ? `Connect what the instructor stated at the start of the segment ("${premiseSentence.slice(0, 65)}...") with the consequence at the end ("${consequenceSentence.slice(0, 65)}...").`
      : `Focus on why "${conceptName}" is necessary and what happens if its core condition is not satisfied.`;

    return {
      id: `act_fallback_${videoId}_${chunk.id}_${chunkIndex}`,
      chunkId: chunk.id,
      shouldSkip: false,
      type,
      title,
      conceptName,
      difficulty: learnerContext?.targetDifficulty || 'medium',
      contextSummary: `Segment ${timeRange}: Covers ${conceptName}.`,
      prompt: cleanPrompt,
      codeOrScenarioSnippet,
      options,
      correctOptionIndices,
      distractorRationale,
      expectedKeyPoints: validSentences.length > 0 ? validSentences.slice(0, 3) : [fullExemplar],
      exemplarAnswer: fullExemplar,
      hint: cleanHint,
      transcriptVerification: premiseSentence || text.slice(0, 120),
      inScopeValidation: true,
      gradingRubric: {
        essentialPoints: validSentences.length > 0 ? validSentences.slice(0, 3) : [fullExemplar],
        acceptableAlternatives: [consequenceSentence, fullExemplar],
        commonMisconceptions: [
          `Misunderstanding the primary requirement of ${conceptName}`,
          `Assuming the outcome is achieved without satisfying the initial condition`
        ]
      },
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
  return s || 'It links the primary condition directly to the resulting outcome.';
}
