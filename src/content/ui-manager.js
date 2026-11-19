/**
 * @fileoverview User Interface Manager (`ui-manager.js`)
 *
 * Updates for New Improvements 1, 2, and 4:
 * 1. Issue 1 (Fix Time Marker Content Visibility & X-Axis Proximity Hover Detection):
 *    - Attaches `mousemove` and `mouseleave` listeners to YouTube's `.ytp-progress-bar-container`
 *      (and `.ytp-progress-bar`).
 *    - Calculates the horizontal X-axis pixel distance (`|cursorX - markerX|`) between the user's
 *      cursor and every breakpoint marker via `UIManager.findNearestMarkerByX(...)`.
 *    - Uses a 26px activation threshold and a 34px hysteresis retention window on the currently
 *      active marker so moving the mouse slightly or passing between two nearby markers never
 *      flickers, while keeping unrelated distant markers hidden.
 *    - Dynamically measures YouTube's `.ytp-tooltip` (thumbnail preview mini-frame) height when
 *      visible and sets `--yt-learn-popup-bottom` (default `152px`, or `ytpTooltipHeight + 28px`)
 *      so our breakpoint popup floats cleanly **above** YouTube's thumbnail preview without
 *      either element obscuring the other!
 * 2. Issue 2 (Simplify Explanations for Multiple-Choice Questions):
 *    - When `evaluation.evaluationMode === 'objective'`, renders a concise, scannable Multiple-Choice
 *      Explanation card (`Why the correct answer is right`, `Why the other options are incorrect`, and
 *      `Core Concept Takeaway`) instead of repeating a 4-criterion essay for every option.
 * 3. Issue 4 (Settings Toggle for Non-Educational Active Intervention):
 *    - Adds a checkbox in Settings (`Active Intervention: Redirect to YouTube Home after ~5m on non-educational videos`)
 *      and displays live intervention status in the dedicated bar when watching a non-educational video.
 */

import { ActivityGenerator } from '../ai/activity-generator.js';
import { TemplateLoader } from './template-loader.js';
import { html, mountComponent } from './components/render-helper.js';
import { DedicatedBar } from './components/DedicatedBar.js';
import { VocabularyDrawer } from './components/VocabularyDrawer.js';
import { ActivityOverlay } from './components/ActivityOverlay.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { DashboardDrawer } from './components/DashboardDrawer.js';
import { DualSubtitles } from './components/DualSubtitles.js';
import { TimelineMarkers } from './components/TimelineMarkers.js';

