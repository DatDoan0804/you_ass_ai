/**
 * @fileoverview Spaced Repetition Scheduler (`spaced-repetition.js`)
 *
 * Implements an adaptive SM-2 inspired spaced-repetition algorithm tailored for
 * interactive video learning. Tracks:
 * - `easinessFactor` (EF): 1.3 to 2.8
 * - `intervalMinutes`: dynamic review intervals (can trigger later in the same long video or across future videos)
 * - `repetitions`: consecutive successful recalls
 * - `masteryScore`: 0 to 100 normalized mastery metric
 * - `struggleCount`: count of times the user struggled with this concept
 */

export class SpacedRepetition {
  /**
   * Normalizes a concept name into a stable key (e.g., "JavaScript Promises" -> "javascript-promises").
   * @param {string} name
   * @returns {string}
   */
  static normalizeConceptId(name) {
    return String(name || 'general-concept')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'general-concept';
  }

  /**
   * Creates a fresh concept mastery record.
   * @param {string} conceptName
   * @param {string} [category='general']
   * @param {string} [summary='']
   */
  static createInitialRecord(conceptName, category = 'general', summary = '') {
    const conceptId = SpacedRepetition.normalizeConceptId(conceptName);
    return {
      conceptId,
      name: conceptName,
      category,
      summary,
      masteryScore: 50, // Neutral starting point
      easinessFactor: 2.3,
      repetitions: 0,
      struggleCount: 0,
      intervalMinutes: 10,
      lastReviewedAt: Date.now(),
      nextReviewAt: Date.now() + 10 * 60 * 1000,
      history: []
    };
  }

  /**
   * Updates a concept's mastery and schedules its next review based on evaluation quality.
   *
   * @param {object} existingRecord - Existing concept record (or null to create new)
   * @param {object} params
   * @param {string} params.conceptName
   * @param {number} params.scoreNormalized - Score from 0.0 (complete failure) to 1.0 (mastery)
   * @param {string} [params.category]
   * @param {string} [params.summary]
   * @param {string} [params.misunderstandingNote]
   * @returns {object} Updated concept record
   */
  static updateConceptSchedule(existingRecord, {
    conceptName,
    scoreNormalized,
    category = 'general',
    summary = '',
    misunderstandingNote = ''
  }) {
    const record = existingRecord
      ? { ...existingRecord }
      : SpacedRepetition.createInitialRecord(conceptName, category, summary);

    // Map 0.0 - 1.0 score to SM-2 quality grade (0 - 5)
    const clampedScore = Math.max(0, Math.min(1, Number(scoreNormalized) || 0));
    const quality = Math.round(clampedScore * 5);

    if (summary && (!record.summary || summary.length > record.summary.length)) {
      record.summary = summary;
    }

    // Update Easiness Factor (EF)
    const efDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    record.easinessFactor = Math.max(1.3, Math.min(2.8, record.easinessFactor + efDelta));

    if (quality < 3) {
      // User struggled with this concept
      record.repetitions = 0;
      record.struggleCount = (record.struggleCount || 0) + 1;
      // Schedule short-term reinforcement (5 minutes later so it can be reviewed later in the video or next session)
      record.intervalMinutes = 5;
      record.masteryScore = Math.max(10, Math.round(record.masteryScore * 0.7 + clampedScore * 30));
    } else {
      // User demonstrated understanding
      record.repetitions += 1;
      if (record.repetitions === 1) {
        record.intervalMinutes = 15; // 15 mins
      } else if (record.repetitions === 2) {
        record.intervalMinutes = 120; // 2 hours
      } else {
        record.intervalMinutes = Math.round(record.intervalMinutes * record.easinessFactor);
      }
      record.masteryScore = Math.min(
        100,
        Math.round(record.masteryScore * 0.65 + clampedScore * 100 * 0.35 + 5)
      );
    }

    const now = Date.now();
    record.lastReviewedAt = now;
    record.nextReviewAt = now + record.intervalMinutes * 60 * 1000;

    // Keep last 10 review snapshots
    record.history = [
      ...(record.history || []).slice(-9),
      {
        timestamp: now,
        scoreNormalized: clampedScore,
        quality,
        misunderstandingNote: misunderstandingNote || null
      }
    ];

    return record;
  }

  /**
   * Filters and prioritizes concepts that are due for spaced-repetition reinforcement
   * or where the user has a known knowledge gap.
   *
   * @param {Array<object>} allConcepts
   * @param {number} [limit=5]
   * @returns {Array<object>}
   */
  static getDueOrStrugglingConcepts(allConcepts, limit = 5) {
    const now = Date.now();
    return (allConcepts || [])
      .filter((c) => c.nextReviewAt <= now || c.masteryScore < 60 || c.struggleCount > 0)
      .sort((a, b) => {
        // Prioritize lowest mastery and highest struggle count first
        const priorityA = (100 - a.masteryScore) + a.struggleCount * 15;
        const priorityB = (100 - b.masteryScore) + b.struggleCount * 15;
        return priorityB - priorityA;
      })
      .slice(0, limit);
  }
}
