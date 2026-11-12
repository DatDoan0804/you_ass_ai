/**
 * Comprehensive Test Suite for YouTube AI Learning Assistant Improvements
 * Tests:
 * 1. Breakpoint Spacing & Concept Merging on Example Video (02KLnAH2bVs)
 * 2. Scope Confinement & Transcript Grounding Validation
 * 3. Multiple-Choice Balance & Distractor Quality
 * 4. AI Answer Grading (9 Scenarios)
 * 5. Marker Hover Detection & Preview Clearance
 * 6. UI Minimization & State Preservation
 */

import assert from 'node:assert';
process.env.NODE_ENV = 'test';
process.env.YT_LEARN_NO_LISTEN = '1';
import { parseVttOrSrt, findInCache } from '../server/subtitle-server.js';
import { BreakpointDetector } from '../src/content/breakpoint-detector.js';
import { PromptBuilder, SCHEMAS } from '../src/ai/prompt-builder.js';
import { ActivityGenerator } from '../src/ai/activity-generator.js';
import { AnswerEvaluator } from '../src/ai/answer-evaluator.js';
import { ContentAnalyzer } from '../src/ai/content-analyzer.js';
import { SubtitleManager } from '../src/content/subtitle-manager.js';
import { Database, DEFAULT_SETTINGS, db } from '../src/storage/database.js';
import { UIManager } from '../src/content/ui-manager.js';
import { VideoController } from '../src/content/video-controller.js';
import { YouTubeLearningAssistantApp } from '../src/content/index.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

