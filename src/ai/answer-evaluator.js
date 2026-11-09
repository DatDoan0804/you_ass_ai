/**
 * @fileoverview AI Tutor Answer Evaluator (`answer-evaluator.js`)
 *
 * Updates for New Improvement 2 (Simplify Explanations for Multiple-Choice Questions):
 * - When `AnswerEvaluator.isObjectiveActivity(activity)` is true (`multiple_choice`, `true_false`, `multiple_select`):
 *   Generates a concise, focused `conciseMcExplanation` object containing:
 *   1. `whyCorrect`: 1–2 sentences explaining why the correct option is right, focusing on the underlying concept rather than repeating the option text.
 *   2. `whyOthersIncorrect`: 1–2 sentences explaining why the other options are wrong (the misconception they represent) without a separate lengthy essay for every option.
 *   3. `coreConceptTakeaway`: 1 concise takeaway sentence.
 * - Preserves the full 4-criterion breakdown (`Accuracy`, `Completeness`, `Reasoning`, `Clarity`) and
 *   complete rewritten `improvedAnswerExample` for all open-ended reasoning/writing exercises.
 */

import { PromptBuilder } from './prompt-builder.js';

export const OBJECTIVE_ACTIVITY_TYPES = new Set([
  'multiple_choice',
  'true_false',
  'multiple_select'
]);

const SYNONYM_EQUIVALENTS = [
  ['parameter', 'parameters', 'placeholder', 'placeholders', 'input', 'inputs', 'variable', 'variables', 'signature'],
  ['argument', 'arguments', 'value', 'values', 'passed', 'invocation', 'called', 'calling', 'invoke', 'supplied'],
  ['return', 'returns', 'returned', 'output', 'outputs', 'result', 'sends', 'back', 'stops', 'terminates', 'exits'],
  ['reusable', 'reuse', 'modular', 'avoid', 'prevent', 'repetition', 'duplicate', 'duplication', 'block'],
  ['cause', 'causes', 'because', 'therefore', 'consequence', 'effect', 'results', 'leads', 'triggers'],
  ['closure', 'closures', 'lexical', 'scope', 'outer', 'inner', 'environment', 'retains']
];

export class AnswerEvaluator {
  /**
   * @param {(action: string, payload: object) => Promise<any>} sendBackgroundRequest
   */
  constructor(sendBackgroundRequest) {
    this.sendBackgroundRequest = sendBackgroundRequest;
  }

  static isObjectiveActivity(activity) {
    if (!activity) return false;
    return (
      OBJECTIVE_ACTIVITY_TYPES.has(activity.type) &&
      Array.isArray(activity.options) &&
      activity.options.length > 0 &&
      Array.isArray(activity.correctOptionIndices) &&
      activity.correctOptionIndices.length > 0
    );
  }

  async evaluate({
    videoId,
    sessionEpoch,
    videoTitle,
    activity,
    userAnswer,
    allowOfflineFallback = true
  }) {
    if (!activity) {
      throw new Error('Cannot evaluate answer: missing activity context.');
    }

    if (
      userAnswer === null ||
      userAnswer === undefined ||
      (typeof userAnswer === 'string' && !userAnswer.trim()) ||
      (Array.isArray(userAnswer) && userAnswer.length === 0)
    ) {
      throw new Error('Please enter or select an answer before submitting.');
    }

    const isObjective = AnswerEvaluator.isObjectiveActivity(activity);

    // 1. Objective ABCD / True-False evaluation -> Fast, concise conceptual explanation (Issue 2)
    if (isObjective) {
      return AnswerEvaluator.evaluateObjectiveQuestion(activity, userAnswer);
    }

    // 2. Open-ended tutor evaluation via AI
    const promptSpec = PromptBuilder.buildAnswerEvaluationPrompt({
      videoTitle: videoTitle || 'YouTube Educational Video',
      activity,
      userAnswer,
      transcriptText: activity.transcriptExcerpt || activity.contextSummary || '',
      isObjective: false
    });

    try {
      const response = await this.sendBackgroundRequest('AI_EVALUATE_ANSWER', {
        videoId,
        sessionEpoch,
        promptSpec
      });

      if (response && response.ok && response.data) {
        return AnswerEvaluator.normalizeEvaluationResult(response.data, activity, userAnswer, false);
      }

      if (response && !response.ok) {
        const apiErrorMessage = response.error || 'AI grading service returned an error.';
        const isUnconfiguredLocal =
          response.code === 'MISSING_API_KEY' ||
          /MISSING_API_KEY|Background runtime unavailable/i.test(apiErrorMessage);

        if (
          !allowOfflineFallback ||
          (!isUnconfiguredLocal && /API Error|500|503|429|Failed|Network|Simulated/i.test(apiErrorMessage))
        ) {
          throw new Error(apiErrorMessage);
        }
      }
    } catch (err) {
      const apiErrorMessage = err.message || String(err);
      const isUnconfiguredLocal =
        err.code === 'MISSING_API_KEY' ||
        /MISSING_API_KEY|Background runtime unavailable/i.test(apiErrorMessage);

      if (
        !allowOfflineFallback ||
        (!isUnconfiguredLocal && /API Error|500|503|429|Failed|Network|Simulated/i.test(apiErrorMessage))
      ) {
        throw err;
      }
      console.warn('[YT-Learn AnswerEvaluator] Falling back to local semantic tutor grading:', apiErrorMessage);
    }

    // 3. Semantic local open-ended evaluation
    return AnswerEvaluator.evaluateOpenEndedFallback(activity, userAnswer);
  }

