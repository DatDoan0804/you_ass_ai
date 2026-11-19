/**
 * @fileoverview ActivityOverlay Component (Preact)
 * Renders interactive learning checkpoint modals: Multiple Choice, Short Answer,
 * Code Spot-the-Mistake, Teach-Back, and Prediction activities with real-time
 * grading, evaluation display, and interactive mini-tutor follow-up.
 */

import { html, useSafeState, useSafeEffect } from './render-helper.js';

function formatActivityType(type = '') {
  switch (type) {
    case 'multiple_choice':
      return 'Multiple Choice';
    case 'short_answer':
      return 'Short Answer';
    case 'prediction':
      return 'Prediction Challenge';
    case 'spot_the_mistake':
      return 'Spot the Mistake';
    case 'teach_back':
      return 'Teach-Back Challenge';
    default:
      return type
        ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Checkpoint';
  }
}

export function ActivityOverlay({
  activity = {},
  restoredAnswer = null,
  onClose = () => {},
  onSkip = () => {},
  onMinimize = () => {},
  onRequestExplanation = async () => ({}),
  onSubmitAnswer = async () => ({}),
  onAskTutorFollowUp = async () => ({}),
  onContinueWatching = () => {}
}) {
  const [answer, setAnswer] = useSafeState(restoredAnswer ?? '');
  const [showHint, setShowHint] = useSafeState(false);
  const [explanation, setExplanation] = useSafeState(null);
  const [isExplaining, setIsExplaining] = useSafeState(false);
  const [isSubmitting, setIsSubmitting] = useSafeState(false);
  const [submitError, setSubmitError] = useSafeState(null);
  const [evaluation, setEvaluation] = useSafeState(null);
  const [validationMsg, setValidationMsg] = useSafeState('');

  // Mini-tutor interactive chat
  const [tutorQuery, setTutorQuery] = useSafeState('');
  const [tutorLoading, setTutorLoading] = useSafeState(false);
  const [tutorHistory, setTutorHistory] = useSafeState([]);

  const isPrediction = activity.type === 'prediction';
  const isMultipleChoice = activity.type === 'multiple_choice';
  const options = Array.isArray(activity.options) ? activity.options : [];

  const rawClean = activity.conceptName || '';
  const displayConceptTitle =
    rawClean && !/^(concept check|section \d+|part \d+)$/i.test(rawClean)
      ? rawClean
      : activity.title || (activity.isSummary ? 'End-of-Video Wrap-Up' : 'Quick Check');

  const hasHelpfulContext = Boolean(
    activity.contextSummary &&
      !activity.contextSummary.startsWith('Segment ') &&
      !activity.contextSummary.includes('Covers ') &&
      activity.contextSummary.trim() !== activity.prompt
  );

  const handleOptionSelect = (opt) => {
    const val = typeof opt === 'object' && opt !== null ? opt.id ?? opt.text : opt;
    setAnswer(val);
    setValidationMsg('');
  };

  const handleExplain = async () => {
    setIsExplaining(true);
    try {
      const exp = await onRequestExplanation(activity);
      setExplanation(exp);
    } catch (err) {
      console.warn('[ActivityOverlay] Explanation request failed:', err);
    } finally {
      setIsExplaining(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const isEmpty =
      answer === null ||
      answer === undefined ||
      (typeof answer === 'string' && !answer.trim()) ||
      (Array.isArray(answer) && answer.length === 0);

    if (isEmpty) {
      setValidationMsg('⚠️ Please enter your answer or select an option before clicking Submit.');
      return;
    }

    setValidationMsg('');
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const evalResult = await onSubmitAnswer(activity, answer);
      setEvaluation(evalResult);
    } catch (err) {
      setSubmitError(
        err?.message || 'Unable to evaluate answer right now. Your response has been preserved.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendTutorFollowUp = async () => {
    if (!tutorQuery.trim() || tutorLoading) return;
    const q = tutorQuery.trim();
    setTutorQuery('');
    setTutorLoading(true);

    const userMsg = { role: 'user', text: q };
    setTutorHistory((prev) => [...prev, userMsg]);

    try {
      const res = await onAskTutorFollowUp({
        activity,
        userAnswer: answer,
        evaluation,
        query: q
      });
      const tutorMsg = {
        role: 'tutor',
        text: res?.directAnswer || res?.explanation || 'Here is more context from the lesson.',
        transcriptGrounding: res?.transcriptGrounding,
        keyInsight: res?.keyInsight
      };
      setTutorHistory((prev) => [...prev, tutorMsg]);
    } catch (err) {
      const errMsg = {
        role: 'tutor',
        text: 'Sorry, I could not retrieve an answer right now. Please try again.'
      };
      setTutorHistory((prev) => [...prev, errMsg]);
    } finally {
      setTutorLoading(false);
    }
  };

  const handleRetry = () => {
    setEvaluation(null);
    setSubmitError(null);
    setTutorHistory([]);
  };

  // Keyboard shortcut for Multiple Choice: 1, 2, 3, 4
  useSafeEffect(() => {
    if (!isMultipleChoice || evaluation || isSubmitting) return;

    const handleKey = (e) => {
      if (
        e.target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)
      ) {
        return;
      }
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= options.length) {
        e.preventDefault();
        handleOptionSelect(options[num - 1]);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [isMultipleChoice, options, evaluation, isSubmitting]);

  // ---------------------------------------------------------------------------
  // Evaluation View
  // ---------------------------------------------------------------------------
  if (evaluation) {
    const score = evaluation.score ?? evaluation.scorePercent ?? (evaluation.isCorrect ? 100 : 50);
    const scoreClass =
      score >= 80 ? 'score-high' : score >= 50 ? 'score-medium' : 'score-low';
    const isObjective = evaluation.evaluationMode === 'objective';
    const mc = evaluation.conciseMcExplanation || {
      whyCorrect: evaluation.whatWasCorrect,
      whyOthersIncorrect: evaluation.missingOrIncorrect,
      coreConceptTakeaway: evaluation.improvedAnswerExample || evaluation.suggestedAnswer
    };

    const correctPoints = Array.isArray(evaluation.correctPoints)
      ? evaluation.correctPoints
      : evaluation.correctPoints ? [evaluation.correctPoints] : [];
    const missingPoints = Array.isArray(evaluation.missingPoints)
      ? evaluation.missingPoints
      : evaluation.missingPoints ? [evaluation.missingPoints] : [];
    const misconceptions = Array.isArray(evaluation.misconceptions)
      ? evaluation.misconceptions
      : evaluation.misconceptions ? [evaluation.misconceptions] : [];
    const suggestedAnswer =
      evaluation.suggestedAnswer || evaluation.improvedAnswerExample || evaluation.modelAnswer || '';
    const feedback =
      evaluation.feedback || evaluation.strengths || evaluation.overallFeedback?.overallEvaluation || '';

    return html`
      <div
        class="yt-learn-overlay-backdrop"
        data-activity-id=${activity.id}
        onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
      >
        <div
          class="yt-learn-card yt-learn-activity-card yt-learn-eval-card"
          onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
        >
          <div class="yt-learn-card-header">
            <div class="yt-learn-card-title-group">
              <span class="yt-learn-card-icon">🎓</span>
              <h3 class="yt-learn-card-title">${displayConceptTitle} — Evaluation</h3>
            </div>
            <div class="yt-learn-score-badge ${scoreClass}" id="yt-learn-score-badge">
              ${score} / 100
            </div>
          </div>

          <div class="yt-learn-card-body yt-learn-eval-body">
            ${isObjective
              ? html`
                  ${mc.whyCorrect
                    ? html`
                        <div class="yt-learn-eval-section yt-learn-eval-strengths">
                          <h4 style="color:#a7f3d0;">✓ Why the correct answer is right</h4>
                          <p>${mc.whyCorrect}</p>
                        </div>
                      `
                    : ''}
                  ${mc.whyOthersIncorrect
                    ? html`
                        <div class="yt-learn-eval-section yt-learn-eval-weaknesses">
                          <h4 style="color:#fde68a;">△ Why other options are incorrect</h4>
                          <p>${mc.whyOthersIncorrect}</p>
                        </div>
                      `
                    : ''}
                  ${mc.coreConceptTakeaway
                    ? html`
                        <div class="yt-learn-eval-section yt-learn-eval-model">
                          <h4 style="color:#7dd3fc;">💡 Core Concept Takeaway</h4>
                          <blockquote>"${mc.coreConceptTakeaway}"</blockquote>
                        </div>
                      `
                    : ''}
                `
              : html`
                  ${correctPoints.length > 0
                    ? html`
                        <div class="yt-learn-eval-points-box yt-learn-points-correct">
                          <div
                            class="yt-learn-points-heading"
                            style="color:#a7f3d0;font-weight:700;font-size:12.5px;"
                          >
                            ✓ What you understood well:
                          </div>
                          <ul
                            style="margin:4px 0 0 16px;padding:0;color:#e2e8f0;font-size:12px;line-height:1.5;"
                          >
                            ${correctPoints.map((pt) => html`<li>${pt}</li>`)}
                          </ul>
                        </div>
                      `
                    : feedback
                      ? html`
                          <div class="yt-learn-eval-section yt-learn-eval-strengths">
                            <h4>What you did well</h4>
                            <p>${feedback}</p>
                          </div>
                        `
                      : ''}

                  ${missingPoints.length > 0 || misconceptions.length > 0
                    ? html`
                        <div class="yt-learn-eval-points-box yt-learn-points-missing">
                          <div
                            class="yt-learn-points-heading"
                            style="color:#fde68a;font-weight:700;font-size:12.5px;"
                          >
                            △ What was missing or needs improvement:
                          </div>
                          <ul
                            style="margin:4px 0 0 16px;padding:0;color:#e2e8f0;font-size:12px;line-height:1.5;"
                          >
                            ${missingPoints.map((pt) => html`<li>${pt}</li>`)}
                            ${misconceptions.map(
                              (m) => html`<li><strong>Misconception:</strong> ${m}</li>`
                            )}
                          </ul>
                        </div>
                      `
                    : evaluation.weaknesses || evaluation.missingNuances
                      ? html`
                          <div class="yt-learn-eval-section yt-learn-eval-weaknesses">
                            <h4>Areas to improve</h4>
                            <p>${evaluation.weaknesses || evaluation.missingNuances}</p>
                          </div>
                        `
                      : ''}

                  ${suggestedAnswer
                    ? html`
                        <div class="yt-learn-improved-answer-card" id="yt-learn-improved-answer">
                          <div style="font-weight:700;color:#10b981;font-size:12.5px;">
                            💡 Suggested Model Answer
                          </div>
                          <div
                            id="yt-learn-improved-answer-body"
                            style="color:#f8fafc;line-height:1.5;font-size:12px;"
                          >
                            ${suggestedAnswer}
                          </div>
                        </div>
                      `
                    : ''}
                `}

            <!-- Interactive Follow-up Mini-Tutor -->
            <div class="yt-learn-tutor-container" id="yt-learn-tutor-container" style="margin-top:18px;">
              <h4 style="color:#7dd3fc;margin-bottom:8px;font-size:13px;">💬 Ask AI Tutor about this concept</h4>
              <div class="yt-learn-tutor-chat-history">
                ${tutorHistory.map(
                  (msg) => html`
                    <div class="yt-learn-chat-msg ${msg.role}">
                      <div class="yt-learn-chat-author">${msg.role === 'user' ? 'You' : 'AI Tutor'}</div>
                      <div class="yt-learn-chat-text">${msg.text}</div>
                      ${msg.keyInsight
                        ? html`<div class="yt-learn-chat-insight">💡 ${msg.keyInsight}</div>`
                        : ''}
                    </div>
                  `
                )}
                ${tutorLoading
                  ? html`
                      <div class="yt-learn-chat-msg tutor yt-learn-loading">
                        <div class="yt-learn-spinner"></div> Thinking...
                      </div>
                    `
                  : ''}
              </div>

              <div class="yt-learn-tutor-input-row" style="display:flex;gap:8px;margin-top:8px;">
                <input
                  type="text"
                  class="yt-learn-input"
                  id="yt-learn-tutor-input"
                  placeholder="Need clarification? Ask here..."
                  value=${tutorQuery}
                  onInput=${(e) => setTutorQuery(e.target.value)}
                  onKeyDown=${(e) => e.key === 'Enter' && handleSendTutorFollowUp()}
                  style="flex:1;"
                />
                <button
                  class="yt-learn-btn yt-learn-btn-secondary"
                  id="yt-learn-tutor-send"
                  type="button"
                  disabled=${tutorLoading || !tutorQuery.trim()}
                  onClick=${(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    handleSendTutorFollowUp();
                  }}
                >
                  Ask
                </button>
              </div>
            </div>
          </div>

          <div class="yt-learn-card-footer" style="display:flex;justify-content:flex-end;gap:10px;">
            <button
              class="yt-learn-btn yt-learn-btn-secondary"
              id="yt-learn-retry-btn"
              type="button"
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                handleRetry();
              }}
            >
              Try Again
            </button>
            <button
              class="yt-learn-btn yt-learn-btn-primary"
              id="yt-learn-continue-btn"
              type="button"
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                onContinueWatching();
              }}
            >
              Continue Watching ▶
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Activity Prompt & Question View
  // ---------------------------------------------------------------------------
  return html`
    <div
      class="yt-learn-overlay-backdrop"
      data-activity-id=${activity.id}
      onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
    >
      <div
        class="yt-learn-card yt-learn-activity-card"
        onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
      >
        <div class="yt-learn-card-header">
          <div class="yt-learn-card-title-group">
            <span class="yt-learn-card-icon">🎯</span>
            <div>
              <div class="yt-learn-activity-badges">
                <span class="yt-learn-badge difficulty-${activity.difficulty || 'medium'}">
                  ${activity.difficulty || 'medium'}
                </span>
                <span class="yt-learn-badge activity-type ${isPrediction ? 'prediction' : ''}">
                  ${activity.title || formatActivityType(activity.type)}
                </span>
                ${activity.isSummary
                  ? html`<span class="yt-learn-badge summary-badge" style="background:#fde047;color:#0f172a;font-weight:700;">🎓 End-of-Video Summary</span>`
                  : ''}
              </div>
              <h3 class="yt-learn-card-title">${displayConceptTitle}</h3>
            </div>
          </div>

          <div class="yt-learn-card-header-actions">
            <button
              class="yt-learn-btn yt-learn-btn-ghost"
              id="yt-learn-minimize-btn"
              title="Minimize to floating pill"
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                onMinimize(answer);
              }}
            >
              🗕
            </button>
            <button
              class="yt-learn-btn yt-learn-btn-ghost"
              id="yt-learn-close-btn"
              title="Close and skip checkpoint"
              disabled=${isSubmitting}
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                onClose();
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div class="yt-learn-card-body">
          ${hasHelpfulContext
            ? html`<div class="yt-learn-context-box">${activity.contextSummary}</div>`
            : ''}

          <div class="yt-learn-prompt" style="font-size:15px;color:#f8fafc;margin:12px 0 16px;line-height:1.5;">
            ${activity.prompt}
          </div>

          ${activity.codeOrScenarioSnippet
            ? html`<pre class="yt-learn-code-block">${activity.codeOrScenarioSnippet}</pre>`
            : ''}

          <!-- Input Widget Mount -->
          <div class="yt-learn-input-widget-mount" id="yt-learn-input-mount">
            ${isMultipleChoice
              ? html`
                  <div class="yt-learn-options-list">
                    ${options.map((opt, i) => {
                      const optVal = typeof opt === 'object' && opt !== null ? opt.id ?? opt.text : opt;
                      const optLabel = typeof opt === 'object' && opt !== null ? opt.text ?? opt.id : opt;
                      const isSelected = answer === optVal;
                      return html`
                        <button
                          type="button"
                          class="yt-learn-option-btn ${isSelected ? 'is-selected' : ''}"
                          disabled=${isSubmitting}
                          onClick=${(e) => {
                            if (e && e.stopPropagation) e.stopPropagation();
                            handleOptionSelect(optVal);
                          }}
                        >
                          <span class="yt-learn-option-index">${i + 1}</span>
                          <span class="yt-learn-option-text">${optLabel}</span>
                        </button>
                      `;
                    })}
                  </div>
                `
              : html`
                  <textarea
                    class="yt-learn-textarea"
                    id="yt-learn-answer-input"
                    rows="4"
                    placeholder="Type your explanation or thoughts here..."
                    disabled=${isSubmitting}
                    value=${answer}
                    onInput=${(e) => {
                      setAnswer(e.target.value);
                      setValidationMsg('');
                    }}
                  ></textarea>
                `}
          </div>

          <!-- Hint & Explanation Toggles -->
          <div class="yt-learn-aux-actions" style="display:flex;gap:10px;margin-top:14px;">
            <button
              class="yt-learn-btn yt-learn-btn-ghost yt-learn-btn-sm"
              id="yt-learn-hint-btn"
              type="button"
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                setShowHint((prev) => !prev);
              }}
            >
              💡 ${showHint ? 'Hide Hint' : 'Need a Hint?'}
            </button>
            <button
              class="yt-learn-btn yt-learn-btn-ghost yt-learn-btn-sm"
              id="yt-learn-explain-btn"
              type="button"
              disabled=${isExplaining}
              onClick=${(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                handleExplain();
              }}
            >
              📖 ${isExplaining ? 'Explaining...' : 'Explain Concept'}
            </button>
          </div>

          ${showHint
            ? html`
                <div class="yt-learn-hint-box" id="yt-learn-hint-area" style="display:block;margin-top:10px;padding:10px 14px;background:rgba(234,179,8,0.1);border-left:3px solid #eab308;border-radius:4px;color:#fde047;font-size:12.5px;">
                  ${activity.hint || 'Think about what the speaker just said or showed on screen.'}
                </div>
              `
            : ''}

          ${explanation
            ? html`
                <div class="yt-learn-explanation-panel" id="yt-learn-explain-mount" style="margin-top:12px;padding:12px 14px;background:rgba(30,41,59,0.7);border-radius:8px;font-size:13px;line-height:1.5;">
                  <h4 style="color:#38bdf8;margin-bottom:6px;">Concept Breakdown</h4>
                  <p>${explanation.explanation || explanation.summary || JSON.stringify(explanation)}</p>
                </div>
              `
            : ''}

          <!-- Status / Loading / Error Banner -->
          <div id="yt-learn-status-mount" style="margin-top:12px;">
            ${validationMsg
              ? html`<div class="yt-learn-error-banner">${validationMsg}</div>`
              : ''}

            ${isSubmitting
              ? html`
                  <div class="yt-learn-loading-banner" id="yt-learn-grading-loader">
                    <div class="yt-learn-spinner"></div>
                    <span>Evaluating your response...</span>
                  </div>
                `
              : ''}

            ${submitError
              ? html`
                  <div class="yt-learn-error-banner" id="yt-learn-grading-error">
                    <div style="font-weight:700;margin-bottom:4px;">⚠️ Grading Service Unavailable</div>
                    <div style="margin-bottom:8px;">${submitError}</div>
                    <div style="display:flex;gap:8px;">
                      <button
                        class="yt-learn-btn yt-learn-btn-primary"
                        id="yt-learn-error-retry-btn"
                        type="button"
                        onClick=${(e) => {
                          if (e && e.stopPropagation) e.stopPropagation();
                          handleSubmit();
                        }}
                      >
                        🔄 Retry Grading
                      </button>
                      <button
                        class="yt-learn-btn yt-learn-btn-ghost"
                        id="yt-learn-error-skip-btn"
                        type="button"
                        onClick=${(e) => {
                          if (e && e.stopPropagation) e.stopPropagation();
                          onSkip();
                        }}
                      >
                        Skip Activity
                      </button>
                    </div>
                  </div>
                `
              : ''}
          </div>
        </div>

        <div class="yt-learn-card-footer" id="yt-learn-activity-footer" style="display:flex;justify-content:space-between;align-items:center;">
          <button
            class="yt-learn-btn yt-learn-btn-ghost"
            id="yt-learn-skip-btn"
            type="button"
            disabled=${isSubmitting}
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              onSkip();
            }}
          >
            Skip for now
          </button>
          <button
            class="yt-learn-btn yt-learn-btn-primary"
            id="yt-learn-submit-btn"
            type="button"
            disabled=${isSubmitting}
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              handleSubmit();
            }}
          >
            ${isSubmitting ? 'Grading...' : 'Submit Answer'}
          </button>
        </div>
      </div>
    </div>
  `;
}
