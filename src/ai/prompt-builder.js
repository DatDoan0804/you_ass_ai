/**
 * @fileoverview Prompt Builder & Structured JSON Schemas (`prompt-builder.js`)
 *
 * Updates for New Improvements 2 & 3:
 * 1. Issue 3 (Significantly Improve Question Quality & Difficulty):
 *    - Enforces **Multi-Piece Synthesis, Inference & Detail Attention** in `buildActivityGenerationPrompt`:
 *      * Questions must require connecting at least TWO distinct facts/mechanisms from the video segment
 *        (e.g., linking a condition/setup in the first part of the segment to its consequence/behavior in the second part).
 *      * Questions must test genuine comprehension, cause-and-effect reasoning, edge-case inference, or practical application—
 *        NEVER simple sentence recognition or obvious recall.
 *      * For `multiple_choice` questions, all 3 incorrect distractors MUST be highly plausible domain misconceptions
 *        (e.g. reversing cause and effect, applying a rule without its boundary condition, or confusing two closely related terms from the segment).
 * 2. Issue 2 (Simplify Explanations for Multiple-Choice Questions):
 *    - Added `conciseMcExplanation` to `SCHEMAS.ANSWER_EVALUATION` (`whyCorrect`, `whyOthersIncorrect`, `coreConceptTakeaway`)
 *      so ABCD multiple-choice questions receive a crisp, high-signal explanation of why the correct option works
 *      and what misconception the distractors represent, without bloated per-option essays.
 */