  static normalizeEvaluationResult(raw, activity = {}, userAnswer = '', isObjective = false) {
    const scoreNormalized = Math.max(
      0,
      Math.min(1, Number(raw?.scoreNormalized ?? (raw?.isCorrect ? 0.88 : 0.45)))
    );
    const scorePercent = Math.round(scoreNormalized * 100);
    const evaluationMode = isObjective ? 'objective' : 'open_ended';

    let qualitativeAssessment = '';
    let verdictStatus = '';

    if (isObjective) {
      if (scoreNormalized >= 0.85) {
        qualitativeAssessment = 'Correct';
        verdictStatus = 'correct';
      } else if (scoreNormalized >= 0.4) {
        qualitativeAssessment = 'Partially Correct';
        verdictStatus = 'partially_correct';
      } else {
        qualitativeAssessment = 'Incorrect';
        verdictStatus = 'incorrect';
      }
    } else {
      if (scoreNormalized >= 0.85) {
        qualitativeAssessment = 'Excellent understanding';
        verdictStatus = 'excellent_understanding';
      } else if (scoreNormalized >= 0.65) {
        qualitativeAssessment = 'Good understanding';
        verdictStatus = 'good_understanding';
      } else if (scoreNormalized >= 0.4) {
        qualitativeAssessment = 'Partially demonstrated understanding';
        verdictStatus = 'partial_understanding';
      } else {
        qualitativeAssessment = 'Needs improvement';
        verdictStatus = 'needs_improvement';
      }
    }

    const r = raw?.rubricScores || {};
    const defaultRubricVal = Math.max(1, Math.round(scoreNormalized * 5));
    const rubricScores = {
      factualAccuracy: Number.isFinite(r.factualAccuracy) ? r.factualAccuracy : defaultRubricVal,
      completeness: Number.isFinite(r.completeness) ? r.completeness : defaultRubricVal,
      reasoning: Number.isFinite(r.reasoning) ? r.reasoning : defaultRubricVal,
      clarity: Number.isFinite(r.clarity) ? r.clarity : Math.max(2, defaultRubricVal)
    };

    const whatWasCorrect =
      raw?.whatWasCorrect ||
      (scoreNormalized >= 0.4
        ? `You identified key aspects of "${activity.conceptName || 'the section concept'}".`
        : 'You submitted an attempt, which is a good starting point for reviewing this section.');

    const missingOrIncorrect =
      raw?.missingOrIncorrect ||
      (scoreNormalized >= 0.85
        ? 'No major conceptual gaps — all core points were addressed.'
        : `Include the complete mechanism and supporting details for "${activity.conceptName || 'this concept'}".`);

    const improvedAnswerExample = AnswerEvaluator.buildCompleteImprovedAnswer({
      rawImprovedAnswer: raw?.improvedAnswerExample,
      activity,
      userAnswer,
      whatWasCorrect,
      missingOrIncorrect,
      scoreNormalized
    });

    const improvedAnswerExplanation =
      raw?.improvedAnswerExplanation ||
      (scoreNormalized >= 0.85
        ? `This model answer preserves your accurate explanation of "${activity.conceptName || 'the concept'}" while tightening the terminology and causal flow.`
        : `Compared to your original response, this rewritten answer directly addresses the question prompt, incorporates the missing details (${missingOrIncorrect.slice(0, 120)}), and clarifies the exact relationship explained in the video.`);

    const criteriaBreakdown = AnswerEvaluator.ensureFourCriteriaBreakdown(
      raw?.criteriaBreakdown,
      rubricScores,
      activity,
      whatWasCorrect,
      missingOrIncorrect
    );

    const overallFeedback = AnswerEvaluator.ensureOverallFeedback(
      raw?.overallFeedback,
      qualitativeAssessment,
      criteriaBreakdown,
      whatWasCorrect,
      missingOrIncorrect,
      activity
    );

    return {
      evaluationMode,
      isCorrect: scoreNormalized >= 0.65,
      qualitativeAssessment,
      verdictStatus,
      scoreNormalized,
      scorePercent,
      verdictLabel: isObjective
        ? qualitativeAssessment
        : raw?.qualitativeAssessment && !/^(correct|incorrect)$/i.test(raw.qualitativeAssessment)
          ? raw.qualitativeAssessment
          : qualitativeAssessment,
      feedback: raw?.conciseMcExplanation
        ? `${raw.conciseMcExplanation.whyCorrect} ${raw.conciseMcExplanation.whyOthersIncorrect}`
        : overallFeedback.overallEvaluation,
      conciseMcExplanation: raw?.conciseMcExplanation || null,
      whatWasCorrect,
      missingOrIncorrect,
      misunderstanding: raw?.misunderstanding || '',
      improvedAnswerExample,
      improvedAnswerExplanation,
      followUpSuggestion:
        raw?.followUpSuggestion ||
        overallFeedback.singleMostUsefulImprovement,
      rubricScores,
      criteriaBreakdown,
      overallFeedback
    };
  }

