/**
 * @fileoverview Intelligent Breakpoint Detector (`breakpoint-detector.js`)
 *
 * Updates for Issues 3, 4, and 7:
 * 1. Diverse Initial Breakpoint Activities: Instead of seeding every chapter/subtitle breakpoint
 *    with a repetitive `short_answer` or `teach_back` prompt, rotates across diverse activity types
 *    (`multiple_choice`, `short_answer`, `critical_thinking`, `practical_application`, `spot_the_mistake`,
 *    `prediction`, `compare_concepts`, `connect_concepts`) and synthesizes a complete multi-sentence
 *    `exemplarAnswer` (never just the chapter title!).
 * 2. Educational Section Filtering (for Mixed Videos): Supports filtering scheduled breakpoints to
 *    only `educationalChunkIds` when a video is classified as `Mixed` (entertainment + educational segments).
 */

import { ActivityGenerator } from '../ai/activity-generator.js';

const STRENGTH_RANK = { strong: 3, normal: 2, optional: 1 };
const SEED_ACTIVITY_ROTATION = [
  'short_answer',
  'multiple_choice',
  'critical_thinking',
  'practical_application',
  'spot_the_mistake',
  'compare_concepts',
  'connect_concepts',
  'prediction'
];

export class BreakpointDetector {
  /**
   * @param {object} config
   * @param {object} config.settings
   * @param {(msg: string) => void} [config.logger]
   */
  constructor({ settings = {}, logger = console.log } = {}) {
    this.settings = settings;
    this.log = logger;
    /** @type {Map<string, object>} bpId -> scheduled breakpoint & activity entry */
    this.scheduledBreakpoints = new Map();
    /** @type {Set<string>} bpIds that have already been triggered or seeked past */
    this.triggeredIds = new Set();
    /** @type {Set<string>} chunkIds currently being analyzed by the ahead-of-playback pipeline */
    this.inProgressChunkIds = new Set();
    this.lastActivityTimestamp = 0;
    this.videoDuration = 0;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  reset() {
    this.scheduledBreakpoints.clear();
    this.triggeredIds.clear();
    this.inProgressChunkIds.clear();
    this.lastActivityTimestamp = 0;
    this.videoDuration = 0;
  }

  /**
   * Filters scheduled breakpoints for `Mixed` educational/entertainment videos so only
   * substantive educational sections trigger activities.
   * @param {Array<string>} allowedChunkIds
   */
  filterToEducationalChunks(allowedChunkIds = []) {
    if (!Array.isArray(allowedChunkIds) || allowedChunkIds.length === 0) return;
    const allowedSet = new Set(allowedChunkIds);
    for (const [id, bp] of this.scheduledBreakpoints.entries()) {
      if (!allowedSet.has(bp.chunkId) && !allowedSet.has(id)) {
        this.scheduledBreakpoints.delete(id);
      }
    }
  }

  seedInitialCandidates(chunks = [], chapters = [], videoDuration = 0, videoId = 'video') {
    this.videoDuration = Number(videoDuration) || 0;
    const useChapters = this.settings.useYoutubeChapters !== false;

    if (useChapters && Array.isArray(chapters) && chapters.length > 0) {
      this.log(`[Breakpoint] Chapters discovered: ${chapters.length}`);
    } else {
      this.log(`[Breakpoint] Chapters discovered: 0`);
    }

    let seedIndex = 0;

    // 1. Register explicit Chapter Boundaries first (when enabled)
    if (useChapters && Array.isArray(chapters) && chapters.length > 0) {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const boundaryTime = Number(ch.end);
        if (!Number.isFinite(boundaryTime) || boundaryTime <= 0) continue;

        if (this.videoDuration > 0 && boundaryTime >= this.videoDuration - 1.5) {
          continue;
        }

        const matchingChunk =
          chunks.find((c) => Math.abs(c.end - boundaryTime) <= 3.0) ||
          chunks.find((c) => boundaryTime >= c.start && boundaryTime <= c.end) ||
          null;

        const bpId = matchingChunk ? matchingChunk.id : `chapter_${i}`;
        const conceptTitle = ActivityGenerator.cleanConceptName(
          ch.title || matchingChunk?.chapterTitle || `Chapter ${i + 1}`
        ) || `Chapter ${i + 1}`;
        const hasSubstantiveChunkText =
          matchingChunk?.text &&
          matchingChunk.text.length > 35 &&
          !/^(chapter|section|part)\s+\d+[:\s-]*$/i.test(matchingChunk.text.trim());
        const sectionText =
          hasSubstantiveChunkText
            ? matchingChunk.text
            : `In "${conceptTitle}" (${ch.start}s–${ch.end}s), the instructor introduces the core principles, explains how they operate step by step, and demonstrates their practical application.`;

        const rotatedType = SEED_ACTIVITY_ROTATION[seedIndex % SEED_ACTIVITY_ROTATION.length];
        seedIndex += 1;

        const defaultActivity = BreakpointDetector.createGroundedDefaultActivity({
          videoId,
          bpId,
          timestamp: boundaryTime,
          conceptName: conceptTitle,
          sectionText,
          start: ch.start ?? matchingChunk?.start ?? 0,
          end: boundaryTime,
          source: 'chapter',
          preferredType: rotatedType,
          seedIndex
        });

        this.scheduledBreakpoints.set(bpId, {
          id: bpId,
          chunkId: matchingChunk?.id || bpId,
          chunkIndex: matchingChunk?.index ?? i,
          timestamp: Number(boundaryTime.toFixed(2)),
          reason: `End of chapter "${conceptTitle}"`,
          strength: 'strong',
          source: 'chapter',
          aiRefined: false,
          skippedByAi: false,
          activity: defaultActivity
        });

        this.log(`[Breakpoint] Scheduled breakpoint: ${boundaryTime.toFixed(1)}s (Chapter: "${conceptTitle}")`);
      }
    }

    // 2. Register Subtitle Linguistic Boundaries for chunks not already covered by a chapter
    if (Array.isArray(chunks) && chunks.length > 0) {
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const nextChunkFirstCue = chunks[idx + 1]?.cues?.[0] || null;
        if (this.scheduledBreakpoints.has(chunk.id)) continue;

        const linguisticCandidate = BreakpointDetector.findBestLinguisticStop(
          chunk.cues,
          nextChunkFirstCue
        );
        const ts = Number((linguisticCandidate.timestamp || chunk.end).toFixed(2));

        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (this.videoDuration > 0 && ts >= this.videoDuration - 1.5) continue;

        if (this.hasBreakpointNear(ts, 5.0)) continue;

        const rotatedType = SEED_ACTIVITY_ROTATION[seedIndex % SEED_ACTIVITY_ROTATION.length];
        seedIndex += 1;

        const defaultActivity = BreakpointDetector.createGroundedDefaultActivity({
          videoId,
          bpId: chunk.id,
          timestamp: ts,
          conceptName: chunk.chapterTitle || BreakpointDetector.extractConceptLabel(chunk.text, chunk.index),
          sectionText: chunk.text,
          start: chunk.start,
          end: ts,
          source: 'subtitle-structure',
          preferredType: rotatedType,
          seedIndex
        });

        this.scheduledBreakpoints.set(chunk.id, {
          id: chunk.id,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          timestamp: ts,
          reason: linguisticCandidate.reason || 'Completed subtitle explanation boundary',
          strength: linguisticCandidate.strength,
          source: 'subtitle-structure',
          aiRefined: false,
          skippedByAi: false,
          activity: defaultActivity
        });

        this.log(`[Breakpoint] Scheduled breakpoint: ${ts.toFixed(1)}s (Subtitle boundary)`);
      }
    }

