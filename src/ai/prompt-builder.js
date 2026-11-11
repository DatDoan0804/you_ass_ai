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
      },
      transcriptVerification: {
        type: 'STRING',
        description: 'Exact quote or factual reference from the transcript proving this question is strictly within the video scope.'
      },
      inScopeValidation: {
        type: 'BOOLEAN',
        description: 'True if the question is answerable purely from the video transcript without requiring outside domain knowledge.'
      },
      gradingRubric: {
        type: 'OBJECT',
        description: 'Question-specific grading criteria generated alongside the question.',
        properties: {
          essentialPoints: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Core concepts, mechanisms, or causal relationships required for full credit.'
          },
          acceptableAlternatives: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Acceptable alternative phrasings, equivalent terminology, or valid analogies.'
          },
          commonMisconceptions: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Common misunderstandings or invalid assumptions to detect.'
          }
        },
        required: ['essentialPoints', 'acceptableAlternatives', 'commonMisconceptions']
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
      'hint',
      'transcriptVerification',
      'inScopeValidation',
      'gradingRubric'
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
      'score',
      'evaluation',
      'confidence',
      'correctPoints',
      'missingPoints',
      'misconceptions',
      'suggestedAnswer',
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
  },

  TUTOR_FOLLOW_UP: {
    type: 'OBJECT',
    properties: {
      directAnswer: {
        type: 'STRING',
        description: 'Empathetic, clear, 2-3 sentence answer directly addressing the learner’s question, grounded strictly in the video transcript and the concept.'
      },
      transcriptGrounding: {
        type: 'STRING',
        description: 'Direct quote or reference to the video segment supporting this explanation.'
      },
      keyInsight: {
        type: 'STRING',
        description: 'One-sentence memorable takeaway reinforcing the underlying principle.'
      }
    },
    required: ['directAnswer', 'transcriptGrounding', 'keyInsight']
  },

  MILESTONE_TITLE_SYNTHESIS: {
    type: 'OBJECT',
    properties: {
      milestoneTitle: {
        type: 'STRING',
        description: 'A concise, natural 2-5 word pedagogical milestone title encompassing the merged concepts (e.g. "Foundational Greetings & Responses", "State Mutation & Lifecycle").'
      },
      synthesisReasoning: {
        type: 'STRING',
        description: 'Brief reason why these concepts combine into this milestone.'
      }
    },
    required: ['milestoneTitle']
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
4. Which activity type best fits the material WITHOUT repeating recent activity types (${JSON.stringify(recentTypes.slice(-3))}).

STRICT SCOPE CONSTRAINTS:
- Ground all concepts EXCLUSIVELY in what is explicitly taught or demonstrated in the provided transcript cues.
- Do NOT introduce unrelated knowledge from the general domain.
- If a concept is only mentioned in passing without explanation, set shouldGenerateActivity to false.`;

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

ADAPTIVE DIFFICULTY & LEARNER LEVEL CALIBRATION:
- Target Difficulty: "${learnerContext?.targetDifficulty || 'medium'}"
- Learner Level: "${learnerContext?.learnerLevel || 'intermediate'}"
- Calibration Directives:
  * If difficulty is "easy" or learnerLevel is "beginner":
    - Provide clear pedagogical scaffolding and framing in the prompt.
    - Focus directly on the primary cause-and-effect or core mechanism from the segment.
    - Multiple-choice distractors must represent common single-step misunderstandings without overly convoluted edge cases.
    - The hint should offer a concrete, supportive clue.
  * If difficulty is "medium" or learnerLevel is "intermediate":
    - Require synthesizing two distinct mechanisms or connecting a premise with its consequence.
    - Distractors should represent plausible domain misconceptions (e.g. inverted sequence, omitting a condition).
  * If difficulty is "hard" or learnerLevel is "advanced":
    - Test edge cases, boundary conditions, subtle trade-offs, or counter-intuitive implications explained in the segment.
    - Distractors should be highly sophisticated, plausible misunderstandings that trap passive viewers who do not understand the exact nuances.

STRICT VIDEO SCOPE CONSTRAINTS:
1. PURE TRANSCRIPT GROUNDING:
   - The question, choices, and expected answer MUST be grounded entirely in what is explicitly taught, explained, or demonstrated in the provided transcript segment.
   - Do NOT introduce concepts, methods, or terms outside the video's scope, even if related to the general subject.
   - If a concept is mentioned in passing without explanation, do NOT test it.
   - Populate \`transcriptVerification\` with the exact sentence or factual statement from the transcript that directly answers the question.
   - Set \`inScopeValidation: true\` to certify the question requires zero outside knowledge.

MULTIPLE-CHOICE QUALITY & DISTRACTOR BALANCE:
1. BALANCED OPTIONS:
   - Provide exactly 4 options. All options must have approximately the same difficulty, length (within 15-20%), and grammatical structure.
   - The correct option must NOT consistently be the longest or most detailed choice.
2. PLAUSIBLE MISCONCEPTIONS (NO ODD-ONE-OUT):
   - All options must belong to the exact same conceptual category.
   - Every incorrect option must represent a realistic, plausible domain misconception (e.g., reversed cause and effect, missing boundary condition, or term confusion from the segment).
   - NEVER write obviously unrelated, absurd, or silly options.
   - Populate \`distractorRationale\` explaining the misconception behind the distractors.

QUESTION SPECIFIC GRADING RUBRIC:
- Populate \`gradingRubric\` with \`essentialPoints\` (2-4 core mechanisms required for full credit), \`acceptableAlternatives\` (valid alternative phrasings), and \`commonMisconceptions\` (flaws indicating lack of understanding).

NATURAL, FEASTABLE QUESTION FORMULATION:
- The question prompt MUST be clear, natural, and directly understandable to a human learner.
- NEVER use repetitive robotic prefixes (such as repeatedly prepending "Synthesizing the concepts of...").
- NEVER link a concept, chapter title, or quote to itself (no tautological statements like "links X to X").
- Keep sentences concise, grammatically sound, and focused on what was actually explained.`;

    const userPrompt = `Video Title: "${videoTitle}"
Subject Category: ${sectionAnalysis.subjectCategory}
Core Concept: ${sectionAnalysis.conceptName}
Concept Summary: ${sectionAnalysis.conceptSummary}
Requested Activity Type: ${sectionAnalysis.recommendedActivityType}
Target Difficulty: ${learnerContext?.targetDifficulty || 'medium'}
Learner Level: ${learnerContext?.learnerLevel || 'intermediate'}
${learnerContext?.strugglingConcepts?.length ? `Learner Known Struggles / Past Misunderstandings (address or reinforce if relevant):
${JSON.stringify(learnerContext.strugglingConcepts.map((c) => ({ concept: c.name, struggle: c.lastMisunderstanding || 'needs practice' })))}` : ''}
${learnerContext?.strongConcepts?.length ? `Learner Mastered Concepts: ${learnerContext.strongConcepts.map((c) => c.name).join(', ')}` : ''}

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
1. SEMANTIC EVALUATION (MEANING OVER WORDING):
   - Evaluate what the user actually understands, not whether their wording matches predefined text.
   - Do NOT penalize for: alternative but equivalent phrasing, different sentence structure, concise vs lengthy explanations, minor grammar/spelling errors, or equivalent terminology.
   - Do NOT accept an answer merely because it contains relevant keywords if the actual meaning is flawed or superficial.
   - Ground grading strictly in what was taught in the video; do not penalize for omitting outside knowledge.

2. NUMERICAL SCORING (0 to 100) & PARTIAL CREDIT:
   - Provide an integer score from 0 to 100:
     * 90–100: Full credit — demonstrates clear, complete conceptual understanding.
     * 65–89: High partial credit — core mechanism understood with minor omissions or slight imprecision.
     * 40–64: Moderate partial credit — partial understanding shown, but misses key elements or causal links.
     * 10–39: Low credit — significant omissions or fundamental misconceptions.
     * 0–9: Zero credit — completely irrelevant, contradictory, or empty response.
   - Set \`evaluation\` to "correct" (score >= 65), "partially_correct" (score 40-64), or "incorrect" (score < 40).
   - In \`correctPoints\`: list specific concepts the user accurately identified.
   - In \`missingPoints\`: list specific missing concepts, conditions, or consequences.
   - In \`misconceptions\`: list any flawed reasoning or misconceptions present.
   - In \`suggestedAnswer\`: provide a concise, high-quality complete answer grounded in the video.

3. Distinguish between OBJECTIVE questions ("multiple_choice", "true_false", "multiple_select") and OPEN-ENDED writing/explanations:
   - For OBJECTIVE ABCD questions (\`evaluationMode: "objective"\`):
     * Populate \`conciseMcExplanation\` with:
       - \`whyCorrect\`: Briefly explain (1-2 sentences) why the correct answer is right focusing on the underlying concept.
       - \`whyOthersIncorrect\`: Briefly explain (1-2 sentences total) why the other options are wrong (the misconception they represent).
       - \`coreConceptTakeaway\`: 1 concise sentence summarizing the principle.
   - For OPEN-ENDED questions (\`evaluationMode: "open_ended"\`):
     * Set \`qualitativeAssessment\` to one of: "Excellent understanding" | "Good understanding" | "Partially demonstrated understanding" | "Needs improvement".
     * Evaluate all 4 criteria in \`criteriaBreakdown\` (Accuracy, Completeness, Reasoning, Clarity) and populate \`overallFeedback\`.
     * Populate \`improvedAnswerExample\` with a complete rewritten model answer and \`improvedAnswerExplanation\`.`;

    const userPrompt = `Video Title: "${videoTitle}"
Activity Type: ${activity.type} (Evaluation Mode: ${isObjective ? 'objective' : 'open_ended'})
Concept Tested: ${activity.conceptName}
Activity Prompt: "${activity.prompt}"
${activity.codeOrScenarioSnippet ? `Code / Scenario Snippet:\n${activity.codeOrScenarioSnippet}\n` : ''}
${activity.options?.length ? `Options:\n${activity.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\nCorrect Indices: ${JSON.stringify(activity.correctOptionIndices)}\n` : ''}
Grading Rubric: ${JSON.stringify(activity.gradingRubric || { essentialPoints: activity.expectedKeyPoints || [], acceptableAlternatives: [], commonMisconceptions: [] })}
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

Evaluate the learner's response semantically and return the structured JSON.`;

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

  static buildTutorFollowUpPrompt({
    videoTitle,
    activity,
    userAnswer,
    evaluation,
    userQuestion,
    transcriptText
  }) {
    const systemPrompt = `You are a supportive, insightful personal AI tutor having a one-on-one dialogue with a learner watching a YouTube video.
The learner just completed a learning activity, received grading feedback, and has asked a follow-up question.

RULES:
1. Ground your answer STRICTLY in what is taught in the video transcript and the core concept tested.
2. Directly and empathetically address the learner's question in 2-3 concise sentences.
3. If they ask why an answer choice was wrong or why their answer lost points, reference the transcript and explain the conceptual distinction clearly.
4. If they ask for clarification or real-world application, provide a succinct intuitive explanation grounded in the video's explanation.
5. Provide a direct quote or timestamp reference in \`transcriptGrounding\` supporting your answer.
6. Provide a 1-sentence \`keyInsight\` summarizing the core takeaway.`;

    const userPrompt = `Video Title: "${videoTitle}"
Concept Tested: "${activity?.conceptName || 'Core Concept'}"
Activity Question: "${activity?.prompt || ''}"
${activity?.options?.length ? `Multiple-Choice Options:\n${activity.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\n` : ''}
Learner's Submitted Answer: "${typeof userAnswer === 'string' ? userAnswer : JSON.stringify(userAnswer)}"
Grading Evaluation / Score: Score ${evaluation?.score ?? 'N/A'}/100 (${evaluation?.evaluation || evaluation?.verdictLabel || 'Evaluated'})
Tutor Feedback Given: "${evaluation?.feedback || evaluation?.suggestedAnswer || ''}"

Relevant Transcript Section:
"""
${transcriptText || activity?.transcriptExcerpt || activity?.contextSummary || ''}
"""

Learner's Follow-Up Question:
"${userQuestion}"

Provide your structured tutor follow-up response JSON.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.TUTOR_FOLLOW_UP };
  }

  static buildSynthesizeMilestonePrompt({
    videoTitle,
    conceptNames = [],
    mergedSummary = ''
  }) {
    const systemPrompt = `You are an expert curriculum designer. Multiple learning checkpoints or chapter topics in a YouTube video occurred close together (within 5 minutes) and have been merged into a single milestone.
Synthesize a concise, natural, 2-5 word pedagogical milestone title that captures the collective theme of these concepts (e.g. "Essential Greetings & Introductions", "Variable Lifecycle & Scope", "Reactive State Management").
Do NOT use clumsy punctuation or concatenate titles with '&'. Formulate a clean, natural curriculum milestone title.`;

    const userPrompt = `Video Title: "${videoTitle}"
Merged Concepts:
${conceptNames.map((n) => `- ${n}`).join('\n')}

Merged Summary Context:
"""
${mergedSummary}
"""

Output the structured JSON with milestoneTitle and synthesisReasoning.`;

    return { systemPrompt, userPrompt, schema: SCHEMAS.MILESTONE_TITLE_SYNTHESIS };
  }
}