  static buildCompleteImprovedAnswer({
    rawImprovedAnswer,
    activity = {},
    userAnswer = '',
    scoreNormalized = 0.5
  }) {
    const candidate = String(rawImprovedAnswer || '').trim();
    const conceptName = String(activity.conceptName || 'this concept').trim();

    const isTitleOnly =
      !candidate ||
      candidate.length < 40 ||
      candidate.toLowerCase() === conceptName.toLowerCase() ||
      /^(chapter\s+\d+|section\s+\d+|suggested improved answer)/i.test(candidate);

    if (!isTitleOnly) {
      return candidate;
    }

    const keyPoints = Array.isArray(activity.expectedKeyPoints)
      ? activity.expectedKeyPoints.filter((kp) => kp && kp.length > 15)
      : [];

    const transcriptSentences = String(activity.transcriptExcerpt || activity.conceptSummary || '')
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    const userText = String(userAnswer || '').trim();
    const userFirstClause =
      scoreNormalized >= 0.45 && userText.length >= 20
        ? `Building on your point ("${userText.slice(0, 90).replace(/[.?!]+$/, '')}"), a complete explanation is: `
        : '';

    if (keyPoints.length >= 2) {
      return `${userFirstClause}${keyPoints.join(' Furthermore, ')}`;
    }

    if (transcriptSentences.length >= 2) {
      return `${userFirstClause}In "${conceptName}", ${transcriptSentences.slice(0, 3).join(' ')}`;
    }

    if (
      activity.exemplarAnswer &&
      activity.exemplarAnswer.length >= 45 &&
      activity.exemplarAnswer.toLowerCase() !== conceptName.toLowerCase()
    ) {
      return `${userFirstClause}${activity.exemplarAnswer}`;
    }

    return `${userFirstClause}To fully answer "${activity.prompt || conceptName}", explain that ${conceptName} provides a structured mechanism where inputs or conditions directly determine the resulting behavior, preventing repetition and ensuring predictable outcomes across the system.`;
  }