export class UIManager {
  /**
   * @param {object} callbacks
   * @param {(activity: object, userAnswer: any) => Promise<object>} callbacks.onSubmitAnswer
   * @param {(activity: object) => void} callbacks.onSkipActivity
   * @param {(activity: object) => void} callbacks.onContinueWatching
   * @param {(activity: object) => Promise<object>} callbacks.onRequestExplanation
   * @param {(newSettings: object) => Promise<void>} callbacks.onSaveSettings
   * @param {() => Promise<object>} callbacks.onLoadDashboardData
   * @param {() => void} callbacks.onManualTriggerActivity
   * @param {(breakpoint: object) => void} [callbacks.onTimelineMarkerClick]
   * @param {(forceEnable: boolean) => void} [callbacks.onOverrideClassification]
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.settings = {};
    this.rootContainer = null;
    this.barContainer = null;
    this.markersLayer = null;
    this.barCollapsed = false;
    this.isActivityMinimized = false;

    this.activePanel = null;
    this.activeActivityId = null;
    this.activeActivity = null;
    this.dualSubtitlesContainer = null;
    this.availableTracks = [];
    this.translationLanguages = [];
    this.isSubmitting = false;
    this.statusText = 'Ready';
    this.statusState = 'ready';
    this.videoClassification = null;
    this.userClassificationOverride = null;
    this.localServerConnected = false;
    this.vocabulary = [];
    this.vocabularyState = 'empty';
    this.vocabularyMessage = '';
    this.vocabularyPrepGate = false;

    this.cachedBreakpoints = [];
    this.cachedTriggeredIds = new Set();
    this.cachedDuration = 0;

    this.boundRepositionUI = () => {
      this.mountDedicatedBarInSafeSlot();
      this.renderTimelineMarkers(
        this.cachedBreakpoints,
        this.cachedDuration,
        this.cachedTriggeredIds
      );
    };
  }

  init(initialSettings) {
    this.settings = initialSettings || {};
    if (typeof document === 'undefined') return;

    this.monitorNativeCaptionButton();

    const existingRoot = document.getElementById('yt-learn-assistant-root');
    if (existingRoot) {
      this.rootContainer = existingRoot;
      this.barContainer = document.getElementById('yt-learn-dedicated-bar');
      this.mountDedicatedBarInSafeSlot();
      this.renderDedicatedBar();
      return;
    }

    this.rootContainer = document.createElement('div');
    this.rootContainer.id = 'yt-learn-assistant-root';
    document.body.appendChild(this.rootContainer);

    this.barContainer = document.createElement('div');
    this.barContainer.id = 'yt-learn-dedicated-bar';
    this.barContainer.className = 'yt-learn-dedicated-bar';
    this.mountDedicatedBarInSafeSlot();

    window.addEventListener('resize', this.boundRepositionUI);
    document.addEventListener('fullscreenchange', this.boundRepositionUI);
    window.addEventListener('yt-navigate-finish', this.boundRepositionUI);

    this.renderDedicatedBar();
  }

  mountDedicatedBarInSafeSlot() {
    if (!this.barContainer || typeof document === 'undefined') return;

    // Only display the dedicated bar on active video watch pages
    const isWatchPage =
      typeof window !== 'undefined' &&
      ((window.location?.pathname || '').includes('/watch') ||
        (window.location?.search || '').includes('v=') ||
        Boolean(window.__YT_LEARN_SIMULATED_VIDEO_ID__));

    if (!isWatchPage) {
      this.barContainer.style.display = 'none';
      return;
    }
    this.barContainer.style.display = '';

    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsElement) {
      this.barContainer.classList.add('floating-top-dock');
      if (this.barContainer.parentElement !== fsElement) {
        fsElement.appendChild(this.barContainer);
      }
      return;
    }

    const belowPlayerSlot =
      document.querySelector('#below') ||
      document.querySelector('ytd-watch-metadata #above-the-fold') ||
      document.querySelector('#primary-inner #info') ||
      document.querySelector('[data-yt-learn-dedicated-slot]');

    if (belowPlayerSlot) {
      this.barContainer.classList.remove('floating-top-dock');
      if (this.barContainer.parentElement !== belowPlayerSlot) {
        belowPlayerSlot.insertBefore(this.barContainer, belowPlayerSlot.firstChild);
      }
    } else {
      this.barContainer.classList.add('floating-top-dock');
      if (this.barContainer.parentElement !== document.body) {
        document.body.appendChild(this.barContainer);
      }
    }
  }

  ensureOverlayHost() {
    if (typeof document === 'undefined') return;
    if (!this.rootContainer && typeof document.createElement === 'function') {
      const existing = typeof document.getElementById === 'function'
        ? document.getElementById('yt-learn-assistant-root')
        : null;
      this.rootContainer = existing || document.createElement('div');
      this.rootContainer.id = 'yt-learn-assistant-root';
      this.rootContainer.className = 'yt-learn-assistant-root';
    }
    if (!this.rootContainer) return;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    const targetParent = fsElement || document.body;
    if (targetParent && this.rootContainer.parentElement !== targetParent && typeof targetParent.appendChild === 'function') {
      targetParent.appendChild(this.rootContainer);
    }
  }

  setStatus(text, state = 'ready') {
    this.statusText = text;
    this.statusState = this.settings.enabled === false ? 'disabled' : state;
    this.renderDedicatedBar();
  }

  setVideoClassification(classification, userOverride = null) {
    this.videoClassification = classification;
    this.userClassificationOverride = userOverride;
    this.renderDedicatedBar();
  }

  setLocalServerStatus(isConnected) {
    if (this.localServerConnected !== isConnected) {
      this.localServerConnected = isConnected;
      this.renderDedicatedBar();
    }
  }

  setVocabulary(words = [], options = {}) {
    const incoming = Array.isArray(words) ? words : [];
    const localEdits = this.activePanel === 'vocabulary' && Array.isArray(this.vocabulary)
      ? this.vocabulary
      : [];
    const seen = new Set();
    this.vocabulary = [...localEdits, ...incoming].filter((item) => {
      const key = String(item?.word || '').trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (incoming.length > 0) {
      this.vocabularyState = 'ready';
      this.vocabularyMessage = '';
    } else if (localEdits.length === 0) {
      this.vocabularyState = 'empty';
      this.vocabularyMessage = '';
    }
    console.info(`[YT-Learn Vocabulary] Frontend state updated: incoming=${incoming.length}, displayed=${this.vocabulary.length}, panel=${this.activePanel || 'closed'}`);
    this.renderDedicatedBar();

    if (this.activePanel === 'vocabulary') {
      this.showVocabularyDrawer();
    }
  }

  setVocabularyStatus(state, message = '') {
    this.vocabularyState = state;
    this.vocabularyMessage = message;
    console.info(`[YT-Learn Vocabulary] UI status: ${state}; cards=${this.vocabulary.length}`);
    if (this.activePanel === 'vocabulary') this.showVocabularyDrawer();
  }

  setVocabularyPrepGate(active) {
    this.vocabularyPrepGate = Boolean(active);
    if (this.activePanel === 'vocabulary') this.showVocabularyDrawer();
  }

  renderDedicatedBar() {
    if (!this.barContainer) return;
    this.mountDedicatedBarInSafeSlot();

    const isInsidePlayer =
      this.barContainer.classList?.contains?.('floating-top-dock') ||
      Boolean(this.barContainer.closest?.('#movie_player, .html5-video-player')) ||
      Boolean(typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement));

    if (this.barCollapsed) {
      this.barContainer.classList?.add?.('is-collapsed');
    } else {
      this.barContainer.classList?.remove?.('is-collapsed');
    }

    const vnode = html`<${DedicatedBar}
      barCollapsed=${this.barCollapsed}
      statusText=${this.statusText}
      statusState=${this.statusState}
      settings=${this.settings}
      videoClassification=${this.videoClassification}
      userClassificationOverride=${this.userClassificationOverride}
      localServerConnected=${this.localServerConnected}
      vocabulary=${this.vocabulary}
      availableTracks=${this.availableTracks}
      activePanel=${this.activePanel}
      onToggleCollapse=${() => {
        this.barCollapsed = !this.barCollapsed;
        this.renderDedicatedBar();
      }}
      onToggleAi=${async () => {
        if (this.statusText === 'No Captions or Chapters' && typeof this.callbacks.onRetryMetadataCheck === 'function') {
          this.setStatus('Checking...', 'preparing');
          this.callbacks.onRetryMetadataCheck();
          return;
        }
        const isEnabled = this.settings.enabled !== false;
        const nextEnabled = !isEnabled;
        this.settings.enabled = nextEnabled;
        if (!nextEnabled) {
          this.clearDualSubtitles();
        }
        await this.callbacks.onSaveSettings({ enabled: nextEnabled });
        this.setStatus(nextEnabled ? 'Active' : 'Paused', nextEnabled ? 'ready' : 'disabled');
      }}
      onToggleDualSubs=${async () => {
        const nextDual = this.settings.enableDualSubtitles === false;
        this.settings.enableDualSubtitles = nextDual;
        if (!nextDual) {
          this.clearDualSubtitles();
        }
        this.renderDedicatedBar();
        await this.callbacks.onSaveSettings({ enableDualSubtitles: nextDual });
        if (!nextDual) {
          this.clearDualSubtitles();
        }
      }}
      onSelectSub1=${async (val) => {
        this.settings.primarySubtitleLang = val;
        await this.callbacks.onSaveSettings({ primarySubtitleLang: val });
      }}
      onSelectSub2=${(val) => {
        this.settings.secondarySubtitleLang = val;
        if (this._sub2ChangeTimer) clearTimeout(this._sub2ChangeTimer);
        this._sub2ChangeTimer = setTimeout(async () => {
          await this.callbacks.onSaveSettings({ secondarySubtitleLang: val });
        }, 300);
      }}
      onToggleVocab=${() => {
        if (this.activePanel === 'vocabulary') {
          if (!this.vocabularyPrepGate) this.closeOverlay();
        } else {
          if (typeof this.callbacks.onOpenVocabulary === 'function') {
            this.callbacks.onOpenVocabulary();
          }
          this.showVocabularyDrawer();
        }
      }}
      onManualTrigger=${() => {
        this.callbacks.onManualTriggerActivity();
      }}
      onOpenDashboard=${() => {
        if (this.activePanel === 'dashboard') {
          this.closeOverlay();
        } else {
          this.showDashboardDrawer();
        }
      }}
      onOpenSettings=${() => {
        if (this.activePanel === 'settings') {
          this.closeOverlay();
        } else {
          this.showSettingsDrawer();
        }
      }}
      onOverrideClassification=${() => {
        if (typeof this.callbacks.onOverrideClassification === 'function') {
          const nextOverride = !this.userClassificationOverride;
          this.callbacks.onOverrideClassification(nextOverride);
        }
      }}
      onRetryMetadataCheck=${() => {
        if (typeof this.callbacks.onRetryMetadataCheck === 'function') {
          this.setStatus('Checking...', 'preparing');
          this.callbacks.onRetryMetadataCheck();
        }
      }}
      onBackgroundClick=${() => {
        if (isInsidePlayer) {
          this.barCollapsed = true;
          this.renderDedicatedBar();
        }
      }}
    />`;

    mountComponent(vnode, this.barContainer);

    // In real browser DOM (nodeType === 1), Preact already binds and manages all event listeners
    // directly on VNodes. Only attach fallback DOM listeners if running on a plain mock object (e.g. Node tests).
    const isPlainMock = !this.barContainer || typeof this.barContainer.nodeType !== 'number';
    if (isPlainMock) {
      this.barContainer.querySelector?.('#yt-learn-expand-bar-btn')?.addEventListener?.('click', () => {
        this.barCollapsed = false;
        this.renderDedicatedBar();
      });

      this.barContainer.querySelector?.('#yt-learn-dual-subs-btn')?.addEventListener?.('click', async () => {
        const nextDual = this.settings.enableDualSubtitles === false;
        this.settings.enableDualSubtitles = nextDual;
        if (!nextDual) {
          this.clearDualSubtitles();
        }
        this.renderDedicatedBar();
        await this.callbacks.onSaveSettings({ enableDualSubtitles: nextDual });
        if (!nextDual) {
          this.clearDualSubtitles();
        }
      });

      this.barContainer.querySelector?.('#yt-learn-sub1-select')?.addEventListener?.('change', async (e) => {
        const val = e.target.value;
        this.settings.primarySubtitleLang = val;
        await this.callbacks.onSaveSettings({ primarySubtitleLang: val });
      });

      this.barContainer.querySelector?.('#yt-learn-sub2-select')?.addEventListener?.('change', (e) => {
        const val = e.target.value;
        this.settings.secondarySubtitleLang = val;
        if (this._sub2ChangeTimer) clearTimeout(this._sub2ChangeTimer);
        this._sub2ChangeTimer = setTimeout(async () => {
          await this.callbacks.onSaveSettings({ secondarySubtitleLang: val });
        }, 300);
      });

      this.barContainer.querySelector?.('#yt-learn-toggle-btn')?.addEventListener?.('click', async () => {
        if (this.statusText === 'No Captions or Chapters' && typeof this.callbacks.onRetryMetadataCheck === 'function') {
          this.setStatus('Checking...', 'preparing');
          this.callbacks.onRetryMetadataCheck();
          return;
        }
        const isEnabled = this.settings.enabled !== false;
        const nextEnabled = !isEnabled;
        this.settings.enabled = nextEnabled;
        if (!nextEnabled) {
          this.clearDualSubtitles();
        }
        await this.callbacks.onSaveSettings({ enabled: nextEnabled });
        this.setStatus(nextEnabled ? 'Active' : 'Paused', nextEnabled ? 'ready' : 'disabled');
      });

      this.barContainer.querySelector?.('#yt-learn-collapse-bar-btn')?.addEventListener?.('click', () => {
        this.barCollapsed = true;
        this.renderDedicatedBar();
      });

      this.barContainer.querySelector?.('#yt-learn-classification-btn')?.addEventListener?.('click', () => {
        if (typeof this.callbacks.onOverrideClassification === 'function') {
          const nextOverride = !this.userClassificationOverride;
          this.callbacks.onOverrideClassification(nextOverride);
        }
      });

      this.barContainer.querySelector?.('#yt-learn-vocab-btn')?.addEventListener?.('click', () => {
        if (this.activePanel === 'vocabulary') {
          if (!this.vocabularyPrepGate) this.closeOverlay();
        } else {
          if (typeof this.callbacks.onOpenVocabulary === 'function') {
            this.callbacks.onOpenVocabulary();
          }
          this.showVocabularyDrawer();
        }
      });

      this.barContainer.querySelector?.('#yt-learn-now-btn')?.addEventListener?.('click', () => {
        this.callbacks.onManualTriggerActivity();
      });

      this.barContainer.querySelector?.('#yt-learn-dashboard-btn')?.addEventListener?.('click', () => {
        if (this.activePanel === 'dashboard') {
          this.closeOverlay();
        } else {
          this.showDashboardDrawer();
        }
      });

      this.barContainer.querySelector?.('#yt-learn-settings-btn')?.addEventListener?.('click', () => {
        if (this.activePanel === 'settings') {
          this.closeOverlay();
        } else {
          this.showSettingsDrawer();
        }
      });
    }

    this.barContainer.onclick = (event) => {
      if (this.barCollapsed) return;
      const targetEl = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
      if (targetEl?.closest?.('button, select, option, input, a, label')) return;

      if (isInsidePlayer) {
        this.barCollapsed = true;
        this.renderDedicatedBar();
      }
    };
  }

  // ===========================================================================
  // Issue 1: Edge-Aware + X-Axis Proximity Detection + Preview Clearance
  // ===========================================================================

  static computePopupAlignment(pct, barWidthPx = 800, estimatedPopupWidthPx = 220) {
    const safeBarWidth = Math.max(240, Number(barWidthPx) || 800);
    const halfPopup = Math.min(estimatedPopupWidthPx / 2, safeBarWidth * 0.4);
    const markerX = (pct / 100) * safeBarWidth;

    if (pct <= 16 || markerX - halfPopup < 8) {
      return {
        alignClass: 'align-left',
        shiftPx: 0,
        leftEdgePx: Math.max(0, markerX - 4),
        rightEdgePx: Math.min(safeBarWidth, markerX - 4 + estimatedPopupWidthPx)
      };
    }

    if (pct >= 84 || markerX + halfPopup > safeBarWidth - 8) {
      return {
        alignClass: 'align-right',
        shiftPx: 0,
        leftEdgePx: Math.max(0, markerX + 4 - estimatedPopupWidthPx),
        rightEdgePx: Math.min(safeBarWidth, markerX + 4)
      };
    }

    return {
      alignClass: 'align-center',
      shiftPx: 0,
      leftEdgePx: Math.max(0, markerX - halfPopup),
      rightEdgePx: Math.min(safeBarWidth, markerX + halfPopup)
    };
  }

  /**
   * Pure helper for X-axis horizontal distance hover detection with anti-flicker hysteresis.
   *
   * @param {object} params
   * @param {number} params.cursorX - Cursor X coordinate relative to the left edge of the progress bar (`0..barWidthPx`)
   * @param {number} params.barWidthPx - Total width of the progress bar in pixels
   * @param {Array<{id: string, timestamp: number}>} params.breakpoints - Scheduled breakpoints
   * @param {number} params.duration - Video duration in seconds
   * @param {string|null} [params.currentActiveId=null] - Currently active marker ID (for hysteresis stability)
   * @param {number} [params.activateThresholdPx=PROXIMITY_ACTIVATE_PX]
   * @param {number} [params.hysteresisThresholdPx=PROXIMITY_HYSTERESIS_PX]
   * @returns {{ activeId: string|null, distancePx: number|null, markerX: number|null }}
   */
  static findNearestMarkerByX({
    cursorX,
    barWidthPx = 800,
    breakpoints = [],
    duration = 0,
    currentActiveId = null,
    activateThresholdPx = PROXIMITY_ACTIVATE_PX,
    hysteresisThresholdPx = PROXIMITY_HYSTERESIS_PX
  }) {
    if (!breakpoints.length || duration <= 0 || barWidthPx <= 0 || !Number.isFinite(cursorX)) {
      return { activeId: null, distancePx: null, markerX: null };
    }

    let closestBp = null;
    let closestDist = Infinity;
    let closestMarkerX = null;

    let currentActiveDist = Infinity;
    let currentActiveMarkerX = null;

    for (const bp of breakpoints) {
      const rawPct = (Number(bp.timestamp) / duration) * 100;
      const clampedPct = Math.max(0.5, Math.min(99.5, rawPct));
      const markerX = (clampedPct / 100) * barWidthPx;
      const dist = Math.abs(cursorX - markerX);

      if (bp.id === currentActiveId) {
        currentActiveDist = dist;
        currentActiveMarkerX = markerX;
      }

      if (dist < closestDist) {
        closestDist = dist;
        closestBp = bp;
        closestMarkerX = markerX;
      }
    }

    // Anti-flicker hysteresis: if a marker is already active and still within hysteresisThresholdPx,
    // keep it active unless another marker is significantly closer (by at least 6px).
    if (
      currentActiveId &&
      currentActiveDist <= hysteresisThresholdPx &&
      closestDist + 6 >= currentActiveDist
    ) {
      return {
        activeId: currentActiveId,
        distancePx: Number(currentActiveDist.toFixed(2)),
        markerX: Number(currentActiveMarkerX.toFixed(2))
      };
    }

    if (closestBp && closestDist <= activateThresholdPx) {
      return {
        activeId: closestBp.id,
        distancePx: Number(closestDist.toFixed(2)),
        markerX: Number(closestMarkerX.toFixed(2))
      };
    }

    return { activeId: null, distancePx: null, markerX: null };
  }