async function runAllTests() {
  console.log('=== TEST SUITE: YouTube AI Learning Assistant ===\n');

  // -----------------------------------------------------------------------------
  // 1. BREAKPOINT SPACING & MERGING ON EXAMPLE VIDEO (02KLnAH2bVs)
  // -----------------------------------------------------------------------------
  console.log('1. Breakpoint Frequency & Spacing (5-Minute Minimum Interval)');

  test('Default settings configure 300s (5-minute) minimum interval', () => {
    assert.strictEqual(DEFAULT_SETTINGS.minIntervalSeconds, 300);
    assert.strictEqual(DEFAULT_SETTINGS.maxIntervalSeconds, 600);
    assert.strictEqual(DEFAULT_SETTINGS.breakFrequency, 'medium');
  });

  await testAsync('Database.getSettings migrates legacy sub-300s values to 300s', async () => {
    const mockStorage = {
      'yt_ai_learning_settings': {
        minIntervalSeconds: 90,
        maxIntervalSeconds: 360
      }
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb(mockStorage),
          set: (obj, cb) => {
            Object.assign(mockStorage, obj);
            if (cb) cb();
          }
        }
      }
    };

    const settings = await Database.getSettings();
    assert.strictEqual(settings.minIntervalSeconds, 300);
    assert.strictEqual(settings.maxIntervalSeconds, 600);
  });

  test('Example Video (02KLnAH2bVs, 13:34 duration) reduces 65 chapters down to <= 3 selective breakpoints', () => {
    const detector = new BreakpointDetector();
    const duration = 814; // 13 minutes 34 seconds

    // Real timestamps from YouTube video 02KLnAH2bVs description (65 timestamps)
    const realVideoTimestamps = [
      { title: "Intro", time: 0 },
      { title: "Hello / Hi", time: 26 },
      { title: "What's up", time: 41 },
      { title: "How are you", time: 54 },
      { title: "Good morning", time: 70 },
      { title: "Good afternoon", time: 82 },
      { title: "Good night", time: 94 },
      { title: "Nice to meet you", time: 106 },
      { title: "Please", time: 122 },
      { title: "Thank you", time: 134 },
      { title: "You're welcome", time: 146 },
      { title: "Sorry", time: 158 },
      { title: "Yes", time: 171 },
      { title: "No", time: 182 },
      { title: "Help", time: 195 },
      { title: "Fine", time: 207 },
      { title: "Good", time: 219 },
      { title: "Bad", time: 232 },
      { title: "Happy", time: 244 },
      { title: "Sad", time: 257 },
      { title: "Love", time: 270 },
      { title: "Like", time: 283 },
      { title: "Dislike", time: 295 },
      { title: "Want", time: 308 },
      { title: "Need", time: 320 },
      { title: "Know", time: 333 },
      { title: "Don't know", time: 345 },
      { title: "Understand", time: 358 },
      { title: "Don't understand", time: 370 },
      { title: "Again / Repeat", time: 382 },
      { title: "Slow / Slowly", time: 395 },
      { title: "Who", time: 407 },
      { title: "What", time: 420 },
      { title: "When", time: 432 },
      { title: "Where", time: 445 },
      { title: "Why", time: 457 },
      { title: "How", time: 470 },
      { title: "Which", time: 482 },
      { title: "Name", time: 495 },
      { title: "Deaf", time: 508 },
      { title: "Hard of hearing", time: 520 },
      { title: "Hearing", time: 533 },
      { title: "Sign language", time: 546 },
      { title: "Learn", time: 559 },
      { title: "Practice", time: 572 },
      { title: "Family", time: 585 },
      { title: "Mom / Mother", time: 597 },
      { title: "Dad / Father", time: 610 },
      { title: "Boy", time: 622 },
      { title: "Girl", time: 635 },
      { title: "Friend", time: 647 },
      { title: "Eat / Food", time: 660 },
      { title: "Drink / Water", time: 673 },
      { title: "Bathroom", time: 686 },
      { title: "Go", time: 699 },
      { title: "Come", time: 712 },
      { title: "See / Look", time: 724 },
      { title: "More", time: 737 },
      { title: "Finish / Done", time: 749 },
      { title: "Stop", time: 762 },
      { title: "Wait", time: 774 },
      { title: "Today", time: 787 },
      { title: "Tomorrow", time: 799 },
      { title: "Yesterday", time: 808 },
      { title: "Goodbye", time: 812 }
    ];

    const realVideoChapters = realVideoTimestamps.map((ch, idx) => ({
      index: idx,
      start: ch.time,
      end: realVideoTimestamps[idx + 1] ? realVideoTimestamps[idx + 1].time : duration,
      title: ch.title
    }));

    detector.seedInitialCandidates([], realVideoChapters, duration, '02KLnAH2bVs');
    const scheduled = detector.getAllScheduledBreakpoints();

    console.log(`    Reduced ${realVideoChapters.length} raw timestamps to ${scheduled.length} spaced breakpoints:`);
    scheduled.forEach((c, idx) => {
      const concept = c.activity?.conceptName || c.reason;
      console.log(`      BP #${idx + 1}: ${c.timestamp}s (${Math.floor(c.timestamp / 60)}:${String(Math.floor(c.timestamp % 60)).padStart(2, '0')}) — ${concept}`);
    });

    // Verify: Max 2 or 3 breakpoints for a 13-minute video
    assert.ok(scheduled.length >= 1 && scheduled.length <= 3, `Expected 1 to 3 breakpoints, got ${scheduled.length}`);

    // Verify: Every consecutive interval >= 300 seconds
    for (let i = 0; i < scheduled.length - 1; i++) {
      const interval = scheduled[i + 1].timestamp - scheduled[i].timestamp;
      assert.ok(interval >= 300, `Consecutive interval ${interval}s is less than 300s!`);
    }

    // Verify: First breakpoint is past intro (> 120s)
    assert.ok(scheduled[0].timestamp >= 120, `First breakpoint ${scheduled[0].timestamp}s too early in intro`);

    // Verify: Last breakpoint is not in outro (< duration - 40s)
    assert.ok(scheduled[scheduled.length - 1].timestamp <= duration - 40, 'Last breakpoint is inside outro');

    // Verify: Concept merging occurred
    const firstConcept = scheduled[0].activity?.conceptName || '';
    assert.ok(firstConcept.includes('&') || firstConcept.includes('related') || firstConcept.includes('Chapter'),
      'Closely occurring concepts were merged into composite milestone');
  });

  test('checkPlaybackForBreakpoint strictly enforces >= 300s between triggered activities', () => {
    const detector = new BreakpointDetector();
    const bp1 = { id: 'bp-1', timestamp: 350, source: 'chapter', strength: 'strong', activity: { id: 'act-1' } };
    const bp2 = { id: 'bp-2', timestamp: 420, source: 'chapter', strength: 'strong', activity: { id: 'act-2' } };
    detector.scheduledBreakpoints.set('bp-1', bp1);
    detector.scheduledBreakpoints.set('bp-2', bp2);

    // At 350s, bp1 triggers
    const trigger1 = detector.checkPlaybackForBreakpoint(350.5);
    assert.strictEqual(trigger1?.id, 'bp-1');

    // At 420s (only 70s later), bp2 MUST NOT trigger despite being chapter + strong
    const trigger2 = detector.checkPlaybackForBreakpoint(420.5);
    assert.strictEqual(trigger2, null, 'Must not trigger another activity within 300s!');

    // At 655s (305s later), now ready for next interval
    const bp3 = { id: 'bp-3', timestamp: 660, source: 'semantic', activity: { id: 'act-3' } };
    detector.scheduledBreakpoints.set('bp-3', bp3);
    const trigger3 = detector.checkPlaybackForBreakpoint(660.2);
    assert.strictEqual(trigger3?.id, 'bp-3', 'Triggers when >= 300s has elapsed');
  });

  // -----------------------------------------------------------------------------
  // 2. KEEP QUESTIONS STRICTLY WITHIN VIDEO SCOPE
  // -----------------------------------------------------------------------------
  console.log('\n2. Keep Questions Strictly Within Video Scope');

  test('PromptBuilder schema requires transcriptVerification and inScopeValidation', () => {
    const schema = SCHEMAS.GENERATED_ACTIVITY;
    assert.ok(schema.properties.transcriptVerification, 'Schema includes transcriptVerification');
    assert.ok(schema.properties.inScopeValidation, 'Schema includes inScopeValidation');
    assert.ok(schema.required.includes('transcriptVerification'));
    assert.ok(schema.required.includes('inScopeValidation'));
    assert.ok(schema.required.includes('gradingRubric'));
  });

  test('ActivityGenerator fallback enforces inScopeValidation and transcript grounding', () => {
    const chunk = {
      start: 120,
      end: 420,
      chapterTitle: 'ASL Basic Greetings',
      text: 'In this video we learn how to say hello and thank you in American Sign Language using open palm.'
    };

    const activity = ActivityGenerator.createFallbackActivity({
      videoId: 'test-vid',
      chunk,
      previousChunkSummary: '',
      sectionAnalysis: { recommendedActivityType: 'multiple_choice', conceptName: 'ASL Basics' },
      chunkIndex: 0
    });

    assert.strictEqual(activity.inScopeValidation, true);
    assert.ok(typeof activity.transcriptVerification === 'string' && activity.transcriptVerification.length > 0);
    assert.ok(activity.gradingRubric.essentialPoints.length > 0);
    assert.ok(activity.options.length === 4);
  });

  // -----------------------------------------------------------------------------
  // 3. MULTIPLE-CHOICE QUALITY AND DIFFICULTY BALANCE
  // -----------------------------------------------------------------------------
  console.log('\n3. Multiple-Choice Quality and Difficulty Balance');

  test('Multiple-choice options have balanced length and plausible domain distractors', () => {
    const chunk = {
      start: 420,
      end: 720,
      chapterTitle: 'Variable declaration in JavaScript',
      text: 'A variable allows us to store data with a name and retrieve or change it later during program execution.'
    };

    const activity = ActivityGenerator.createFallbackActivity({
      videoId: 'test-vid',
      chunk,
      previousChunkSummary: '',
      sectionAnalysis: { recommendedActivityType: 'multiple_choice', conceptName: 'Variables' },
      chunkIndex: 1
    });

    const options = activity.options;
    assert.strictEqual(options.length, 4);

    // Check length balance (no option should be 3x longer or shorter than average)
    const avgLen = options.reduce((sum, o) => sum + o.length, 0) / options.length;
    options.forEach((opt, idx) => {
      assert.ok(opt.length >= avgLen * 0.45, `Option ${idx} too short compared to average`);
      assert.ok(opt.length <= avgLen * 1.9, `Option ${idx} too long compared to average`);
    });

    // Verify correct index varies (chunkIndex 1 => index 1)
    assert.strictEqual(activity.correctOptionIndices[0], 1);
  });

  // -----------------------------------------------------------------------------
  // 4. AI-POWERED ANSWER GRADING (9 SCENARIOS)
  // -----------------------------------------------------------------------------
  console.log('\n4. AI-Powered Answer Grading (9 Scenarios)');

  const sampleActivity = {
    id: 'act-test-1',
    type: 'teach_back',
    conceptName: 'JavaScript Variables',
    prompt: 'What is the purpose of a variable in JavaScript?',
    expectedAnswer: 'A variable stores a value under a designated identifier so it can be retrieved and modified later.',
    gradingRubric: {
      essentialPoints: [
        'Stores a value or data in memory',
        'Provides a name or identifier to access the value',
        'Can be referenced, updated, or manipulated later in execution'
      ],
      acceptableAlternatives: [
        'A container or box that holds information for later use',
        'Gives a place to keep information so we can reuse or change it'
      ],
      commonMisconceptions: [
        'Believing a variable makes physical computer hardware larger',
        'Confusing a variable with a permanent database table',
        'Assuming variables can never be changed once declared'
      ]
    }
  };

  await testAsync('Scenario 1: Fully correct answer with different wording/structure -> >= 90 score', async () => {
    const userAnswer = 'It is like a labeled container where we put data so the program can find and reuse it whenever needed.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 90, `Expected score >= 90, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'correct');
    assert.ok(result.correctPoints.length >= 1, 'Identified correct points');
    assert.strictEqual(result.missingPoints.length, 0, 'No missing points');
    assert.ok(result.suggestedAnswer, 'Provides suggested model answer');
  });

  await testAsync('Scenario 2: Partially correct answer -> 50-75 partial credit score', async () => {
    const userAnswer = 'It holds some data in the computer.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 50 && result.score <= 75, `Expected score 50-75, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'partially_correct');
    assert.ok(result.correctPoints.length >= 1, 'Recognized partial understanding');
    assert.ok(result.missingPoints.length >= 1, 'Identified what was missing');
  });

  await testAsync('Scenario 3: Incorrect answer with common misconception -> score < 40 & flags misconception', async () => {
    const userAnswer = 'A variable permanently saves data to an external database server so it never gets lost.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score < 40, `Expected score < 40, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'incorrect');
    assert.ok(result.misconceptions.length > 0 || result.missingPoints.length > 0);
  });

  await testAsync('Scenario 4: Correct answer with minor spelling/grammatical errors -> >= 88 score without language penalty', async () => {
    const userAnswer = 'variabel stor valus in memory so progam can acsess and chnage them letr.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 88, `Expected score >= 88 despite typos, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'correct');
  });

  await testAsync('Scenario 5: Concise answer containing core concept -> high score, no length penalty', async () => {
    const userAnswer = 'Named storage for values to access and update later.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 85, `Expected score >= 85 for concise answer, got ${result.score}`);
  });

  await testAsync('Scenario 6: Verbose answer containing correct idea -> grades meaning, not word count', async () => {
    const userAnswer = 'In programming languages such as JavaScript, when developers are constructing applications, they frequently need an organized mechanism to designate memory space with an identifier name to hold transient state or numerical values so they can subsequently read or modify them during execution.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 90, `Expected score >= 90, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'correct');
  });

  await testAsync('Scenario 7: Alternate valid metaphor/explanation -> recognized as semantically correct', async () => {
    const userAnswer = 'It gives us a place to keep information so we can use it again.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score >= 85, `Expected score >= 85, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'correct');
  });

  await testAsync('Scenario 8: Irrelevant / nonsense answer -> score <= 15', async () => {
    const userAnswer = 'I like watching cartoons on Saturday mornings.';
    const result = await AnswerEvaluator.evaluateOpenEndedFallback(sampleActivity, userAnswer);

    assert.ok(result.score <= 15, `Expected score <= 15, got ${result.score}`);
    assert.strictEqual(result.evaluation, 'incorrect');
  });

  test('Scenario 9: Objective multiple choice questions are evaluated deterministically without external AI call', () => {
    const mcActivity = {
      id: 'mc-1',
      type: 'multiple_choice',
      options: ['Stores data', 'Makes computer larger', 'Changes screen color', 'Plays music'],
      correctOptionIndices: [0]
    };

    const evalCorrect = AnswerEvaluator.evaluateObjectiveQuestion(mcActivity, 0);
    assert.strictEqual(evalCorrect.score, 100);
    assert.strictEqual(evalCorrect.evaluation, 'correct');
    assert.strictEqual(evalCorrect.evaluationMode, 'objective');

    const evalIncorrect = AnswerEvaluator.evaluateObjectiveQuestion(mcActivity, 2);
    assert.strictEqual(evalIncorrect.score, 0);
    assert.strictEqual(evalIncorrect.evaluation, 'incorrect');
  });

  // -----------------------------------------------------------------------------
  // 5. MARKER HOVER DETECTION & PREVIEW CLEARANCE
  // -----------------------------------------------------------------------------
  console.log('\n5. Marker Hover Detection & Preview Clearance');

  test('computeSafePopupBottomOffsetPx calculates safe bottom clearance above YouTube preview', () => {
    const offset = UIManager.computeSafePopupBottomOffsetPx(null);
    assert.strictEqual(offset, 152, 'Default clearance is 152px above progress bar');
  });

  test('computePopupAlignment prevents popups from overflowing screen edges', () => {
    const leftEdge = UIManager.computePopupAlignment(2, 1000, 240);
    assert.strictEqual(leftEdge.alignClass, 'align-left');

    const rightEdge = UIManager.computePopupAlignment(98, 1000, 240);
    assert.strictEqual(rightEdge.alignClass, 'align-right');

    const center = UIManager.computePopupAlignment(50, 1000, 240);
    assert.strictEqual(center.alignClass, 'align-center');
  });

  // -----------------------------------------------------------------------------
  // 6. UI MINIMIZATION & RETRY STATE PRESERVATION
  // -----------------------------------------------------------------------------
  console.log('\n6. UI Minimization & State Preservation');

  test('UIManager minimizes active question without losing user answer', () => {
    // Setup lightweight DOM mock for node environment
    globalThis.document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        className: '',
        id: '',
        style: {},
        setAttribute: () => {},
        addEventListener: () => {},
        appendChild: () => {},
        querySelector: () => null,
        innerHTML: ''
      })
    };

    const mockCallbacks = {
      onSubmitAnswer: async () => ({ score: 100 }),
      onSkipActivity: () => {},
      onContinueWatching: () => {},
      onRequestExplanation: async () => ({}),
      onSaveSettings: async () => {},
      onLoadDashboardData: async () => ({}),
      onManualTriggerActivity: () => {}
    };

    const ui = new UIManager(mockCallbacks);
    ui.rootContainer = { innerHTML: '', appendChild: () => {} };

    // Minimize with user answer
    ui.minimizeActivity(sampleActivity, 'My saved in-progress answer');
    assert.strictEqual(ui.isActivityMinimized, true);
    assert.strictEqual(ui.minimizedActivityData.userAnswer, 'My saved in-progress answer');
    assert.strictEqual(ui.minimizedActivityData.activity.id, sampleActivity.id);
  });

  // -----------------------------------------------------------------------------
  // 7. ADAPTIVE DIFFICULTY CALIBRATION BASED ON STUDENT MASTERY
  // -----------------------------------------------------------------------------
  console.log('\n7. Adaptive Difficulty Calibration based on Student Mastery');

  test('PromptBuilder injects targetDifficulty, learnerLevel, and struggling/strong concepts', () => {
    const learnerContext = {
      targetDifficulty: 'hard',
      learnerLevel: 'advanced',
      strugglingConcepts: [
        { name: 'Variable Scope', lastMisunderstanding: 'Thought let was hoisted to global window' }
      ],
      strongConcepts: [
        { name: 'Basic Syntax', masteryScore: 95 }
      ]
    };

    const promptSpec = PromptBuilder.buildActivityGenerationPrompt({
      videoTitle: 'Advanced JS',
      sectionAnalysis: {
        subjectCategory: 'programming',
        conceptName: 'Closures and Scope',
        conceptSummary: 'Explains lexical scope and closure memory retention.',
        recommendedActivityType: 'multiple_choice'
      },
      transcriptText: 'When a function references an outer variable, it closes over that variable.',
      upcomingTranscriptText: 'Next we will see garbage collection.',
      previousChunkSummary: 'Functions are first class.',
      learnerContext
    });

    assert.ok(promptSpec.systemPrompt.includes('ADAPTIVE DIFFICULTY & LEARNER LEVEL CALIBRATION'));
    assert.ok(promptSpec.systemPrompt.includes('If difficulty is "hard"'));
    assert.ok(promptSpec.userPrompt.includes('Target Difficulty: hard'));
    assert.ok(promptSpec.userPrompt.includes('Learner Level: advanced'));
    assert.ok(promptSpec.userPrompt.includes('Thought let was hoisted to global window'));
    assert.ok(promptSpec.userPrompt.includes('Learner Mastered Concepts: Basic Syntax'));
  });

  test('ActivityGenerator fallback adapts difficulty to learnerContext targetDifficulty', () => {
    const chunk = {
      id: 'chk_adv',
      start: 120,
      end: 240,
      text: 'Functions retain their lexical scope. This allows private state encapsulation.'
    };
    const analysis = {
      conceptName: 'Lexical Scope',
      conceptSummary: 'Functions retain scope.',
      recommendedActivityType: 'short_answer'
    };

    const hardActivity = ActivityGenerator.createFallbackActivity({
      videoId: 'js-video',
      chunk,
      sectionAnalysis: analysis,
      learnerContext: { targetDifficulty: 'hard' }
    });
    assert.strictEqual(hardActivity.difficulty, 'hard');

    const easyActivity = ActivityGenerator.createFallbackActivity({
      videoId: 'js-video',
      chunk,
      sectionAnalysis: analysis,
      learnerContext: { targetDifficulty: 'easy' }
    });
    assert.strictEqual(easyActivity.difficulty, 'easy');
  });

  // -----------------------------------------------------------------------------
  // 8. INTERACTIVE REAL-TIME AI TUTOR FOLLOW-UP
  // -----------------------------------------------------------------------------
  console.log('\n8. Interactive Real-Time AI Tutor Follow-up Prompt & Schema');

  test('SCHEMAS.TUTOR_FOLLOW_UP requires directAnswer, transcriptGrounding, keyInsight', () => {
    const schema = SCHEMAS.TUTOR_FOLLOW_UP;
    assert.strictEqual(schema.type, 'OBJECT');
    assert.ok(schema.properties.directAnswer);
    assert.ok(schema.properties.transcriptGrounding);
    assert.ok(schema.properties.keyInsight);
    assert.deepStrictEqual(schema.required, ['directAnswer', 'transcriptGrounding', 'keyInsight']);
  });

  test('PromptBuilder.buildTutorFollowUpPrompt builds grounded tutor prompt', () => {
    const promptSpec = PromptBuilder.buildTutorFollowUpPrompt({
      videoTitle: 'JavaScript Basics',
      activity: {
        conceptName: 'Variables',
        prompt: 'What is a variable?',
        options: ['Stores data', 'Makes computer bigger', 'Changes screen color', 'Plays music'],
        transcriptExcerpt: 'A variable is a container for holding values.',
        exemplarAnswer: 'A variable stores a value for later use.'
      },
      userAnswer: 'It stores stuff in the computer.',
      evaluation: { score: 75, evaluation: 'partially_correct', feedback: 'Good, but mention later retrieval.' },
      userQuestion: 'Why did I lose points for saying stuff instead of value?',
      transcriptText: 'A variable is a container for holding values.'
    });

    assert.ok(promptSpec.systemPrompt.includes('personal AI tutor'));
    assert.ok(promptSpec.systemPrompt.includes('Ground your answer STRICTLY'));
    assert.ok(promptSpec.userPrompt.includes('Why did I lose points for saying stuff instead of value?'));
    assert.ok(promptSpec.userPrompt.includes('Score 75/100'));
    assert.strictEqual(promptSpec.schema, SCHEMAS.TUTOR_FOLLOW_UP);
  });

  // -----------------------------------------------------------------------------
  // 9. PEDAGOGICAL MILESTONE TITLE SYNTHESIS
  // -----------------------------------------------------------------------------
  console.log('\n9. Pedagogical Milestone Title Synthesis');

  test('SCHEMAS.MILESTONE_TITLE_SYNTHESIS and buildSynthesizeMilestonePrompt build valid schema', () => {
    const schema = SCHEMAS.MILESTONE_TITLE_SYNTHESIS;
    assert.ok(schema.properties.milestoneTitle);
    assert.deepStrictEqual(schema.required, ['milestoneTitle']);

    const promptSpec = PromptBuilder.buildSynthesizeMilestonePrompt({
      videoTitle: 'ASL 100 Signs',
      conceptNames: ['Hello / Hi', 'Good morning', 'Nice to meet you'],
      mergedSummary: 'Instructor teaches greeting signs and introductions.'
    });

    assert.ok(promptSpec.systemPrompt.includes('curriculum designer'));
    assert.ok(promptSpec.userPrompt.includes('Hello / Hi'));
    assert.ok(promptSpec.userPrompt.includes('Nice to meet you'));
    assert.strictEqual(promptSpec.schema, SCHEMAS.MILESTONE_TITLE_SYNTHESIS);
  });

  // -----------------------------------------------------------------------------
  // 10. INTERACTIVE MINI-TUTOR FOLLOW-UP UI INTEGRATION
  // -----------------------------------------------------------------------------
  console.log('\n10. Interactive Mini-Tutor Follow-up UI Integration');

  test('UIManager renders follow-up tutor container and handles interactive query', async () => {
    let followUpCalledWith = null;

    const mockCallbacks = {
      onSubmitAnswer: async () => ({ score: 85, evaluation: 'correct' }),
      onSkipActivity: () => {},
      onContinueWatching: () => {},
      onRequestExplanation: async () => ({}),
      onAskTutorFollowUp: async (params) => {
        followUpCalledWith = params;
        return {
          directAnswer: 'In programming, variables store data so you can access it again later.',
          transcriptGrounding: 'A variable is a container for values.',
          keyInsight: 'Variables enable state reuse.'
        };
      },
      onSaveSettings: async () => {},
      onLoadDashboardData: async () => ({}),
      onManualTriggerActivity: () => {}
    };

    // Lightweight mock DOM environment for evaluation rendering
    const elements = new Map();
    const createMockElement = (tag) => {
      const children = [];
      const listeners = {};
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        id: '',
        style: {},
        value: '',
        disabled: false,
        textContent: '',
        scrollIntoView: () => {},
        focus: () => {},
        setAttribute: (k, v) => {},
        addEventListener: (event, handler) => {
          listeners[event] = handler;
        },
        dispatchEvent: (event) => {
          if (listeners[event]) listeners[event]({ key: event, preventDefault: () => {} });
        },
        appendChild: (child) => {
          children.push(child);
          if (child.id) elements.set(child.id, child);
          return child;
        },
        querySelector: (selector) => {
          const idMatch = selector.match(/#([\w-]+)/);
          if (idMatch && elements.has(idMatch[1])) {
            return elements.get(idMatch[1]);
          }
          for (const c of children) {
            if (selector.startsWith('#') && c.id === selector.slice(1)) return c;
            if (selector.startsWith('.') && c.className && c.className.includes(selector.slice(1))) return c;
            if (c.querySelector) {
              const nested = c.querySelector(selector);
              if (nested) return nested;
            }
          }
          return null;
        },
        get innerHTML() {
          return this._html || '';
        },
        set innerHTML(html) {
          this._html = html;
          // Simple parser for elements with id
          const idRegex = /id="([^"]+)"/g;
          let match;
          while ((match = idRegex.exec(html)) !== null) {
            const childMock = createMockElement('div');
            childMock.id = match[1];
            elements.set(match[1], childMock);
            children.push(childMock);
          }
        }
      };
      return el;
    };

    globalThis.document = {
      createElement: createMockElement
    };

    const ui = new UIManager(mockCallbacks);
    const evalMount = createMockElement('div');
    const footerMount = createMockElement('div');

    ui.renderEvaluationFeedback(
      evalMount,
      footerMount,
      sampleActivity,
      {
        score: 75,
        evaluation: 'partially_correct',
        correctPoints: ['Stores values'],
        missingPoints: ['Later retrieval'],
        suggestedAnswer: 'A variable stores a value to access and update later.'
      },
      () => {},
      'It stores values'
    );

    // Verify follow-up container was mounted
    const followup = elements.get('yt-learn-tutor-followup');
    assert.ok(followup, 'Interactive tutor follow-up container was mounted');

    const tutorInput = elements.get('yt-learn-tutor-input');
    const tutorBtn = elements.get('yt-learn-tutor-ask-btn');
    assert.ok(tutorInput, 'Tutor follow-up input field mounted');
    assert.ok(tutorBtn, 'Tutor follow-up submit button mounted');

    // Simulate asking a question
    tutorInput.value = 'How does this compare to a constant?';
    await tutorBtn.dispatchEvent('click');

    assert.ok(followUpCalledWith, 'onAskTutorFollowUp was triggered with student query');
    assert.strictEqual(followUpCalledWith.userQuestion, 'How does this compare to a constant?');
    assert.strictEqual(followUpCalledWith.userAnswer, 'It stores values');
    assert.strictEqual(followUpCalledWith.activity.id, sampleActivity.id);
  });

  // -----------------------------------------------------------------------------
  // 11. NATIVE YOUTUBE MACROMARKER CHAPTERS & ROBUST CLASSIFICATION (DEFBn0r53uQ)
  // -----------------------------------------------------------------------------
  console.log('\n11. Native YouTube MacroMarker Chapters & Classification (DEFBn0r53uQ)');

  test('ContentAnalyzer classifies DEFBn0r53uQ accurately with urban/transit keywords', () => {
    const climateTownChapters = [
      { start: 0, end: 62, title: 'Congestion pricing battle' },
      { start: 62, end: 192, title: 'Car culture in America' },
      { start: 192, end: 353, title: 'The true cost of driving' },
      { start: 353, end: 598, title: 'Lessons from other cities' },
      { start: 598, end: 846, title: "New York's transit crisis" },
      { start: 846, end: 971, title: 'Implementing the plan' },
      { start: 971, end: 1156, title: 'Initial program success' },
      { start: 1156, end: 1345, title: 'Federal legal challenges' },
      { start: 1345, end: 1533, title: 'Funding and program goals' },
      { start: 1533, end: 1771, title: 'Equitable urban planning' },
      { start: 1771, end: 2203, title: 'Looking toward a better future' }
    ];

    const result = ContentAnalyzer.heuristicClassifyVideo({
      videoId: 'DEFBn0r53uQ',
      title: 'New York Declares War On Traffic (A Congestion Pricing Story)',
      shortDescription: "WE'RE WALKING HERE! Get Nebula right here... Patreon...",
      author: 'Climate Town',
      chapters: climateTownChapters,
      chunks: []
    });

    assert.ok(result.educationalValue >= 70, `Expected educationalValue >= 70, got ${result.educationalValue}`);
    assert.strictEqual(result.shouldActivateLearning, true);
    assert.ok(result.category === 'Educational' || result.category === 'Informational');
  });

  test('BreakpointDetector handles DEFBn0r53uQ when using chapter-only chunks', () => {
    const climateTownChapters = [
      { start: 0, end: 62, title: 'Congestion pricing battle' },
      { start: 62, end: 192, title: 'Car culture in America' },
      { start: 192, end: 353, title: 'The true cost of driving' },
      { start: 353, end: 598, title: 'Lessons from other cities' },
      { start: 598, end: 846, title: "New York's transit crisis" },
      { start: 846, end: 971, title: 'Implementing the plan' },
      { start: 971, end: 1156, title: 'Initial program success' },
      { start: 1156, end: 1345, title: 'Federal legal challenges' },
      { start: 1345, end: 1533, title: 'Funding and program goals' },
      { start: 1533, end: 1771, title: 'Equitable urban planning' },
      { start: 1771, end: 2203, title: 'Looking toward a better future' }
    ];

    const chunks = SubtitleManager.buildChapterOnlyChunks(climateTownChapters, 2203);
    assert.strictEqual(chunks.length, 11);

    const detector = new BreakpointDetector({
      settings: { minIntervalSeconds: 300, maxIntervalSeconds: 600, breakFrequency: 'medium' }
    });

    detector.seedInitialCandidates(chunks, climateTownChapters, 2203, 'DEFBn0r53uQ');

    for (const [id, bp] of detector.scheduledBreakpoints.entries()) {
      bp.activity = {
        id: 'act_' + id,
        conceptName: bp.reason || 'Urban Policy',
        conceptSummary: 'Summary of chapter',
        prompt: 'How does this policy mechanism operate?',
        expectedKeyPoints: ['Point A', 'Point B']
      };
    }

    detector.enforceMinimumInterval();

    const finalBps = detector.getAllScheduledBreakpoints();
    assert.ok(finalBps.length >= 2 && finalBps.length <= 4, `Expected 2-4 breakpoints, got ${finalBps.length}`);

    // Verify consecutive interval is >= 300s
    for (let i = 0; i < finalBps.length - 1; i++) {
      const gap = finalBps[i + 1].timestamp - finalBps[i].timestamp;
      assert.ok(gap >= 300, `Gap between BP #${i+1} and BP #${i+2} is ${gap}s, expected >= 300s`);
    }
  });

  // -----------------------------------------------------------------------------
  // 12. FEASTABLE AND NATURAL ACTIVITY QUESTION GENERATION
  // -----------------------------------------------------------------------------
  console.log('\n12. Feastable & Natural Activity Question Generation');

  test('ActivityGenerator.sanitizePrompt cleans nested recursive prefixes and resolves tautologies', () => {
    const rawUserQuestion = `Synthesizing the concepts of "Wir zerlegen den Radweg & Das Problem am RS15 (and related concepts)" and "Die Mittelmarkierung ist nicht das Problem": Synthesizing the concepts of "Wir zerlegen den Radweg & Das Problem am RS15 (and related concepts)" and "Was beim Nebeneinanderfahren passiert": Synthesizing the concepts of "Wir zerlegen den Radweg & Das Problem am RS15" and "Warum 4 Meter nötig sind": Synthesizing the concepts of "Wir zerlegen den Radweg" and "Das Problem am RS15": In "Wir zerlegen den Radweg" (1:10 – 2:15), the instructor links "Chapter 3: Wir zerlegen den Radweg...." to "Chapter 3: Wir zerlegen den Radweg....". Why does the first condition necessarily lead to the second, and what specific failure or behavior would occur if that condition were altered?`;

    const sanitized = ActivityGenerator.sanitizePrompt(rawUserQuestion);

    // Verify all 4 recursive "Synthesizing..." prefixes are removed
    assert.strictEqual(sanitized.includes('Synthesizing the concepts of'), false, 'Should remove repetitive synthesis prefixes');

    // Verify self-referential tautology is resolved
    assert.strictEqual(sanitized.includes('links "Chapter 3: Wir zerlegen den Radweg...." to "Chapter 3: Wir zerlegen den Radweg...."'), false);
    assert.ok(sanitized.includes('explains "Wir zerlegen den Radweg"'), 'Should state what the instructor explains cleanly');
    assert.ok(sanitized.includes('Why is this condition necessary'), 'Should use clear and sensible condition phrasing');
  });

  test('BreakpointDetector does not compound recursive prefixes when multiple chapters merge', () => {
    const detector = new BreakpointDetector({
      settings: { minIntervalSeconds: 300, maxIntervalSeconds: 600, breakFrequency: 'medium' }
    });

    const bikeLaneChapters = [
      { start: 0, end: 70, title: 'Intro' },
      { start: 70, end: 135, title: 'Wir zerlegen den Radweg' },
      { start: 135, end: 190, title: 'Das Problem am RS15' },
      { start: 190, end: 250, title: 'Warum 4 Meter nötig sind' },
      { start: 250, end: 310, title: 'Was beim Nebeneinanderfahren passiert' },
      { start: 310, end: 380, title: 'Die Mittelmarkierung ist nicht das Problem' }
    ];

    detector.seedInitialCandidates([], bikeLaneChapters, 600, 'bike-lane-video');
    const scheduled = detector.getAllScheduledBreakpoints();

    assert.ok(scheduled.length >= 1, 'Scheduled at least 1 spaced breakpoint');
    for (const bp of scheduled) {
      const prompt = bp.activity?.prompt || '';
      // Ensure prompt contains NO nested or repeated synthesis prefixes
      const occurrences = (prompt.match(/Synthesizing/gi) || []).length;
      assert.ok(occurrences <= 1, `Prompt contains unexpected repeated "Synthesizing" occurrences: ${occurrences}`);
      assert.strictEqual(prompt.includes('Synthesizing the concepts of'), false, 'No clumsy nested synthesis prefix in prompt');
      assert.strictEqual(prompt.includes('to ""') || prompt.includes('links ""'), false, 'No empty quoted tautologies');
    }
  });

  test('createFallbackActivity critical_thinking never links identical phrases to themselves', () => {
    const chunkSingleSentence = {
      start: 70,
      end: 135,
      chapterTitle: 'Wir zerlegen den Radweg',
      text: 'Chapter 3: Wir zerlegen den Radweg.'
    };

    const activity = ActivityGenerator.createFallbackActivity({
      videoId: 'test-bike',
      chunk: chunkSingleSentence,
      sectionAnalysis: {
        conceptName: 'Wir zerlegen den Radweg',
        recommendedActivityType: 'critical_thinking',
        subjectCategory: 'general'
      },
      chunkIndex: 0
    });

    const prompt = activity.prompt;
    assert.strictEqual(prompt.includes('links "Chapter 3'), false, 'Does not link raw chapter header');
    assert.strictEqual(prompt.includes('links "Wir zerlegen den Radweg" to "Wir zerlegen den Radweg"'), false, 'Never links concept to itself');
    assert.ok(prompt.includes('why is this principle essential'), 'Generates a clear and understandable question');
  });

  // -----------------------------------------------------------------------------
  // 13. DUAL SUBTITLE FEATURE IN YOUTUBE VIDEO
  // -----------------------------------------------------------------------------
  console.log('\n13. Dual Subtitle Feature in YouTube Video');

  test('DEFAULT_SETTINGS includes dual subtitle configuration', () => {
    assert.strictEqual(DEFAULT_SETTINGS.enableDualSubtitles, true);
    assert.strictEqual(DEFAULT_SETTINGS.primarySubtitleLang, 'auto');
    assert.strictEqual(DEFAULT_SETTINGS.secondarySubtitleLang, 'en');
    assert.strictEqual(DEFAULT_SETTINGS.subtitleFontSize, 'medium');
    assert.strictEqual(DEFAULT_SETTINGS.hideNativeSubtitles, false);
  });

  test('SubtitleManager.findActiveCue accurately finds cues with binary search', () => {
    const cues = [
      { start: 0.0, end: 3.5, text: 'Hello and welcome.' },
      { start: 3.5, end: 7.2, text: 'Today we discuss dual subtitles.' },
      { start: 8.5, end: 12.0, text: 'Notice the pause between 7.2 and 8.5.' },
      { start: 12.0, end: 15.5, text: 'Final concluding statement.' }
    ];

    // Inside cue 0
    const c0 = SubtitleManager.findActiveCue(cues, 1.5);
    assert.strictEqual(c0?.text, 'Hello and welcome.');

    // Inside cue 1
    const c1 = SubtitleManager.findActiveCue(cues, 5.0);
    assert.strictEqual(c1?.text, 'Today we discuss dual subtitles.');

    // During pause between 7.2 and 8.5
    const pauseCue = SubtitleManager.findActiveCue(cues, 7.8);
    assert.strictEqual(pauseCue, null, 'Must return null during pause gap');

    // Inside cue 2
    const c2 = SubtitleManager.findActiveCue(cues, 10.0);
    assert.strictEqual(c2?.text, 'Notice the pause between 7.2 and 8.5.');

    // Outside bounds
    assert.strictEqual(SubtitleManager.findActiveCue(cues, -1.0), null);
    assert.strictEqual(SubtitleManager.findActiveCue(cues, 20.0), null);
    assert.strictEqual(SubtitleManager.findActiveCue([], 5.0), null);
  });

  test('SubtitleManager.getActiveDualCues returns synchronized primary and secondary cues', () => {
    const mgr = new SubtitleManager(async () => ({ ok: true }));
    mgr.primaryCues = [
      { start: 0.0, end: 4.0, text: 'Wir zerlegen den Radweg' },
      { start: 4.0, end: 8.0, text: 'Das ist ein wichtiges Problem' }
    ];
    mgr.secondaryCues = [
      { start: 0.0, end: 4.0, text: 'We deconstruct the bike lane' },
      { start: 4.0, end: 8.0, text: 'This is an important problem' }
    ];
    mgr.hasSubtitles = true;
    mgr.hasSecondarySubtitles = true;

    // At 2.0s
    const active1 = mgr.getActiveDualCues(2.0);
    assert.strictEqual(active1.primaryText, 'Wir zerlegen den Radweg');
    assert.strictEqual(active1.secondaryText, 'We deconstruct the bike lane');
    assert.strictEqual(active1.hasActiveText, true);

    // At 6.0s
    const active2 = mgr.getActiveDualCues(6.0);
    assert.strictEqual(active2.primaryText, 'Das ist ein wichtiges Problem');
    assert.strictEqual(active2.secondaryText, 'This is an important problem');

    // At 10.0s (past speech)
    const active3 = mgr.getActiveDualCues(10.0);
    assert.strictEqual(active3.primaryText, '');
    assert.strictEqual(active3.secondaryText, '');
    assert.strictEqual(active3.hasActiveText, false);
  });

  test('SubtitleManager.getActiveDualCues suppresses duplicate identical text', () => {
    const mgr = new SubtitleManager(async () => ({ ok: true }));
    mgr.primaryCues = [{ start: 0.0, end: 4.0, text: 'Identical subtitle sentence' }];
    mgr.secondaryCues = [{ start: 0.0, end: 4.0, text: 'Identical subtitle sentence' }];

    const active = mgr.getActiveDualCues(2.0);
    assert.strictEqual(active.primaryText, 'Identical subtitle sentence');
    assert.strictEqual(active.secondaryText, '', 'Should suppress duplicate secondary text');
  });

  test('SubtitleManager.getActiveDualCues preserves secondary cues in companion single-download mode', () => {
    const mgr = new SubtitleManager(async () => ({ ok: true }));
    mgr.primaryCues = [];
    mgr.secondaryCues = [{ start: 0.0, end: 4.0, text: 'Companion Secondary Cue' }];
    mgr.cues = mgr.secondaryCues; // simulate single-download mode where cues shares secondaryCues

    const active = mgr.getActiveDualCues(2.0);
    assert.strictEqual(active.secondaryText, 'Companion Secondary Cue', 'Secondary text must be preserved and not erased as duplicate of itself');
    assert.strictEqual(active.hasActiveText, true);
  });

  await testAsync('SubtitleManager.loadSecondaryTrack selects direct track or auto-translation', async () => {
    let requestedUrl = '';
    const mockSender = async (action, payload) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        requestedUrl = payload.url;
        return {
          ok: true,
          data: JSON.stringify({
            events: [
              { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Translated text' }] }
            ]
          })
        };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    const captionTracks = [
      {
        languageCode: 'de',
        name: 'German',
        kind: 'standard',
        baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=de'
      }
    ];

    const primaryTrack = {
      languageCode: 'de',
      name: 'German',
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=de'
    };

    const loaded = await mgr.loadSecondaryTrack(captionTracks, 'en', primaryTrack);
    assert.strictEqual(loaded, true);
    assert.ok(requestedUrl.includes('&tlang=en') || requestedUrl.includes('tlang=en'), 'Generated translated tlang URL');
    assert.strictEqual(mgr.secondaryCues.length, 1);
    assert.strictEqual(mgr.secondaryCues[0].text, 'Translated text');
    assert.strictEqual(mgr.hasSecondarySubtitles, true);
  });

  test('UIManager mounts and renders dual subtitles overlay cleanly', () => {
    // DOM mock with element tree
    const createdElements = [];
    const elementsById = new Map();

    const makeEl = (tag) => {
      let _id = '';
      let _html = '';
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); el.className = Array.from(this.classes).join(' '); },
          remove(c) { this.classes.delete(c); el.className = Array.from(this.classes).join(' '); },
          contains(c) { return this.classes.has(c); },
          toggle(c, val) { if (val) this.add(c); else this.remove(c); }
        },
        children: [],
        parentElement: null,
        isConnected: true,
        textContent: '',
        get id() { return _id; },
        set id(val) {
          _id = val;
          if (val) elementsById.set(val, el);
        },
        get innerHTML() { return _html; },
        set innerHTML(val) {
          _html = val;
          const matches = val.matchAll(/id=["']([^"']+)["']/g);
          for (const match of matches) {
            const childId = match[1];
            let child = elementsById.get(childId);
            if (!child) {
              child = makeEl('div');
              child.id = childId;
              el.appendChild(child);
            }
          }
        },
        appendChild(child) {
          child.parentElement = el;
          el.children.push(child);
          if (child.id) elementsById.set(child.id, child);
          return child;
        },
        querySelector(sel) {
          if (sel.startsWith('#')) {
            const targetId = sel.slice(1);
            if (this.id === targetId) return this;
            return elementsById.get(targetId) || null;
          }
          return null;
        }
      };
      createdElements.push(el);
      return el;
    };

    const mockBody = makeEl('body');
    const mockPlayer = makeEl('div');
    mockPlayer.id = 'movie_player';
    mockBody.appendChild(mockPlayer);

    globalThis.document = {
      body: mockBody,
      getElementById: (id) => (id === 'movie_player' ? mockPlayer : elementsById.get(id) || null),
      querySelector: (sel) => (sel === '#movie_player' ? mockPlayer : null),
      createElement: makeEl
    };

    const ui = new UIManager({ onSaveSettings: async () => {} });
    ui.settings = { enableDualSubtitles: true, subtitleFontSize: 'large', hideNativeSubtitles: true };

    // Render active cues
    ui.renderDualSubtitles({
      primaryText: 'Primary line German',
      secondaryText: 'Secondary line English'
    });

    const container = elementsById.get('yt-learn-dual-subtitles-container');
    assert.ok(container, 'Mounted dual subtitles container in player');
    assert.ok(container.className.includes('font-size-large'), 'Applied font size class');

    const primaryEl = elementsById.get('yt-learn-sub-primary');
    const secondaryEl = elementsById.get('yt-learn-sub-secondary');
    assert.strictEqual(primaryEl?.textContent, 'Primary line German');
    assert.strictEqual(secondaryEl?.textContent, 'Secondary line English');

    // Test clearDualSubtitles
    ui.clearDualSubtitles();
    const box = elementsById.get('yt-learn-dual-subtitles-box');
    assert.strictEqual(box?.style.display, 'none', 'Dual subtitles box is hidden on clear');
  });

  test('SubtitleManager.parseVttCaptions parses WebVTT timestamps and text', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.500 --> 00:00:04.200
Hello and welcome to this video.

00:00:04.500 --> 00:00:08.100
This is a dual subtitle demonstration.
`;
    const cues = SubtitleManager.parseVttCaptions(vtt);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 1.5);
    assert.strictEqual(cues[0].end, 4.2);
    assert.strictEqual(cues[0].text, 'Hello and welcome to this video.');
    assert.strictEqual(cues[1].start, 4.5);
    assert.strictEqual(cues[1].end, 8.1);
    assert.strictEqual(cues[1].text, 'This is a dual subtitle demonstration.');
  });

  await testAsync('SubtitleManager.fetchAndParseTrack parses XML format 3 timedtext srv3 segments', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
  <body>
    <p t="1200" d="3500"><s>Wir zerlegen den Radweg</s></p>
    <p t="5000" d="2800"><s>Das ist das Problem am RS15</s></p>
  </body>
</timedtext>`;
    const mockSender = async () => ({ ok: true, data: xml });
    const mgr = new SubtitleManager(mockSender);
    const cues = await mgr.fetchAndParseTrack('https://www.youtube.com/api/timedtext?v=test&lang=de&tlang=en');
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 1.2);
    assert.strictEqual(cues[0].end, 4.7);
    assert.strictEqual(cues[0].text, 'Wir zerlegen den Radweg');
    assert.strictEqual(cues[1].start, 5.0);
    assert.strictEqual(cues[1].end, 7.8);
    assert.strictEqual(cues[1].text, 'Das ist das Problem am RS15');
  });

  await testAsync('SubtitleManager.loadPrimaryTrack switches primary cues and updates track metadata', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="2.0" dur="4.0">Primary English subtitle</text></transcript>`;
    const mockSender = async () => ({ ok: true, data: xml });
    const mgr = new SubtitleManager(mockSender);
    mgr.availableTracks = [
      { languageCode: 'de', name: 'German', baseUrl: 'https://youtube.com/api/timedtext?v=test&lang=de' },
      { languageCode: 'en', name: 'English', baseUrl: 'https://youtube.com/api/timedtext?v=test&lang=en' }
    ];

    const loaded = await mgr.loadPrimaryTrack(mgr.availableTracks, 'en');
    assert.strictEqual(loaded, true);
    assert.strictEqual(mgr.primaryTrack?.languageCode, 'en');
    assert.strictEqual(mgr.primaryCues.length, 1);
    assert.strictEqual(mgr.primaryCues[0].text, 'Primary English subtitle');
  });

  test('UIManager renders inline Dual Subs language dropdowns on Dedicated Bar', () => {
    const createdElements = [];
    const elementsById = new Map();

    const makeEl = (tag) => {
      let _id = '';
      let _html = '';
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); el.className = Array.from(this.classes).join(' '); },
          remove(c) { this.classes.delete(c); el.className = Array.from(this.classes).join(' '); },
          contains(c) { return this.classes.has(c); },
          toggle(c, val) { if (val) this.add(c); else this.remove(c); }
        },
        children: [],
        parentElement: null,
        isConnected: true,
        textContent: '',
        get id() { return _id; },
        set id(val) {
          _id = val;
          if (val) elementsById.set(val, el);
        },
        get innerHTML() { return _html; },
        set innerHTML(val) {
          _html = val;
          const matches = val.matchAll(/id=["']([^"']+)["']/g);
          for (const match of matches) {
            const childId = match[1];
            let child = elementsById.get(childId);
            if (!child) {
              child = makeEl('div');
              child.id = childId;
              el.appendChild(child);
            }
          }
        },
        appendChild(child) {
          child.parentElement = el;
          el.children.push(child);
          if (child.id) elementsById.set(child.id, child);
          return child;
        },
        querySelector(sel) {
          if (sel.startsWith('#')) return elementsById.get(sel.slice(1)) || null;
          return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {}
      };
      return el;
    };

    const bodyEl = makeEl('body');
    const slot = makeEl('div');
    slot.id = 'above-the-fold';
    bodyEl.appendChild(slot);

    global.document = {
      body: bodyEl,
      createElement: makeEl,
      getElementById: (id) => elementsById.get(id) || null,
      querySelector: (sel) => {
        if (sel === '#above-the-fold') return slot;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const ui = new UIManager({ onSaveSettings: async () => {} });
    ui.init({ enableDualSubtitles: true, primarySubtitleLang: 'de', secondarySubtitleLang: 'en' });
    ui.setAvailableTracks(
      [
        { languageCode: 'de', name: 'German' },
        { languageCode: 'en', name: 'English' }
      ],
      [
        { languageCode: 'es', name: 'Spanish' }
      ]
    );

    const sub1Select = elementsById.get('yt-learn-sub1-select');
    const sub2Select = elementsById.get('yt-learn-sub2-select');
    assert.ok(sub1Select, 'Sub 1 dropdown mounted on Dedicated Bar');
    assert.ok(sub2Select, 'Sub 2 dropdown mounted on Dedicated Bar');
    assert.ok(
      ui.barContainer.innerHTML.includes('💬 2nd Sub: <strong>ON</strong>') ||
      ui.barContainer.innerHTML.includes('💬 Dual Subs: <strong>ON</strong>'),
      'Companion subtitle toggle button present on Dedicated Bar'
    );
  });

  console.log('\n14. Immediate Bar Mounting, DOM Fallback & Bridge Metadata Communication');

  await test('SubtitleManager.normalizeTimedtextUrl correctly normalizes relative URLs', async () => {
    assert.strictEqual(
      SubtitleManager.normalizeTimedtextUrl('//www.youtube.com/api/timedtext?v=xyz'),
      'https://www.youtube.com/api/timedtext?v=xyz'
    );
    assert.strictEqual(
      SubtitleManager.normalizeTimedtextUrl('/api/timedtext?v=xyz&lang=de'),
      'https://www.youtube.com/api/timedtext?v=xyz&lang=de'
    );
    assert.strictEqual(
      SubtitleManager.normalizeTimedtextUrl('https://www.youtube.com/api/timedtext?v=xyz'),
      'https://www.youtube.com/api/timedtext?v=xyz'
    );
  });

  await test('VideoController.extractMetadataFromDOM parses captionTracks and translationLanguages from script tags', async () => {
    const rawJson = JSON.stringify({
      videoDetails: { title: 'Test Video', author: 'Test Author', lengthSeconds: '120' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=testVid&lang=en',
              languageCode: 'en',
              name: { simpleText: 'English' }
            }
          ],
          translationLanguages: [
            {
              languageCode: 'es',
              languageName: { simpleText: 'Spanish' }
            }
          ]
        }
      }
    });

    const mockScript = {
      textContent: `var ytInitialPlayerResponse = ${rawJson};`
    };

    global.document = {
      querySelectorAll: (sel) => (sel === 'script' ? [mockScript] : []),
      title: 'Test Video - YouTube'
    };

    const vc = new VideoController({
      onVideoChanged: () => {},
      onTimeUpdate: () => {}
    });

    const meta = vc.extractMetadataFromDOM('testVid');
    assert.ok(meta, 'Metadata extracted from DOM');
    assert.strictEqual(meta.videoId, 'testVid');
    assert.strictEqual(meta.title, 'Test Video');
    assert.strictEqual(meta.captionTracks.length, 1);
    assert.strictEqual(meta.captionTracks[0].languageCode, 'en');
    assert.strictEqual(meta.translationLanguages.length, 1);
    assert.strictEqual(meta.translationLanguages[0].languageCode, 'es');
  });

  await test('VideoController.requestBridgeMetadata resolves both metadata and payload properties', async () => {
    let capturedHandler = null;
    let postedMsg = null;

    global.window = {
      addEventListener: (type, fn) => {
        if (type === 'message') capturedHandler = fn;
      },
      removeEventListener: () => {},
      postMessage: (msg) => {
        postedMsg = msg;
        setTimeout(() => {
          if (capturedHandler && postedMsg) {
            capturedHandler({
              source: global.window,
              data: {
                source: 'YT_AI_LEARNING_BRIDGE',
                requestId: postedMsg.requestId,
                metadata: {
                  videoId: 'bridgeVid',
                  captionTracks: [{ languageCode: 'de', baseUrl: 'https://example.com' }]
                }
              }
            });
          }
        }, 5);
      }
    };

    const vc = new VideoController({
      onVideoChanged: () => {},
      onTimeUpdate: () => {}
    });

    const res = await vc.requestBridgeMetadata();
    assert.ok(res, 'Received metadata from bridge');
    assert.strictEqual(res.videoId, 'bridgeVid');
    assert.strictEqual(res.captionTracks.length, 1);
  });

  await test('VideoController.handleNavigation immediately calls onVideoChanged with metadata: null', async () => {
    const invocations = [];
    global.window = {
      location: { href: 'https://www.youtube.com/watch?v=immediateTest123', pathname: '/watch', searchParams: new URLSearchParams('v=immediateTest123') },
      addEventListener: () => {},
      removeEventListener: () => {},
      postMessage: () => {}
    };
    global.document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      title: 'YouTube'
    };

    const vc = new VideoController({
      onVideoChanged: (data) => invocations.push(data),
      onTimeUpdate: () => {}
    });

    // Mock fetchPlayerMetadataWithRetry to simulate network latency
    vc.fetchPlayerMetadataWithRetry = async (vid, epoch) => {
      await new Promise((r) => setTimeout(r, 20));
      return { videoId: vid, captionTracks: [], chapters: [] };
    };

    const navPromise = vc.handleNavigation();
    assert.strictEqual(invocations.length, 1, 'onVideoChanged called immediately before metadata resolves');
    assert.strictEqual(invocations[0].videoId, 'immediateTest123');
    assert.strictEqual(invocations[0].metadata, null);

    await navPromise;
    assert.strictEqual(invocations.length, 2, 'onVideoChanged called second time when metadata is ready');
    assert.ok(invocations[1].metadata !== null);
  });

  console.log('\n15. On-Demand Companion Subtitle Download & Unblocked Native YouTube Main Subtitles');

  await test('UIManager.renderDualSubtitles NEVER hides native YouTube captions (one from YouTube, one from App)', async () => {
    const classList = new Set();
    const bodyEl = {
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c)
      },
      appendChild: () => {}
    };

    const playerEl = {
      appendChild: () => {},
      isConnected: true
    };

    let renderedText = '';
    const mockBox = { style: {} };
    const mockPrimary = { style: {}, textContent: '' };
    const mockSecondary = {
      style: {},
      set textContent(val) { renderedText = val; },
      get textContent() { return renderedText; }
    };

    global.document = {
      body: bodyEl,
      querySelector: (sel) => {
        if (sel === '#movie_player') return playerEl;
        return null;
      },
      querySelectorAll: () => [],
      getElementById: (id) => (id === 'movie_player' ? playerEl : null),
      createElement: () => ({
        style: {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        querySelector: (sel) => {
          if (sel === '#yt-learn-dual-subtitles-box') return mockBox;
          if (sel === '#yt-learn-sub-primary') return mockPrimary;
          if (sel === '#yt-learn-sub-secondary') return mockSecondary;
          return { style: {} };
        },
        appendChild: () => {}
      })
    };

    const ui = new UIManager();
    ui.settings = { enableDualSubtitles: true, secondarySubtitleLang: 'en' };

    // 1. When companion subtitle is active, native captions are NEVER hidden
    ui.renderDualSubtitles({ primaryText: 'YouTube Native Subtitle', secondaryText: 'App Companion Subtitle' }, ui.settings);
    assert.strictEqual(
      classList.has('yt-learn-hide-native-captions'),
      false,
      'yt-learn-hide-native-captions is NEVER added (YouTube native CC remains 100% visible)'
    );
    assert.strictEqual(renderedText, 'App Companion Subtitle', 'App renders the companion subtitle');
    assert.strictEqual(mockPrimary.style.display, 'none', 'Primary element kept hidden so YouTube renders native main subtitle');
    assert.strictEqual(mockSecondary.style.display, 'block', 'Secondary element is visible alongside main subtitle');

    // 2. When companion subtitle is turned off, native captions remain unblocked
    ui.renderDualSubtitles({ primaryText: 'YouTube Native Subtitle', secondaryText: 'App Companion Subtitle' }, { enableDualSubtitles: false });
    assert.strictEqual(
      classList.has('yt-learn-hide-native-captions'),
      false,
      'yt-learn-hide-native-captions remains false when companion subtitles is off'
    );
    assert.strictEqual(mockBox.style.display, 'none', 'Companion subtitle box is hidden when disabled');
  });

  await testAsync('SubtitleManager.downloadSecondaryTrackOnDemand fetches subtitle on demand from YouTube', async () => {
    let capturedUrl = '';
    const mockSender = async (action, payload) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        capturedUrl = payload.url;
        return {
          ok: true,
          data: '<transcript><text start="1.5" dur="3.0">Downloaded on demand subtitle</text></transcript>'
        };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'onDemandVid123';
    mgr.availableTracks = [
      {
        languageCode: 'de',
        name: 'German (Original)',
        baseUrl: 'https://www.youtube.com/api/timedtext?v=onDemandVid123&lang=de'
      }
    ];

    const success = await mgr.downloadSecondaryTrackOnDemand('es', { videoId: 'onDemandVid123' });
    assert.strictEqual(success, true, 'Subtitle downloaded on demand');
    assert.ok(capturedUrl.includes('tlang=es'), 'Request targeted Spanish on demand via timedtext tlang');
    assert.strictEqual(mgr.secondaryCues.length, 1);
    assert.strictEqual(mgr.secondaryCues[0].text, 'Downloaded on demand subtitle');
    assert.strictEqual(mgr.getActiveSecondaryCue(2.0), 'Downloaded on demand subtitle');
  });

  console.log('\n16. Rate Limiting, Server Block Prevention & Single Subtitle Download On Demand');

  await testAsync('loadSubtitlesForVideo only downloads 1 subtitle on demand, leaving original to YouTube', async () => {
    SubtitleManager.resetRateLimitState();
    const fetchedUrls = [];
    const mockSender = async (action, payload) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        fetchedUrls.push(payload.url);
        return {
          ok: true,
          data: '<transcript><text start="1.0" dur="2.0">Companion Spanish Cue</text></transcript>'
        };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    const metadata = {
      videoId: 'singleSubTest1',
      captionTracks: [
        { languageCode: 'en', name: 'English', baseUrl: 'https://www.youtube.com/api/timedtext?v=singleSubTest1&lang=en' }
      ]
    };

    // Demand dual subtitles in Spanish
    const res = await mgr.loadSubtitlesForVideo(metadata, 'auto', 'es', { enableDualSubtitles: true });
    assert.strictEqual(res.hasSubtitles, true);
    assert.strictEqual(mgr.hasSecondarySubtitles, true);
    assert.strictEqual(fetchedUrls.length, 1, 'Exactly 1 subtitle was downloaded');
    assert.ok(fetchedUrls[0].includes('tlang=es'), 'The 1 downloaded subtitle is the demanded companion subtitle');
    assert.ok(!fetchedUrls.some((u) => u === 'https://www.youtube.com/api/timedtext?v=singleSubTest1&lang=en'), 'Original subtitle was NOT downloaded (handled by YouTube)');

    // Dual subtitles disabled: 0 downloads
    fetchedUrls.length = 0;
    const mgrOff = new SubtitleManager(mockSender);
    const resOff = await mgrOff.loadSubtitlesForVideo({ videoId: 'singleSubTest2' }, 'auto', 'es', { enableDualSubtitles: false });
    assert.strictEqual(fetchedUrls.length, 0, 'No subtitle is downloaded when dual subtitles is not demanded');
  });

  await testAsync('SubtitleManager caches downloaded tracks in memory and avoids duplicate requests', async () => {
    SubtitleManager.resetRateLimitState();
    let requestCount = 0;
    const mockSender = async (action) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        requestCount++;
        return {
          ok: true,
          data: '<transcript><text start="0.5" dur="1.5">Cached Translation</text></transcript>'
        };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'cacheTestVid';
    mgr.availableTracks = [
      { languageCode: 'en', name: 'English', baseUrl: 'https://www.youtube.com/api/timedtext?v=cacheTestVid&lang=en' }
    ];

    // First demand: fetches over network
    await mgr.downloadSecondaryTrackOnDemand('es', { videoId: 'cacheTestVid' });
    assert.strictEqual(requestCount, 1, 'First demand triggered 1 network request');

    // Second demand for same language: served from memory cache (0 network requests)
    await mgr.downloadSecondaryTrackOnDemand('es', { videoId: 'cacheTestVid' });
    assert.strictEqual(requestCount, 1, 'Second demand used memory cache without triggering new network request');
  });

  await testAsync('SubtitleManager deduplicates concurrent in-flight requests for the same track', async () => {
    SubtitleManager.resetRateLimitState();
    let networkCalls = 0;
    const mockSender = async (action) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        networkCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          data: '<transcript><text start="0" dur="2">Deduplicated cue</text></transcript>'
        };
      }
      return { ok: false };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'dedupeVid';
    mgr.availableTracks = [
      { languageCode: 'en', name: 'English', baseUrl: 'https://www.youtube.com/api/timedtext?v=dedupeVid&lang=en' }
    ];

    // Fire 3 concurrent requests for same target language
    const [r1, r2, r3] = await Promise.all([
      mgr.downloadSecondaryTrackOnDemand('fr', { videoId: 'dedupeVid' }),
      mgr.downloadSecondaryTrackOnDemand('fr', { videoId: 'dedupeVid' }),
      mgr.downloadSecondaryTrackOnDemand('fr', { videoId: 'dedupeVid' })
    ]);

    assert.strictEqual(r1, true);
    assert.strictEqual(r2, true);
    assert.strictEqual(r3, true);
    assert.strictEqual(networkCalls, 1, 'Only 1 network call was made for 3 concurrent requests');
  });

  await testAsync('SubtitleManager circuit breaker halts requests when YouTube responds with HTTP 429', async () => {
    SubtitleManager.resetRateLimitState();
    let calls = 0;
    const mockSender = async (action) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        calls++;
        return { ok: false, status: 429, error: 'Caption fetch HTTP 429' };
      }
      return { ok: false };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'rateLimitVid';
    mgr.availableTracks = [
      { languageCode: 'en', name: 'English', baseUrl: 'https://www.youtube.com/api/timedtext?v=rateLimitVid&lang=en' }
    ];

    const success = await mgr.downloadSecondaryTrackOnDemand('de', { videoId: 'rateLimitVid' });
    assert.strictEqual(success, false, 'Failed cleanly on 429');
    assert.ok(SubtitleManager.cooldownUntil > Date.now(), 'Cooldown circuit breaker was activated');

    // Attempt another request while in cooldown
    const secondTry = await mgr.downloadSecondaryTrackOnDemand('de', { videoId: 'rateLimitVid' });
    assert.strictEqual(secondTry, false, 'Rejected immediately during cooldown');
    assert.strictEqual(calls, 1, 'Zero network calls made during active cooldown');

    SubtitleManager.resetRateLimitState();
  });

  await testAsync('SubtitleManager never generates or fetches fake timedtext URLs when metadata lacks baseUrl', async () => {
    SubtitleManager.resetRateLimitState();
    let networkCalls = 0;
    const mockSender = async (action) => {
      if (action === 'FETCH_CAPTION_TRACK') {
        networkCalls++;
        return { ok: true, data: '<transcript></transcript>' };
      }
      return { ok: false };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'noBaseUrlVid';
    mgr.availableTracks = [];

    // Attempt on-demand download with empty captionTracks and no baseUrl
    const success = await mgr.downloadSecondaryTrackOnDemand('es', {
      videoId: 'noBaseUrlVid',
      captionTracks: []
    });

    assert.strictEqual(success, false, 'Refuses to download without genuine YouTube baseUrl');
    assert.strictEqual(networkCalls, 0, 'Zero network calls made — no fake timedtext URLs generated');
  });

  await test('SubtitleManager.getActiveDualCues preserves secondary subtitle when native player displays live captions', () => {
    const mgr = new SubtitleManager(async () => ({ ok: true }));
    mgr.primaryCues = []; // Single companion mode (YouTube handles original subtitle)
    mgr.secondaryCues = [{ start: 1.0, end: 5.0, text: 'Secondary Translation Cue' }];

    // Mock DOM representing YouTube's native player showing English CC
    const origDoc = globalThis.document;
    globalThis.document = {
      querySelectorAll: (sel) => {
        if (sel.includes('.ytp-caption-segment')) {
          return [{ textContent: 'Native YouTube CC Text' }];
        }
        return [];
      }
    };

    try {
      const active = mgr.getActiveDualCues(3.0);
      assert.strictEqual(active.primaryText, 'Native YouTube CC Text', 'Reads native YouTube caption from DOM');
      assert.strictEqual(active.secondaryText, 'Secondary Translation Cue', 'Secondary subtitle shows up alongside native caption');
      assert.strictEqual(active.hasActiveText, true);
    } finally {
      globalThis.document = origDoc;
    }
  });

  console.log(`\n17. Local Subtitle Server & Terminal Downloader Architecture`);

  await test('parseVttOrSrt parses WebVTT cues with timestamps and cleans HTML tags', () => {
    const rawVtt = `WEBVTT
Kind: captions
Language: es

00:00:01.500 --> 00:00:04.200
<c.colorE5E5E5>¡Hola a todos!</c> Bienvenidos al video.

00:00:05.100 --> 00:00:08.750
Hoy vamos a <b>aprender</b> cosas increíbles &amp; divertidas.
`;
    const cues = parseVttOrSrt(rawVtt);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 1.5);
    assert.strictEqual(cues[0].end, 4.2);
    assert.strictEqual(cues[0].text, '¡Hola a todos! Bienvenidos al video.');
    assert.strictEqual(cues[1].start, 5.1);
    assert.strictEqual(cues[1].end, 8.75);
    assert.strictEqual(cues[1].text, 'Hoy vamos a aprender cosas increíbles & divertidas.');
  });

  await test('parseVttOrSrt parses SubRip (.srt) cues with comma timestamps', () => {
    const rawSrt = `1
00:01:20,500 --> 00:01:23,800
This is subtitle line 1.

2
00:01:24,100 --> 00:01:28,450
This is subtitle line 2.
`;
    const cues = parseVttOrSrt(rawSrt);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 80.5);
    assert.strictEqual(cues[0].end, 83.8);
    assert.strictEqual(cues[0].text, 'This is subtitle line 1.');
    assert.strictEqual(cues[1].start, 84.1);
    assert.strictEqual(cues[1].end, 88.45);
    assert.strictEqual(cues[1].text, 'This is subtitle line 2.');
  });

  await testAsync('SubtitleManager queries local terminal server first with zero YouTube requests', async () => {
    SubtitleManager.resetRateLimitState();
    let youtubeNetworkCalls = 0;
    let localServerCalls = 0;

    const mockSender = async (action, payload) => {
      if (action === 'FETCH_LOCAL_SUBTITLE') {
        localServerCalls++;
        return {
          ok: true,
          data: {
            videoId: payload.videoId,
            lang: payload.lang,
            cues: [
              { start: 0.0, end: 3.5, text: 'Terminal downloaded cue delivered to YouTube app' }
            ],
            trackInfo: { languageCode: payload.lang, name: 'Local Sub (VI)' }
          }
        };
      }
      if (action === 'FETCH_CAPTION_TRACK') {
        youtubeNetworkCalls++;
        return { ok: false, status: 429 };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'terminalServerVid';

    const success = await mgr.downloadSecondaryTrackOnDemand('vi', { videoId: 'terminalServerVid' });
    assert.strictEqual(success, true, 'Successfully received subtitle from local server');
    assert.strictEqual(localServerCalls, 1, 'Local server endpoint was called');
    assert.strictEqual(youtubeNetworkCalls, 0, 'ZERO calls to YouTube — 100% immune to 429 block');
    assert.strictEqual(mgr.secondaryCues.length, 1);
    assert.strictEqual(mgr.secondaryCues[0].text, 'Terminal downloaded cue delivered to YouTube app');
    assert.strictEqual(mgr.hasSecondarySubtitles, true);
  });

  await test('UIManager renders local terminal server badge when server is connected', () => {
    const ui = new UIManager({});
    ui.settings = { enabled: true, enableDualSubtitles: true };
    ui.barContainer = {
      style: {},
      classList: { add: () => {}, remove: () => {} },
      innerHTML: '',
      querySelector: () => null
    };

    ui.setLocalServerStatus(true);
    assert.strictEqual(ui.localServerConnected, true);
    assert.ok(ui.barContainer.innerHTML.includes('yt-learn-server-badge'));
    assert.ok(ui.barContainer.innerHTML.includes('🖥️'));
  });

  await testAsync('SubtitleManager handles local server error or turn-off gracefully with backoff and browser fallback', async () => {
    SubtitleManager.resetRateLimitState();
    let localCalls = 0;
    let browserCalls = 0;

    const mockSender = async (action, payload) => {
      if (action === 'FETCH_LOCAL_SUBTITLE') {
        localCalls++;
        // Simulate local server being turned off or erroring
        return { ok: false, isServerOffline: true, error: 'connect ECONNREFUSED 127.0.0.1:8765' };
      }
      if (action === 'FETCH_CAPTION_TRACK') {
        browserCalls++;
        return {
          ok: true,
          data: '<transcript><text start="0" dur="2">Fallback Browser Cue</text></transcript>'
        };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'offlineServerVid';
    const metadata = {
      videoId: 'offlineServerVid',
      captionTracks: [
        { languageCode: 'es', name: 'Spanish', baseUrl: 'https://www.youtube.com/api/timedtext?v=offlineServerVid&lang=es' }
      ]
    };

    // First attempt: local server fails -> triggers backoff -> seamlessly falls back to browser caption track
    const success1 = await mgr.downloadSecondaryTrackOnDemand('es', metadata);
    assert.strictEqual(success1, true, 'Successfully fell back to browser track without crashing');
    assert.strictEqual(localCalls, 1, 'Attempted local server first');
    assert.strictEqual(browserCalls, 1, 'Fell back to browser timedtext track seamlessly');
    assert.ok(mgr.localServerOfflineUntil > Date.now(), 'Local server backoff was activated (15s)');
    assert.strictEqual(mgr.secondaryCues[0].text, 'Fallback Browser Cue');

    // Second attempt while local server is in backoff:
    // Should NOT ping the dead local server port again immediately
    const success2 = await mgr.downloadSecondaryTrackOnDemand('es', metadata);
    assert.strictEqual(success2, true);
    assert.strictEqual(localCalls, 1, 'Did not spam dead local server while backoff was active');
  });

  await test('cuesToVtt formats cue objects into valid WebVTT string', async () => {
    const { cuesToVtt } = await import('../server/subtitle-server.js');
    const cues = [
      { start: 2.88, end: 7.36, text: 'Hello world' },
      { start: 7.68, end: 10.12, text: 'Second subtitle line' }
    ];
    const vtt = cuesToVtt(cues);
    assert.ok(vtt.startsWith('WEBVTT'));
    assert.ok(vtt.includes('00:00:02.880 --> 00:00:07.360'));
    assert.ok(vtt.includes('Hello world'));
    assert.ok(vtt.includes('00:00:07.680 --> 00:00:10.120'));
    assert.ok(vtt.includes('Second subtitle line'));
  });

  await test('UIManager.buildSub2OptionsHtml shows ONLY available video tracks and excludes non-working auto-translations', () => {
    const ui = new UIManager({});
    ui.availableTracks = [
      { languageCode: 'en', name: 'English' },
      { languageCode: 'zh-Hant', name: 'Chinese (Traditional)' }
    ];
    ui.translationLanguages = [{ languageCode: 'ab', name: 'Abkhazian' }, { languageCode: 'es', name: 'Spanish' }];

    const html = ui.buildSub2OptionsHtml('en');
    assert.ok(html.includes('value="none"'), 'Off option is present');
    assert.ok(html.includes('value="en"'), 'Available English track is present');
    assert.ok(html.includes('value="zh-Hant"'), 'Available Chinese track is present');
    assert.strictEqual(html.includes('value="ab"'), false, 'Auto-translated Abkhazian is strictly excluded');
    assert.strictEqual(html.includes('value="es"'), false, 'Non-existent Spanish track is strictly excluded');
  });

  console.log('\n18. Draggable Subtitles, Gemini AI Breakpoint Planning & Universal Video Coverage');

  await test('PromptBuilder.buildVideoBreakpointsAndActivitiesPrompt generates valid schema and rules', () => {
    const promptObj = PromptBuilder.buildVideoBreakpointsAndActivitiesPrompt({
      videoTitle: 'Test Video on Latin Language',
      videoDuration: 620,
      chapters: [
        { title: 'Intro', start: 0, end: 180 },
        { title: 'Origins', start: 180, end: 400 },
        { title: 'Modern Examples', start: 400, end: 620 }
      ],
      transcriptChunks: [
        { start: 0, end: 180, chapterTitle: 'Intro', text: 'Introduction to Latin.' },
        { start: 180, end: 400, chapterTitle: 'Origins', text: 'Origins of Latin.' },
        { start: 400, end: 620, chapterTitle: 'Modern Examples', text: 'Modern daily uses.' }
      ],
      minIntervalSeconds: 300
    });

    assert.ok(promptObj.systemPrompt.includes('MANDATORY FINAL END-OF-VIDEO SUMMARY ACTIVITY'));
    assert.ok(promptObj.systemPrompt.includes('MINIMUM INTERVAL SPACING'));
    assert.ok(promptObj.userPrompt.includes('Test Video on Latin Language'));
    assert.ok(promptObj.schema === SCHEMAS.VIDEO_BREAKPOINTS_AND_ACTIVITIES);
    assert.strictEqual(promptObj.schema.type, 'OBJECT');
    assert.ok(promptObj.schema.properties.breakpoints);
  });

  await test('BreakpointDetector.setBreakpointsFromAi schedules checkpoints and marks final summary', () => {
    const bd = new BreakpointDetector({ minIntervalSeconds: 300 });
    bd.videoDuration = 600;

    const aiBreakpoints = [
      {
        timestamp: 280,
        milestoneTitle: 'Foundations of Latin',
        activity: {
          type: 'multiple_choice',
          question: 'What is the primary origin discussed?',
          options: ['Rome', 'Greece', 'Egypt', 'Persia'],
          correctIndex: 0,
          explanation: 'Latin originated in Latium, Rome.'
        }
      },
      {
        timestamp: 590,
        milestoneTitle: 'Comprehensive Video Wrap-Up',
        isSummary: true,
        activity: {
          type: 'teach_back',
          question: 'Summarize the overarching thesis of the entire video.',
          explanation: 'Comprehensive reflection on all sections.'
        }
      }
    ];

    bd.setBreakpointsFromAi(aiBreakpoints, 'testVid123');
    const scheduled = bd.getAllScheduledBreakpoints();
    assert.strictEqual(scheduled.length, 2);
    assert.strictEqual(scheduled[0].timestamp, 280);
    assert.strictEqual(scheduled[0].isSummary, false);
    assert.strictEqual(scheduled[1].timestamp, 590);
    assert.strictEqual(scheduled[1].isSummary, true);
    assert.strictEqual(scheduled[1].activity.isSummary, true);
  });

  await test('UIManager.setupDraggableSubtitle attaches listeners and handles double-click reset', () => {
    const ui = new UIManager({});
    let dblClickTriggered = false;
    let savedSettings = null;
    ui.callbacks.onSaveSettings = async (settings) => {
      savedSettings = settings;
    };

    const listeners = new Map();
    const mockBox = {
      classList: { add: () => {}, remove: () => {} },
      addEventListener: (type, fn) => {
        listeners.set(type, fn);
      }
    };

    const mockContainer = {
      parentElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 })
      },
      getBoundingClientRect: () => ({ left: 300, top: 350, width: 200, height: 40 }),
      style: {
        left: '50%',
        top: '',
        bottom: '104px',
        transform: 'translateX(-50%)',
        setProperty(prop, val) { this[prop] = val; },
        removeProperty(prop) { delete this[prop]; }
      },
      dataset: {}
    };

    ui.setupDraggableSubtitle(mockContainer, mockBox);
    assert.ok(listeners.has('pointerdown'), 'Pointerdown listener attached');
    assert.ok(listeners.has('mousedown'), 'Mousedown listener attached');
    assert.ok(listeners.has('dblclick'), 'Double-click listener attached');

    // Simulate pointer drag movement
    const pointerDown = listeners.get('pointerdown');
    const pointerMove = listeners.get('pointermove');
    const pointerUp = listeners.get('pointerup');

    pointerDown({ clientX: 350, clientY: 360, pointerId: 1, preventDefault: () => {}, stopPropagation: () => {} });
    pointerMove({ clientX: 450, clientY: 260, preventDefault: () => {}, stopPropagation: () => {} });
    pointerUp({ preventDefault: () => {}, stopPropagation: () => {} });

    assert.ok(mockContainer.style.left.includes('%'), 'Left percentage position updated');
    assert.ok(mockContainer.style.top.includes('%'), 'Top percentage position updated');
    assert.strictEqual(mockContainer.style.bottom, 'auto');
    assert.strictEqual(mockContainer.style.transform, 'none');
    assert.ok(savedSettings?.subtitlePosition, 'Settings saved new drag position');

    // Simulate double click to reset position
    const dblClickHandler = listeners.get('dblclick');
    dblClickHandler({ stopPropagation: () => {}, preventDefault: () => {} });

    assert.strictEqual(mockContainer.style.left, '50%');
    assert.strictEqual(mockContainer.style.transform, 'translateX(-50%)');
    assert.strictEqual(mockContainer.style.top, '');
    assert.strictEqual(savedSettings?.subtitlePosition, null, 'Settings updated to reset position');
  });

  await test('Casual & Video-Related Phrasing: cleans greetings, avoids academic filler in prompts and fallbacks', () => {
    // 1. extractConceptLabel filters conversational filler
    const greetingText = 'Hey guys welcome back today we are going to build a redstone machine.';
    const label = BreakpointDetector.extractConceptLabel(greetingText, 0);
    assert.strictEqual(label.includes('Hey Guys'), false, 'Does not use greeting filler as concept');
    assert.strictEqual(label.includes('Build Redstone Machine'), true, 'Extracts the actual action/topic');

    // 2. cleanConceptName strips Intro/Outro/numbers
    assert.strictEqual(ActivityGenerator.cleanConceptName('Intro'), 'Introduction');
    assert.strictEqual(ActivityGenerator.cleanConceptName('1'), '');
    assert.strictEqual(ActivityGenerator.cleanConceptName('Chapter 2: Sourdough'), 'Sourdough');

    // 3. createFallbackActivity produces casual video-related question without robotic filler
    const chunk = {
      start: 60,
      end: 180,
      chapterTitle: 'Intro',
      text: 'We mixed the cold water with flour and let the dough ferment for four hours.'
    };
    const act = ActivityGenerator.createFallbackActivity({
      videoId: 'vid-casual',
      chunk,
      sectionAnalysis: { recommendedActivityType: 'multiple_choice' },
      chunkIndex: 0
    });

    assert.strictEqual(act.prompt.includes('about "Intro"'), false, 'Does not ask about Intro');
    assert.strictEqual(act.prompt.includes('primary principle governs'), false, 'No academic principle jargon');
    assert.ok(act.prompt.includes('What was the main thing explained') || act.prompt.includes('What did the creator explain'), 'Casual question wording');

    // Check options are natural and do not contain generic academic filler
    act.options.forEach((opt) => {
      assert.strictEqual(opt.includes('outdated idea that is no longer used'), false, 'No generic filler distractor');
      assert.strictEqual(opt.includes('satisfying the primary condition to achieve the expected result'), false, 'No robotic template option');
    });
  });

  await testAsync('SubtitleManager restores secondary subtitles correctly from cache when primaryCues was omitted', async () => {
    const mgr = new SubtitleManager(async () => ({ ok: true }));
    // Mock db.getTranscript returning legacy cache with only cues
    const origGet = db.getTranscript;
    db.getTranscript = async () => ({
      cues: [{ start: 0, end: 5, text: 'Cached subtitle text' }],
      trackInfo: { languageCode: 'en', name: 'English' }
    });

    try {
      const res = await mgr.loadSubtitlesForVideo({ videoId: 'cachedVid' }, 'auto', 'en');
      assert.strictEqual(res.hasSubtitles, true);
      assert.strictEqual(mgr.hasSecondarySubtitles, true);
      assert.strictEqual(mgr.secondaryCues.length, 1);
      assert.strictEqual(mgr.secondaryCues[0].text, 'Cached subtitle text');
      // When primaryCues was empty in cache, primaryCues is [] and does NOT duplicate secondaryCues
      assert.strictEqual(mgr.primaryCues.length, 0);

      // Verify getActiveDualCues returns the secondary cue without suppression
      const active = mgr.getActiveDualCues(2.5);
      assert.strictEqual(active.secondaryText, 'Cached subtitle text');
      assert.strictEqual(active.hasActiveText, true);
    } finally {
      db.getTranscript = origGet;
    }
  });

  await test('UIManager.renderDualSubtitles displays companion subtitle with primaryCue fallback when secondaryText is empty', () => {
    const ui = new UIManager({});
    ui.settings = { enabled: true, enableDualSubtitles: true, secondarySubtitleLang: 'en' };

    let displayedText = '';
    let boxDisplay = 'none';

    // Mock DOM elements
    ui.ensureDualSubtitlesMount = () => ({
      classList: { contains: () => true, add: () => {}, remove: () => {} },
      querySelector: (sel) => {
        if (sel === '#yt-learn-dual-subtitles-box') {
          return {
            style: {
              get display() { return boxDisplay; },
              set display(val) { boxDisplay = val; }
            }
          };
        }
        if (sel === '#yt-learn-sub-primary') {
          return { style: {}, textContent: '' };
        }
        if (sel === '#yt-learn-sub-secondary') {
          return {
            style: {},
            get textContent() { return displayedText; },
            set textContent(val) { displayedText = val; }
          };
        }
        return null;
      }
    });

    // Case 1: normal secondaryText present
    ui.renderDualSubtitles({ secondaryText: 'Hello World' });
    assert.strictEqual(boxDisplay, 'inline-flex');
    assert.strictEqual(displayedText, 'Hello World');

    // Case 2: secondaryText empty, but primaryCue loaded internally
    ui.renderDualSubtitles({ secondaryText: '', primaryCue: { text: 'Fallback Cue' } });
    assert.strictEqual(boxDisplay, 'inline-flex');
    assert.strictEqual(displayedText, 'Fallback Cue');

    // Case 3: both empty -> box hides
    ui.renderDualSubtitles({ secondaryText: '', primaryCue: null });
    assert.strictEqual(boxDisplay, 'none');
  });

  await testAsync('SubtitleManager.loadSecondaryTrack failure updates failedLanguages timestamp map without throwing TypeError', async () => {
    const mgr = new SubtitleManager(async () => {
      throw new Error('Network failure');
    });
    mgr.currentVideoId = 'failVid';

    const ok = await mgr.loadSecondaryTrack(
      [{ languageCode: 'es', baseUrl: 'https://www.youtube.com/api/timedtext?v=failVid&lang=es' }],
      'es'
    );
    assert.strictEqual(ok, false);
    assert.strictEqual(mgr.hasSecondarySubtitles, false);
    // Ensure failedLanguages is a Map and has the timestamp set
    const failedUntil = mgr.failedLanguages.get('failVid_es');
    assert.ok(typeof failedUntil === 'number' && failedUntil > Date.now(), 'failedLanguages holds future timestamp');
  });

  console.log('\n19. Comprehensive HTTP 429 Prevention & Circuit Breakers');

  await testAsync('GeminiProvider circuit breaker sets 25s cooldown on HTTP 429 and halts network calls', async () => {
    const { GeminiProvider } = await import('../src/ai/gemini-provider.js');
    GeminiProvider.resetRateLimitState();

    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Resource has been exhausted (quota exceeded)' } })
      };
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      fetchImpl: mockFetch,
      maxRetries: 0
    });

    let firstErr = null;
    try {
      await provider.generateStructuredJSON({
        systemPrompt: 'System',
        userPrompt: 'User',
        responseSchema: { type: 'object' }
      });
    } catch (e) {
      firstErr = e;
    }

    assert.ok(firstErr, 'First call threw error');
    assert.strictEqual(firstErr.status, 429);
    assert.strictEqual(fetchCount, 1, 'Network fetch was called once');
    assert.ok(GeminiProvider.cooldownUntil > Date.now(), 'cooldownUntil set to future timestamp');

    // Second call during cooldown: must be halted immediately without calling fetchImpl!
    let secondErr = null;
    try {
      await provider.generateStructuredJSON({
        systemPrompt: 'System',
        userPrompt: 'User',
        responseSchema: { type: 'object' }
      });
    } catch (e) {
      secondErr = e;
    }

    assert.ok(secondErr, 'Second call threw immediately');
    assert.strictEqual(secondErr.status, 429);
    assert.strictEqual(secondErr.code, 'RATE_LIMITED');
    assert.strictEqual(fetchCount, 1, 'ZERO additional network calls made during circuit-breaker cooldown');

    GeminiProvider.resetRateLimitState();
  });

  await test('BreakpointDetector tracks hasAiPlanned flag to suppress redundant chunk preparation', () => {
    const detector = new BreakpointDetector({ settings: { minIntervalSeconds: 300 } });
    assert.strictEqual(detector.hasAiPlanned, false, 'Initial hasAiPlanned is false');

    detector.setBreakpointsFromAi([
      { timestamp: 150, milestoneTitle: 'Checkpoint 1', activity: { prompt: 'How is it going?' } },
      { timestamp: 450, milestoneTitle: 'Checkpoint 2', activity: { prompt: 'What did you think?' } }
    ], 'vidTest');

    assert.strictEqual(detector.hasAiPlanned, true, 'hasAiPlanned set to true after AI planning');
    detector.reset();
    assert.strictEqual(detector.hasAiPlanned, false, 'reset clears hasAiPlanned');
  });

  await testAsync('SubtitleManager negative caches 404 from local server for 60s without hitting synthetic tlang', async () => {
    let networkAttempts = 0;
    const mockSender = async (action, payload) => {
      if (action === 'FETCH_LOCAL_SUBTITLE') {
        return { ok: false, status: 404, error: 'Subtitle not found for videoId=vid429, lang=vi' };
      }
      if (action === 'FETCH_CAPTION_TRACK') {
        networkAttempts++;
        return { ok: true, data: '<transcript></transcript>' };
      }
      return { ok: true };
    };

    const mgr = new SubtitleManager(mockSender);
    mgr.currentVideoId = 'vid429';
    // No direct track for 'vi' in available tracks
    mgr.availableTracks = [
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=vid429&lang=en' }
    ];

    const res = await mgr.downloadSecondaryTrackOnDemand('vi', { videoId: 'vid429' });
    assert.strictEqual(res, false, 'Returned false cleanly');
    assert.strictEqual(networkAttempts, 0, 'Did not make synthetic timedtext request to YouTube');
    const failedUntil = mgr.failedLanguages.get('vid429_vi');
    assert.ok(typeof failedUntil === 'number' && failedUntil > Date.now() + 50000, 'Negative cache set for 60s');
  });

  console.log('\n20. Rolling Subtitle Deduplication & Independent Sentence Display');

  await test('cleanAndMergeCues removes middle rolling transition sentences and displays sentences independently', () => {
    // User request case: 3 cues where middle cue is an overlapping bridge
    const rawCues = [
      { start: 0.0, end: 4.0, text: 'i love pizza, pizza is really good.' },
      { start: 4.0, end: 8.0, text: 'pizza is really good. And it is a nice day' },
      { start: 8.0, end: 12.0, text: 'And it is a nice day to have a pie of pizza' }
    ];

    const cleaned = SubtitleManager.cleanAndMergeCues(rawCues);
    assert.strictEqual(cleaned.length, 2, 'Middle bridge sentence was removed');
    assert.strictEqual(cleaned[0].text, 'i love pizza, pizza is really good.');
    assert.strictEqual(cleaned[1].text, 'And it is a nice day to have a pie of pizza');
    assert.strictEqual(cleaned[0].end, 8.0, 'First cue timestamp extended cleanly across transition');
    assert.strictEqual(cleaned[1].start, 8.0, 'Second cue starts cleanly without gap');
  });

  await test('parseVttOrSrt deduplicates YouTube 2-line rolling captions and skips flash frames', () => {
    const rollingVtt = `WEBVTT
Kind: captions
Language: en

00:00:00.080 --> 00:00:02.230
welcome back to rm transit one of my

00:00:02.230 --> 00:00:02.240
welcome back to rm transit one of my

00:00:02.240 --> 00:00:03.830
welcome back to rm transit one of my
favorite cities i've ever visited is

00:00:03.830 --> 00:00:03.840
favorite cities i've ever visited is

00:00:03.840 --> 00:00:05.830
favorite cities i've ever visited is
berlin and more than any other city i've
`;
    const cues = parseVttOrSrt(rollingVtt);
    assert.strictEqual(cues.length, 3, 'Extracted 3 independent sequential cues');
    assert.strictEqual(cues[0].text, 'welcome back to rm transit one of my');
    assert.strictEqual(cues[1].text, "favorite cities i've ever visited is");
    assert.strictEqual(cues[2].text, "berlin and more than any other city i've");
  });

  await test('cleanAndMergeCues trims repeated prefix between consecutive subtitle sentences', () => {
    const raw = [
      { start: 0.0, end: 3.0, text: 'Learning languages takes daily practice.' },
      { start: 3.0, end: 6.0, text: 'takes daily practice. Consistency is the key.' }
    ];
    const cleaned = SubtitleManager.cleanAndMergeCues(raw);
    assert.strictEqual(cleaned.length, 2);
    assert.strictEqual(cleaned[0].text, 'Learning languages takes daily practice.');
    assert.strictEqual(cleaned[1].text, 'Consistency is the key.', 'Repeated prefix trimmed and capitalized');
  });

  console.log('\n21. Table of New Words in Original Language (Independent from Breakpoint)');

  await test('PromptBuilder.buildVideoBreakpointsAndActivitiesPrompt includes newWords schema and instructions', () => {
    const promptObj = PromptBuilder.buildVideoBreakpointsAndActivitiesPrompt({
      videoTitle: 'Learn Japanese Basics',
      videoDuration: 700,
      chapters: [{ title: 'Greetings', start: 0, end: 350 }],
      transcriptChunks: [
        { start: 0, end: 180, chapterTitle: 'Greetings', text: 'Konnichiwa means hello. Arigatou means thank you.' }
      ],
      minIntervalSeconds: 300
    });

    assert.ok(promptObj.schema.properties.newWords, 'newWords property exists in schema');
    assert.strictEqual(promptObj.schema.properties.newWords.type, 'ARRAY');
    assert.ok(promptObj.schema.properties.newWords.items.properties.word);
    assert.ok(promptObj.schema.properties.newWords.items.properties.meaning);
    assert.ok(promptObj.schema.properties.newWords.items.properties.context);
    assert.ok(promptObj.schema.properties.newWords.items.properties.timestamp);
    assert.ok(promptObj.systemPrompt.includes('TABLE OF NEW WORDS IN ORIGINAL LANGUAGE'));
    assert.ok(promptObj.systemPrompt.includes('INDEPENDENT FROM BREAKPOINTS'));
    assert.ok(promptObj.userPrompt.includes('table of new words in the original language'));
  });

  await test('YouTubeLearningAssistantApp receives new words and stores them independently of breakpoints', async () => {
    const mockSender = async (action, payload) => {
      if (action === 'AI_PLAN_BREAKPOINTS_AND_ACTIVITIES') {
        return {
          ok: true,
          data: {
            overview: 'Learn French video.',
            newWords: [
              { word: 'Bonjour', pronunciation: 'bɔ̃.ʒuʁ', meaning: 'Hello', context: 'Bonjour tout le monde', timestamp: 15 },
              { word: 'Merci', pronunciation: 'mɛʁ.si', meaning: 'Thank you', context: 'Merci beaucoup', timestamp: 45 }
            ],
            breakpoints: [
              {
                timestamp: 300,
                milestoneTitle: 'French Greetings Checkpoint',
                activity: { type: 'multiple_choice', question: 'What does Bonjour mean?', options: ['Hello', 'Bye', 'Yes', 'No'], correctIndex: 0, explanation: 'Bonjour means hello.' }
              }
            ]
          }
        };
      }
      return { ok: true };
    };

    const app = new YouTubeLearningAssistantApp({ requestHandler: mockSender });
    app.currentVideoId = 'french101';
    app.sessionEpoch = 1;
    app.videoController.isSessionValid = () => true;

    await app.planBreakpointsWithGemini('french101', 1, { chunks: [{ start: 0, end: 300, text: 'Bonjour tout le monde' }] }, []);

    assert.strictEqual(app.vocabulary.length, 2, 'Received 2 new words in original language');
    assert.strictEqual(app.vocabulary[0].word, 'Bonjour');
    assert.strictEqual(app.vocabulary[0].meaning, 'Hello');
    assert.strictEqual(app.vocabulary[1].word, 'Merci');
    assert.strictEqual(app.uiManager.vocabulary.length, 2, 'UIManager received vocabulary');
  });

  await test('UIManager.showVocabularyDrawer renders original language table, contexts, and clickable timestamps', () => {
    const origDoc = globalThis.document;
    let soughtTimestamp = null;
    let appendedElement = null;

    const mockElements = [];
    globalThis.document = {
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          style: {},
          dataset: {},
          children: [],
          appendChild: (c) => el.children.push(c),
          querySelector: (sel) => {
            if (sel === '#yt-learn-vocab-filter') return { addEventListener: () => {}, value: '' };
            if (sel === '#yt-learn-vocab-tbody') return { querySelectorAll: () => [] };
            if (sel === '#yt-learn-vocab-visible-count') return { textContent: '' };
            return null;
          },
          querySelectorAll: (sel) => {
            if (sel === '.yt-learn-timestamp-btn') {
              return [
                {
                  dataset: { time: '45.5' },
                  addEventListener: (evt, handler) => {
                    if (evt === 'click') el._seekClick = handler;
                  }
                }
              ];
            }
            return [];
          }
        };
        mockElements.push(el);
        return el;
      }
    };

    try {
      const ui = new UIManager({
        onSeekToTimestamp: (ts) => {
          soughtTimestamp = ts;
        }
      });
      ui.rootContainer = {
        innerHTML: '',
        appendChild: (el) => { appendedElement = el; }
      };

      const sampleWords = [
        {
          word: 'Konnichiwa',
          pronunciation: 'kon-nee-chee-wah',
          meaning: 'Good afternoon / Hello',
          context: 'Konnichiwa everyone, welcome to the lesson.',
          timestamp: 45.5
        }
      ];

      ui.setVocabulary(sampleWords, { notify: false });
      assert.strictEqual(ui.vocabulary.length, 1);

      ui.showVocabularyDrawer();
      assert.strictEqual(ui.activePanel, 'vocabulary', 'Active panel set to vocabulary');
      assert.ok(appendedElement, 'Appended drawer to rootContainer');
      assert.ok(appendedElement.innerHTML.includes('Konnichiwa'), 'Original language word rendered');
      assert.ok(appendedElement.innerHTML.includes('Good afternoon / Hello'), 'Meaning rendered');
      assert.ok(appendedElement.innerHTML.includes('kon-nee-chee-wah'), 'Pronunciation rendered');
      assert.ok(appendedElement.innerHTML.includes('00:45'), 'Timestamp formatted');

      const card = mockElements.find((e) => e.innerHTML && e.innerHTML.includes('yt-learn-vocab-card'));
      if (card && typeof card._seekClick === 'function') {
        card._seekClick();
        assert.strictEqual(soughtTimestamp, 45.5, 'Clicking timestamp seeks video');
      }
    } finally {
      globalThis.document = origDoc;
    }
  });

  await test('YouTubeLearningAssistantApp.extractFallbackVocabulary extracts key terms from chapters and cues when offline', () => {
    const chapters = [
      { title: '1. Introduction to Photosynthesis', start: 0, end: 120 },
      { title: '2. Chlorophyll Mechanics', start: 120, end: 300 }
    ];
    const cues = [
      { start: 10, end: 30, text: 'Plants absorb sunlight through Chloroplast structures.' }
    ];

    const fallback = YouTubeLearningAssistantApp.extractFallbackVocabulary([], cues, chapters);
    assert.ok(fallback.length >= 2, 'Extracted at least 2 key terms');
    assert.strictEqual(fallback[0].word, 'Photosynthesis');
    assert.strictEqual(fallback[1].word, 'Chlorophyll Mechanics');
  });

  await test('UIManager.showQuickGlanceToast displays preview notification before diving into video', () => {
    const origDoc = globalThis.document;
    let appendedToast = null;

    globalThis.document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        style: {},
        querySelector: () => null,
        remove: () => {}
      })
    };

    try {
      const ui = new UIManager({});
      ui.rootContainer = {
        innerHTML: '',
        querySelector: () => null,
        appendChild: (el) => { appendedToast = el; }
      };

      ui.showQuickGlanceToast([
        { word: 'Danke', meaning: 'Thank you' }
      ]);

      assert.ok(appendedToast, 'Toast appended to container');
      assert.ok(appendedToast.innerHTML.includes('1 New Words in Original Language'));
      assert.ok(appendedToast.innerHTML.includes('Quick glance before diving into the video'));
    } finally {
      globalThis.document = origDoc;
    }
  });

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
