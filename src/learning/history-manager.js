/**
 * @fileoverview Learning History Manager (`history-manager.js`)
 *
 * Tracks completed and skipped activities within the current video session and across
 * historical sessions. Provides compact context summaries for the AI prompt builder
 * so activities build upon prior sections without repeating questions.
 */

import { db } from '../storage/database.js';

export class HistoryManager {
  constructor() {
    /** @type {Map<string, Array<object>>} videoId -> list of session activities */
    this.sessionCache = new Map();
  }

  /**
   * Records an activity interaction (answered or skipped).
   * @param {object} params
   * @param {string} params.videoId
   * @param {string} params.videoTitle
   * @param {number} params.videoTime
   * @param {object} params.activity
   * @param {any} params.userAnswer
   * @param {object|null} params.evaluation
   * @param {boolean} [params.skipped=false]
   */
  async recordInteraction({
    videoId,
    videoTitle,
    videoTime,
    activity,
    userAnswer,
    evaluation,
    skipped = false
  }) {
    const entry = {
      videoId,
      videoTitle,
      videoTime: Math.round(videoTime),
      activityType: activity.type,
      conceptName: activity.conceptName || 'Core Concept',
      difficulty: activity.difficulty || 'medium',
      prompt: activity.prompt,
      userAnswer: skipped ? '[Skipped]' : userAnswer,
      scoreNormalized: skipped ? null : (evaluation?.scoreNormalized ?? 0),
      isCorrect: skipped ? null : Boolean(evaluation?.isCorrect),
      feedbackSummary: evaluation?.feedback || '',
      misunderstanding: evaluation?.misunderstanding || '',
      skipped
    };

    const saved = await db.addHistoryEntry(entry);

    if (!this.sessionCache.has(videoId)) {
      this.sessionCache.set(videoId, []);
    }
    this.sessionCache.get(videoId).push(saved);

    return saved;
  }

  /**
   * Gets all activity records for a given video.
   * @param {string} videoId
   * @returns {Promise<Array<object>>}
   */
  async getVideoInteractions(videoId) {
    if (this.sessionCache.has(videoId)) {
      return this.sessionCache.get(videoId);
    }
    const records = await db.getVideoHistory(videoId);
    this.sessionCache.set(videoId, records);
    return records;
  }

  /**
   * Builds a concise summary of previous activities in this video so the AI
   * can connect concepts and avoid asking duplicate questions.
   * @param {string} videoId
   * @returns {Promise<Array<object>>}
   */
  async getCompactVideoContext(videoId) {
    const interactions = await this.getVideoInteractions(videoId);
    return interactions.slice(-6).map((item) => ({
      videoTime: item.videoTime,
      activityType: item.activityType,
      conceptName: item.conceptName,
      questionAsked: item.prompt,
      skipped: item.skipped,
      scoreNormalized: item.scoreNormalized,
      misunderstanding: item.misunderstanding
    }));
  }

  /**
   * Returns overall statistics for the UI progress panel.
   * @param {string} [currentVideoId]
   */
  async getStats(currentVideoId) {
    const recent = await db.getRecentHistory(100);
    const completed = recent.filter((r) => !r.skipped && r.scoreNormalized !== null);
    const totalCompleted = completed.length;
    const avgScore = totalCompleted > 0
      ? Math.round(
          (completed.reduce((acc, r) => acc + Number(r.scoreNormalized || 0), 0) / totalCompleted) * 100
        )
      : 0;

    const currentVideoItems = currentVideoId
      ? recent.filter((r) => r.videoId === currentVideoId)
      : [];

    return {
      totalActivities: recent.length,
      totalCompleted,
      averageMasteryPercent: avgScore,
      currentVideoCount: currentVideoItems.length,
      recentItems: recent.slice(0, 15)
    };
  }
}

export const historyManager = new HistoryManager();