  /**
   * Computes the safe vertical `bottom` offset (in pixels) for the marker popup so it
   * sits cleanly above YouTube's `.ytp-tooltip` thumbnail preview.
   *
   * @param {HTMLElement|null} progressBar
   * @returns {number} Bottom offset in pixels (e.g. `152` or higher if YouTube's preview is taller)
   */
  static computeSafePopupBottomOffsetPx(progressBar = null) {
    const defaultClearancePx = 152; // Clears standard 90px–125px YouTube thumbnail preview + title
    if (typeof document === 'undefined') return defaultClearancePx;

    const ytTooltip = document.querySelector('.ytp-tooltip');
    if (!ytTooltip || ytTooltip.style.display === 'none') {
      return defaultClearancePx;
    }

    try {
      const tooltipRect = ytTooltip.getBoundingClientRect();
      const barRect = progressBar ? progressBar.getBoundingClientRect() : null;
      if (tooltipRect.height > 0 && barRect && barRect.top > 0) {
        const distanceFromBarToTooltipTop = barRect.top - tooltipRect.top;
        if (distanceFromBarToTooltipTop > 20) {
          return Math.max(defaultClearancePx, Math.round(distanceFromBarToTooltipTop + 14));
        }
      }
    } catch {
      // Ignore DOM rect errors
    }

    return defaultClearancePx;
  }

  /**
   * Handles mouse movement on the progress bar.
   * Direct marker hover is now used instead of broad X-axis proximity detection
   * to prevent premature popups when scrubbing or hovering the timeline.
   */
  handleProgressBarMouseMove(_event) {
    // Deprecated in favor of direct marker pointerenter/pointerleave
  }

  handleProgressBarMouseLeave() {
    this.activeProximityBpId = null;
    if (!this.markersLayer) return;
    this.markersLayer
      .querySelectorAll('.yt-learn-timeline-marker.hover-active, .yt-learn-timeline-marker.proximity-active')
      .forEach((el) => {
        el.classList.remove('hover-active');
        el.classList.remove('proximity-active');
      });
  }

  attachProgressBarProximityListeners(progressBar) {
    // Direct marker hover is used; no broad progress bar proximity listeners needed.
  }

  renderTimelineMarkers(
    breakpoints = [],
    videoDuration = 0,
    triggeredIds = new Set(),
    explicitProgressBar = null
  ) {
    if (typeof document === 'undefined') return;

    this.cachedBreakpoints = Array.isArray(breakpoints) ? breakpoints : [];
    this.cachedTriggeredIds = triggeredIds instanceof Set ? triggeredIds : new Set();

    let duration = Number(videoDuration) || 0;
    if (duration <= 0) {
      const videoEl =
        document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
        duration = videoEl.duration;
      }
    }
    this.cachedDuration = duration;

