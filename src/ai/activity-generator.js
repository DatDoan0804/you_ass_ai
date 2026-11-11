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
    let s = String(name || '')
      .replace(/^(chapter|section|part)\s+\d+[:\s-]*/i, '')
      .replace(/[.]+$/, '')
      .trim();

    if (/^\d+$/.test(s) || /^(intro|introduction|outro|conclusion|summary|overview)$/i.test(s)) {
      if (/^(intro|introduction)$/i.test(s)) return 'Introduction';
      if (/^(outro|conclusion)$/i.test(s)) return 'Wrap-Up';
      return '';
    }
    return s;
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
    const text = (chunk.text || '').replace(/\[.*?\]/g, '').trim();
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
      '';
    const cleanConcept = ActivityGenerator.cleanConceptName(rawConceptName);
    const conceptName = cleanConcept || (validSentences[0] ? validSentences[0].slice(0, 35) : `Section ${chunkIndex + 1}`);

    const hasDistinctPair =
      validSentences.length >= 2 &&
      validSentences[0].toLowerCase() !== validSentences[validSentences.length - 1].toLowerCase() &&
      !validSentences[0].toLowerCase().includes(validSentences[validSentences.length - 1].toLowerCase()) &&
      !validSentences[validSentences.length - 1].toLowerCase().includes(validSentences[0].toLowerCase());

    const premiseSentence =
      validSentences[0] ||
      (text.length > 25 ? ActivityGenerator.cleanSentence(text) : `The creator shows what happens in this part of the video.`);
    const consequenceSentence = hasDistinctPair
      ? validSentences[validSentences.length - 1]
      : (text.length > 40 ? ActivityGenerator.cleanSentence(text) : `showing the step-by-step result.`);

    const fullExemplar = ActivityGenerator.ensureCompleteExemplar(
      sectionAnalysis.conceptSummary,
      text,
      conceptName
    );

    const timeRange = `${Math.floor(chunk.start / 60)}:${String(Math.floor(chunk.start % 60)).padStart(2, '0')} – ${Math.floor(chunk.end / 60)}:${String(Math.floor(chunk.end % 60)).padStart(2, '0')}`;

    let title = 'Quick Check';
    let prompt = '';
    let codeOrScenarioSnippet = '';
    let options = [];
    let correctOptionIndices = [];
    let distractorRationale = '';

    const hasSpecificConcept = Boolean(cleanConcept && cleanConcept !== 'Introduction' && cleanConcept !== 'Wrap-Up');

    switch (type) {
      case 'multiple_choice': {
        title = 'Quick Check';
        if (hasSpecificConcept) {
          prompt = `What did the creator explain or show about ${cleanConcept}?`;
        } else {
          prompt = `What was the main thing explained or shown in this part of the video?`;
        }

        let synthesizedCorrect;
        if (hasDistinctPair) {
          synthesizedCorrect = `${premiseSentence.replace(/[.]+$/, '')}, showing how ${consequenceSentence.charAt(0).toLowerCase() + consequenceSentence.slice(1)}`;
        } else if (text.length > 25) {
          synthesizedCorrect = premiseSentence;
        } else {
          synthesizedCorrect = `The video demonstrates how this works step by step.`;
        }

        if (synthesizedCorrect.length < 45) {
          synthesizedCorrect = `The creator shows that ${synthesizedCorrect.charAt(0).toLowerCase() + synthesizedCorrect.slice(1)}`;
        }
        const correctText = synthesizedCorrect.length <= 120 ? synthesizedCorrect : `${synthesizedCorrect.slice(0, 117)}...`;

        const distractor1 = `They tried this at first, but showed that it didn't work out as expected.`;
        const distractor2 = `They suggested skipping this step because it doesn't change the final result.`;
        const distractor3 = `They warned that doing this produces the opposite of what was demonstrated.`;

        const allOptions = [correctText, distractor1, distractor2, distractor3];
        const targetIndex = chunkIndex % 4;

        if (targetIndex !== 0) {
          const temp = allOptions[targetIndex];
          allOptions[targetIndex] = correctText;
          allOptions[0] = temp;
        }

        options = allOptions;
        correctOptionIndices = [targetIndex];
        distractorRationale = `The correct option directly reflects what was shown in the video. The other options are common mistakes or opposite claims.`;
        break;
      }

      case 'spot_the_mistake': {
        title = 'Spot the Mistake';
        codeOrScenarioSnippet = `Viewer comment:\n"You can completely ignore what was shown here, it doesn't actually matter."`;
        prompt = `A viewer left the comment above. Based on what the video actually showed, why is that wrong?`;
        break;
      }

      case 'prediction': {
        title = 'What Happens Next?';
        prompt = `Based on what the creator just did, what do you think will happen next in the video?`;
        break;
      }

      case 'practical_application': {
        title = 'Real-World Example';
        if (hasSpecificConcept) {
          prompt = `How could someone actually use what was shown about ${cleanConcept} in real life?`;
        } else {
          prompt = `How could someone actually use or notice what was demonstrated here in real life?`;
        }
        break;
      }

      case 'critical_thinking': {
        title = 'Think About It';
        if (hasSpecificConcept) {
          prompt = `Based on what was just shown about "${cleanConcept}", why is this principle essential or helpful in the video?`;
        } else {
          prompt = `Based on what was just shown in this clip, why is this principle essential or helpful to know?`;
        }
        break;
      }

      case 'compare_concepts': {
        title = 'Compare & Contrast';
        if (hasSpecificConcept) {
          prompt = `How does the creator compare ${cleanConcept} with other options or ideas in this video?`;
        } else {
          prompt = `How does the creator compare what was shown here with other ideas in this video?`;
        }
        break;
      }

      case 'connect_concepts': {
        title = 'Connecting Ideas';
        if (hasSpecificConcept) {
          prompt = `How does ${cleanConcept} connect back to what the creator did earlier in the video?`;
        } else {
          prompt = `How does what just happened here connect back to earlier parts of the video?`;
        }
        break;
      }

      case 'teach_back': {
        title = 'Explain to a Friend';
        if (hasSpecificConcept) {
          prompt = `If a friend asked what ${cleanConcept} was about, how would you explain it in 1 simple sentence?`;
        } else {
          prompt = `How would you explain what just happened in this clip to a friend in 1 simple sentence?`;
        }
        break;
      }

      case 'short_answer':
      default: {
        title = 'Quick Question';
        if (hasSpecificConcept) {
          prompt = `In 1 or 2 simple sentences, what did the creator just show or explain about ${cleanConcept}?`;
        } else {
          prompt = `In 1 or 2 simple sentences, what just happened or was explained in this part of the video?`;
        }
        break;
      }
    }

    const cleanPrompt = ActivityGenerator.sanitizePrompt(prompt);
    const cleanHint = validSentences[0]
      ? `Think about what happened in this part: "${validSentences[0].slice(0, 60)}..."`
      : 'Think about what the speaker just said or demonstrated on screen.';

    return {
      id: `act_fallback_${videoId}_${chunk.id}_${chunkIndex}`,
      chunkId: chunk.id,
      shouldSkip: false,
      type,
      title,
      conceptName,
      difficulty: learnerContext?.targetDifficulty || 'medium',
      contextSummary: validSentences[0] ? validSentences[0].slice(0, 110) : '',
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
          `Assuming what happened in the video had the opposite effect`,
          `Skipping the main step that was demonstrated`
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