export const SCHEMAS = {
  VIDEO_CLASSIFICATION: {
    type: 'OBJECT',
    properties: {
      category: {
        type: 'STRING',
        description: 'Educational | Informational | Entertainment | Mixed'
      },
      educationalValue: {
        type: 'INTEGER',
        description: 'Score from 0 to 100 indicating educational/learning value.'
      },
      confidence: {
        type: 'NUMBER',
        description: 'Confidence score from 0.0 to 1.0.'
      },
      reasoning: {
        type: 'STRING',
        description: 'Short explanation of why the video received this classification based on its title, description, chapters, and transcript.'
      },
      learningPotential: {
        type: 'STRING',
        description: 'What useful knowledge, concepts, or skills a viewer could gain, or "Minimal/None — primarily entertainment" if low value.'
      },
      shouldActivateLearning: {
        type: 'BOOLEAN',
        description: 'True if educationalValue >= 35 (Educational, Informational, or Mixed with substantive teaching sections).'
      },
      educationalChunkIds: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'For Mixed videos, the list of chunk IDs (e.g. ["chunk_1", "chunk_2"]) that contain substantive educational content.'
      }
    },
    required: [
      'category',
      'educationalValue',
      'confidence',
      'reasoning',
      'learningPotential',
      'shouldActivateLearning',
      'educationalChunkIds'
    ]
  },

  SECTION_ANALYSIS: {
    type: 'OBJECT',
    properties: {
      shouldGenerateActivity: {
        type: 'BOOLEAN',
        description: 'True only if the transcript chunk contains substantive educational content worth reinforcing.'
      },
      skipReason: {
        type: 'STRING',
        description: 'If shouldGenerateActivity is false, explain why (e.g. intro/sponsor/entertainment banter/insufficient detail).'
      },
      subjectCategory: {
        type: 'STRING',
        description: 'programming | computer_science | science | math | language | history | interview | general'
      },
      conceptName: {
        type: 'STRING',
        description: 'Concise name of the core concept explained in this chunk.'
      },
      conceptSummary: {
        type: 'STRING',
        description: '2-3 sentence summary of what was explicitly taught in the transcript chunk.'
      },
      recommendedBreakpointTime: {
        type: 'NUMBER',
        description: 'Exact timestamp in seconds (chosen from the provided cue end times) where the video should pause.'
      },
      breakpointStrength: {
        type: 'STRING',
        description: 'strong | normal | optional'
      },
      recommendedActivityType: {
        type: 'STRING',
        description: 'multiple_choice | short_answer | teach_back | prediction | critical_thinking | spot_the_mistake | practical_application | connect_concepts | compare_concepts'
      },
      isPredictionOpportunity: {
        type: 'BOOLEAN',
        description: 'True if the instructor sets up an experiment, code execution, or problem whose outcome is revealed at the end of this chunk or in the upcoming cues.'
      },
      predictionPauseTimestamp: {
        type: 'NUMBER',
        description: 'If isPredictionOpportunity is true, the exact cue end timestamp BEFORE the outcome is revealed.'
      }
    },
    required: [
      'shouldGenerateActivity',
      'subjectCategory',
      'conceptName',
      'conceptSummary',
      'recommendedBreakpointTime',
      'breakpointStrength',
      'recommendedActivityType',
      'isPredictionOpportunity'
    ]
  },

  GENERATED_ACTIVITY: {
    type: 'OBJECT',
    properties: {
      shouldSkip: {
        type: 'BOOLEAN',
        description: 'True if the transcript chunk cannot support a challenging, high-value activity.'
      },
      type: {
        type: 'STRING',
        description: 'multiple_choice | true_false | multiple_select | short_answer | teach_back | prediction | critical_thinking | spot_the_mistake | practical_application | connect_concepts | compare_concepts | writing_exercise | memory_reinforcement'
      },
      title: {
        type: 'STRING',
        description: 'Short engaging badge title (e.g., "Predict the Execution", "Diagnose the Edge Case", "Cause & Effect Synthesis").'
      },
      conceptName: {
        type: 'STRING',
        description: 'The specific concept being tested or reinforced.'
      },
      difficulty: {
        type: 'STRING',
        description: 'easy | medium | hard'
      },
      contextSummary: {
        type: 'STRING',
        description: '1-2 sentence reminder of the setup/context from the segment without giving away the answer.'
      },
      prompt: {
        type: 'STRING',
        description: 'Challenging question requiring the learner to connect multiple pieces of information, infer cause-and-effect, or apply a detail from the transcript.'
      },
      codeOrScenarioSnippet: {
        type: 'STRING',
        description: 'Concrete code snippet, scenario, or subtle flawed claim to analyze.'
      },
      options: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'For multiple_choice: 4 nuanced options where all 3 distractors represent plausible domain misunderstandings (empty array for open-ended types).'
      },
      correctOptionIndices: {
        type: 'ARRAY',
        items: { type: 'INTEGER' },
        description: '0-based index(es) of the correct option(s) for objective questions.'
      },
      distractorRationale: {
        type: 'STRING',
        description: 'For multiple_choice: 1-2 concise sentences explaining why the incorrect options fail (the common misconception they represent).'
      },
      expectedKeyPoints: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: '2-4 specific conceptual relationships or details a strong response must connect.'
      },
      exemplarAnswer: {
        type: 'STRING',
        description: 'Complete, multi-sentence model explanation that synthesizes the connected facts from the transcript (never just a title).'
      },
      hint: {
        type: 'STRING',
        description: 'A subtle nudge pointing to the two facts in the segment that need to be connected, without spoiling the conclusion.'
      }
    },
    required: [
      'shouldSkip',
      'type',
      'title',
      'conceptName',
      'difficulty',
      'contextSummary',
      'prompt',
      'options',
      'correctOptionIndices',
      'expectedKeyPoints',
      'exemplarAnswer',
      'hint'
    ]
  },

  ANSWER_EVALUATION: {
    type: 'OBJECT',
    properties: {
      evaluationMode: {
        type: 'STRING',
        description: 'objective | open_ended'
      },
      isCorrect: {
        type: 'BOOLEAN',
        description: 'Used for objective questions; for open-ended questions, true if understanding is Good or Excellent.'
      },
      qualitativeAssessment: {
        type: 'STRING',
        description: 'For open-ended questions: "Excellent understanding" | "Good understanding" | "Partially demonstrated understanding" | "Needs improvement". For objective: "Correct" | "Partially Correct" | "Incorrect".'
      },
      scoreNormalized: {
        type: 'NUMBER',
        description: 'Score from 0.0 to 1.0 representing conceptual mastery.'
      },
      score: {
        type: 'INTEGER',
        description: 'Score from 0 to 100 representing the quality of the answer.'
      },
      evaluation: {
        type: 'STRING',
        description: '"correct" | "partially_correct" | "incorrect"'
      },
      confidence: {
        type: 'NUMBER',
        description: 'Confidence in the grading from 0.0 to 1.0.'
      },
      correctPoints: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'Key concepts the user correctly identified.'
      },
      missingPoints: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'Important points the user missed.'
      },
      misconceptions: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'Misconceptions present in the answer.'
      },
      suggestedAnswer: {
        type: 'STRING',
        description: 'A concise example of a complete, correct answer.'
      },
      verdictLabel: {
        type: 'STRING',
        description: 'Display label matching qualitativeAssessment (for open-ended) or Correct/Incorrect (for objective).'
      },
      whatWasCorrect: {
        type: 'STRING',
        description: 'Specific aspects of the learner response that were accurate and well-reasoned.'
      },
      missingOrIncorrect: {
        type: 'STRING',
        description: 'Specific missing concepts, imprecise relationships, or misconceptions.'
      },
      misunderstanding: {
        type: 'STRING',
        description: 'Concise diagnosis of any underlying conceptual misconception.'
      },
      feedback: {
        type: 'STRING',
        description: 'Warm, specific tutor explanation evaluating the user answer against the learning material.'
      },
      conciseMcExplanation: {
        type: 'OBJECT',
        description: 'Concise explanation for ABCD multiple-choice questions (Issue 2).',
        properties: {
          whyCorrect: {
            type: 'STRING',
            description: '1-2 concise sentences explaining why the correct answer is right based on the underlying concept.'
          },
          whyOthersIncorrect: {
            type: 'STRING',
            description: '1-2 concise sentences explaining why the other options are wrong without a bloated essay for each option.'
          },
          coreConceptTakeaway: {
            type: 'STRING',
            description: '1-sentence takeaway summarizing the underlying principle.'
          }
        },
        required: ['whyCorrect', 'whyOthersIncorrect', 'coreConceptTakeaway']
      },
      improvedAnswerExample: {
        type: 'STRING',
        description: 'A complete, natural, multi-sentence rewritten answer that directly answers the question, preserves the user’s correct ideas, corrects inaccuracies, and adds missing key concepts.'
      },
      improvedAnswerExplanation: {
        type: 'STRING',
        description: 'Clear explanation of what makes the suggested improved answer stronger and which missing details or misconceptions it fixes.'
      },
      followUpSuggestion: {
        type: 'STRING',
        description: 'Brief follow-up thought experiment or practical tip.'
      },
      rubricScores: {
        type: 'OBJECT',
        properties: {
          factualAccuracy: { type: 'INTEGER', description: 'Score 0 to 5' },
          completeness: { type: 'INTEGER', description: 'Score 0 to 5' },
          reasoning: { type: 'INTEGER', description: 'Score 0 to 5' },
          clarity: { type: 'INTEGER', description: 'Score 0 to 5' }
        },
        required: ['factualAccuracy', 'completeness', 'reasoning', 'clarity']
      },
      criteriaBreakdown: {
        type: 'ARRAY',
        description: 'Detailed assessment for each of the 4 criteria: Accuracy, Completeness, Reasoning, and Clarity.',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Accuracy | Completeness | Reasoning | Clarity' },
            measures: { type: 'STRING', description: 'What this criterion measures.' },
            score: { type: 'INTEGER', description: '0 to 5' },
            assessmentLabel: { type: 'STRING', description: 'Strong | Good | Partial | Needs Improvement' },
            whatUserDidWell: { type: 'STRING', description: 'Specific strength in this criterion.' },
            whatWasMissingOrIncorrect: { type: 'STRING', description: 'Specific gap or error in this criterion.' },
            specificImprovement: { type: 'STRING', description: 'Actionable step to improve this criterion.' }
          },
          required: [
            'name',
            'measures',
            'score',
            'assessmentLabel',
            'whatUserDidWell',
            'whatWasMissingOrIncorrect',
            'specificImprovement'
          ]
        }
      },
      overallFeedback: {
        type: 'OBJECT',
        properties: {
          overallEvaluation: { type: 'STRING', description: 'Concise overall synthesis of the response.' },
          mostImportantStrength: { type: 'STRING', description: 'The single strongest aspect of the learner response.' },
          mostImportantWeakness: { type: 'STRING', description: 'The single most important gap or misconception.' },
          singleMostUsefulImprovement: { type: 'STRING', description: 'The single most actionable next step to improve.' }
        },
        required: [
          'overallEvaluation',
          'mostImportantStrength',
          'mostImportantWeakness',
          'singleMostUsefulImprovement'
        ]
      }
    },
    required: [
      'evaluationMode',
      'isCorrect',
      'qualitativeAssessment',
      'scoreNormalized',
      'verdictLabel',
      'whatWasCorrect',
      'missingOrIncorrect',
      'misunderstanding',
      'feedback',
      'improvedAnswerExample',
      'improvedAnswerExplanation',
      'followUpSuggestion',
      'rubricScores',
      'criteriaBreakdown',
      'overallFeedback'
    ]
  },

  CONCEPT_EXPLANATION: {
    type: 'OBJECT',
    properties: {
      conceptName: { type: 'STRING' },
      simpleAnalogy: {
        type: 'STRING',
        description: 'Intuitive real-world analogy explaining the concept.'
      },
      stepByStepBreakdown: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: '3-4 clear bullet points breaking down how it works based on the video.'
      },
      keyTakeaway: {
        type: 'STRING',
        description: 'One-sentence memorable takeaway.'
      }
    },
    required: ['conceptName', 'simpleAnalogy', 'stepByStepBreakdown', 'keyTakeaway']
  }
};