    const progressBar =
      explicitProgressBar ||
      document.querySelector('.ytp-progress-bar') ||
      document.querySelector('[data-yt-learn-progress-bar]');

    if (!progressBar) return;

    const computedPos = window.getComputedStyle(progressBar).position;
    if (computedPos === 'static') {
      progressBar.style.position = 'relative';
    }
    progressBar.style.overflow = 'visible';
    if (progressBar.parentElement) {
      progressBar.parentElement.style.overflow = 'visible';
    }

    let layer = progressBar.querySelector('.yt-learn-timeline-markers-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'yt-learn-timeline-markers-layer';
      progressBar.appendChild(layer);
    }
    this.markersLayer = layer;
    layer.innerHTML = '';

    if (this.settings.enabled === false || duration <= 0 || this.cachedBreakpoints.length === 0) {
      return;
    }

    const barRect = progressBar.getBoundingClientRect();
    const barWidthPx = barRect && barRect.width > 0 ? barRect.width : 800;
    const safeBottomPx = UIManager.computeSafePopupBottomOffsetPx(progressBar);

    const vnode = html`<${TimelineMarkers}
      breakpoints=${this.cachedBreakpoints}
      duration=${duration}
      triggeredIds=${this.cachedTriggeredIds}
      barWidthPx=${barWidthPx}
      safeBottomPx=${safeBottomPx}
      onSeek=${(ts) => {
        const bp = this.cachedBreakpoints.find((b) => Math.abs(b.timestamp - ts) < 0.1);
        if (bp && typeof this.callbacks.onTimelineMarkerClick === 'function') {
          this.callbacks.onTimelineMarkerClick(bp);
        }
      }}
    />`;

    mountComponent(vnode, layer);

