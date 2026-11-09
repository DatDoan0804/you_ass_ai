/**
 * @fileoverview Adaptive Learning Manager (`learning-manager.js`)
 *
 * Fixes:
 * 1. Replaced dynamic `await import('../storage/database.js')` (which fails in Firefox
 *    content scripts due to relative `moz-extension://` resolution) with direct static import
 *    of `Database` from `../storage/database.js`.
 * 2. Wrapped storage updates in `processCompletedActivity` in a `try/catch` so an IndexedDB
 *    transaction glitch can never block the grading UI from rendering.
 */

import { db, Database } from '../storage/database.js';
import { SpacedRepetition } from './spaced-repetition.js';
import { historyManager } from './history-manager.js';

export class LearningManager {
  constructor() {
    this.consecutiveHighScores = 0;
    this.consecutiveStruggles = 0;
  }

  /**
   * Processes a completed activity evaluation and updates the user's concept mastery profile.
   */
  async processCompletedActivity({
    videoId,
    videoTitle,
    videoTime,
    activity,
    userAnswer,
    evaluation
  }) {
    try {
      await historyManager.recordInteraction({
        videoId,
        videoTitle,
        videoTime,
        activity,
        userAnswer,
        evaluation,
        skipped: false
      });

      const score = Number(evaluation?.scoreNormalized ?? 0.7);
      if (score >= 0.85) {
        this.consecutiveHighScores += 1;
        this.consecutiveStruggles = 0;
      } else if (score < 0.55) {
        this.consecutiveStruggles += 1;
        this.consecutiveHighScores = 0;
      } else {
        this.consecutiveStruggles = 0;
      }

      const conceptName = activity.conceptName || 'General Comprehension';
      const conceptId = SpacedRepetition.normalizeConceptId(conceptName);
      const existing = await db.getConcept(conceptId);

      const updatedConcept = SpacedRepetition.updateConceptSchedule(existing, {
        conceptName,
        scoreNormalized: score,
        category: activity.subjectCategory || 'general',
        summary: activity.conceptSummary || '',
        misunderstandingNote: evaluation?.misunderstanding || ''
      });

      await db.saveConcept(updatedConcept);
      return updatedConcept;
    } catch (err) {
      console.warn('[YT-Learn LearningManager] Non-fatal storage update warning:', err.message);
      return null;
    }
  }

  async recordSkippedActivity({ videoId, videoTitle, videoTime, activity }) {
    try {
      return await historyManager.recordInteraction({
        videoId,
        videoTitle,
        videoTime,
        activity,
        userAnswer: null,
        evaluation: null,
        skipped: true
      });
    } catch (err) {
      console.warn('[YT-Learn LearningManager] Failed recording skipped activity:', err.message);
      return null;
    }
  }

  async getLearnerContext(videoId) {
    try {
      const [allConcepts, videoContext, settings] = await Promise.all([
        db.getAllConcepts(),
        historyManager.getCompactVideoContext(videoId),
        Database.getSettings()
      ]);

      const strongConcepts = allConcepts
        .filter((c) => c.masteryScore >= 78)
        .sort((a, b) => b.masteryScore - a.masteryScore)
        .slice(0, 6)
        .map((c) => ({ name: c.name, masteryScore: c.masteryScore }));

      const strugglingConcepts = SpacedRepetition.getDueOrStrugglingConcepts(allConcepts, 6).map(
        (c) => ({
          name: c.name,
          masteryScore: c.masteryScore,
          struggleCount: c.struggleCount,
          lastMisunderstanding:
            c.history && c.history.length > 0
              ? c.history[c.history.length - 1].misunderstandingNote
              : null
        })
      );

      let targetDifficulty = 'medium';
      if (this.consecutiveStruggles >= 1) {
        targetDifficulty = 'easy';
      } else if (this.consecutiveHighScores >= 2 || settings.learnerLevel === 'advanced') {
        targetDifficulty = 'hard';
      } else if (settings.learnerLevel === 'beginner') {
        targetDifficulty = 'easy';
      }

      const adaptiveIntervalMultiplier =
        this.consecutiveHighScores >= 3
          ? 1.35
          : this.consecutiveStruggles >= 2
          ? 0.85
          : 1.0;

      return {
        strongConcepts,
        strugglingConcepts,
        previousVideoActivities: videoContext,
        targetDifficulty,
        adaptiveIntervalMultiplier,
        preferredActivityTypes: settings.preferredActivityTypes,
        learnerLevel: settings.learnerLevel
      };
    } catch (err) {
      console.warn('[YT-Learn LearningManager] Fallback learnerContext due to error:', err.message);
      return {
        strongConcepts: [],
        strugglingConcepts: [],
        previousVideoActivities: [],
        targetDifficulty: 'medium',
        adaptiveIntervalMultiplier: 1.0,
        preferredActivityTypes: [],
        learnerLevel: 'intermediate'
      };
    }
  }
}

export const learningManager = new LearningManager();