  static ensureFourCriteriaBreakdown(
    rawBreakdown,
    rubricScores,
    activity,
    whatWasCorrect,
    missingOrIncorrect
  ) {
    const labelForScore = (s) =>
      s >= 4 ? 'Strong' : s >= 3 ? 'Good' : s >= 2 ? 'Partial' : 'Needs Improvement';

    const concept = activity.conceptName || 'the core concept';

    const defaults = [
      {
        name: 'Accuracy',
        measures: 'Factual correctness and alignment with the concepts explained in the video.',
        score: rubricScores.factualAccuracy,
        assessmentLabel: labelForScore(rubricScores.factualAccuracy),
        whatUserDidWell:
          rubricScores.factualAccuracy >= 4
            ? `You accurately stated the core facts regarding ${concept}.`
            : rubricScores.factualAccuracy >= 2
              ? `Your response contained partially accurate statements about ${concept}, without major contradictions.`
              : `You attempted the question, though the core factual premise of ${concept} was not yet accurate.`,
        whatWasMissingOrIncorrect:
          rubricScores.factualAccuracy >= 4
            ? 'No factual inaccuracies detected.'
            : `Some terminology or relationships regarding ${concept} were imprecise or missing.`,
        specificImprovement:
          rubricScores.factualAccuracy >= 4
            ? `Continue grounding your explanations in the specific terms introduced in the video.`
            : `Verify how ${concept} operates in the transcript excerpt and replace imprecise terms with the exact mechanism shown.`
      },
      {
        name: 'Completeness',
        measures: 'Coverage of all essential points, conditions, and examples required by the question.',
        score: rubricScores.completeness,
        assessmentLabel: labelForScore(rubricScores.completeness),
        whatUserDidWell:
          rubricScores.completeness >= 4
            ? whatWasCorrect
            : rubricScores.completeness >= 2
              ? `You covered the initial idea of ${concept}.`
              : `You provided a brief starting response.`,
        whatWasMissingOrIncorrect:
          rubricScores.completeness >= 4
            ? 'All essential key points from this section were covered.'
            : missingOrIncorrect,
        specificImprovement:
          rubricScores.completeness >= 4
            ? 'Your coverage is thorough—consider adding a brief edge case for even deeper mastery.'
            : `Expand your answer to include the missing details: ${missingOrIncorrect.slice(0, 140)}`
      },
      {
        name: 'Reasoning',
        measures: 'Explanation of cause-and-effect relationships, why the concept works, and how parts connect.',
        score: rubricScores.reasoning,
        assessmentLabel: labelForScore(rubricScores.reasoning),
        whatUserDidWell:
          rubricScores.reasoning >= 4
            ? `You clearly connected the "why" and cause-and-effect logic behind ${concept}.`
            : rubricScores.reasoning >= 2
              ? `You stated what happens in ${concept}, showing initial logical structure.`
              : `Logical cause-and-effect connections were not yet explicit in the answer.`,
        whatWasMissingOrIncorrect:
          rubricScores.reasoning >= 4
            ? 'Logical flow and causal relationships are well-established.'
            : `The cause-and-effect link explaining WHY ${concept} behaves this way was omitted.`,
        specificImprovement:
          rubricScores.reasoning >= 4
            ? `Try predicting how ${concept} would behave if one of its inputs changed.`
            : `Use causal connectors ("because", "therefore", "as a result") to explain how the input or condition in ${concept} produces its outcome.`
      },
      {
        name: 'Clarity',
        measures: 'Readability, organization, and precision of your written explanation.',
        score: rubricScores.clarity,
        assessmentLabel: labelForScore(rubricScores.clarity),
        whatUserDidWell:
          rubricScores.clarity >= 4
            ? 'Your phrasing is clear, direct, and easy to follow.'
            : 'Your sentences are understandable and concise.',
        whatWasMissingOrIncorrect:
          rubricScores.clarity >= 4
            ? 'Expression is clear and well-structured.'
            : 'The explanation was too brief or fragmented to convey the full idea clearly.',
        specificImprovement:
          rubricScores.clarity >= 4
            ? 'Maintain this clear, structured style in future explanations.'
            : 'Write 2–3 complete sentences: first define the concept, then state how it works with a concrete example.'
      }
    ];

    if (Array.isArray(rawBreakdown) && rawBreakdown.length === 4) {
      return rawBreakdown.map((item, idx) => ({
        name: item.name || defaults[idx].name,
        measures: item.measures || defaults[idx].measures,
        score: Number.isFinite(item.score) ? item.score : defaults[idx].score,
        assessmentLabel: item.assessmentLabel || labelForScore(item.score ?? defaults[idx].score),
        whatUserDidWell: item.whatUserDidWell || defaults[idx].whatUserDidWell,
        whatWasMissingOrIncorrect:
          item.whatWasMissingOrIncorrect || defaults[idx].whatWasMissingOrIncorrect,
        specificImprovement: item.specificImprovement || defaults[idx].specificImprovement
      }));
    }

    return defaults;
  }