export class PromptBuilder {
  static buildVideoClassificationPrompt({
    videoId,
    videoTitle,
    videoDescription,
    author,
    chapters = [],
    chunks = []
  }) {
    const systemPrompt = `You are an educational content classifier. Analyze the provided YouTube video metadata and transcript excerpts to determine its educational value.
Categories:
- "Educational": Lectures, programming/engineering tutorials, scientific explanations, language lessons, academic documentaries, technical demonstrations that teach transferable concepts or skills.
- "Informational": News analysis, historical overviews, thoughtful interviews, or structured explainers with moderate-to-high learning value.
- "Entertainment": Let's Play gaming videos, roleplay/survival gameplay vlogs, meme compilations, prank videos, music videos, or casual time-wasting streams with little conceptual instruction.
- "Mixed": Videos that blend entertainment/storytelling with distinct educational segments. For Mixed videos, identify the specific chunk IDs in \`educationalChunkIds\` that contain real educational explanations.

Set \`shouldActivateLearning\` to false if \`educationalValue < 35\` or \`category === "Entertainment"\`.`;

    const chapterSummary = (chapters || [])
      .slice(0, 12)
      .map((c) => `[${c.start}s-${c.end}s] ${c.title}`)
      .join('\n');

    const chunkSummary = (chunks || [])
      .slice(0, 8)
      .map((ch) => `${ch.id} (${ch.start}s-${ch.end}s): ${(ch.text || '').slice(0, 180)}`)
      .join('\n');

    const userPrompt = `Video ID: "${videoId}"
Title: "${videoTitle || ''}"
Channel / Author: "${author || ''}"
Description Snippet:
"""
${(videoDescription || '').slice(0, 500)}
"""
Chapters:
${chapterSummary || 'None'}

Transcript Sample Chunks:
${chunkSummary || 'No transcript available'}

Classify this video and return the structured JSON.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.VIDEO_CLASSIFICATION };
  }

  static buildSectionAnalysisPrompt({
    videoTitle,
    videoDescription,
    currentChunkCues,
    upcomingChunkCues,
    previousChunkSummary,
    learnerContext
  }) {
    const recentTypes = (learnerContext?.previousVideoActivities || []).map((a) => a.activityType);

    const systemPrompt = `You are an expert educational architect designing active-learning breakpoints for a YouTube video.
Analyze the timestamped transcript chunk and decide:
1. Whether this section contains substantive educational content worth a learning activity.
2. The exact natural timestamp (in seconds, matching the end of a completed sentence/explanation cue) where the video should pause.
3. Whether there is a "prediction" opportunity right before the instructor reveals a code output, experiment result, or solution.
4. Which activity type best fits the material WITHOUT repeating recent activity types (${JSON.stringify(recentTypes.slice(-3))}).`;

    const formattedCues = (currentChunkCues || [])
      .map((c) => `[${c.start.toFixed(1)}s -> ${c.end.toFixed(1)}s] ${c.text}`)
      .join('\n');

    const formattedUpcoming = (upcomingChunkCues || [])
      .slice(0, 8)
      .map((c) => `[${c.start.toFixed(1)}s -> ${c.end.toFixed(1)}s] ${c.text}`)
      .join('\n');

    const userPrompt = `Video Title: "${videoTitle || 'Untitled Video'}"
Video Description Snippet: "${(videoDescription || '').slice(0, 300)}"
Previous Section Context: ${previousChunkSummary || 'Beginning of video'}
Recently Used Activity Types (DO NOT REPEAT): ${JSON.stringify(recentTypes)}

Current Transcript Section Cues:
${formattedCues}

Immediate Upcoming Cues (Lookahead):
${formattedUpcoming || 'None'}

Analyze this section and output the JSON matching the schema.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.SECTION_ANALYSIS };
  }

  /**
   * Issue 3 Upgrade: Enforces deep cognitive processing, multi-fact synthesis, attention to subtle
   * details, and plausible misconception distractors so passive viewers cannot guess the answer.
   */
  static buildActivityGenerationPrompt({
    videoTitle,
    sectionAnalysis,
    transcriptText,
    upcomingTranscriptText,
    previousChunkSummary,
    learnerContext
  }) {
    const recentQuestions = (learnerContext?.previousVideoActivities || []).map((a) => ({
      type: a.activityType,
      question: a.questionAsked
    }));

    const systemPrompt = `You are a rigorous cognitive scientist and domain-expert AI tutor creating a high-value active-learning challenge for a YouTube viewer.

CORE PEDAGOGICAL PRINCIPLE:
A viewer who watched the segment passively MUST find this question difficult to answer or guess.
A viewer who paid close attention, understood the underlying mechanism, and connected multiple facts from the segment should be rewarded.

STRICT QUESTION QUALITY & DIFFICULTY REQUIREMENTS:
1. TEST UNDERSTANDING & MULTI-FACT SYNTHESIS (NOT SURFACE RECOGNITION):
   - NEVER ask trivial recall questions that merely repeat a single sentence from the video.
   - Require the learner to connect at least TWO pieces of information from the transcript (e.g., how Premise/Mechanism A interacts with Condition/Constraint B, or how the current concept modifies an earlier concept in \`Previous Section Summary\`).
2. REQUIRE REASONING & ATTENTION TO SUBTLE DETAIL:
   - Frame questions around "Why would X happen if Y changed?", "What is the exact causal consequence of...", "Which subtle condition determines whether...", or a concrete mini-scenario/code trace.
   - Target important nuances or boundary conditions mentioned in the transcript that an inattentive viewer would miss.
3. PLAUSIBLE MISCONCEPTION DISTRACTORS (FOR MULTIPLE-CHOICE):
   - When generating \`multiple_choice\` options, NEVER write obviously wrong or silly options.
   - Every incorrect option MUST sound plausible to someone who only half-listened—representing a common misconception, an inverted cause-and-effect relationship, a confusion between two terms in the video, or a rule applied without its required boundary condition.
   - Populate \`distractorRationale\` with 1-2 concise sentences explaining the misconception behind the wrong options.
4. VARIETY & ZERO REPETITION:
   - Do NOT repeat any question or phrasing from \`Recently Asked Activities\`.
   - Ensure \`exemplarAnswer\` is a complete, multi-sentence model explanation synthesizing the connected facts.`;

    const userPrompt = `Video Title: "${videoTitle}"
Subject Category: ${sectionAnalysis.subjectCategory}
Core Concept: ${sectionAnalysis.conceptName}
Concept Summary: ${sectionAnalysis.conceptSummary}
Requested Activity Type: ${sectionAnalysis.recommendedActivityType}
Target Difficulty: ${learnerContext?.targetDifficulty || 'medium'}

Previous Section Summary (Connect to this when relevant):
${previousChunkSummary || 'N/A'}

Recently Asked Activities in This Video (DO NOT REPEAT TYPE OR PHRASING):
${JSON.stringify(recentQuestions)}

Transcript of Section Just Watched:
"""
${transcriptText}
"""

Upcoming Transcript Snippet (for prediction context only — do not spoil!):
"""
${upcomingTranscriptText || 'N/A'}
"""

Generate the high-difficulty, transcript-grounded activity JSON.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.GENERATED_ACTIVITY };
  }

  static buildAnswerEvaluationPrompt({
    videoTitle,
    activity,
    userAnswer,
    transcriptText,
    isObjective = false
  }) {
    const systemPrompt = `You are a supportive, rigorous AI tutor evaluating a learner's response to an active-learning exercise on YouTube.

CRITICAL GRADING RULES:
1. Distinguish between OBJECTIVE questions ("multiple_choice", "true_false", "multiple_select") and OPEN-ENDED writing/explanations:
   - For OBJECTIVE ABCD questions (\`evaluationMode: "objective"\`):
     * Populate \`conciseMcExplanation\` with:
       - \`whyCorrect\`: Briefly explain (1-2 sentences) why the correct answer is right by focusing on the underlying concept rather than repeating the option text verbatim.
       - \`whyOthersIncorrect\`: Briefly explain (1-2 sentences total) why the other answers are incorrect (the misconception they represent) WITHOUT writing a separate lengthy paragraph for every single option.
       - \`coreConceptTakeaway\`: 1 concise sentence summarizing the principle.
   - For OPEN-ENDED questions (\`evaluationMode: "open_ended"\`):
     * Do NOT grade as binary Correct/Incorrect! Accept semantically equivalent explanations written in the user's own words. Set \`qualitativeAssessment\` and \`verdictLabel\` to one of:
       "Excellent understanding" | "Good understanding" | "Partially demonstrated understanding" | "Needs improvement".
     * Evaluate all 4 criteria individually in \`criteriaBreakdown\` (Accuracy, Completeness, Reasoning, Clarity) and populate \`overallFeedback\`.
     * Populate \`improvedAnswerExample\` with a COMPLETE, natural, multi-sentence rewritten answer and \`improvedAnswerExplanation\`.`;

    const userPrompt = `Video Title: "${videoTitle}"
Activity Type: ${activity.type} (Evaluation Mode: ${isObjective ? 'objective' : 'open_ended'})
Concept Tested: ${activity.conceptName}
Activity Prompt: "${activity.prompt}"
${activity.codeOrScenarioSnippet ? `Code / Scenario Snippet:\n${activity.codeOrScenarioSnippet}\n` : ''}
${activity.options?.length ? `Options:\n${activity.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\nCorrect Indices: ${JSON.stringify(activity.correctOptionIndices)}\n` : ''}
Expected Key Points: ${JSON.stringify(activity.expectedKeyPoints || [])}
Reference Model Answer: "${activity.exemplarAnswer || ''}"

Reference Transcript Section:
"""
${transcriptText || activity.contextSummary}
"""

Learner's Submitted Response:
"""
${typeof userAnswer === 'string' ? userAnswer : JSON.stringify(userAnswer)}
"""

Evaluate the learner's response and return the complete structured JSON.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.ANSWER_EVALUATION };
  }

  static buildConceptExplanationPrompt({
    videoTitle,
    conceptName,
    transcriptText,
    userStruggleNote
  }) {
    const systemPrompt = `You are a clear, empathetic teacher. A learner watching a YouTube video requested an alternative explanation of a concept they just encountered.
Break the concept down simply using an intuitive real-world analogy and 3-4 step-by-step points grounded in the video's transcript.`;

    const userPrompt = `Video Title: "${videoTitle}"
Concept to Explain: "${conceptName}"
${userStruggleNote ? `Learner's Question / Confusion: "${userStruggleNote}"` : ''}

Transcript Context:
"""
${transcriptText}
"""

Return the structured explanation JSON.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.CONCEPT_EXPLANATION };
  }
}