    this.deduplicateAndSortBreakpoints();
    this.enforceMinimumInterval();
  }

  /**
   * Sets scheduled breakpoints directly from Gemini AI planning output.
   * Every item includes an AI-crafted activity, timestamp, and optional isSummary flag.
   * @param {Array<object>} aiBreakpoints
   * @param {string} videoId
   */
  setBreakpointsFromAi(aiBreakpoints = [], videoId = 'video') {
    if (!Array.isArray(aiBreakpoints) || aiBreakpoints.length === 0) return;
    this.scheduledBreakpoints.clear();

    for (let i = 0; i < aiBreakpoints.length; i++) {
      const item = aiBreakpoints[i];
      const ts = Number(item.timestamp);
      if (!Number.isFinite(ts) || ts <= 0) continue;

      const bpId = `gemini_bp_${i}_${Math.round(ts)}`;
      const isSummary = Boolean(item.isSummary || (this.videoDuration > 0 && ts >= this.videoDuration - 15));
      const rawAct = item.activity || {};

      const activity = {
        id: `act_${bpId}`,
        videoId,
        type: rawAct.type || (isSummary ? 'teach_back' : 'multiple_choice'),
        title: item.milestoneTitle || (isSummary ? 'End of Video Summary' : `Checkpoint ${i + 1}`),
        conceptName: item.milestoneTitle || item.chapterTitle || 'Core Concept',
        difficulty: rawAct.difficulty || 'medium',
        prompt: rawAct.prompt || rawAct.question || 'Reflect on this key moment.',
        options: Array.isArray(rawAct.options) ? rawAct.options : [],
        correctOptionIndices: Array.isArray(rawAct.correctOptionIndices)
          ? rawAct.correctOptionIndices
          : typeof rawAct.correctIndex === 'number'
          ? [rawAct.correctIndex]
          : [0],
        correctIndex: typeof rawAct.correctIndex === 'number' ? rawAct.correctIndex : 0,
        expectedKeyPoints: rawAct.expectedKeyPoints || rawAct.keyPoints || [],
        exemplarAnswer: rawAct.sampleAnswer || rawAct.exemplarAnswer || rawAct.explanation || '',
        sampleAnswer: rawAct.sampleAnswer || rawAct.exemplarAnswer || rawAct.explanation || '',
        explanation: rawAct.explanation || '',
        hint: rawAct.hint || 'Consider the main takeaway from the preceding section.',
        isSummary,
        source: 'gemini-ai'
      };

      this.scheduledBreakpoints.set(bpId, {
        id: bpId,
        chunkId: bpId,
        chunkIndex: i,
        timestamp: Number(ts.toFixed(2)),
        reason: item.milestoneTitle || (isSummary ? 'Final Video Summary' : `AI Checkpoint ${i + 1}`),
        milestoneTitle: item.milestoneTitle || (isSummary ? 'End of Video Summary' : `Checkpoint ${i + 1}`),
        strength: 'strong',
        source: 'gemini-ai',
        aiRefined: true,
        skippedByAi: false,
        activity,
        isSummary
      });

      this.log(`[Breakpoint] AI scheduled checkpoint: ${ts.toFixed(1)}s ("${item.milestoneTitle || 'Milestone'}"${isSummary ? ' [Summary]' : ''})`);
    }

    this.deduplicateAndSortBreakpoints();
  }

  /**
   * Enforces the 5-minute (300-second) minimum interval between consecutive breakpoints.
   * Rather than merely dropping close candidates, it:
   * 1. Evaluates candidate importance (strength, source, concept depth).
   * 2. Groups close candidates into clusters.
   * 3. Selects the most meaningful learning moment as the anchor (preserving its exact timestamp).
   * 4. Merges closely related concepts, key points, and summaries from neighboring candidates into the anchor.
   * 5. Removes low-value / redundant interruptions.
   * 6. Strictly guarantees that every consecutive pair of scheduled breakpoints is separated by at least minIntervalSeconds (>= 300s).
   */
  enforceMinimumInterval() {
    const minInterval = Math.max(60, Number(this.settings.minIntervalSeconds) || 300);
    const duration = Number(this.videoDuration) || 0;

    const all = Array.from(this.scheduledBreakpoints.values())
      .filter((bp) => Number.isFinite(bp.timestamp) && bp.timestamp > 0 && !bp.skippedByAi && bp.activity)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (all.length <= 1) return;

    // Filter out trivial breakpoints at the very start (< 120s if video >= 360s) or very end (< 40s from end)
    const filtered = all.filter((bp) => {
      if (duration >= 360) {
        if (bp.timestamp < 120 && all.some((c) => c.timestamp >= 180)) {
          return false;
        }
        if (bp.timestamp >= duration - 40) {
          return false;
        }
      }
      return true;
    });

    const candidates = filtered.length > 0 ? filtered : all;
    if (candidates.length <= 1) {
      this.scheduledBreakpoints.clear();
      if (candidates.length === 1) {
        this.scheduledBreakpoints.set(candidates[0].id, candidates[0]);
      }
      return;
    }

    const getImportance = (bp, windowEnd = 0) => {
      let score = STRENGTH_RANK[bp.strength] || 2;
      if (bp.source === 'chapter') score += 2;
      if (bp.source === 'ai-prediction' || bp.source === 'ai-semantic') score += 1.5;
      if (bp.aiRefined) score += 1;
      const textLen = (bp.activity?.transcriptExcerpt || bp.activity?.conceptSummary || '').length;
      if (textLen > 150) score += 1;
      
      // Bonus for major milestones / tips / summary / overview chapters
      const name = (bp.activity?.conceptName || bp.reason || '').toLowerCase();
      if (/\b(tip|summary|review|overview|conclusion|checkpoint|part|section)\b/.test(name)) {
        score += 1.5;
      }

      // Slightly favor candidates that culminate a learning segment (closer to windowEnd)
      if (windowEnd > 0 && bp.timestamp >= windowEnd * 0.6) {
        score += 0.8;
      }
      return score;
    };

    const mergeBreakpoints = (targetBp, sourceBp) => {
      if (!targetBp.activity || !sourceBp.activity) return;
      const tAct = targetBp.activity;
      const sAct = sourceBp.activity;

      // Merge concept names cleanly without creating an endless string
      const tConcept = (tAct.conceptName || '').trim();
      const sConcept = (sAct.conceptName || '').trim();
      targetBp.mergedConceptNames = targetBp.mergedConceptNames || (tConcept ? [tConcept] : []);
      if (sConcept && !targetBp.mergedConceptNames.includes(sConcept)) {
        targetBp.mergedConceptNames.push(sConcept);
      }
      if (sConcept && tConcept && !tConcept.toLowerCase().includes(sConcept.toLowerCase())) {
        const parts = tConcept.split(/ & | \+ /).map((p) => p.trim());
        if (parts.length < 2) {
          tAct.conceptName = `${tConcept} & ${sConcept}`;
        } else if (!tConcept.includes('related')) {
          tAct.conceptName = `${parts[0]} & ${parts[1]} (and related concepts)`;
        }
      }

      // Merge expected key points
      const existingPoints = new Set((tAct.expectedKeyPoints || []).map((p) => p.toLowerCase().trim()));
      const mergedPoints = [...(tAct.expectedKeyPoints || [])];
      for (const p of sAct.expectedKeyPoints || []) {
        const norm = (p || '').toLowerCase().trim();
        if (norm && !existingPoints.has(norm)) {
          existingPoints.add(norm);
          mergedPoints.push(p);
        }
      }
      tAct.expectedKeyPoints = mergedPoints.slice(0, 6);

      // Merge summaries
      if (sAct.conceptSummary && tAct.conceptSummary && !tAct.conceptSummary.includes(sAct.conceptSummary)) {
        tAct.conceptSummary = `${tAct.conceptSummary} ${sAct.conceptSummary}`;
      }

      // Keep question prompt clean, readable, and feastable (never prepend recursive synthesis prefixes)
      tAct.prompt = BreakpointDetector.sanitizePrompt(tAct.prompt);

      // Inherit stronger rating
      if ((STRENGTH_RANK[sourceBp.strength] || 2) > (STRENGTH_RANK[targetBp.strength] || 2)) {
        targetBp.strength = sourceBp.strength;
      }
    };

    // Forward clustering: ensure consecutive selected breakpoints have gap >= minInterval
    const selected = [];
    let i = 0;

    while (i < candidates.length) {
      const current = candidates[i];

      if (selected.length === 0) {
        const targetWindowEnd = current.timestamp + minInterval;
        let best = current;
        let bestScore = getImportance(current, targetWindowEnd);
        const cluster = [current];
        let j = i + 1;

        while (j < candidates.length && candidates[j].timestamp - current.timestamp < minInterval) {
          cluster.push(candidates[j]);
          const score = getImportance(candidates[j], targetWindowEnd);
          if (score >= bestScore) {
            bestScore = score;
            best = candidates[j];
          }
          j++;
        }

        for (const item of cluster) {
          if (item !== best) {
            mergeBreakpoints(best, item);
          }
        }

        selected.push(best);
        i = j;
      } else {
        const lastSelected = selected[selected.length - 1];
        const gap = current.timestamp - lastSelected.timestamp;

        if (gap < minInterval) {
          mergeBreakpoints(lastSelected, current);
          i++;
        } else {
          const targetWindowEnd = current.timestamp + minInterval;
          let best = current;
          let bestScore = getImportance(current, targetWindowEnd);
          const cluster = [current];
          let j = i + 1;

          while (j < candidates.length && candidates[j].timestamp - current.timestamp < minInterval) {
            if (candidates[j].timestamp - lastSelected.timestamp >= minInterval) {
              cluster.push(candidates[j]);
              const score = getImportance(candidates[j], targetWindowEnd);
              if (score >= bestScore) {
                bestScore = score;
                best = candidates[j];
              }
            }
            j++;
          }

          for (const item of cluster) {
            if (item !== best) {
              mergeBreakpoints(best, item);
            }
          }

          selected.push(best);
          i = j;
        }
      }
    }

    // Final verification: guarantee every consecutive pair has gap >= minInterval
    const finalKept = [];
    for (const bp of selected) {
      if (finalKept.length === 0) {
        finalKept.push(bp);
      } else {
        const last = finalKept[finalKept.length - 1];
        if (bp.timestamp - last.timestamp >= minInterval) {
          finalKept.push(bp);
        } else {
          mergeBreakpoints(last, bp);
        }
      }
    }

    this.scheduledBreakpoints.clear();
    for (const bp of finalKept) {
      this.scheduledBreakpoints.set(bp.id, bp);
    }

    const removed = all.length - finalKept.length;
    if (removed > 0) {
      this.log(`[Breakpoint] Enforced ${minInterval}s minimum interval: kept ${finalKept.length} of ${all.length} candidates (merged/pruned ${removed}).`);
    }
  }

  hasBreakpointNear(timestamp, toleranceSeconds = 4.0, ignoreId = null) {
    for (const [id, bp] of this.scheduledBreakpoints.entries()) {
      if (ignoreId && id === ignoreId) continue;
      if (Math.abs(bp.timestamp - timestamp) <= toleranceSeconds) {
        return true;
      }
    }
    return false;
  }

  deduplicateAndSortBreakpoints() {
    const entries = Array.from(this.scheduledBreakpoints.values())
      .filter((bp) => Number.isFinite(bp.timestamp) && bp.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const deduped = [];
    for (const bp of entries) {
      const prev = deduped[deduped.length - 1];
      if (prev && Math.abs(bp.timestamp - prev.timestamp) < 3.0) {
        const prevRank = STRENGTH_RANK[prev.strength] || 2;
        const currRank = STRENGTH_RANK[bp.strength] || 2;
        if (
          bp.source === 'chapter' ||
          (bp.aiRefined && !prev.aiRefined) ||
          currRank > prevRank
        ) {
          deduped[deduped.length - 1] = bp;
        }
      } else {
        deduped.push(bp);
      }
    }

    this.scheduledBreakpoints.clear();
    for (const bp of deduped) {
      this.scheduledBreakpoints.set(bp.id, bp);
    }
  }

  static findBestLinguisticStop(cues = [], followingChunkFirstCue = null) {
    if (!cues || cues.length === 0) {
      return { timestamp: 0, strength: 'optional', reason: 'Empty cues' };
    }

    const startIdx = Math.max(0, Math.floor(cues.length * 0.75));
    let bestCue = cues[cues.length - 1];
    let bestScore = -1;
    let bestReason = 'End of subtitle segment';

    for (let i = startIdx; i < cues.length; i++) {
      const cue = cues[i];
      const nextCue = cues[i + 1] || followingChunkFirstCue;
      let score = i === cues.length - 1 ? 1 : 0;
      const reasons = [];

      const text = cue.text.trim();
      if (/[.?!]["']?$/.test(text)) {
        score += 3;
        reasons.push('completed sentence');
      }

      const gap = nextCue ? nextCue.start - cue.end : 1.0;
      if (gap >= 0.65) {
        score += 2;
        reasons.push(`pause (${gap.toFixed(1)}s)`);
      }

      if (
        nextCue &&
        /^(now let's|so let's|next|moving on|however|on the other hand|another|first|second|finally|in conclusion)/i.test(
          nextCue.text.trim()
        )
      ) {
        score += 3;
        reasons.push('topic transition');
      }

      if (/\b(and|or|but|because|which|that|so)$/i.test(text.replace(/[.?!]+$/, ''))) {
        score -= 4;
      }

      if (score >= bestScore) {
        bestScore = score;
        bestCue = cue;
        if (reasons.length > 0) {
          bestReason = `Linguistic boundary (${reasons.join(' + ')})`;
        }
      }
    }

    return {
      timestamp: Number(bestCue.end.toFixed(2)),
      strength: bestScore >= 5 ? 'strong' : bestScore >= 3 ? 'normal' : 'optional',
      reason: bestReason
    };
  }

  ingestAiBreakpoints({ aiBreakpoints = [], cues = [], videoDuration = 0, videoId = 'video' }) {
    const maxDuration = Number(videoDuration || this.videoDuration || 0);
    const accepted = [];

    for (const rawBp of aiBreakpoints) {
      const rawTs = Number(rawBp?.timestamp ?? rawBp?.recommendedBreakpointTime);

      if (!Number.isFinite(rawTs) || rawTs <= 2) {
        this.log(`[Breakpoint] Rejected invalid AI timestamp: ${rawBp?.timestamp}`);
        continue;
      }
      if (maxDuration > 0 && rawTs >= maxDuration - 1.0) {
        this.log(`[Breakpoint] Rejected out-of-bounds AI timestamp: ${rawTs}s (duration: ${maxDuration}s)`);
        continue;
      }

      const alignedTs = BreakpointDetector.alignTimestampToCompletedSentence(rawTs, cues, maxDuration);
      if (alignedTs === null) {
        this.log(`[Breakpoint] Rejected AI timestamp ${rawTs}s (no valid sentence boundary)`);
        continue;
      }

      const strength =
        rawBp.importance === 'high' || rawBp.breakpointStrength === 'strong'
          ? 'strong'
          : rawBp.importance === 'low' || rawBp.breakpointStrength === 'optional'
          ? 'optional'
          : 'normal';

      const id = `ai_bp_${Math.round(alignedTs)}_${accepted.length}`;

      let shouldSkipDuplicate = false;
      for (const [existingId, existingBp] of this.scheduledBreakpoints.entries()) {
        if (Math.abs(existingBp.timestamp - alignedTs) < 3.0) {
          const existingRank = STRENGTH_RANK[existingBp.strength] || 2;
          const newRank = STRENGTH_RANK[strength] || 2;
          if (existingBp.source === 'chapter' || existingRank >= newRank) {
            shouldSkipDuplicate = true;
            break;
          } else {
            this.scheduledBreakpoints.delete(existingId);
          }
        }
      }

      if (shouldSkipDuplicate) {
        this.log(`[Breakpoint] Ignored duplicate AI timestamp ${rawTs}s (aligned to ${alignedTs}s)`);
        continue;
      }

      const sectionCues = cues.filter((c) => c.end <= alignedTs && c.start >= Math.max(0, alignedTs - 60));
      const sectionText = sectionCues.map((c) => c.text).join(' ') || rawBp.reason || 'AI-identified concept section.';

      const activity =
        rawBp.activity ||
        BreakpointDetector.createGroundedDefaultActivity({
          videoId,
          bpId: id,
          timestamp: alignedTs,
          conceptName: rawBp.conceptName || BreakpointDetector.extractConceptLabel(sectionText, accepted.length),
          sectionText,
          start: sectionCues[0]?.start ?? Math.max(0, alignedTs - 30),
          end: alignedTs,
          source: 'ai-semantic',
          preferredType: rawBp.activityType || rawBp.recommendedActivityType || 'short_answer',
          seedIndex: accepted.length
        });

      const record = {
        id,
        chunkId: id,
        chunkIndex: accepted.length,
        timestamp: alignedTs,
        reason: rawBp.reason || 'AI semantic concept boundary',
        strength,
        source: 'ai-semantic',
        aiRefined: true,
        skippedByAi: false,
        activity
      };

      this.scheduledBreakpoints.set(id, record);
      accepted.push(record);
    }

    this.log(`[Breakpoint] Semantic analysis completed`);
    this.deduplicateAndSortBreakpoints();
    this.enforceMinimumInterval();
    for (const bp of this.getAllScheduledBreakpoints()) {
      if (bp.source === 'ai-semantic') {
        this.log(`[Breakpoint] Scheduled breakpoint: ${bp.timestamp.toFixed(1)}s (${bp.reason})`);
      }
    }

    return this.getAllScheduledBreakpoints();
  }

  static alignTimestampToCompletedSentence(targetSeconds, cues = [], maxDuration = 0) {
    if (!Array.isArray(cues) || cues.length === 0) {
      return Number(targetSeconds.toFixed(2));
    }

    const sentenceEndingCues = cues.filter((c) => {
      const endsSentence = /[.?!]["']?$/.test(c.text.trim());
      const notAtVeryEnd = maxDuration <= 0 || c.end < maxDuration - 1.0;
      return endsSentence && notAtVeryEnd;
    });

    const pool = sentenceEndingCues.length > 0 ? sentenceEndingCues : cues;
    let bestCue = null;
    let minDiff = Infinity;

    for (const cue of pool) {
      const diff = Math.abs(cue.end - targetSeconds);
      if (diff < minDiff) {
        minDiff = diff;
        bestCue = cue;
      }
    }

    if (!bestCue) return null;
    return Number(bestCue.end.toFixed(2));
  }

  getChunksToPrepareAhead(currentTime, chunks = [], adaptiveMultiplier = 1.0) {
    if (!chunks || chunks.length === 0) return [];

    const effectiveMinInterval =
      (this.settings.minIntervalSeconds ?? 300) * adaptiveMultiplier;

    const candidates = [];

    for (const chunk of chunks) {
      const isCurrentOrUpcoming =
        chunk.end > currentTime + 1.0 && chunk.start <= currentTime + 80;

      if (!isCurrentOrUpcoming) continue;
      if (this.triggeredIds.has(chunk.id)) continue;
      if (this.inProgressChunkIds.has(chunk.id)) continue;

      const existing = this.scheduledBreakpoints.get(chunk.id);
      if (existing && (existing.aiRefined || existing.skippedByAi)) continue;

      const timeSinceLast = chunk.end - this.lastActivityTimestamp;
      if (
        this.lastActivityTimestamp > 0 &&
        timeSinceLast < effectiveMinInterval
      ) {
        continue;
      }

      candidates.push(chunk);
      if (candidates.length >= 2) break;
    }

    return candidates;
  }

  registerPreparedBreakpoint(chunkId, sectionAnalysis, activity) {
    this.inProgressChunkIds.delete(chunkId);
    const existing = this.scheduledBreakpoints.get(chunkId);

    if (!sectionAnalysis?.shouldGenerateActivity || !activity) {
      if (existing && existing.activity && (existing.source === 'chapter' || sectionAnalysis?.isFallback)) {
        this.scheduledBreakpoints.set(chunkId, {
          ...existing,
          aiRefined: true
        });
        return;
      }

      if (existing && existing.source !== 'chapter') {
        this.scheduledBreakpoints.set(chunkId, {
          ...existing,
          aiRefined: true,
          skippedByAi: true
        });
      }
      return;
    }

    const rawAligned = Number(sectionAnalysis.alignedBreakpointTime || existing?.timestamp || activity.breakpointTime);
    const finalTimestamp =
      existing?.source === 'chapter'
        ? existing.timestamp
        : Number(rawAligned.toFixed(2));

    this.scheduledBreakpoints.set(chunkId, {
      ...(existing || { id: chunkId, chunkId }),
      timestamp: finalTimestamp,
      strength:
        existing?.source === 'chapter'
          ? 'strong'
          : sectionAnalysis.breakpointStrength || 'normal',
      source:
        existing?.source === 'chapter'
          ? 'chapter'
          : sectionAnalysis.isPredictionOpportunity
          ? 'ai-prediction'
          : 'ai-semantic',
      aiRefined: true,
      skippedByAi: false,
      activity
    });

    this.deduplicateAndSortBreakpoints();
    this.enforceMinimumInterval();
    this.log(`[Breakpoint] Semantic analysis completed`);
    this.log(`[Breakpoint] Scheduled breakpoint: ${finalTimestamp.toFixed(1)}s`);
  }

  handleUserSeek(newTime) {
    for (const [id, bp] of this.scheduledBreakpoints.entries()) {
      if (newTime > bp.timestamp + 2.0 && !this.triggeredIds.has(id)) {
        this.triggeredIds.add(id);
      }
    }
    if (newTime < this.lastActivityTimestamp) {
      this.lastActivityTimestamp = Math.max(0, newTime - (this.settings.minIntervalSeconds || 300));
    }
  }

  checkPlaybackForBreakpoint(currentTime, adaptiveMultiplier = 1.0, playbackRate = 1.0) {
    const effectiveMinInterval =
      (this.settings.minIntervalSeconds ?? 300) * adaptiveMultiplier;
    const maxInterval = this.settings.maxIntervalSeconds || 600;

    const upperTolerance = Math.max(1.8, 1.2 * Math.max(1, playbackRate));

    const sorted = this.getAllScheduledBreakpoints();

    for (const bp of sorted) {
      if (this.triggeredIds.has(bp.id)) continue;
      if (bp.skippedByAi || !bp.activity) continue;

      if (currentTime > bp.timestamp + upperTolerance) {
        this.triggeredIds.add(bp.id);
        continue;
      }

      if (
        this.settings.skipMinorActivities &&
        bp.strength === 'optional' &&
        currentTime - this.lastActivityTimestamp < maxInterval
      ) {
        continue;
      }

      if (
        this.lastActivityTimestamp > 0 &&
        currentTime - this.lastActivityTimestamp < effectiveMinInterval
      ) {
        continue;
      }

      if (currentTime >= bp.timestamp - 0.15 && currentTime <= bp.timestamp + upperTolerance) {
        this.triggeredIds.add(bp.id);
        this.lastActivityTimestamp = currentTime;
        this.log(`[Breakpoint] Playback reached breakpoint: ${bp.timestamp.toFixed(1)}s`);
        return bp;
      }
    }

    return null;
  }

  getAllScheduledBreakpoints() {
    return Array.from(this.scheduledBreakpoints.values())
      .filter((bp) => !bp.skippedByAi && bp.activity)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getUpcomingBreakpoints(currentTime = 0) {
    return this.getAllScheduledBreakpoints().filter(
      (bp) => !this.triggeredIds.has(bp.id) && bp.timestamp >= currentTime - 0.5
    );
  }

  static extractConceptLabel(text = '', index = 0) {
    const cleaned = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleaned) return `Section ${index + 1} Concept`;
    const words = cleaned.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean).slice(0, 5);
    return words.join(' ') || `Section ${index + 1} Concept`;
  }

  /**
   * Delegates to `ActivityGenerator.createFallbackActivity` so every seeded breakpoint
   * gets a diverse, content-specific activity and a full multi-sentence `exemplarAnswer`
   * (never just the chapter title).
   */
  static createGroundedDefaultActivity({
    videoId,
    bpId,
    timestamp,
    conceptName,
    sectionText,
    start = 0,
    end = timestamp,
    source = 'chapter',
    preferredType = 'short_answer',
    seedIndex = 0
  }) {
    const normalizedType =
      preferredType === 'comprehension' ? 'short_answer' : preferredType;

    const activity = ActivityGenerator.createFallbackActivity({
      videoId,
      chunk: {
        id: bpId,
        index: seedIndex,
        start,
        end,
        chapterTitle: conceptName,
        text: sectionText
      },
      sectionAnalysis: {
        conceptName,
        conceptSummary: sectionText,
        recommendedActivityType: normalizedType,
        alignedBreakpointTime: Number(timestamp.toFixed(2)),
        breakpointStrength: source === 'chapter' ? 'strong' : 'normal',
        subjectCategory: 'general'
      },
      chunkIndex: seedIndex
    });

    return {
      ...activity,
      id: `act_${videoId}_${bpId}`,
      prompt: BreakpointDetector.sanitizePrompt(activity.prompt),
      title:
        source === 'chapter'
          ? `Chapter Checkpoint (${activity.title})`
          : source === 'ai-semantic'
          ? `AI ${activity.title}`
          : activity.title,
      isAiGenerated: source === 'ai-semantic'
    };
  }

  static sanitizePrompt(prompt = '') {
    return ActivityGenerator.sanitizePrompt(prompt);
  }

  static cleanConceptName(name = '') {
    return ActivityGenerator.cleanConceptName(name);
  }
}