  static ensureOverallFeedback(
    rawOverall,
    qualitativeAssessment,
    criteriaBreakdown,
    whatWasCorrect,
    missingOrIncorrect,
    activity
  ) {
    if (
      rawOverall &&
      rawOverall.overallEvaluation &&
      rawOverall.mostImportantStrength &&
      rawOverall.mostImportantWeakness &&
      rawOverall.singleMostUsefulImprovement
    ) {
      return rawOverall;
    }

    const sortedByScore = [...criteriaBreakdown].sort((a, b) => b.score - a.score);
    const strongest = sortedByScore[0];
    const weakest = sortedByScore[sortedByScore.length - 1];

    return {
      overallEvaluation: `${qualitativeAssessment}: Your response on "${activity.conceptName || 'this section'}" was strongest in ${strongest.name} (${strongest.score}/5) and has the most room to grow in ${weakest.name} (${weakest.score}/5).`,
      mostImportantStrength: `${strongest.name} — ${whatWasCorrect}`,
      mostImportantWeakness:
        weakest.score >= 4
          ? 'No major weaknesses—only minor opportunities to add extra examples.'
          : `${weakest.name} — ${missingOrIncorrect}`,
      singleMostUsefulImprovement: weakest.specificImprovement
    };
  }

  async explainConceptDifferently({ videoId, sessionEpoch, videoTitle, activity, userQuestion = '' }) {
    const promptSpec = PromptBuilder.buildConceptExplanationPrompt({
      videoTitle,
      conceptName: activity.conceptName,
      transcriptText: activity.transcriptExcerpt || activity.contextSummary,
      userStruggleNote: userQuestion
    });

    try {
      const response = await this.sendBackgroundRequest('AI_EXPLAIN_CONCEPT', {
        videoId,
        sessionEpoch,
        cacheKey: `explain:${videoId}:${activity.chunkId}:${userQuestion.slice(0, 30)}`,
        promptSpec
      });

      if (response && response.ok && response.data) {
        return response.data;
      }
    } catch (err) {
      console.warn('[YT-Learn AnswerEvaluator] Concept explanation fallback:', err.message);
    }

    return {
      conceptName: activity.conceptName || 'Core Concept',
      simpleAnalogy:
        'Think of this section as a building block: the instructor first establishes the setup, then shows how changing one part directly affects the outcome.',
      stepByStepBreakdown:
        activity.expectedKeyPoints && activity.expectedKeyPoints.length > 0
          ? activity.expectedKeyPoints
          : [
            activity.contextSummary || 'Review the key definition introduced at the start of this segment.',
            activity.exemplarAnswer || 'Notice how the example connects back to the main topic of the video.'
          ],
      keyTakeaway:
        activity.exemplarAnswer ||
        activity.conceptSummary ||
        'Focus on the relationship between the core terms.'
    };
  }