    // Direct hover and click listeners for rendered markers
    layer.querySelectorAll?.('.yt-learn-timeline-marker')?.forEach?.((marker) => {
      marker.addEventListener('pointerenter', () => {
        const dynamicSafeBottom = UIManager.computeSafePopupBottomOffsetPx(progressBar);
        const tooltip = marker.querySelector?.('.yt-learn-marker-tooltip');
        if (tooltip && tooltip.style) {
          tooltip.style.setProperty('--yt-learn-popup-bottom', `${dynamicSafeBottom}px`);
        }
        marker.classList?.add?.('hover-active');
      });

      marker.addEventListener('pointerleave', () => {
        marker.classList?.remove?.('hover-active');
      });

      const stopDrag = (ev) => {
        ev.stopPropagation();
      };
      marker.addEventListener('mousedown', stopDrag);
      marker.addEventListener('pointerdown', stopDrag);

      marker.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const bpId = marker.dataset?.breakpointId;
        const bp = this.cachedBreakpoints.find((b) => b.id === bpId);
        if (bp && typeof this.callbacks.onTimelineMarkerClick === 'function') {
          this.callbacks.onTimelineMarkerClick(bp);
        }
      });
    });
  }

  static formatTimestamp(seconds) {
    const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // ===========================================================================
  // Activity Overlay & Concise MC vs. 4-Criterion Open-Ended Display
  // ===========================================================================

  showOptionalActivityToast(activity, onAccept) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    this.ensureOverlayHost();
    this.closeOverlay();
    const toast = document.createElement('div');
    toast.className = 'yt-learn-toast';
    toast.innerHTML = TemplateLoader.render('activity-toast.html', {
      typeLabel: this.escapeHtml(this.formatActivityType(activity.type)),
      conceptName: this.escapeHtml(activity.conceptName)
    });

    if (this.rootContainer?.appendChild) {
      this.rootContainer.appendChild(toast);
    }

    const dismiss = () => {
      if (toast.isConnected) toast.remove();
    };

    toast.querySelector('#yt-learn-toast-dismiss')?.addEventListener('click', dismiss);
    toast.querySelector('#yt-learn-toast-skip')?.addEventListener('click', () => {
      dismiss();
      this.callbacks.onSkipActivity(activity);
    });
    toast.querySelector('#yt-learn-toast-open')?.addEventListener('click', () => {
      dismiss();
      onAccept();
    });

    setTimeout(dismiss, 14000);
  }

  showActivityOverlay(activity, restoredAnswer = null) {
    this.ensureOverlayHost();
    this.activePanel = 'activity';
    this.activeActivityId = activity.id;
    this.activeActivity = activity;
    this.isSubmitting = false;

    const vnode = html`<${ActivityOverlay}
      activity=${activity}
      restoredAnswer=${restoredAnswer}
      onClose=${() => {
        if (this.isSubmitting) return;
        this.closeOverlay();
        this.callbacks.onSkipActivity(activity);
      }}
      onSkip=${() => {
        if (this.isSubmitting) return;
        this.closeOverlay();
        this.callbacks.onSkipActivity(activity);
      }}
      onMinimize=${(currentAnswer) => {
        this.minimizeActivity(activity, currentAnswer);
      }}
      onRequestExplanation=${(act) => this.callbacks.onRequestExplanation(act)}
      onSubmitAnswer=${(act, answer) => this.callbacks.onSubmitAnswer(act, answer)}
      onAskTutorFollowUp=${(params) => this.callbacks.onAskTutorFollowUp(params)}
      onContinueWatching=${() => {
        this.closeOverlay();
        this.callbacks.onContinueWatching(activity);
      }}
    />`;

    mountComponent(vnode, this.rootContainer);
  }

  minimizeActivity(activity, currentAnswer = '') {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    this.ensureOverlayHost();
    this.isActivityMinimized = true;
    this.minimizedActivityData = {
      activity,
      userAnswer: currentAnswer
    };
    if (this.rootContainer) {
      this.rootContainer.innerHTML = '';
    }

    const pill = document.createElement('div');
    pill.className = 'yt-learn-minimized-pill';
    pill.id = 'yt-learn-minimized-pill';
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute(
      'aria-label',
      `Learning question in progress: ${activity.conceptName || 'Question'}. Click to expand.`
    );

    pill.innerHTML = TemplateLoader.render('activity-minimized-pill.html', {
      activityType: this.escapeHtml(this.formatActivityType(activity.type)),
      conceptTitle: this.escapeHtml(activity.conceptName || 'Question in progress')
    });

    const restore = () => {
      this.isActivityMinimized = false;
      const saved = this.minimizedActivityData;
      this.minimizedActivityData = null;
      this.showActivityOverlay(saved?.activity || activity, saved?.userAnswer);
    };

    pill.addEventListener('click', restore);
    if (this.rootContainer?.appendChild) {
      this.rootContainer.appendChild(pill);
    }
  }

  restoreSubmitFooter(footerContainer, activity, originalSubmitBtn) {
    if (!footerContainer) return;
    footerContainer.innerHTML = '';
    const leftGroup = document.createElement('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.gap = '6px';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'yt-learn-btn yt-learn-btn-ghost';
    skipBtn.textContent = 'Skip & Resume';
    skipBtn.addEventListener('click', () => {
      this.closeOverlay();
      this.callbacks.onSkipActivity(activity);
    });

    leftGroup.appendChild(skipBtn);
    footerContainer.appendChild(leftGroup);

    originalSubmitBtn.disabled = false;
    originalSubmitBtn.textContent = 'Submit Answer';
    footerContainer.appendChild(originalSubmitBtn);
  }

  mountActivityInputWidget(container, activity, isCodeOrMistake, initialValue = null) {
    const isChoice =
      ['multiple_choice', 'true_false', 'multiple_select'].includes(activity.type) &&
      Array.isArray(activity.options) &&
      activity.options.length > 0;

    if (isChoice) {
      const isMulti = activity.type === 'multiple_select';
      const selected = new Set();
      if (initialValue !== null && initialValue !== undefined) {
        if (Array.isArray(initialValue)) {
          initialValue.forEach((v) => selected.add(Number(v)));
        } else if (typeof initialValue === 'number') {
          selected.add(initialValue);
        }
      }

      const list = document.createElement('div');
      list.className = 'yt-learn-options-list';
      const buttons = [];

      activity.options.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `yt-learn-option-item${selected.has(idx) ? ' selected' : ''}`;
        btn.innerHTML = `
          <span style="font-weight:700;color:#38bdf8;">${String.fromCharCode(65 + idx)}.</span>
          <span>${this.escapeHtml(optText)}</span>
        `;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          if (!isMulti) {
            selected.clear();
            buttons.forEach((el) => el.classList.remove('selected'));
            selected.add(idx);
            btn.classList.add('selected');
          } else {
            if (selected.has(idx)) {
              selected.delete(idx);
              btn.classList.remove('selected');
            } else {
              selected.add(idx);
              btn.classList.add('selected');
            }
          }
        });
        buttons.push(btn);
        list.appendChild(btn);
      });

      container.appendChild(list);
      return {
        getValue: () => (isMulti ? Array.from(selected) : Array.from(selected)[0]),
        setDisabled: (disabled) => {
          buttons.forEach((b) => {
            b.disabled = disabled;
          });
        }
      };
    }

    const placeholders = {
      prediction: 'Write your prediction before resuming the video to see the actual result...',
      teach_back: 'Explain this mechanism in your own words...',
      spot_the_mistake: 'Identify what is flawed in the statement/snippet above and how to fix it...',
      critical_thinking: 'Explain the cause-and-effect reasoning or what happens if conditions change...',
      practical_application: 'Write your practical solution or real-world application...',
      compare_concepts: 'Compare how these concepts differ and relate...',
      connect_concepts: 'Explain how this concept connects to earlier material...',
      writing_exercise: 'Write your structured explanation...'
    };

    const textarea = document.createElement('textarea');
    textarea.className = `yt-learn-textarea ${isCodeOrMistake ? 'code-editor' : ''}`;
    textarea.id = 'yt-learn-answer-textarea';
    textarea.placeholder = placeholders[activity.type] || 'Type your answer here...';
    if (typeof initialValue === 'string') {
      textarea.value = initialValue;
    }

    container.appendChild(textarea);
    setTimeout(() => textarea.focus(), 60);

    return {
      getValue: () => textarea.value,
      setDisabled: (disabled) => {
        textarea.disabled = disabled;
      }
    };
  }

  /**
   * Renders evaluation feedback:
   * - Objective multiple choice: renders a concise, focused card.
   * - Open-ended: displays 0-100 numerical score, evaluation label, what was understood well,
   *   missing points / misconceptions, and suggested answer.
   */
  renderEvaluationFeedback(evalContainer, footerContainer, activity, evaluation, onRetry, userAnswer = null) {
    if (!evalContainer) return;

    const score = evaluation.score ?? evaluation.scorePercent ?? Math.round((evaluation.scoreNormalized ?? 0.7) * 100);
    const evalVerdict = evaluation.evaluation || (score >= 80 ? 'correct' : score >= 50 ? 'partially_correct' : 'incorrect');
    const verdictStatus = evalVerdict;
    const isObjective = evaluation.evaluationMode === 'objective';

    const verdictIcon =
      verdictStatus === 'correct' || verdictStatus === 'excellent_understanding' || verdictStatus === 'good_understanding'
        ? '✅'
        : verdictStatus === 'partially_correct' || verdictStatus === 'partial_understanding'
          ? '⚖️'
          : '🧭';

    const verdictLabel =
      verdictStatus === 'correct'
        ? 'Correct'
        : verdictStatus === 'partially_correct'
          ? 'Partially Correct'
          : 'Needs Improvement';

    if (isObjective) {
      const mc = evaluation.conciseMcExplanation || {
        whyCorrect: evaluation.whatWasCorrect,
        whyOthersIncorrect: evaluation.missingOrIncorrect,
        coreConceptTakeaway: evaluation.improvedAnswerExample || evaluation.suggestedAnswer
      };

      evalContainer.innerHTML = TemplateLoader.render('activity-mc-explanation.html', {
        verdictStatus,
        verdictIcon,
        verdictLabel: this.escapeHtml(evaluation.verdictLabel || verdictLabel),
        score,
        whyCorrect: this.escapeHtml(mc.whyCorrect || ''),
        whyOthersIncorrect: this.escapeHtml(mc.whyOthersIncorrect || ''),
        coreConceptTakeaway: this.escapeHtml(mc.coreConceptTakeaway || '')
      });
    } else {
      const correctPoints = Array.isArray(evaluation.correctPoints)
        ? evaluation.correctPoints
        : evaluation.correctPoints ? [evaluation.correctPoints] : [];
      const missingPoints = Array.isArray(evaluation.missingPoints)
        ? evaluation.missingPoints
        : evaluation.missingPoints ? [evaluation.missingPoints] : [];
      const misconceptions = Array.isArray(evaluation.misconceptions)
        ? evaluation.misconceptions
        : evaluation.misconceptions ? [evaluation.misconceptions] : [];
      const suggestedAnswer = evaluation.suggestedAnswer || evaluation.improvedAnswerExample || '';
      const feedback = evaluation.feedback || evaluation.overallFeedback?.overallEvaluation || '';
      const confidence = evaluation.confidence != null ? Math.round(evaluation.confidence * 100) : null;

      const correctPointsHtml = correctPoints.length > 0 ? `
        <div class="yt-learn-eval-points-box yt-learn-points-correct">
          <div class="yt-learn-points-heading" style="color:#a7f3d0;font-weight:700;font-size:12.5px;">✓ What you understood well:</div>
          <ul style="margin:4px 0 0 16px;padding:0;color:#e2e8f0;font-size:12px;line-height:1.5;">
            ${correctPoints.map((pt) => `<li>${this.escapeHtml(pt)}</li>`).join('')}
          </ul>
        </div>
      ` : '';

      const missingPointsHtml = (missingPoints.length > 0 || misconceptions.length > 0) ? `
        <div class="yt-learn-eval-points-box yt-learn-points-missing">
          <div class="yt-learn-points-heading" style="color:#fde68a;font-weight:700;font-size:12.5px;">△ What was missing or needs improvement:</div>
          <ul style="margin:4px 0 0 16px;padding:0;color:#e2e8f0;font-size:12px;line-height:1.5;">
            ${missingPoints.map((pt) => `<li>${this.escapeHtml(pt)}</li>`).join('')}
            ${misconceptions.map((m) => `<li><strong>Misconception:</strong> ${this.escapeHtml(m)}</li>`).join('')}
          </ul>
        </div>
      ` : '';

      const suggestedAnswerHtml = suggestedAnswer ? `
        <div class="yt-learn-improved-answer-card" id="yt-learn-improved-answer">
          <div style="font-weight:700;color:#10b981;font-size:12.5px;">💡 Suggested Model Answer</div>
          <div id="yt-learn-improved-answer-body" style="color:#f8fafc;line-height:1.5;font-size:12px;">
            ${this.escapeHtml(suggestedAnswer)}
          </div>
        </div>
      ` : '';

      evalContainer.innerHTML = TemplateLoader.render('activity-evaluation-card.html', {
        verdictStatus,
        verdictIcon,
        verdictLabel: this.escapeHtml(evaluation.verdictLabel || verdictLabel),
        confidenceHtml: confidence != null ? `<span style="font-size:11px;font-weight:500;opacity:0.8;margin-left:6px;">(${confidence}% confidence)</span>` : '',
        score,
        feedbackHtml: feedback ? `<div style="font-size:12.5px;color:#cbd5e1;line-height:1.5;background:rgba(30,41,59,0.5);padding:8px 10px;border-radius:8px;">${this.escapeHtml(feedback)}</div>` : '',
        correctPointsHtml,
        missingPointsHtml,
        suggestedAnswerHtml
      });
    }

    // Mount Interactive AI Tutor Follow-Up Dialog
    const evalBox = evalContainer.querySelector('#yt-learn-grading-result');
    if (evalBox) {
      const followupContainer = document.createElement('div');
      followupContainer.className = 'yt-learn-tutor-followup';
      followupContainer.id = 'yt-learn-tutor-followup';
      followupContainer.innerHTML = TemplateLoader.render('activity-followup-chat.html');
      evalBox.appendChild(followupContainer);

      const tutorInput = followupContainer.querySelector('#yt-learn-tutor-input');
      const tutorBtn = followupContainer.querySelector('#yt-learn-tutor-ask-btn');
      const chatHistory = followupContainer.querySelector('#yt-learn-tutor-chat-history');

      const submitFollowUp = async () => {
        const query = (tutorInput?.value || '').trim();
        if (!query || tutorBtn?.disabled) return;

        // Append user bubble
        const userBubble = document.createElement('div');
        userBubble.className = 'yt-learn-chat-bubble yt-learn-chat-user';
        userBubble.innerHTML = `<span class="yt-learn-chat-author">You:</span> ${this.escapeHtml(query)}`;
        chatHistory.appendChild(userBubble);
        tutorInput.value = '';

        // Append tutor loading bubble
        const tutorBubble = document.createElement('div');
        tutorBubble.className = 'yt-learn-chat-bubble yt-learn-chat-tutor';
        tutorBubble.innerHTML = `<span class="yt-learn-chat-author">🤖 AI Tutor:</span> <em>Thinking...</em>`;
        chatHistory.appendChild(tutorBubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;

        tutorBtn.disabled = true;
        tutorInput.disabled = true;
        tutorBtn.textContent = 'Thinking...';

        try {
          let response = null;
          if (typeof this.callbacks.onAskTutorFollowUp === 'function') {
            response = await this.callbacks.onAskTutorFollowUp({
              activity,
              userAnswer,
              evaluation,
              userQuestion: query
            });
          }

          if (response) {
            tutorBubble.innerHTML = `
              <div class="yt-learn-tutor-reply-header">
                <span class="yt-learn-chat-author">🤖 AI Tutor:</span>
              </div>
              <div class="yt-learn-tutor-reply-body">
                ${this.escapeHtml(response.directAnswer || response.feedback || 'Here is the explanation.')}
              </div>
              ${response.transcriptGrounding ? `
                <div class="yt-learn-tutor-reply-quote">
                  <em>"${this.escapeHtml(response.transcriptGrounding)}"</em>
                </div>
              ` : ''}
              ${response.keyInsight ? `
                <div class="yt-learn-tutor-reply-insight">
                  💡 <strong>Key Insight:</strong> ${this.escapeHtml(response.keyInsight)}
                </div>
              ` : ''}
            `;
          } else {
            tutorBubble.innerHTML = `
              <div class="yt-learn-tutor-reply-header">
                <span class="yt-learn-chat-author">🤖 AI Tutor:</span>
              </div>
              <div class="yt-learn-tutor-reply-body">
                In this segment covering "${this.escapeHtml(activity.conceptName)}", the key takeaway is: ${this.escapeHtml(activity.exemplarAnswer || activity.conceptSummary || 'review the highlighted concept in the video')}.
              </div>
            `;
          }
        } catch (err) {
          tutorBubble.innerHTML = `
            <div style="color:#f87171;font-size:12px;">
              ⚠️ AI Tutor is currently unreachable: ${this.escapeHtml(err.message || 'Network error')}.
            </div>
          `;
        } finally {
          tutorBtn.disabled = false;
          tutorInput.disabled = false;
          tutorBtn.textContent = 'Ask Tutor';
          chatHistory.scrollTop = chatHistory.scrollHeight;
          tutorInput?.focus?.();
        }
      };

      tutorBtn?.addEventListener('click', submitFollowUp);
      tutorInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitFollowUp();
        }
      });
    }

    evalContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (footerContainer) {
      footerContainer.innerHTML = `
        <button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-retry-btn">Edit / Retry Answer</button>
        <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-continue-btn">
          ${activity.type === 'prediction' ? '▶ Resume to See Reveal' : '▶ Continue Watching'}
        </button>
      `;

      footerContainer.querySelector('#yt-learn-retry-btn')?.addEventListener('click', () => {
        if (typeof onRetry === 'function') {
          onRetry();
        } else {
          this.showActivityOverlay(activity);
        }
      });

      footerContainer.querySelector('#yt-learn-continue-btn')?.addEventListener('click', () => {
        this.closeOverlay();
        this.callbacks.onContinueWatching(activity);
      });
    }
  }

  renderConceptExplanation(container, explanation) {
    if (!container || !explanation) return;
    const steps = (explanation.stepByStepBreakdown || [])
      .map((s) => `<li style="margin-bottom:4px;">${this.escapeHtml(s)}</li>`)
      .join('');

    container.innerHTML = `
      <div class="yt-learn-eval-box" style="border-color:#38bdf8;">
        <div style="font-weight:700;color:#38bdf8;font-size:13.5px;">
          📖 Alternative Explanation: ${this.escapeHtml(explanation.conceptName || '')}
        </div>
        <div style="font-size:12.5px;color:#e2e8f0;">
          <strong>Intuitive Analogy:</strong> ${this.escapeHtml(explanation.simpleAnalogy || '')}
        </div>
        <ul style="margin:4px 0 4px 18px;padding:0;font-size:12.5px;color:#cbd5e1;">
          ${steps}
        </ul>
        <div style="font-size:12.5px;color:#a7f3d0;">
          <strong>Key Takeaway:</strong> ${this.escapeHtml(explanation.keyTakeaway || '')}
        </div>
      </div>
    `;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  setAvailableTracks(tracks = [], translationLanguages = []) {
    this.availableTracks = Array.isArray(tracks) ? tracks : [];
    this.translationLanguages = Array.isArray(translationLanguages) ? translationLanguages : [];
    this.renderDedicatedBar();
  }

  buildSub1OptionsHtml(selectedLang = 'auto') {
    let html = `<option value="auto" ${selectedLang === 'auto' ? 'selected' : ''}>Sub 1: Auto</option>`;
    const seen = new Set(['auto']);

    for (const t of this.availableTracks) {
      if (t.languageCode && !seen.has(t.languageCode)) {
        seen.add(t.languageCode);
        const name = t.name || t.languageCode.toUpperCase();
        html += `<option value="${this.escapeHtml(t.languageCode)}" ${selectedLang === t.languageCode ? 'selected' : ''}>Sub 1: ${this.escapeHtml(name)}</option>`;
      }
    }

    const common = [
      { code: 'en', name: 'English' },
      { code: 'de', name: 'German' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'ja', name: 'Japanese' },
      { code: 'zh', name: 'Chinese' }
    ];
    for (const c of common) {
      if (!seen.has(c.code)) {
        seen.add(c.code);
        html += `<option value="${c.code}" ${selectedLang === c.code ? 'selected' : ''}>Sub 1: ${c.name}</option>`;
      }
    }
    return html;
  }

  buildSub2OptionsHtml(selectedLang = 'en') {
    let html = `<option value="none" ${selectedLang === 'none' ? 'selected' : ''}>Sub 2: Off</option>`;
    const seen = new Set(['none']);

    const tracks = Array.isArray(this.availableTracks) ? this.availableTracks : [];
    if (tracks.length === 0) {
      html += `<option value="none" disabled>No Subtitles Available</option>`;
      return html;
    }

    const prefix = typeof selectedLang === 'string' ? selectedLang.split('-')[0].toLowerCase() : '';
    const hasMatch = tracks.some(
      (t) => t.languageCode === selectedLang || (prefix && (t.languageCode || '').toLowerCase().startsWith(prefix))
    );
    const effectiveSelected = hasMatch ? selectedLang : tracks[0].languageCode;

    for (const t of tracks) {
      if (t.languageCode && !seen.has(t.languageCode)) {
        seen.add(t.languageCode);
        const name = t.name || t.languageCode.toUpperCase();
        const kindLabel = t.kind === 'asr' ? ' (Auto)' : '';
        const isSelected = selectedLang !== 'none' && (
          t.languageCode === effectiveSelected ||
          t.languageCode === selectedLang ||
          (prefix && (t.languageCode || '').toLowerCase().startsWith(prefix))
        );
        html += `<option value="${this.escapeHtml(t.languageCode)}" ${isSelected ? 'selected' : ''}>Sub 2: ${this.escapeHtml(name)}${kindLabel}</option>`;
      }
    }

    return html;
  }

  showSettingsDrawer() {
    this.ensureOverlayHost();
    this.activePanel = 'settings';

    const vnode = html`<${SettingsDrawer}
      settings=${this.settings}
      availableTracks=${this.availableTracks}
      onClose=${() => this.closeOverlay()}
      onSave=${async (updated) => {
        this.settings = { ...this.settings, ...updated };
        if (updated.enableDualSubtitles === false) {
          this.clearDualSubtitles();
        }
        this.renderDedicatedBar();
        await this.callbacks.onSaveSettings(updated);
      }}
    />`;

    mountComponent(vnode, this.rootContainer);
  }

  async showDashboardDrawer() {
    this.ensureOverlayHost();
    this.activePanel = 'dashboard';

    const data = await this.callbacks.onLoadDashboardData();
    if (this.activePanel !== 'dashboard') return;

    const vnode = html`<${DashboardDrawer}
      data=${data}
      onClose=${() => this.closeOverlay()}
    />`;

    mountComponent(vnode, this.rootContainer);
  }

  showVocabularyDrawer() {
    if (typeof document === 'undefined') return;
    this.ensureOverlayHost();
    this.activePanel = 'vocabulary';
    if (!this.rootContainer && typeof document.createElement !== 'function') return;

    const wrapper = typeof document.createElement === 'function'
      ? document.createElement('div')
      : { querySelector: () => null, querySelectorAll: () => [] };
    if (wrapper && typeof wrapper.setAttribute === 'function') {
      wrapper.className = 'yt-learn-overlay-backdrop yt-learn-vocab-backdrop';
    }

    const vnode = html`<${VocabularyDrawer}
      words=${this.vocabulary}
      state=${this.vocabularyState}
      message=${this.vocabularyMessage}
      isGate=${this.vocabularyPrepGate}
      onClose=${() => this.closeOverlay()}
      onRetry=${() => {
        this.setVocabularyStatus('preparing', 'Retrieving subtitles with yt-dlp and analyzing vocabulary...');
        if (typeof this.callbacks.onRetryVocabulary === 'function') {
          this.callbacks.onRetryVocabulary();
        } else if (typeof this.callbacks.onRetryMetadataCheck === 'function') {
          this.callbacks.onRetryMetadataCheck();
        }
      }}
      onContinue=${() => {
        if (this.vocabularyPrepGate && typeof this.callbacks.onContinueVocabulary === 'function') {
          this.callbacks.onContinueVocabulary();
        } else {
          this.closeOverlay();
        }
      }}
      onSeekToTimestamp=${(time) => {
        if (typeof this.callbacks.onSeekToTimestamp === 'function') {
          this.callbacks.onSeekToTimestamp(time);
        }
      }}
    />`;

    mountComponent(vnode, wrapper);

    if (this.rootContainer) {
      if (typeof this.rootContainer.appendChild === 'function') {
        this.rootContainer.appendChild(wrapper);
      }
    }

    const isPlainMockWrapper = !wrapper || typeof wrapper.nodeType !== 'number';
    if (isPlainMockWrapper) {
      wrapper.querySelector?.('#yt-learn-vocab-close')?.addEventListener?.('click', () => this.closeOverlay());
      wrapper.querySelector?.('#yt-learn-vocab-retry')?.addEventListener?.('click', () => {
        this.setVocabularyStatus('preparing', 'Retrieving subtitles with yt-dlp and analyzing vocabulary...');
        if (typeof this.callbacks.onRetryVocabulary === 'function') {
          this.callbacks.onRetryVocabulary();
        } else if (typeof this.callbacks.onRetryMetadataCheck === 'function') {
          this.callbacks.onRetryMetadataCheck();
        }
      });
      wrapper.querySelector?.('#yt-learn-vocab-continue')?.addEventListener?.('click', () => {
        if (this.vocabularyPrepGate && typeof this.callbacks.onContinueVocabulary === 'function') {
          this.callbacks.onContinueVocabulary();
        } else {
          this.closeOverlay();
        }
      });
      wrapper.querySelectorAll?.('.yt-learn-timestamp-btn')?.forEach?.((btn) => {
        btn.addEventListener?.('click', (e) => {
          const time = parseFloat(e.currentTarget?.getAttribute?.('data-time'));
          if (!isNaN(time) && typeof this.callbacks.onSeekToTimestamp === 'function') {
            this.callbacks.onSeekToTimestamp(time);
          }
        });
      });
    }
  }

  closeOverlay() {
    this.activePanel = null;
    this.activeActivityId = null;
    this.isSubmitting = false;
    if (this.rootContainer) {
      mountComponent(null, this.rootContainer);
    }
  }

  updateSettings(newSettings = {}) {
    this.settings = { ...this.settings, ...newSettings };
    if (this.dualSubtitlesContainer) {
      this.dualSubtitlesContainer.className = `yt-learn-dual-subtitles-container font-size-${this.settings.subtitleFontSize || 'medium'}`;
    }
    if (this.settings.enableDualSubtitles === false) {
      this.clearDualSubtitles();
    }
    this.renderDedicatedBar();
  }

  static isValidPercentPosition(pos) {
    if (!pos || typeof pos !== 'object') return false;
    const leftNum = parseFloat(pos.left);
    const topNum = parseFloat(pos.top);
    return (
      typeof pos.left === 'string' &&
      pos.left.endsWith('%') &&
      Number.isFinite(leftNum) &&
      leftNum >= 2 &&
      leftNum <= 95 &&
      typeof pos.top === 'string' &&
      pos.top.endsWith('%') &&
      Number.isFinite(topNum) &&
      topNum >= 2 &&
      topNum <= 95
    );
  }

  ensureDualSubtitlesMount() {
    if (typeof document === 'undefined') return null;

    const player =
      document.getElementById('movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('video')?.parentElement;

    if (!player) return null;

    if (this.dualSubtitlesContainer && this.dualSubtitlesContainer.isConnected) {
      if (this.dualSubtitlesContainer.parentElement !== player) {
        player.appendChild(this.dualSubtitlesContainer);
      }
      const box = this.dualSubtitlesContainer.querySelector('#yt-learn-dual-subtitles-box');
      if (box && (!this.dualSubtitlesContainer.dataset || !this.dualSubtitlesContainer.dataset.hasDragListeners)) {
        if (this.dualSubtitlesContainer.dataset) this.dualSubtitlesContainer.dataset.hasDragListeners = 'true';
        this.setupDraggableSubtitle(this.dualSubtitlesContainer, box);
      }
      return this.dualSubtitlesContainer;
    }

    const existing = document.getElementById('yt-learn-dual-subtitles-container');
    if (existing) {
      if (existing.parentElement !== player) {
        player.appendChild(existing);
      }
      this.dualSubtitlesContainer = existing;
      const box = existing.querySelector('#yt-learn-dual-subtitles-box');
      if (box && (!existing.dataset || !existing.dataset.hasDragListeners)) {
        if (existing.dataset) existing.dataset.hasDragListeners = 'true';
        this.setupDraggableSubtitle(existing, box);
      }
      if (UIManager.isValidPercentPosition(this.settings.subtitlePosition) && (!existing.dataset || !existing.dataset.hasCustomPos)) {
        existing.style.setProperty?.('left', this.settings.subtitlePosition.left, 'important');
        existing.style.setProperty?.('top', this.settings.subtitlePosition.top, 'important');
        existing.style.setProperty?.('bottom', 'auto', 'important');
        existing.style.setProperty?.('transform', 'none', 'important');
        if (existing.dataset) existing.dataset.hasCustomPos = 'true';
      }
      return existing;
    }

    const container = document.createElement('div');
    container.id = 'yt-learn-dual-subtitles-container';
    container.className = `yt-learn-dual-subtitles-container yt-learn-secondary-subtitle-container font-size-${this.settings.subtitleFontSize || 'medium'}`;
    container.innerHTML = TemplateLoader.render('dual-subtitles.html');

    if (UIManager.isValidPercentPosition(this.settings.subtitlePosition)) {
      container.style.setProperty?.('left', this.settings.subtitlePosition.left, 'important');
      container.style.setProperty?.('top', this.settings.subtitlePosition.top, 'important');
      container.style.setProperty?.('bottom', 'auto', 'important');
      container.style.setProperty?.('transform', 'none', 'important');
      if (container.dataset) container.dataset.hasCustomPos = 'true';
    }

    const box = container.querySelector('#yt-learn-dual-subtitles-box');
    if (container.dataset) {
      container.dataset.hasDragListeners = 'true';
    }
    this.setupDraggableSubtitle(container, box);

    player.appendChild(container);
    this.dualSubtitlesContainer = container;
    return container;
  }

  /**
   * Sets up drag-and-drop movement for the secondary subtitle box so the user can
   * move it anywhere on the video player just like YouTube's native captions.
   */
  setupDraggableSubtitle(container, box) {
    if (!container || !box || typeof document === 'undefined') return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;
    let activePointerId = null;

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return; // Left mouse click only
      const player = container.parentElement;
      if (!player) return;

      // Prevent YouTube from capturing the click and toggling play/pause or text selection
      e.preventDefault?.();
      e.stopPropagation?.();

      isDragging = true;
      this.isDraggingSubtitle = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      activePointerId = e.pointerId ?? null;

      if (e.pointerId !== undefined && typeof box.setPointerCapture === 'function') {
        try {
          box.setPointerCapture(e.pointerId);
        } catch { }
      }

      const playerRect = player.getBoundingClientRect?.() || { left: 0, top: 0, width: 640, height: 360 };
      const boxRect = container.getBoundingClientRect?.() || { left: 0, top: 0, width: 200, height: 40 };

      startLeft = (boxRect.left || 0) - (playerRect.left || 0);
      startTop = (boxRect.top || 0) - (playerRect.top || 0);

      container.style.transition = 'none';
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault?.();
      e.stopPropagation?.();

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        hasMoved = true;
        box.classList.add?.('is-dragging');
      }

      if (!hasMoved) return;

      const player = container.parentElement;
      if (!player) return;

      const playerRect = player.getBoundingClientRect?.() || { left: 0, top: 0, width: 640, height: 360 };
      const boxRect = container.getBoundingClientRect?.() || { left: 0, top: 0, width: 200, height: 40 };

      const playerWidth = playerRect.width || player.offsetWidth || 640;
      const playerHeight = playerRect.height || player.offsetHeight || 360;
      const containerWidth = boxRect.width || container.offsetWidth || 200;
      const containerHeight = boxRect.height || container.offsetHeight || 40;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Clamp inside video player with 8px margin
      newLeft = Math.max(8, Math.min(newLeft, playerWidth - containerWidth - 8));
      newTop = Math.max(8, Math.min(newTop, playerHeight - containerHeight - 8));

      const leftPercent = (newLeft / playerWidth) * 100;
      const topPercent = (newTop / playerHeight) * 100;

      container.style.setProperty('left', `${leftPercent.toFixed(2)}%`, 'important');
      container.style.setProperty('top', `${topPercent.toFixed(2)}%`, 'important');
      container.style.setProperty('bottom', 'auto', 'important');
      container.style.setProperty('transform', 'none', 'important');
      if (container.dataset) {
        container.dataset.hasCustomPos = 'true';
      }

      this.customSubtitlePosition = {
        left: `${leftPercent.toFixed(2)}%`,
        top: `${topPercent.toFixed(2)}%`
      };
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingSubtitle = false;
      box.classList.remove?.('is-dragging');

      if (activePointerId !== null && typeof box.releasePointerCapture === 'function') {
        try {
          box.releasePointerCapture(activePointerId);
        } catch { }
        activePointerId = null;
      }

      container.style.transition = '';

      if (hasMoved) {
        e.preventDefault?.();
        e.stopPropagation?.();
        if (this.customSubtitlePosition) {
          this.settings.subtitlePosition = this.customSubtitlePosition;
          this.callbacks.onSaveSettings?.({ subtitlePosition: this.customSubtitlePosition });
        }
      }
    };

    // Attach Pointer Events
    box.addEventListener?.('pointerdown', onPointerDown);
    box.addEventListener?.('pointermove', onPointerMove);
    box.addEventListener?.('pointerup', onPointerUp);
    box.addEventListener?.('pointercancel', onPointerUp);

    // Mouse fallback for environments without PointerEvent support
    const onMouseDown = (e) => {
      if (activePointerId !== null) return;
      onPointerDown(e);
      const onDocMove = (me) => onPointerMove(me);
      const onDocUp = (ue) => {
        document.removeEventListener('mousemove', onDocMove, true);
        document.removeEventListener('mouseup', onDocUp, true);
        onPointerUp(ue);
      };
      document.addEventListener('mousemove', onDocMove, true);
      document.addEventListener('mouseup', onDocUp, true);
    };
    box.addEventListener?.('mousedown', onMouseDown);

    // Suppress native drag-and-drop so browser never drops into ghost drag
    box.addEventListener?.('dragstart', (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
    });

    // Suppress click if user dragged the subtitle box so YouTube video doesn't pause
    box.addEventListener?.('click', (e) => {
      if (hasMoved) {
        e.preventDefault?.();
        e.stopPropagation?.();
        hasMoved = false;
      }
    }, true);

    const onDblClick = (e) => {
      e.stopPropagation?.();
      e.preventDefault?.();
      container.style.removeProperty?.('top');
      container.style.removeProperty?.('bottom');
      container.style.removeProperty?.('left');
      container.style.removeProperty?.('transform');
      container.style.left = '50%';
      container.style.bottom = '';
      container.style.top = '';
      container.style.transform = 'translateX(-50%)';
      container.style.transition = '';
      if (container.dataset) {
        delete container.dataset.hasCustomPos;
      }
      this.customSubtitlePosition = null;
      this.settings.subtitlePosition = null;
      this.callbacks.onSaveSettings?.({ subtitlePosition: null });
    };

    box.addEventListener?.('dblclick', onDblClick);
  }

  renderDualSubtitles(activeCues, settings = this.settings) {
    if (typeof document === 'undefined') return;

    // Never hide YouTube native captions: One from YouTube, one from the app!
    if (typeof document.body !== 'undefined' && document.body?.classList?.contains('yt-learn-hide-native-captions')) {
      document.body.classList.remove('yt-learn-hide-native-captions');
    }

    if (settings.enableDualSubtitles === false || settings.secondarySubtitleLang === 'none') {
      this.clearDualSubtitles();
      return;
    }

    const primaryText = (typeof activeCues === 'object' ? activeCues?.primaryText || '' : '').trim();
    const secondaryText = (typeof activeCues === 'string'
      ? activeCues
      : activeCues?.secondaryText || activeCues?.text || ''
    ).trim();

    const container = this.ensureDualSubtitlesMount();
    if (!container) return;

    const sizeClass = `font-size-${settings.subtitleFontSize || 'medium'}`;
    if (!container.classList.contains(sizeClass)) {
      container.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
      container.classList.add(sizeClass);
    }

    const box = container.querySelector('#yt-learn-dual-subtitles-box');
    const primaryEl = container.querySelector('#yt-learn-sub-primary');
    const secondaryEl = container.querySelector('#yt-learn-sub-secondary');
    if (!box || !secondaryEl) return;

    if (primaryEl) {
      primaryEl.textContent = primaryText;
      primaryEl.style.display = 'none';
    }

    let displayText = secondaryText;
    if (!displayText && activeCues?.primaryCue?.text) {
      displayText = activeCues.primaryCue.text.trim();
    }

    if (!displayText) {
      if (!this.isDraggingSubtitle) {
        box.style.display = 'none';
      }
      return;
    }

    box.style.display = 'inline-flex';
    secondaryEl.textContent = displayText;
    secondaryEl.style.display = 'block';
  }

  renderSecondarySubtitle(activeCueOrText, settings = this.settings) {
    if (typeof activeCueOrText === 'string') {
      return this.renderDualSubtitles({ secondaryText: activeCueOrText }, settings);
    }
    return this.renderDualSubtitles(activeCueOrText, settings);
  }

  ensureSecondarySubtitleMount() {
    return this.ensureDualSubtitlesMount();
  }

  clearSecondarySubtitle() {
    this.clearDualSubtitles();
  }

  clearDualSubtitles() {
    if (this.dualSubtitlesContainer) {
      const box = this.dualSubtitlesContainer.querySelector('#yt-learn-dual-subtitles-box');
      if (box) {
        box.style.display = 'none';
      }
    }
    if (typeof document !== 'undefined' && document.body?.classList) {
      document.body.classList.remove('yt-learn-hide-native-captions');
    }
  }

  monitorNativeCaptionButton() {
    if (typeof document === 'undefined') return;

    const checkCcButtonState = () => {
      const ccBtn = document.querySelector('.ytp-subtitles-button');
      const isPressed = ccBtn && ccBtn.getAttribute('aria-pressed') === 'true';
      if (isPressed) {
        document.body.classList.add('yt-learn-native-cc-active');
        document.body.classList.remove('yt-learn-hide-native-captions');
      } else {
        document.body.classList.remove('yt-learn-native-cc-active');
      }
    };

    if (typeof window !== 'undefined' && !window.__YT_LEARN_CC_MONITORED__) {
      window.__YT_LEARN_CC_MONITORED__ = true;
      document.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.ytp-subtitles-button')) {
          setTimeout(checkCcButtonState, 60);
        }
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'c' || e.key === 'C') {
          const tag = (e.target?.tagName || '').toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && !e.target?.isContentEditable) {
            setTimeout(checkCcButtonState, 60);
          }
        }
      }, true);
    }
  }

  formatActivityType(type = '') {
    return String(type)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
