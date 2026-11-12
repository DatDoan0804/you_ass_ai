/**
 * @fileoverview Main Content Script Orchestrator & Non-Educational Active Intervention (`index.js`)
 *
 * Updates for New Improvement 4 (Active Intervention for Non-Educational Videos):
 * - Added `NonEducationalInterventionManager` to interrupt passive time-wasting on videos
 *   explicitly classified as non-educational (`category === 'Entertainment'`, `educationalValue < 35`,
 *   `confidence >= 0.7`, and `!shouldActivateLearning`).
 * - Tracks **actual active playback time** (never wall-clock time):
 *   * Increments `watchedSeconds` only during active playback ticks where `!paused`, `!seeking`,
 *     the tab is visible (`document.visibilityState !== 'hidden'`), and `deltaSeconds` is a normal
 *     playback step (`0 < deltaSeconds <= 2.5 * playbackRate`, ignoring manual seeks).
 * - Uses a randomized target threshold around 5 minutes (`240s` to `340s`, i.e., `4m 00s` to `5m 40s`)
 *   so the interruption cannot be anticipated or gamed.
 * - Persists `watchedSeconds` and `targetThresholdSeconds` in `Database` (`saveInterventionState`)
 *   so refreshing the page (`F5`) does NOT reset the accumulated watch time!
 * - Prevents duplicate redirects via `isRedirecting` lock and redirects directly to
 *   `https://www.youtube.com/` via `location.replace('https://www.youtube.com/')` after pausing
 *   the player and resetting `watchedSeconds = 0` for the next interval.
 * - Respects user override (`userClassificationOverride`) and the Settings toggle
 *   (`settings.enableNonEducationalIntervention`).
 */

import { db, Database } from '../storage/database.js';
import { learningManager } from '../learning/learning-manager.js';
import { historyManager } from '../learning/history-manager.js';
import { ContentAnalyzer } from '../ai/content-analyzer.js';
import { ActivityGenerator } from '../ai/activity-generator.js';
import { AnswerEvaluator } from '../ai/answer-evaluator.js';
import { PromptBuilder } from '../ai/prompt-builder.js';
import { SubtitleManager } from './subtitle-manager.js';
import { BreakpointDetector } from './breakpoint-detector.js';
import { VideoController } from './video-controller.js';
import { UIManager } from './ui-manager.js';

const runtimeApi =
  typeof browser !== 'undefined' && browser.runtime
    ? browser.runtime
    : typeof chrome !== 'undefined' && chrome.runtime
    ? chrome.runtime
    : null;