  /**
   * Issue 2 Fix: Evaluates objective multiple-choice / multiple-select answers concisely.
   * Instead of generating a bloated essay for every option or repeating option text verbatim,
   * returns `conciseMcExplanation`:
   * - `whyCorrect`: 1–2 sentences explaining why the correct choice is right based on the underlying concept.
   * - `whyOthersIncorrect`: 1–2 sentences summarizing why the distractors fail (the misconception they represent).
   * - `coreConceptTakeaway`: 1 concise conceptual takeaway.
   */
  static evaluateObjectiveQuestion(activity, userAnswer) {
    const selectedIndices = Array.isArray(userAnswer)
      ? userAnswer.map(Number).sort()
      : [Number(userAnswer)];
    const correctIndices = (activity.correctOptionIndices || [0]).map(Number).sort();

    const isExactMatch =
      selectedIndices.length === correctIndices.length &&
      selectedIndices.every((val, idx) => val === correctIndices[idx]);

    const overlapCount = selectedIndices.filter((i) => correctIndices.includes(i)).length;
    const scoreNormalized = isExactMatch ? 1.0 : overlapCount > 0 ? 0.5 : 0.0;

    const correctLetter = correctIndices.map((i) => String.fromCharCode(65 + i)).join(', ');
    const selectedLetter = selectedIndices.map((i) => String.fromCharCode(65 + i)).join(', ');

    const underlyingConcept =
      activity.exemplarAnswer && activity.exemplarAnswer.length <= 220
        ? activity.exemplarAnswer
        : (activity.expectedKeyPoints && activity.expectedKeyPoints[0]) ||
        `In ${activity.conceptName || 'this section'}, the mechanism directly links the initial condition to the resulting state.`;

    const whyCorrect = `Option ${correctLetter} is correct because ${underlyingConcept.charAt(0).toLowerCase() + underlyingConcept.slice(1)}`;

    const whyOthersIncorrect =
      activity.distractorRationale ||
      `The other options are incorrect because they either invert the cause-and-effect relationship in "${activity.conceptName || 'this concept'}" or omit the boundary condition required for execution.`;

    const coreConceptTakeaway =
      (activity.expectedKeyPoints && activity.expectedKeyPoints[activity.expectedKeyPoints.length - 1]) ||
      underlyingConcept;

    return AnswerEvaluator.normalizeEvaluationResult(
      {
        isCorrect: isExactMatch,
        scoreNormalized,
        conciseMcExplanation: {
          whyCorrect,
          whyOthersIncorrect,
          coreConceptTakeaway
        },
        whatWasCorrect: isExactMatch
          ? `Option ${correctLetter} accurately captures the underlying mechanism of ${activity.conceptName}.`
          : overlapCount > 0
            ? `You identified part of the correct answer (${selectedLetter}).`
            : `You selected Option ${selectedLetter}, which reflects a common misconception.`,
        missingOrIncorrect: isExactMatch
          ? 'None!'
          : whyOthersIncorrect,
        misunderstanding: isExactMatch ? '' : whyOthersIncorrect,
        improvedAnswerExample: `${whyCorrect} ${whyOthersIncorrect}`,
        rubricScores: {
          factualAccuracy: isExactMatch ? 5 : overlapCount > 0 ? 3 : 1,
          completeness: isExactMatch ? 5 : overlapCount > 0 ? 3 : 1,
          reasoning: isExactMatch ? 5 : overlapCount > 0 ? 3 : 1,
          clarity: 5
        }
      },
      activity,
      selectedLetter,
      true
    );
  }

  static evaluateOpenEndedFallback(activity, userAnswer) {
    const text = String(userAnswer || '').trim();
    const lowerText = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const stopWords = new Set([
      'the', 'and', 'that', 'this', 'with', 'from', 'what', 'when', 'where', 'which',
      'have', 'will', 'about', 'into', 'your', 'they', 'their', 'there', 'been', 'were',
      'section', 'chapter', 'video', 'instructor', 'explain', 'watched', 'just', 'define',
      'functions', 'function', 'inside', 'values', 'value', 'actual', 'take', 'takes'
    ]);

    const extractTerms = (str) =>
      Array.from(
        new Set(
          String(str || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !stopWords.has(w))
        )
      );

    const areTermsSemanticallyEquivalent = (uw, rw) => {
      if (uw === rw) return true;
      if (uw.length >= 5 && rw.length >= 5 && uw.slice(0, 5) === rw.slice(0, 5)) return true;
      for (const group of SYNONYM_EQUIVALENTS) {
        if (group.includes(uw) && group.includes(rw)) return true;
      }
      return false;
    };

    const userWords = extractTerms(lowerText);
    const referenceSource = `${activity.exemplarAnswer || ''} ${(activity.expectedKeyPoints || []).join(' ')} ${activity.transcriptExcerpt || ''} ${activity.contextSummary || ''}`;
    const refKeywords = extractTerms(referenceSource);

    const matchedKeywords = userWords.filter((uw) =>
      refKeywords.some((rw) => areTermsSemanticallyEquivalent(uw, rw))
    );

    const keyPoints =
      Array.isArray(activity.expectedKeyPoints) && activity.expectedKeyPoints.length > 0
        ? activity.expectedKeyPoints
        : [activity.exemplarAnswer || referenceSource];

    let coveredKeyPoints = 0;
    const missedKeyPointDescriptions = [];

    for (const kp of keyPoints) {
      const kpTerms = extractTerms(kp);
      if (kpTerms.length === 0) continue;
      const hits = kpTerms.filter((kt) =>
        userWords.some((uw) => areTermsSemanticallyEquivalent(uw, kt))
      );
      if (hits.length >= Math.max(1, Math.ceil(kpTerms.length * 0.35))) {
        coveredKeyPoints += 1;
      } else {
        missedKeyPointDescriptions.push(kp);
      }
    }

    const keyPointCoverageRatio =
      keyPoints.length > 0 ? coveredKeyPoints / keyPoints.length : 0;

    const hasCausalReasoning =
      /\b(because|therefore|so that|allows|prevents|when|causes|results in|by passing|sends back|stops)\b/i.test(text);

    const isIDontKnow = /^(i don'?t know|idk|no idea|not sure|none|nothing|skip|test|asdf)$/i.test(text);

    let scoreNormalized = 0.2;
    if (isIDontKnow || wordCount < 3 || matchedKeywords.length === 0) {
      scoreNormalized = 0.15;
    } else if (keyPointCoverageRatio >= 0.75 && wordCount >= 9) {
      scoreNormalized = Math.min(1.0, 0.85 + (hasCausalReasoning ? 0.1 : 0.05));
    } else if (keyPointCoverageRatio >= 0.5 && wordCount >= 8) {
      scoreNormalized = 0.72;
    } else if (keyPointCoverageRatio >= 0.25 || matchedKeywords.length >= 1) {
      scoreNormalized = 0.52;
    } else {
      scoreNormalized = 0.22;
    }

    const accuracyScore =
      scoreNormalized >= 0.8 ? 5 : scoreNormalized >= 0.65 ? 4 : scoreNormalized >= 0.4 ? 3 : 1;
    const completenessScore =
      keyPointCoverageRatio >= 0.8 ? 5 : keyPointCoverageRatio >= 0.55 ? 4 : keyPointCoverageRatio >= 0.3 ? 3 : 1;
    const reasoningScore =
      scoreNormalized >= 0.75 && hasCausalReasoning
        ? 5
        : scoreNormalized >= 0.5
          ? 3
          : 1;
    const clarityScore = wordCount >= 12 ? 5 : wordCount >= 6 ? 4 : 2;

    const whatWasCorrect =
      scoreNormalized >= 0.65
        ? `You demonstrated strong grasp of the core ideas (${matchedKeywords.slice(0, 5).join(', ')}) in your own words.`
        : scoreNormalized >= 0.4
          ? `You correctly identified part of the concept (${matchedKeywords.slice(0, 4).join(', ')}), showing partial understanding of "${activity.conceptName}".`
          : 'Your response did not yet address the specific mechanism or concepts covered in this segment.';

    const missingOrIncorrect =
      scoreNormalized >= 0.85
        ? 'No major concepts missed — your explanation covered the essential points!'
        : `To make your explanation complete, include: ${missedKeyPointDescriptions.join('; ') || 'the full cause-and-effect relationship described in the model answer'}.`;

    return AnswerEvaluator.normalizeEvaluationResult(
      {
        scoreNormalized,
        whatWasCorrect,
        missingOrIncorrect,
        misunderstanding:
          scoreNormalized < 0.4
            ? `The core mechanism of ${activity.conceptName} was omitted or misunderstood.`
            : '',
        rubricScores: {
          factualAccuracy: accuracyScore,
          completeness: completenessScore,
          reasoning: reasoningScore,
          clarity: clarityScore
        }
      },
      activity,
      userAnswer,
      false
    );
  }
}