export function sendBackgroundRequest(action, payload = {}) {
  if (!runtimeApi || typeof runtimeApi.sendMessage !== 'function') {
    return Promise.resolve({ ok: false, error: 'Background runtime unavailable in standalone environment.' });
  }
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = runtimeApi.sendMessage({ action, payload }, (response) => {
        const lastError = runtimeApi.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Issue 4: Active Intervention Manager for Non-Educational Videos.
 * Tracks actual playback time (excluding pauses, seeks, and background tab time) across page
 * reloads and redirects to `https://www.youtube.com/` at varied ~5-minute intervals (`240s–340s`).
 */
export class NonEducationalInterventionManager {
  /**
   * @param {object} [options]
   * @param {() => void} [options.onRedirect] - Custom redirect callback (defaults to `window.location.replace('https://www.youtube.com/')`)
   * @param {(msg: string) => void} [options.logger]
   * @param {() => number} [options.randomFn]
   */
  constructor(options = {}) {
    this.onRedirect =
      options.onRedirect ||
      (() => {
        if (typeof window !== 'undefined' && window.location) {
          window.location.replace('https://www.youtube.com/');
        }
      });
    this.log = options.logger || console.log;
    this.randomFn = options.randomFn || Math.random;

    this.videoId = null;
    this.isNonEducational = false;
    this.watchedSeconds = 0;
    this.targetThresholdSeconds = 300;
    this.redirectCount = 0;
    this.lastPlaybackPosition = null;
    this.isRedirecting = false;
  }

  /**
   * Generates a randomized threshold around 5 minutes (300s ± 55s -> `[245s, 355s]`).
   */
  generateVariedThresholdSeconds() {
    const minSec = 245; // 4m 05s
    const maxSec = 355; // 5m 55s
    return Math.round(minSec + this.randomFn() * (maxSec - minSec));
  }

  /**
   * Initializes or restores persisted intervention state for `videoId`.
   * If the user reloads the page (`F5`), `watchedSeconds` and `targetThresholdSeconds`
   * are restored from storage so reloading does NOT reset the timer!
   */
  async initForVideo(videoId, classification) {
    this.videoId = videoId;
    this.lastPlaybackPosition = null;
    this.isRedirecting = false;

    const isExplicitlyNonEducational =
      Boolean(classification) &&
      classification.category === 'Entertainment' &&
      Number(classification.educationalValue) < 35 &&
      Number(classification.confidence ?? 0.8) >= 0.7 &&
      !classification.shouldActivateLearning;

    this.isNonEducational = isExplicitlyNonEducational;

    if (!this.isNonEducational) {
      this.watchedSeconds = 0;
      return;
    }

    const existing = await Database.getInterventionState(videoId);
    if (existing && typeof existing.watchedSeconds === 'number') {
      this.watchedSeconds = existing.watchedSeconds;
      this.targetThresholdSeconds =
        existing.targetThresholdSeconds || this.generateVariedThresholdSeconds();
      this.redirectCount = existing.redirectCount || 0;
      this.log(
        `[Intervention] Restored non-educational watch timer for ${videoId}: ${this.watchedSeconds.toFixed(1)}s / ${this.targetThresholdSeconds}s`
      );
    } else {
      this.watchedSeconds = 0;
      this.targetThresholdSeconds = this.generateVariedThresholdSeconds();
      this.redirectCount = 0;
      await Database.saveInterventionState(videoId, {
        watchedSeconds: 0,
        targetThresholdSeconds: this.targetThresholdSeconds,
        redirectCount: 0
      });
      this.log(
        `[Intervention] Armed non-educational intervention for ${videoId} (target playback interval: ${this.targetThresholdSeconds}s)`
      );
    }
  }

  /**
   * Resets the last playback position when the user manually seeks so seeking forward
   * does not count as watched playback time.
   */
  handleSeek(newPlaybackTime) {
    this.lastPlaybackPosition = newPlaybackTime;
  }

  /**
   * Records a tick of active playback time and triggers the homepage redirect when
   * accumulated `watchedSeconds` reaches `targetThresholdSeconds`.
   *
   * @param {object} params
   * @param {number} params.currentTime - Current `video.currentTime` in seconds
   * @param {number} [params.playbackRate=1.0] - Current `video.playbackRate`
   * @param {boolean} [params.isPaused=false]
   * @param {boolean} [params.isSeeking=false]
   * @param {boolean} [params.isTabHidden=false]
   * @param {boolean} [params.interventionEnabled=true]
   * @param {boolean} [params.userOverrodeClassification=false]
   * @returns {Promise<{redirected: boolean, watchedSeconds: number, targetThresholdSeconds: number}>}
   */
  async recordPlaybackTick({
    currentTime,
    playbackRate = 1.0,
    isPaused = false,
    isSeeking = false,
    isTabHidden = false,
    interventionEnabled = true,
    userOverrodeClassification = false
  }) {
    if (
      !this.isNonEducational ||
      !interventionEnabled ||
      userOverrodeClassification ||
      this.isRedirecting ||
      isPaused ||
      isSeeking ||
      isTabHidden
    ) {
      this.lastPlaybackPosition = currentTime;
      return {
        redirected: false,
        watchedSeconds: this.watchedSeconds,
        targetThresholdSeconds: this.targetThresholdSeconds
      };
    }

    if (this.lastPlaybackPosition === null) {
      this.lastPlaybackPosition = currentTime;
      return {
        redirected: false,
        watchedSeconds: this.watchedSeconds,
        targetThresholdSeconds: this.targetThresholdSeconds
      };
    }

    const mediaDelta = currentTime - this.lastPlaybackPosition;
    this.lastPlaybackPosition = currentTime;

    // Convert media-time delta to actual real-time playback seconds watched (`mediaDelta / playbackRate`).
    // Ignore negative deltas or large jumps (> 4.0s of real time) caused by scrubbing/seeking!
    const safeRate = Math.max(0.25, Number(playbackRate) || 1.0);
    const actualWatchedDelta = mediaDelta / safeRate;

    if (actualWatchedDelta <= 0 || actualWatchedDelta > 4.0) {
      return {
        redirected: false,
        watchedSeconds: this.watchedSeconds,
        targetThresholdSeconds: this.targetThresholdSeconds
      };
    }

    this.watchedSeconds = Number((this.watchedSeconds + actualWatchedDelta).toFixed(2));

    // Check if accumulated actual playback time has reached the randomized ~5-minute threshold
    if (this.watchedSeconds >= this.targetThresholdSeconds) {
      this.isRedirecting = true;
      this.redirectCount += 1;
      const completedWatch = this.watchedSeconds;

      // Reset watchedSeconds and pick a fresh varied threshold for any future visit
      this.watchedSeconds = 0;
      this.targetThresholdSeconds = this.generateVariedThresholdSeconds();

      await Database.saveInterventionState(this.videoId, {
        watchedSeconds: 0,
        targetThresholdSeconds: this.targetThresholdSeconds,
        redirectCount: this.redirectCount
      });

      this.log(
        `[Intervention] Active playback reached ${completedWatch.toFixed(1)}s on non-educational video ${this.videoId}. Redirecting to https://www.youtube.com/ (Intervention #${this.redirectCount})`
      );

      this.onRedirect('https://www.youtube.com/', this.videoId, completedWatch);
      return {
        redirected: true,
        watchedSeconds: completedWatch,
        targetThresholdSeconds: this.targetThresholdSeconds
      };
    }

    // Periodically persist state (every ~2 seconds of accumulated watch time)
    await Database.saveInterventionState(this.videoId, {
      watchedSeconds: this.watchedSeconds,
      targetThresholdSeconds: this.targetThresholdSeconds,
      redirectCount: this.redirectCount
    });

    return {
      redirected: false,
      watchedSeconds: this.watchedSeconds,
      targetThresholdSeconds: this.targetThresholdSeconds
    };
  }
}

export class YouTubeLearningAssistantApp {
  /**
   * @param {object} [options]
   * @param {(action: string, payload: object) => Promise<any>} [options.requestHandler]
   * @param {(msg: string) => void} [options.logger]
   * @param {(url: string, videoId: string, watchedSeconds: number) => void} [options.onInterventionRedirect]
   */
  constructor(options = {}) {
    this.requestHandler = options.requestHandler || sendBackgroundRequest;
    this.log = options.logger || ((msg) => console.log(msg));

    this.settings = {};
    this.currentVideoId = null;
    this.sessionEpoch = 0;
    this.videoMetadata = null;
    this.videoClassification = null;
    this.userClassificationOverride = false;
    this.lastSubtitleResult = null;
    this.isActivityActive = false;
    this.chunkSummaries = new Map();
    this.vocabulary = [];
    this._isFetchingSecondary = false;
    this._lastSecondaryFetchAttempt = 0;
    this._lateCaptionRetrySessions = new Set();

    this.videoController = new VideoController({
      onVideoChanged: this.handleVideoChanged.bind(this),
      onTimeUpdate: this.handleTimeUpdate.bind(this),
      onUserSeek: this.handleUserSeek.bind(this),
      onDurationChange: this.handleDurationChange.bind(this),
      logger: this.log
    });

    this.subtitleManager = new SubtitleManager(
      this.requestHandler,
      this.log,
      (url) => this.videoController.requestTimedtextViaBridge(url)
    );
    this.contentAnalyzer = new ContentAnalyzer(this.requestHandler);
    this.activityGenerator = new ActivityGenerator(this.requestHandler);
    this.answerEvaluator = new AnswerEvaluator(this.requestHandler);
    this.breakpointDetector = new BreakpointDetector({ settings: {}, logger: this.log });
    this.interventionManager = new NonEducationalInterventionManager({
      logger: this.log,
      onRedirect: (url, videoId, watchedSec) => {
        this.videoController.pause();
        if (typeof options.onInterventionRedirect === 'function') {
          options.onInterventionRedirect(url, videoId, watchedSec);
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.replace(url);
        }
      }
    });

    this.uiManager = new UIManager({
      onSubmitAnswer: this.handleAnswerSubmission.bind(this),
      onSkipActivity: this.handleSkipActivity.bind(this),
      onContinueWatching: this.handleContinueWatching.bind(this),
      onRequestExplanation: this.handleRequestExplanation.bind(this),
      onAskTutorFollowUp: this.handleAskTutorFollowUp.bind(this),
      onSaveSettings: this.handleSaveSettings.bind(this),
      onLoadDashboardData: this.handleLoadDashboardData.bind(this),
      onManualTriggerActivity: this.handleManualTriggerActivity.bind(this),
      onTimelineMarkerClick: this.handleTimelineMarkerClick.bind(this),
      onOverrideClassification: this.handleOverrideClassification.bind(this),
      onContinueVocabulary: this.handleContinueFromVocabulary.bind(this),
      onSeekToTimestamp: (timestamp) => {
        if (typeof timestamp === 'number' && !isNaN(timestamp)) {
          this.log(`[Vocabulary] Seeking video to word timestamp: ${timestamp.toFixed(1)}s`);
          this.videoController.seekTo(timestamp);
          if (!this.vocabularyPrepGate) this.videoController.resume();
        }
      },
      onRetryMetadataCheck: () => {
        if (this.currentVideoId) {
          this.log('[Breakpoint] Manual retry metadata check triggered.');
          this.scheduleLateMetadataCheck(this.currentVideoId, this.sessionEpoch, 0);
        }
      }
    });
  }

  async start() {
    await db.init();
    this.settings = await Database.getSettings();
    this.breakpointDetector.updateSettings(this.settings);
    this.uiManager.init(this.settings);
    this.videoController.init();
    this.requestHandler('CHECK_LOCAL_SUB_SERVER', {}).then((res) => {
      if (this.uiManager) {
        this.uiManager.setLocalServerStatus(Boolean(res && res.ok));
      }
    }).catch(() => {});
  }

  getEffectiveDuration() {
    return (
      this.videoMetadata?.lengthSeconds ||
      this.videoController.getDuration() ||
      this.breakpointDetector.videoDuration ||
      0
    );
  }

  isLearningActiveForCurrentVideo() {
    if (this.settings.enabled === false) return false;
    // Every video has breakpoints regardless of entertainment or education
    return true;
  }

  syncTimelineMarkers() {
    if (!this.isLearningActiveForCurrentVideo()) {
      this.uiManager.renderTimelineMarkers([], this.getEffectiveDuration(), new Set());
      return;
    }
    const allBreakpoints = this.breakpointDetector.getAllScheduledBreakpoints();
    const duration = this.getEffectiveDuration();
    this.uiManager.renderTimelineMarkers(
      allBreakpoints,
      duration,
      this.breakpointDetector.triggeredIds
    );
    this.triggerMilestoneTitleSynthesisIfNeeded(allBreakpoints);
  }

  handleDurationChange(newDuration) {
    if (this.videoMetadata && (!this.videoMetadata.lengthSeconds || this.videoMetadata.lengthSeconds <= 0)) {
      this.videoMetadata.lengthSeconds = newDuration;
    }
    this.breakpointDetector.videoDuration = newDuration;
    this.syncTimelineMarkers();
  }

  handleTimelineMarkerClick(breakpoint) {
    if (!breakpoint) return;
    this.videoController.seekTo(breakpoint.timestamp);
    this.breakpointDetector.triggeredIds.add(breakpoint.id);
    this.breakpointDetector.lastActivityTimestamp = breakpoint.timestamp;
    this.log(`[Breakpoint] Playback reached breakpoint: ${breakpoint.timestamp.toFixed(1)}s (via marker click)`);
    this.syncTimelineMarkers();

    if (breakpoint.activity) {
      this.presentBreakpointActivity(breakpoint.activity, true);
    }
  }

  handleOverrideClassification(forceEnable) {
    this.userClassificationOverride = Boolean(forceEnable);
    this.uiManager.setVideoClassification(this.videoClassification, this.userClassificationOverride);

    if (this.userClassificationOverride && this.lastSubtitleResult) {
      const chapters = this.videoMetadata?.chapters || [];
      this.breakpointDetector.seedInitialCandidates(
        this.lastSubtitleResult.chunks,
        chapters,
        this.getEffectiveDuration(),
        this.currentVideoId
      );
      const totalScheduled = this.breakpointDetector.getAllScheduledBreakpoints().length;
      this.uiManager.setStatus(`Active (${totalScheduled} breakpoints)`, 'ready');
      this.syncTimelineMarkers();
    } else if (!this.isLearningActiveForCurrentVideo()) {
      this.breakpointDetector.reset();
      this.uiManager.setStatus('Auto-Paused (Entertainment)', 'paused');
      this.syncTimelineMarkers();
    }
  }

  async handleVideoChanged({ videoId, sessionEpoch, metadata }) {
    this.log(`[Vocabulary] Video change received: videoId=${videoId || '(none)'}, epoch=${sessionEpoch}, metadata=${Boolean(metadata)}`);
    this.currentVideoId = videoId;
    this.sessionEpoch = sessionEpoch;
    this.videoMetadata = metadata || { videoId, chapters: [], captionTracks: [] };
    this.videoClassification = null;
    this.userClassificationOverride = false;
    this.lastSubtitleResult = null;
    this.isActivityActive = false;
    this.chunkSummaries.clear();
    this.vocabulary = [];
    this._isFetchingSecondary = false;
    this._lastSecondaryFetchAttempt = 0;
    this._secondaryFetchAttempts = 0;
    if (videoId) {
      this.activityGenerator.resetHistory(videoId);
    }
    this.breakpointDetector.reset();
    this.uiManager.closeOverlay();
    this.uiManager.clearDualSubtitles();
    this.uiManager.setVideoClassification(null, false);
    this.uiManager.setVocabulary([]);
    this.vocabularyPrepGate = false;
    this.videoController.setPlaybackGate(false);
    this.uiManager.setVocabularyPrepGate(false);
    this.syncTimelineMarkers();

    if (!videoId) {
      this.uiManager.mountDedicatedBarInSafeSlot();
      return;
    }

    this.uiManager.mountDedicatedBarInSafeSlot();
    this.vocabularyPrepGate = this.settings.enabled !== false && this.settings.enableVocabularyPrep !== false;
    this.videoController.setPlaybackGate(this.vocabularyPrepGate);
    this.uiManager.setVocabularyPrepGate(this.vocabularyPrepGate);
    this.uiManager.setStatus(this.vocabularyPrepGate ? 'Preparing vocabulary...' : 'Loading Captions...', 'preparing');
    if (this.vocabularyPrepGate) {
      this.uiManager.setVocabularyStatus('preparing');
      this.uiManager.showVocabularyDrawer();
    }

    if (!metadata) {
      // Interim call on navigation: Dedicated Bar is mounted immediately with 'Loading Captions...'
      // Full metadata and subtitles will be loaded once fetchPlayerMetadataWithRetry returns.
      return;
    }

    await this.requestHandler('REGISTER_VIDEO_SESSION', { videoId, sessionEpoch }).catch(() => {});
    this.requestHandler('CHECK_LOCAL_SUB_SERVER', {}).then((res) => {
      if (this.uiManager) {
        this.uiManager.setLocalServerStatus(Boolean(res && res.ok));
      }
    }).catch(() => {});

    let demandSecondaryLang = (this.settings.enableDualSubtitles !== false)
      ? (this.settings.secondarySubtitleLang || 'en')
      : 'none';

    // If available tracks are known and the chosen language is not available on this video,
    // match by prefix (e.g. en matches en-US) or select the first available track
    const videoTracks = this.videoMetadata?.captionTracks;
    if (demandSecondaryLang !== 'none' && Array.isArray(videoTracks) && videoTracks.length > 0) {
      const targetPrefix = demandSecondaryLang.split('-')[0].toLowerCase();
      const matched = videoTracks.find(
        (t) => (t.languageCode || '').toLowerCase() === demandSecondaryLang.toLowerCase() ||
               (t.languageCode || '').toLowerCase().startsWith(targetPrefix)
      );
      if (matched) {
        demandSecondaryLang = matched.languageCode;
      } else {
        demandSecondaryLang = videoTracks[0].languageCode;
      }
      this.settings.secondarySubtitleLang = demandSecondaryLang;
    }

    let subtitleResult;
    let subtitleLoadError = null;
    try {
      subtitleResult = await this.subtitleManager.loadSubtitlesForVideo(
        this.videoMetadata,
        this.settings.primarySubtitleLang || 'auto',
        demandSecondaryLang,
        { enableDualSubtitles: this.settings.enableDualSubtitles !== false }
      );
      const cueTextLength = (subtitleResult?.cues || []).reduce((total, cue) => total + String(cue.text || '').length, 0);
      this.log(`[Vocabulary] Subtitle load complete for ${videoId}: hasSubtitles=${Boolean(subtitleResult?.hasSubtitles)}, cues=${subtitleResult?.cues?.length || 0}, chars=${cueTextLength}, primaryCues=${subtitleResult?.primaryCues?.length || 0}, tracks=${subtitleResult?.availableTracks?.length || 0}`);
    } catch (err) {
      subtitleLoadError = err;
      this.log(`[Vocabulary] Subtitle extraction failed for ${videoId}: ${err.message}`);
      subtitleResult = { hasSubtitles: false, cues: [], chunks: [], primaryCues: [], availableTracks: [] };
      if (this.vocabularyPrepGate) {
        this.uiManager.setVocabularyStatus('error', `Could not read this video’s captions (${err.message}). You can add words yourself or continue.`);
      }
    }
    this.lastSubtitleResult = subtitleResult;

    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
      return;
    }

    this.uiManager.setAvailableTracks(
      subtitleResult.availableTracks || this.subtitleManager.availableTracks || [],
      this.videoMetadata.translationLanguages || []
    );

    if (this.settings.enableDualSubtitles !== false && this.subtitleManager) {
      const currentTime = this.videoController.getCurrentTime();
      const activeCues = this.subtitleManager.getActiveDualCues(currentTime);
      this.uiManager.renderDualSubtitles(activeCues, this.settings);
    }

    if (this.settings.enabled === false) {
      this.uiManager.setStatus('Off', 'disabled');
      return;
    }

    let originalCues = [];
    let originalTranscriptError = null;
    try {
      originalCues = await this.getOriginalTranscriptCues(subtitleResult);
    } catch (err) {
      originalTranscriptError = err;
      this.log(`[Captions] Original transcript extraction failed for ${videoId}: ${err.message}`);
    }
    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;
    const originalChars = originalCues.reduce((total, cue) => total + String(cue.text || '').length, 0);
    this.log(`[Captions] Original transcript ready for ${videoId}: cues=${originalCues.length}, chars=${originalChars}`);
    if (originalCues.length > 0) {
      subtitleResult.primaryCues = originalCues;
      if (!subtitleResult.cues?.length) {
        subtitleResult.cues = originalCues;
        subtitleResult.chunks = SubtitleManager.buildSemanticChunks(originalCues, this.videoMetadata.chapters || [], 30);
        subtitleResult.hasSubtitles = true;
        this.subtitleManager.cues = originalCues;
        this.subtitleManager.chunks = subtitleResult.chunks;
        await db.saveTranscript(videoId, {
          cues: originalCues,
          chunks: subtitleResult.chunks,
          primaryCues: originalCues,
          primaryTrack: this.subtitleManager.primaryTrack,
          trackInfo: this.subtitleManager.primaryTrack,
          secondaryCues: this.subtitleManager.secondaryCues,
          secondaryTrack: this.subtitleManager.secondaryTrack
        }).catch(() => {});
      }
      this.lastSubtitleResult = subtitleResult;
      if (this.vocabularyPrepGate) await this.prepareVideoVocabulary(videoId, sessionEpoch, originalCues);
    } else {
      const tracks = this.videoMetadata?.captionTracks || [];
      const availability = this.videoMetadata?.captionAvailability || 'unknown';
      if (this.vocabularyPrepGate) {
        if (tracks.length > 0) {
          const fetchStatus = this.subtitleManager.lastFetchStatus || {};
          const detail = originalTranscriptError?.message || subtitleLoadError?.message || fetchStatus.message;
          this.uiManager.setVocabularyStatus(
            'error',
            `YouTube listed ${tracks.length} caption track(s), but the transcript could not be read${detail ? `: ${detail}` : '.'} We’ll check again; you can retry or continue.`
          );
        } else if (availability === 'unavailable') {
          this.uiManager.setVocabularyStatus(
            'unavailable',
            'YouTube did not provide caption tracks after repeated checks. We did not invent vocabulary; add words yourself or continue to the video.'
          );
        } else if (subtitleLoadError || originalTranscriptError) {
          const error = subtitleLoadError || originalTranscriptError;
          this.uiManager.setVocabularyStatus('error', `Could not extract this video’s transcript (${error.message}). You can add words yourself or continue.`);
        } else {
          this.uiManager.setVocabularyStatus('preparing', 'Caption availability is not confirmed yet. Checking again before we decide.');
        }
      }
      if (tracks.length > 0 || availability !== 'unavailable') {
        this.scheduleLateMetadataCheck(videoId, sessionEpoch, 0);
      }
    }

    const chapters = this.videoMetadata.chapters || [];

    const classification = await this.contentAnalyzer.classifyVideo({
      videoId,
      sessionEpoch,
      title: this.videoMetadata.title || '',
      shortDescription: this.videoMetadata.shortDescription || '',
      author: this.videoMetadata.author || '',
      chapters,
      chunks: subtitleResult.chunks
    });

    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
      return;
    }

    this.videoClassification = classification;
    this.uiManager.setVideoClassification(classification, this.userClassificationOverride);
    this.log(
      `[Breakpoint] Video classified: ${classification.category} (${classification.educationalValue}/100, confidence: ${classification.confidence})`
    );

    // Every video has breakpoints regardless of entertainment or education.
    // The Gemini AI is responsible for deciding breakpoints and generating questions.
    const hasChapters = this.settings.useYoutubeChapters !== false && chapters.length > 0;
    // 1. Immediate heuristic seed so timeline markers appear instantly
    this.breakpointDetector.seedInitialCandidates(
      subtitleResult.chunks,
      chapters,
      this.getEffectiveDuration(),
      videoId
    );
    this.syncTimelineMarkers();

    const initialTotal = this.breakpointDetector.getAllScheduledBreakpoints().length;
    this.uiManager.setStatus(
      `Active (${initialTotal} breakpoints)`,
      'ready'
    );

    // 2. Gemini AI decides breakpoints & questions directly from transcript and chapter ends
    if (this.settings.useAiBreakpoints !== false) {
      await this.planBreakpointsWithGemini(
        videoId,
        sessionEpoch,
        subtitleResult,
        chapters
      );
    }
  }

  async getOriginalTranscriptCues(subtitleResult = {}) {
    const cachedPrimary = (subtitleResult.primaryCues?.length > 0 && subtitleResult.primaryCues) ||
      (this.subtitleManager.primaryCues?.length > 0 && this.subtitleManager.primaryCues) || [];
    this.log(`[Vocabulary] Checking original transcript sources: cachedPrimary=${cachedPrimary.length}, metadataTracks=${this.videoMetadata?.captionTracks?.length || 0}`);
    const tracks = (this.videoMetadata?.captionTracks || []).filter((track) => {
      if (!track?.baseUrl) return false;
      try { return !new URL(track.baseUrl).searchParams.has('tlang'); } catch { return !String(track.baseUrl).includes('tlang='); }
    });
    const preferred = this.settings.primarySubtitleLang || 'auto';
    const selected = this.subtitleManager.primaryTrack || subtitleResult.primaryTrack || subtitleResult.trackInfo;
    const preferredPrefix = preferred === 'auto' ? '' : preferred.toLowerCase().split('-')[0];
    const selectedMatchesPreference = !preferredPrefix || (selected?.languageCode || '').toLowerCase().startsWith(preferredPrefix);
    if (Array.isArray(cachedPrimary) && cachedPrimary.length > 0 && selectedMatchesPreference) return cachedPrimary;

    const preferredTrack = SubtitleManager.selectBestTrack(tracks, preferred);
    const candidates = [
      preferredTrack,
      ...tracks.filter((track) => track.kind !== 'asr'),
      ...tracks
    ].filter((track, index, all) => track?.baseUrl && all.findIndex((item) => item?.baseUrl === track.baseUrl) === index);
    if (candidates.length === 0) {
      this.log('[Vocabulary] No fetchable original caption track found.');
      return [];
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        this.log(`[Captions] Fetching ${candidate.languageCode || 'unknown'} ${candidate.kind === 'asr' ? 'automatic' : 'manual'} track.`);
        const cues = await this.subtitleManager.fetchAndParseTrack(candidate.baseUrl);
        if (cues.length > 0) {
          const cleanCues = SubtitleManager.cleanAndMergeCues(cues);
          const track = {
            languageCode: candidate.languageCode,
            name: candidate.name,
            isAutoGenerated: candidate.kind === 'asr',
            baseUrl: candidate.baseUrl
          };
          this.subtitleManager.primaryTrack = track;
          this.subtitleManager.selectedTrack = track;
          this.subtitleManager.primaryCues = cleanCues;
          subtitleResult.primaryCues = cleanCues;
          const cached = await db.getTranscript(this.currentVideoId).catch(() => null);
          const saveCues = cached?.cues?.length ? cached.cues : this.subtitleManager.cues;
          const saveChunks = cached?.chunks?.length
            ? cached.chunks
            : (saveCues?.length ? SubtitleManager.buildSemanticChunks(saveCues, this.videoMetadata?.chapters || [], 30) : []);
          await db.saveTranscript(this.currentVideoId, {
            ...(cached || {}),
            cues: saveCues?.length ? saveCues : cleanCues,
            chunks: saveChunks.length ? saveChunks : SubtitleManager.buildSemanticChunks(cleanCues, this.videoMetadata?.chapters || [], 30),
            trackInfo: cached?.trackInfo || track,
            primaryCues: cleanCues,
            primaryTrack: track
          }).catch(() => {});
          this.log(`[Captions] Original transcript extraction succeeded: ${cleanCues.length} cues, ${cleanCues.reduce((n, cue) => n + String(cue.text || '').length, 0)} characters.`);
          return cleanCues;
        }
        this.log(`[Captions] Track ${candidate.languageCode || 'unknown'} returned no cues (${this.subtitleManager.lastFetchStatus?.state || 'unknown'}).`);
        if (this.subtitleManager.lastFetchStatus?.state === 'temporary-failure') break;
      } catch (err) {
        lastError = err;
        this.log(`[Captions] Could not read ${candidate.languageCode || 'unknown'} track: ${err.message}`);
        if (this.subtitleManager.lastFetchStatus?.state === 'temporary-failure') break;
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  static validateVocabularyResponse(response, transcriptCues = []) {
    const rawItems = Array.isArray(response?.vocabulary) ? response.vocabulary : [];
    const normalize = (value) => String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    const containsPhrase = (text, phrase) => {
      if (!phrase) return false;
      if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(phrase)) return text.includes(phrase);
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text);
    };
    const cues = (Array.isArray(transcriptCues) ? transcriptCues : [])
      .filter((cue) => cue && typeof cue.text === 'string' && cue.text.trim())
      .map((cue) => ({ ...cue, normalized: normalize(cue.text) }));
    const transcript = cues.map((cue) => cue.normalized).join(' ');
    const seen = new Set();
    const validated = [];
    const rejected = { malformed: 0, wordNotInTranscript: 0, exampleNotInTranscript: 0, duplicate: 0 };

    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') { rejected.malformed++; continue; }
      const word = typeof raw.word === 'string' ? raw.word.trim() : '';
      const translation = typeof raw.translation === 'string' ? raw.translation.trim() : '';
      const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';
      const example = typeof raw.example === 'string' ? raw.example.trim() : '';
      const contextualMeaning = typeof raw.contextualMeaning === 'string' ? raw.contextualMeaning.trim() : '';
      const normalizedWord = normalize(word);
      const normalizedExample = normalize(example);
      const isCjk = /[\u3040-\u30ff\u3400-\u9fff]/u.test(normalizedWord);
      if (!word || !translation || !explanation || !example || !contextualMeaning) { rejected.malformed++; continue; }
      if (normalizedWord.length < (isCjk ? 1 : 2) || !containsPhrase(transcript, normalizedWord)) { rejected.wordNotInTranscript++; continue; }
      if (normalizedExample.length < (isCjk ? 3 : 8) || !transcript.includes(normalizedExample)) { rejected.exampleNotInTranscript++; continue; }
      if (seen.has(normalizedWord)) { rejected.duplicate++; continue; }
      seen.add(normalizedWord);

      const matchingCues = cues.filter((cue) => containsPhrase(cue.normalized, normalizedWord));
      const rawTimestamp = Number(raw.timestamp);
      const timestamp = Number.isFinite(rawTimestamp)
        ? (matchingCues.find((cue) => Math.abs(Number(cue.start) - rawTimestamp) <= 15) || matchingCues[0])?.start
        : matchingCues[0]?.start;

      validated.push({
        word,
        translation,
        meaning: translation,
        explanation,
        example,
        context: example,
        contextualMeaning,
        pronunciation: typeof raw.pronunciation === 'string' ? raw.pronunciation.trim() : '',
        timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : null
      });
      if (validated.length >= 8) break;
    }
    return { words: validated, received: rawItems.length, rejected };
  }

  async prepareVideoVocabulary(videoId, sessionEpoch, transcriptCues) {
    if (!Array.isArray(transcriptCues) || transcriptCues.length === 0) {
      this.uiManager.setVocabularyStatus('unavailable');
      return;
    }

    try {
      this.uiManager.setVocabularyStatus('preparing');
      const transcriptLanguage = this.subtitleManager.primaryTrack?.name ||
        this.subtitleManager.primaryTrack?.languageCode || 'the video language';
      const translationLanguage = this.settings.vocabularyTranslationLanguage || 'English';
      const learnerLevel = this.settings.vocabularyLevel || 'B1';
      const promptSpec = PromptBuilder.buildVideoVocabularyPrompt({
        videoTitle: this.videoMetadata?.title || '',
        transcriptCues,
        transcriptLanguage,
        translationLanguage,
        learnerLevel
      });
      const transcriptTrack = this.subtitleManager.primaryTrack?.languageCode || 'auto';
      const cacheKey = `video_vocab_${videoId}_${transcriptTrack}_${learnerLevel}_${translationLanguage.toLowerCase()}`;
      const response = await this.requestHandler('AI_GENERATE_VIDEO_VOCABULARY', {
        videoId,
        sessionEpoch,
        cacheKey,
        promptSpec
      });
      this.log(`[Vocabulary] Gemini vocabulary request returned for ${videoId}: ok=${Boolean(response?.ok)}, cached=${Boolean(response?.cached)}, error=${response?.error || 'none'}, code=${response?.code || 'none'}`);
      if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
        this.log(`[Vocabulary] Ignoring stale Gemini response for ${videoId} at epoch ${sessionEpoch}.`);
        return;
      }
      if (!response?.ok) {
        const error = new Error(response?.error || 'Vocabulary service unavailable.');
        error.status = response?.status;
        error.code = response?.code;
        if (!error.status && /(?:429|rate.?limit)/i.test(error.message)) error.status = 429;
        throw error;
      }

      const validation = YouTubeLearningAssistantApp.validateVocabularyResponse(response.data, transcriptCues);
      const words = validation.words;
      this.log(`[Vocabulary] Validation for ${videoId}: received=${validation.received}, accepted=${words.length}, rejected=${JSON.stringify(validation.rejected)}`);
      this.vocabulary = words;
      this.uiManager.setVocabulary(words);
      if (words.length > 0) {
        this.uiManager.setVocabularyStatus('ready');
        this.log(`[Vocabulary] Prepared and transcript-validated ${words.length} cards.`);
      } else {
        this.uiManager.setVocabularyStatus(
          'empty',
          'The captions did not contain enough reliable, level-appropriate vocabulary. Add a word yourself or continue to the video.'
        );
      }
    } catch (err) {
      if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;
      this.log(`[Vocabulary] Preparation failed: ${err.message}`);
      const message = err.code === 'MISSING_API_KEY'
        ? 'Add your Gemini API key in Settings, then try again. You can continue to the video now.'
        : err.status === 429 || err.code === 'RATE_LIMITED'
        ? 'Gemini is temporarily rate-limited. You can add words yourself or continue to the video.'
        : 'The vocabulary response could not be verified. Add words yourself or continue to the video.';
      this.uiManager.setVocabularyStatus('error', message);
    }
  }

  handleContinueFromVocabulary() {
    if (!this.vocabularyPrepGate) {
      this.uiManager.closeOverlay();
      return;
    }
    this.vocabularyPrepGate = false;
    this.uiManager.closeOverlay();
    this.uiManager.setVocabularyPrepGate(false);
    this.uiManager.setStatus('Ready', 'ready');
    this.videoController.setPlaybackGate(false);
    this.videoController.resume();
  }

  /**
   * Sends transcript and chapter timestamps to Gemini for interactive breakpoints.
   */
  async planBreakpointsWithGemini(videoId, sessionEpoch, subtitleResult, chapters = []) {
    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;
    if (this.settings.enabled === false) return;

    try {
      this.uiManager.setStatus('AI Planning Video Check-ins...', 'preparing');

      const videoDuration = this.getEffectiveDuration();
      const promptSpec = PromptBuilder.buildVideoBreakpointsAndActivitiesPrompt({
        videoTitle: this.videoMetadata?.title || '',
        videoDuration,
        chapters,
        transcriptCues: this.subtitleManager.cues || [],
        transcriptChunks: subtitleResult.chunks || [],
        minIntervalSeconds: this.settings.minIntervalSeconds || 300,
        preferredActivityTypes: this.settings.preferredActivityTypes || [
          'multiple_choice',
          'short_answer',
          'teach_back',
          'prediction',
          'critical_thinking'
        ]
      });

      const transcriptForCache = this.subtitleManager.cues || [];
      const cacheInput = transcriptForCache.map((cue) => `${cue.start || 0}:${cue.text || ''}`).join('|');
      let transcriptHash = 2166136261;
      for (let i = 0; i < cacheInput.length; i++) {
        transcriptHash ^= cacheInput.charCodeAt(i);
        transcriptHash = Math.imul(transcriptHash, 16777619);
      }

      const res = await this.requestHandler('AI_PLAN_BREAKPOINTS_AND_ACTIVITIES', {
        videoId,
        sessionEpoch,
        cacheKey: `plan_bp_${videoId}_${transcriptForCache.length}_${(transcriptHash >>> 0).toString(16)}`,
        promptSpec
      });

      if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

      if (res && res.ok && res.data) {
        if (Array.isArray(res.data.breakpoints) && res.data.breakpoints.length > 0) {
          this.log(
            `[Breakpoint] Gemini AI planned ${res.data.breakpoints.length} checkpoints and questions for video!`
          );
          this.breakpointDetector.setBreakpointsFromAi(res.data.breakpoints, videoId);
          this.syncTimelineMarkers();

          const count = this.breakpointDetector.getAllScheduledBreakpoints().length;
          this.uiManager.setStatus(`Active (${count} AI checkpoints)`, 'ready');
          return;
        }
      }
    } catch (err) {
      this.log(`[Breakpoint] Gemini AI planning fallback (${err.message}). Using seeded checkpoints.`);
    }

    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

    const totalScheduled = this.breakpointDetector.getAllScheduledBreakpoints().length;
    this.uiManager.setStatus(`Active (${totalScheduled} breakpoints)`, 'ready');
  }

  scheduleLateMetadataCheck(videoId, sessionEpoch, retryCount = 0) {
    const retryKey = `${videoId}:${sessionEpoch}`;
    const retryDelays = [1200, 2000, 3200, 4800, 6500];
    if (retryCount === 0) {
      if (this._lateCaptionRetrySessions.has(retryKey)) return;
      this._lateCaptionRetrySessions.add(retryKey);
    }

    if (retryCount >= retryDelays.length) {
      this._lateCaptionRetrySessions.delete(retryKey);
      if (!this.videoController.isSessionValid(videoId, sessionEpoch) || this.lastSubtitleResult?.primaryCues?.length) return;
      const tracks = this.videoMetadata?.captionTracks || [];
      const availability = this.videoMetadata?.captionAvailability || 'unknown';
      if (this.vocabularyPrepGate) {
        if (tracks.length > 0) {
          this.uiManager.setVocabularyStatus(
            'error',
            `YouTube listed captions, but none of the available tracks could be read. Check your connection and retry; you can also continue without a word list.`
          );
        } else if (availability === 'unavailable') {
          this.uiManager.setVocabularyStatus(
            'unavailable',
            'YouTube confirmed that this video has no caption tracks. We did not invent vocabulary; add words yourself or continue to the video.'
          );
        } else {
          this.uiManager.setVocabularyStatus(
            'error',
            'Could not confirm whether this video has captions. Try checking again, or continue to the video.'
          );
        }
      }
      this.log(`[Captions] Retry window ended for ${videoId}: availability=${availability}, tracks=${tracks.length}.`);
      return;
    }

    setTimeout(async () => {
      if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
        this._lateCaptionRetrySessions.delete(retryKey);
        return;
      }

      let metadata = null;
      try {
        metadata = await this.videoController.requestBridgeMetadata();
      } catch (err) {
        this.log(`[Captions] Metadata retry ${retryCount + 1} failed: ${err.message}`);
      }

      if (metadata && metadata.videoId === videoId) {
        const incomingTracks = Array.isArray(metadata.captionTracks) ? metadata.captionTracks : [];
        this.videoMetadata = {
          ...this.videoMetadata,
          ...metadata,
          captionTracks: incomingTracks.length ? incomingTracks : (this.videoMetadata?.captionTracks || []),
          captionAvailability: incomingTracks.length
            ? 'available'
            : metadata.captionAvailability || this.videoMetadata?.captionAvailability || 'unknown',
          translationLanguages: metadata.translationLanguages?.length
            ? metadata.translationLanguages
            : (this.videoMetadata?.translationLanguages || [])
        };

        if (incomingTracks.length > 0) {
          this.log(`[Captions] Late discovery succeeded for ${videoId}: ${incomingTracks.length} track(s).`);
          this.uiManager.setAvailableTracks(incomingTracks, this.videoMetadata.translationLanguages || []);
          try {
            const secondaryLang = this.settings.enableDualSubtitles !== false
              ? this.settings.secondarySubtitleLang || 'en'
              : 'none';
            const result = await this.subtitleManager.loadSubtitlesForVideo(
              this.videoMetadata,
              this.settings.primarySubtitleLang || 'auto',
              secondaryLang,
              { enableDualSubtitles: this.settings.enableDualSubtitles !== false }
            );
            if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
              this._lateCaptionRetrySessions.delete(retryKey);
              return;
            }
            this.lastSubtitleResult = result;
            const primaryCues = await this.getOriginalTranscriptCues(result);
            if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
              this._lateCaptionRetrySessions.delete(retryKey);
              return;
            }

            if (primaryCues.length > 0) {
              result.primaryCues = primaryCues;
              if (!result.cues?.length) {
                result.cues = primaryCues;
                result.chunks = SubtitleManager.buildSemanticChunks(primaryCues, this.videoMetadata.chapters || [], 30);
                result.hasSubtitles = true;
                this.subtitleManager.cues = primaryCues;
                this.subtitleManager.chunks = result.chunks;
                await db.saveTranscript(videoId, {
                  cues: primaryCues,
                  chunks: result.chunks,
                  primaryCues,
                  primaryTrack: this.subtitleManager.primaryTrack,
                  trackInfo: this.subtitleManager.primaryTrack,
                  secondaryCues: this.subtitleManager.secondaryCues,
                  secondaryTrack: this.subtitleManager.secondaryTrack
                }).catch(() => {});
              }
              this.lastSubtitleResult = result;
              this.log(`[Captions] Late transcript extraction succeeded for ${videoId}: ${primaryCues.length} cue(s).`);
              if (this.vocabularyPrepGate) await this.prepareVideoVocabulary(videoId, sessionEpoch, primaryCues);
              if (!this.videoController.isSessionValid(videoId, sessionEpoch)) {
                this._lateCaptionRetrySessions.delete(retryKey);
                return;
              }

              const chapters = this.videoMetadata.chapters || [];
              this.breakpointDetector.seedInitialCandidates(result.chunks || [], chapters, this.getEffectiveDuration(), videoId);
              this.syncTimelineMarkers();
              if (this.settings.useAiBreakpoints !== false) {
                await this.planBreakpointsWithGemini(videoId, sessionEpoch, result, chapters);
              }
              const activeCues = this.subtitleManager.getActiveDualCues(this.videoController.getCurrentTime());
              this.uiManager.renderDualSubtitles(activeCues, this.settings);
              this._lateCaptionRetrySessions.delete(retryKey);
              return;
            }
            this.log(`[Captions] Tracks were discovered for ${videoId}, but extraction is ${this.subtitleManager.lastFetchStatus?.state || 'unknown'}; retrying.`);
          } catch (err) {
            this.log(`[Captions] Late caption processing failed for ${videoId}: ${err.message}`);
          }
        } else {
          this.log(`[Captions] Retry ${retryCount + 1} found no caption tracks for ${videoId} (${this.videoMetadata.captionAvailability || 'unknown'}).`);
        }
      } else {
        this.log(`[Captions] Retry ${retryCount + 1} metadata did not match current video ${videoId}.`);
      }

      this.scheduleLateMetadataCheck(videoId, sessionEpoch, retryCount + 1);
    }, retryDelays[retryCount]);
  }

  handleUserSeek(newTime, videoId, sessionEpoch) {
    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;
    this.interventionManager.handleSeek(newTime);
    this.breakpointDetector.handleUserSeek(newTime);
    this.syncTimelineMarkers();

    if (this.settings.enableDualSubtitles !== false && this.subtitleManager) {
      const activeCues = this.subtitleManager.getActiveDualCues(newTime);
      this.uiManager.renderDualSubtitles(activeCues, this.settings);
    } else {
      this.uiManager.clearDualSubtitles();
    }
  }

  async handleTimeUpdate(currentTime, videoId, sessionEpoch, playbackRate = 1.0) {
    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

    // Dual Subtitles Update (renders subtitles on video whenever enabled)
    if (this.settings.enableDualSubtitles !== false && this.subtitleManager) {
      const attempts = this._secondaryFetchAttempts || 0;
      const backoff = attempts === 0 ? 3000 : 15000;
      if (
        !this.subtitleManager.hasSecondarySubtitles &&
        this.currentVideoId &&
        this.settings.secondarySubtitleLang !== 'none' &&
        !this._isFetchingSecondary &&
        attempts < 2 &&
        (Date.now() - (this._lastSecondaryFetchAttempt || 0) > backoff)
      ) {
        this._secondaryFetchAttempts = attempts + 1;
        this._lastSecondaryFetchAttempt = Date.now();
        this._isFetchingSecondary = true;
        this.subtitleManager.downloadSecondaryTrackOnDemand(
          this.settings.secondarySubtitleLang || 'en',
          this.videoMetadata || { videoId: this.currentVideoId }
        ).then((ok) => {
          if (ok) {
            const cur = this.videoController.getCurrentTime();
            const cues = this.subtitleManager.getActiveDualCues(cur);
            this.uiManager.renderDualSubtitles(cues, this.settings);
          }
        }).catch(() => {}).finally(() => {
          this._isFetchingSecondary = false;
        });
      }

      const activeCues = this.subtitleManager.getActiveDualCues(currentTime);
      this.uiManager.renderDualSubtitles(activeCues, this.settings);
    } else {
      this.uiManager.clearDualSubtitles();
    }

    if (this.settings.enabled === false) return;

    // Issue 4: If watching a non-educational video without override, track actual playback time
    // and redirect to https://www.youtube.com/ when the varied ~5-minute threshold is reached!
    if (this.interventionManager.isNonEducational && !this.userClassificationOverride) {
      const isTabHidden =
        typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const tickRes = await this.interventionManager.recordPlaybackTick({
        currentTime,
        playbackRate,
        isPaused: Boolean(this.videoController.videoElement?.paused),
        isSeeking: Boolean(this.videoController.videoElement?.seeking),
        isTabHidden,
        interventionEnabled: this.settings.enableNonEducationalIntervention !== false,
        userOverrodeClassification: this.userClassificationOverride
      });
      if (tickRes.redirected) {
        return;
      }
      return;
    }

    if (!this.isLearningActiveForCurrentVideo() || this.isActivityActive) return;

    const hasScheduled = this.breakpointDetector.getAllScheduledBreakpoints().length > 0;
    if (!this.subtitleManager.hasSubtitles && !hasScheduled) return;

    const learnerContext = await learningManager.getLearnerContext(videoId);
    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

    const triggeredBp = this.breakpointDetector.checkPlaybackForBreakpoint(
      currentTime,
      learnerContext.adaptiveIntervalMultiplier,
      playbackRate
    );

    if (triggeredBp && triggeredBp.activity) {
      this.syncTimelineMarkers();
      this.presentBreakpointActivity(triggeredBp.activity);
      return;
    }

    if (
      this.settings.useAiBreakpoints !== false &&
      !this.breakpointDetector.hasAiPlanned &&
      this.subtitleManager.chunks.length > 0
    ) {
      this.prepareUpcomingSectionsAhead(currentTime, videoId, sessionEpoch, learnerContext);
    }
  }

  async prepareUpcomingSectionsAhead(currentTime, videoId, sessionEpoch, cachedLearnerContext = null) {
    if (this.breakpointDetector.hasAiPlanned) return;
    const learnerContext =
      cachedLearnerContext || (await learningManager.getLearnerContext(videoId));

    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

    const chunksToPrepare = this.breakpointDetector.getChunksToPrepareAhead(
      currentTime,
      this.subtitleManager.chunks,
      learnerContext.adaptiveIntervalMultiplier
    );

    if (chunksToPrepare.length === 0) return;

    for (const chunk of chunksToPrepare) {
      this.breakpointDetector.inProgressChunkIds.add(chunk.id);

      const nextChunk = this.subtitleManager.chunks[chunk.index + 1] || null;
      const previousChunkSummary = this.chunkSummaries.get(chunk.index - 1) || '';

      try {
        const analysis =
          this.settings.useAiBreakpoints !== false
            ? await this.contentAnalyzer.analyzeChunk({
                videoId,
                sessionEpoch,
                videoTitle: this.videoMetadata?.title || '',
                videoDescription: this.videoMetadata?.shortDescription || '',
                chunk,
                nextChunk,
                previousChunkSummary,
                learnerContext
              })
            : ContentAnalyzer.heuristicAnalysis(chunk, this.videoMetadata?.title || '');

        if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

        if (analysis?.conceptSummary) {
          this.chunkSummaries.set(chunk.index, analysis.conceptSummary);
        }

        let activity = null;
        if (analysis && analysis.shouldGenerateActivity) {
          activity = await this.activityGenerator.generateActivity({
            videoId,
            sessionEpoch,
            videoTitle: this.videoMetadata?.title || '',
            chunk,
            nextChunk,
            sectionAnalysis: analysis,
            previousChunkSummary,
            learnerContext,
            chunkIndex: chunk.index
          });
        }

        if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;

        this.breakpointDetector.registerPreparedBreakpoint(chunk.id, analysis, activity);
        this.syncTimelineMarkers();
      } catch (err) {
        console.warn('[YT-Learn Pipeline] Failed preparing chunk:', chunk.id, err);
        this.breakpointDetector.inProgressChunkIds.delete(chunk.id);
      }
    }

    if (this.videoController.isSessionValid(videoId, sessionEpoch) && !this.isActivityActive) {
      const readyCount = this.breakpointDetector.getUpcomingBreakpoints(currentTime).length;
      this.uiManager.setStatus(
        readyCount > 0 ? `Active (${readyCount} queued)` : 'Active',
        'ready'
      );
    }
  }

  presentBreakpointActivity(activity, forceImmediate = false) {
    if (activity) {
      if (activity.prompt) activity.prompt = BreakpointDetector.sanitizePrompt(activity.prompt);
      if (activity.conceptName) activity.conceptName = BreakpointDetector.cleanConceptName(activity.conceptName);
    }

    if (!forceImmediate && (this.settings.autoPause === false || this.settings.notificationOnlyMode)) {
      this.log(`[Breakpoint] Activity triggered (notification toast)`);
      this.uiManager.showOptionalActivityToast(activity, () => {
        this.isActivityActive = true;
        this.videoController.pause();
        this.log(`[Breakpoint] Activity triggered`);
        this.uiManager.setStatus('Activity Paused', 'paused');
        this.uiManager.showActivityOverlay(activity);
      });
      return;
    }

    this.isActivityActive = true;
    this.videoController.pause();
    this.log(`[Breakpoint] Activity triggered`);
    this.uiManager.setStatus('Activity Active', 'paused');
    this.uiManager.showActivityOverlay(activity);
  }

  async handleManualTriggerActivity() {
    if (!this.currentVideoId) return;

    const currentTime = this.videoController.getCurrentTime();
    const chunk =
      this.subtitleManager.getChunkAtTime(currentTime) ||
      this.subtitleManager.chunks[0];
    if (!chunk) return;

    this.videoController.pause();
    this.isActivityActive = true;
    this.uiManager.setStatus('Generating...', 'preparing');

    const videoId = this.currentVideoId;
    const sessionEpoch = this.sessionEpoch;
    const learnerContext = await learningManager.getLearnerContext(videoId);
    const nextChunk = this.subtitleManager.chunks[chunk.index + 1] || null;
    const previousChunkSummary = this.chunkSummaries.get(chunk.index - 1) || '';

    const analysis = await this.contentAnalyzer.analyzeChunk({
      videoId,
      sessionEpoch,
      videoTitle: this.videoMetadata?.title || '',
      videoDescription: this.videoMetadata?.shortDescription || '',
      chunk,
      nextChunk,
      previousChunkSummary,
      learnerContext
    });

    if (!this.videoController.isSessionValid(videoId, sessionEpoch)) return;
    analysis.shouldGenerateActivity = true;

    const activity = await this.activityGenerator.generateActivity({
      videoId,
      sessionEpoch,
      videoTitle: this.videoMetadata?.title || '',
      chunk,
      nextChunk,
      sectionAnalysis: analysis,
      previousChunkSummary,
      learnerContext,
      chunkIndex: chunk.index
    });

    if (!this.videoController.isSessionValid(videoId, sessionEpoch) || !activity) {
      this.isActivityActive = false;
      return;
    }

    this.log(`[Breakpoint] Activity triggered`);
    this.uiManager.setStatus('Activity Active', 'paused');
    this.uiManager.showActivityOverlay(activity);
  }

  async handleAnswerSubmission(activity, userAnswer) {
    const videoId = this.currentVideoId;
    const sessionEpoch = this.sessionEpoch;

    const evaluation = await this.answerEvaluator.evaluate({
      videoId,
      sessionEpoch,
      videoTitle: this.videoMetadata?.title || '',
      activity,
      userAnswer
    });

    this.log(`[Breakpoint] Activity completed`);

    if (this.videoController.isSessionValid(videoId, sessionEpoch)) {
      learningManager
        .processCompletedActivity({
          videoId,
          videoTitle: this.videoMetadata?.title || '',
          videoTime: this.videoController.getCurrentTime(),
          activity,
          userAnswer,
          evaluation
        })
        .catch((err) => {
          console.warn('[YT-Learn] Non-fatal history persistence error:', err);
        });
    }

    return evaluation;
  }

  async handleSkipActivity(activity) {
    this.log(`[Breakpoint] Activity completed (skipped)`);
    this.isActivityActive = false;
    this.uiManager.setStatus('Active', 'ready');
    this.videoController.resume();

    if (this.currentVideoId) {
      await learningManager.recordSkippedActivity({
        videoId: this.currentVideoId,
        videoTitle: this.videoMetadata?.title || '',
        videoTime: this.videoController.getCurrentTime(),
        activity
      });
    }
  }

  handleContinueWatching() {
    this.isActivityActive = false;
    this.uiManager.setStatus('Active', 'ready');
    this.videoController.resume();
  }

  async handleRequestExplanation(activity) {
    return this.answerEvaluator.explainConceptDifferently({
      videoId: this.currentVideoId,
      sessionEpoch: this.sessionEpoch,
      videoTitle: this.videoMetadata?.title || '',
      activity
    });
  }

  async handleAskTutorFollowUp({ activity, userAnswer, evaluation, userQuestion }) {
    const promptSpec = PromptBuilder.buildTutorFollowUpPrompt({
      videoTitle: this.videoMetadata?.title || '',
      activity,
      userAnswer,
      evaluation,
      userQuestion,
      transcriptText: activity?.transcriptExcerpt || activity?.conceptSummary || ''
    });

    try {
      const res = await this.requestHandler('AI_TUTOR_FOLLOW_UP', {
        videoId: this.currentVideoId,
        sessionEpoch: this.sessionEpoch,
        promptSpec
      });

      if (res && res.ok && res.data) {
        return res.data;
      }
    } catch (err) {
      console.warn('[YT-Learn] AI tutor follow-up request failed:', err);
    }

    return {
      directAnswer: `Regarding "${userQuestion}": In this section covering "${activity.conceptName}", ${activity.exemplarAnswer || activity.conceptSummary || 'the concept works as demonstrated in the video'}.`,
      transcriptGrounding: activity.transcriptVerification || activity.contextSummary || '',
      keyInsight: activity.expectedKeyPoints?.[0] || 'Focus on how the core principle connects to the video demonstration.'
    };
  }

  async triggerMilestoneTitleSynthesisIfNeeded(breakpoints) {
    if (this.settings.useAiBreakpoints === false) return;
    const candidates = (breakpoints || []).filter(
      (bp) => bp.mergedConceptNames?.length > 1 && !bp.aiMilestoneSynthesized && !bp.isSynthesizingMilestone
    );

    for (const bp of candidates) {
      bp.isSynthesizingMilestone = true;
      const promptSpec = PromptBuilder.buildSynthesizeMilestonePrompt({
        videoTitle: this.videoMetadata?.title || '',
        conceptNames: bp.mergedConceptNames,
        mergedSummary: bp.activity?.conceptSummary || ''
      });

      this.requestHandler('AI_SYNTHESIZE_MILESTONE_TITLE', {
        videoId: this.currentVideoId,
        sessionEpoch: this.sessionEpoch,
        promptSpec
      })
        .then((res) => {
          bp.isSynthesizingMilestone = false;
          if (res && res.ok && res.data?.milestoneTitle) {
            bp.aiMilestoneSynthesized = true;
            if (bp.activity) {
              bp.activity.conceptName = res.data.milestoneTitle;
              if (bp.activity.prompt) {
                bp.activity.prompt = BreakpointDetector.sanitizePrompt(bp.activity.prompt);
              }
              this.log(
                `[Breakpoint] AI synthesized milestone title: "${res.data.milestoneTitle}" for breakpoint at ${bp.timestamp.toFixed(1)}s`
              );
              const currentBreakpoints = this.breakpointDetector.getAllScheduledBreakpoints();
              this.uiManager.renderTimelineMarkers(
                currentBreakpoints,
                this.getEffectiveDuration(),
                this.breakpointDetector.triggeredIds
              );
            }
          }
        })
        .catch(() => {
          bp.isSynthesizingMilestone = false;
        });
    }
  }

  async handleSaveSettings(partialSettings) {
    this.settings = { ...this.settings, ...partialSettings };
    if (partialSettings.enableDualSubtitles === false) {
      this.uiManager.clearDualSubtitles();
    }

    const saved = await Database.saveSettings(partialSettings);
    this.settings = saved;
    this.breakpointDetector.updateSettings(saved);
    this.syncTimelineMarkers();

    if (
      'secondarySubtitleLang' in partialSettings ||
      'enableDualSubtitles' in partialSettings
    ) {
      this._secondaryFetchAttempts = 0;
      this._lastSecondaryFetchAttempt = 0;
      const targetVideoId = this.currentVideoId || this.videoMetadata?.videoId;
      if (targetVideoId && this.settings.enableDualSubtitles !== false && this.subtitleManager) {
        if (!this.videoMetadata) {
          this.videoMetadata = { videoId: targetVideoId };
        }
        if (!this.videoMetadata.captionTracks || this.videoMetadata.captionTracks.length === 0) {
          const freshMeta = await this.videoController.requestBridgeMetadata();
          if (freshMeta && freshMeta.captionTracks?.length > 0) {
            this.videoMetadata = { ...this.videoMetadata, ...freshMeta };
            this.uiManager.setAvailableTracks(
              this.videoMetadata.captionTracks,
              this.videoMetadata.translationLanguages || []
            );
          }
        }
        // Only download 1 subtitle on user demand. The original one is handled natively by YouTube.
        await this.subtitleManager.downloadSecondaryTrackOnDemand(
          this.settings.secondarySubtitleLang || 'en',
          this.videoMetadata
        );
        const currentTime = this.videoController.getCurrentTime();
        const activeCues = this.subtitleManager.getActiveDualCues(currentTime);
        this.uiManager.renderDualSubtitles(activeCues, this.settings);
      } else if (this.settings.enableDualSubtitles === false) {
        this.uiManager.clearDualSubtitles();
      }
    }

    this.uiManager.updateSettings(saved);
    await this.requestHandler('SAVE_SETTINGS', { settings: saved }).catch(() => {});
  }

  async handleLoadDashboardData() {
    const [stats, concepts] = await Promise.all([
      historyManager.getStats(this.currentVideoId),
      db.getAllConcepts()
    ]);
    const upcomingBreakpoints = this.breakpointDetector.getUpcomingBreakpoints(
      this.videoController.getCurrentTime()
    );
    return { stats, concepts, upcomingBreakpoints };
  }
}

if (
  typeof window !== 'undefined' &&
  !window.__YT_LEARN_DISABLE_AUTOSTART__
) {
  const app = new YouTubeLearningAssistantApp();
  window.__ytLearnApp = app;
  app.start();
}
