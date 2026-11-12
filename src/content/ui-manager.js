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
    if (!this.rootContainer || typeof document === 'undefined') return;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    const targetParent = fsElement || document.body;
    if (this.rootContainer.parentElement !== targetParent) {
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
    this.vocabulary = Array.isArray(words) ? words : [];
    this.renderDedicatedBar();

    if (this.activePanel === 'vocabulary') {
      this.showVocabularyDrawer();
    } else if (this.vocabulary.length > 0 && options.notify !== false) {
      this.showQuickGlanceToast(this.vocabulary);
    }
  }

  renderDedicatedBar() {
    if (!this.barContainer) return;
    this.mountDedicatedBarInSafeSlot();

    const s = this.settings || {};
    const isEnabled = s.enabled !== false;
    const cls = this.videoClassification;

    if (this.barCollapsed) {
      this.barContainer.classList.add('is-collapsed');
      this.barContainer.innerHTML = `
        <div class="yt-learn-bar-collapsed-inner">
          <button class="yt-learn-fab yt-learn-collapsed-btn" id="yt-learn-expand-bar-btn" title="Expand AI Tutor Bar">
            <span class="yt-learn-status-dot ${isEnabled ? this.statusState : 'disabled'}"></span>
            <span>🎓 AI Tutor: <strong>${isEnabled ? this.escapeHtml(this.statusText) : 'Off'}</strong></span>
            <span style="font-size:10px;margin-left:4px;opacity:0.8;">▲ Expand</span>
          </button>
        </div>
      `;
      this.barContainer.querySelector('#yt-learn-expand-bar-btn')?.addEventListener('click', () => {
        this.barCollapsed = false;
        this.renderDedicatedBar();
      });
      return;
    }

    this.barContainer.classList.remove('is-collapsed');

    let classificationBadgeHtml = '';
    if (cls) {
      const catLower = String(cls.category || 'Educational').toLowerCase();
      const isPausedForEnt = !cls.shouldActivateLearning && !this.userClassificationOverride;
      const overrideLabel = isPausedForEnt
        ? ' (Intervention Active — Click to Enable Learning)'
        : this.userClassificationOverride
        ? ' (User Override)'
        : '';

      classificationBadgeHtml = `
        <button class="yt-learn-classification-pill cat-${catLower}" id="yt-learn-classification-btn"
          title="${this.escapeHtml(`${cls.reasoning} | Learning Potential: ${cls.learningPotential}`)}">
          <span>🎓 ${this.escapeHtml(cls.category)}: <strong>${cls.educationalValue}/100</strong>${overrideLabel}</span>
        </button>
      `;
    }

    this.barContainer.innerHTML = `
      <div class="yt-learn-bar-left">
        <button class="yt-learn-fab" id="yt-learn-toggle-btn" title="Click to toggle AI Learning Assistant">
          <span class="yt-learn-status-dot ${isEnabled ? this.statusState : 'disabled'}"></span>
          <span>AI Tutor: <strong>${isEnabled ? this.escapeHtml(this.statusText) : 'Off'}</strong></span>
        </button>
        ${classificationBadgeHtml}
      </div>
      <div class="yt-learn-bar-right">
        <div class="yt-learn-dual-subs-group">
          <button class="yt-learn-icon-btn ${s.enableDualSubtitles !== false ? 'active-toggle' : ''}" id="yt-learn-dual-subs-btn" title="Toggle 2nd Subtitle on/off (displayed alongside YouTube native subtitles)${this.localServerConnected ? ' [🖥️ Terminal Server Connected]' : ''}">💬 2nd Sub: <strong>${s.enableDualSubtitles !== false ? 'ON' : 'Off'}</strong>${this.localServerConnected ? ' <span class="yt-learn-server-badge" title="Local Subtitle Server connected in terminal">🖥️</span>' : ''}</button>
          ${s.enableDualSubtitles !== false ? `
            <select class="yt-learn-sub-dropdown yt-learn-sub2-dropdown" id="yt-learn-sub2-select" title="2nd Subtitle Language (Downloaded on demand from YouTube)">
              ${this.buildSub2OptionsHtml(s.secondarySubtitleLang || 'en')}
            </select>
            <select class="yt-learn-sub-dropdown yt-learn-sub1-dropdown" id="yt-learn-sub1-select" style="display:none;" title="Main Subtitle Track">
              ${this.buildSub1OptionsHtml(s.primarySubtitleLang || 'auto')}
            </select>
          ` : ''}
        </div>
        <button class="yt-learn-icon-btn yt-learn-vocab-btn ${this.vocabulary.length > 0 ? 'active-vocab' : ''}" id="yt-learn-vocab-btn" title="Quick glance at new words & key vocabulary in original language (independent of breakpoints)">📖 Words${this.vocabulary.length > 0 ? ` <strong>(${this.vocabulary.length})</strong>` : ''}</button>
        <button class="yt-learn-icon-btn" id="yt-learn-now-btn" title="Generate activity for current section now">⚡ Quiz Now</button>
        <button class="yt-learn-icon-btn" id="yt-learn-dashboard-btn" title="Learning Profile & Activity History">📊 Progress</button>
        <button class="yt-learn-icon-btn" id="yt-learn-settings-btn" title="Assistant Settings & API Key">⚙️ Settings</button>
        <button class="yt-learn-icon-btn yt-learn-collapse-bar-btn" id="yt-learn-collapse-bar-btn" title="Collapse Bar to Mini Pill">▾</button>
      </div>
    `;

    this.barContainer.querySelector('#yt-learn-dual-subs-btn')?.addEventListener('click', async () => {
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

    this.barContainer.querySelector('#yt-learn-sub1-select')?.addEventListener('change', async (e) => {
      const val = e.target.value;
      this.settings.primarySubtitleLang = val;
      await this.callbacks.onSaveSettings({ primarySubtitleLang: val });
    });

    let sub2ChangeTimer = null;
    this.barContainer.querySelector('#yt-learn-sub2-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      this.settings.secondarySubtitleLang = val;
      if (sub2ChangeTimer) clearTimeout(sub2ChangeTimer);
      sub2ChangeTimer = setTimeout(async () => {
        await this.callbacks.onSaveSettings({ secondarySubtitleLang: val });
      }, 300);
    });

    this.barContainer.querySelector('#yt-learn-toggle-btn')?.addEventListener('click', async () => {
      if (this.statusText === 'No Captions or Chapters' && typeof this.callbacks.onRetryMetadataCheck === 'function') {
        this.setStatus('Checking...', 'preparing');
        this.callbacks.onRetryMetadataCheck();
        return;
      }
      const nextEnabled = !isEnabled;
      this.settings.enabled = nextEnabled;
      if (!nextEnabled) {
        this.clearDualSubtitles();
      }
      await this.callbacks.onSaveSettings({ enabled: nextEnabled });
      this.setStatus(nextEnabled ? 'Active' : 'Paused', nextEnabled ? 'ready' : 'disabled');
    });

    this.barContainer.querySelector('#yt-learn-collapse-bar-btn')?.addEventListener('click', () => {
      this.barCollapsed = true;
      this.renderDedicatedBar();
    });

    this.barContainer.querySelector('#yt-learn-classification-btn')?.addEventListener('click', () => {
      if (typeof this.callbacks.onOverrideClassification === 'function') {
        const nextOverride = !this.userClassificationOverride;
        this.callbacks.onOverrideClassification(nextOverride);
      }
    });

    this.barContainer.querySelector('#yt-learn-vocab-btn')?.addEventListener('click', () => {
      if (this.activePanel === 'vocabulary') {
        this.closeOverlay();
      } else {
        this.showVocabularyDrawer();
      }
    });

    this.barContainer.querySelector('#yt-learn-now-btn')?.addEventListener('click', () => {
      this.callbacks.onManualTriggerActivity();
    });

    this.barContainer.querySelector('#yt-learn-dashboard-btn')?.addEventListener('click', () => {
      if (this.activePanel === 'dashboard') {
        this.closeOverlay();
      } else {
        this.showDashboardDrawer();
      }
    });

    this.barContainer.querySelector('#yt-learn-settings-btn')?.addEventListener('click', () => {
      if (this.activePanel === 'settings') {
        this.closeOverlay();
      } else {
        this.showSettingsDrawer();
      }
    });
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

    for (const bp of this.cachedBreakpoints) {
      const ts = Number(bp.timestamp);
      if (!Number.isFinite(ts) || ts < 0 || ts > duration) continue;

      const rawPct = (ts / duration) * 100;
      const clampedPct = Math.max(0.5, Math.min(99.5, rawPct));

      const strength = bp.strength || 'normal';
      const isCompleted = this.cachedTriggeredIds.has(bp.id);
      const formattedTime = UIManager.formatTimestamp(ts);
      const conceptLabel =
        bp.activity?.conceptName || bp.reason || 'Learning Breakpoint';
      const activityBadge = this.formatActivityType(bp.activity?.type || 'check');

      const { alignClass, shiftPx } = UIManager.computePopupAlignment(
        clampedPct,
        barWidthPx,
        240
      );

      const marker = document.createElement('div');
      marker.className = `yt-learn-timeline-marker strength-${strength}${isCompleted ? ' completed' : ''}`;
      marker.style.left = `${clampedPct.toFixed(3)}%`;
      marker.dataset.breakpointId = bp.id;
      marker.dataset.timestamp = String(ts);
      marker.dataset.popupAlign = alignClass;
      marker.setAttribute(
        'aria-label',
        `Learning breakpoint at ${formattedTime}: ${conceptLabel}`
      );

      marker.innerHTML = `
        <div class="yt-learn-marker-tooltip ${alignClass}" style="--tooltip-shift-x: ${shiftPx}px; --yt-learn-popup-bottom: ${safeBottomPx}px;">
          <span class="yt-learn-marker-tooltip-time">${this.escapeHtml(formattedTime)}</span>
          <span class="yt-learn-marker-tooltip-type">${this.escapeHtml(activityBadge)}</span>
          <span>${this.escapeHtml(conceptLabel)}</span>
        </div>
      `;

      // Direct hover detection: Only trigger when cursor is directly over this marker
      marker.addEventListener('pointerenter', () => {
        const dynamicSafeBottom = UIManager.computeSafePopupBottomOffsetPx(progressBar);
        const tooltip = marker.querySelector('.yt-learn-marker-tooltip');
        if (tooltip) {
          tooltip.style.setProperty('--yt-learn-popup-bottom', `${dynamicSafeBottom}px`);
        }
        marker.classList.add('hover-active');
      });

      marker.addEventListener('pointerleave', () => {
        marker.classList.remove('hover-active');
      });

      const stopDrag = (ev) => {
        ev.stopPropagation();
      };
      marker.addEventListener('mousedown', stopDrag);
      marker.addEventListener('pointerdown', stopDrag);

      marker.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof this.callbacks.onTimelineMarkerClick === 'function') {
          this.callbacks.onTimelineMarkerClick(bp);
        }
      });

      layer.appendChild(marker);
    }
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
    this.ensureOverlayHost();
    this.closeOverlay();
    const toast = document.createElement('div');
    toast.className = 'yt-learn-toast';
    toast.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span class="yt-learn-badge">${this.formatActivityType(activity.type)}</span>
        <button class="yt-learn-btn-ghost" id="yt-learn-toast-dismiss" style="border:none;cursor:pointer;">✕</button>
      </div>
      <div style="font-weight:600;font-size:13.5px;margin-bottom:10px;">
        Ready to check your understanding of "${this.escapeHtml(activity.conceptName)}"?
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-toast-skip">Skip</button>
        <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-toast-open">Pause & Start</button>
      </div>
    `;

    this.rootContainer.appendChild(toast);

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
    this.isSubmitting = false;
    this.rootContainer.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'yt-learn-overlay-backdrop';
    wrapper.dataset.activityId = activity.id;

    const isPrediction = activity.type === 'prediction';
    const isCodeOrMistake =
      activity.type === 'spot_the_mistake' ||
      activity.subjectCategory === 'programming';

    const rawClean = ActivityGenerator.cleanConceptName(activity.conceptName || '');
    const displayConceptTitle = rawClean && !/^(concept check|section \d+|part \d+)$/i.test(rawClean)
      ? rawClean
      : (activity.title || (activity.isSummary ? 'End-of-Video Wrap-Up' : 'Quick Check'));

    const hasHelpfulContext = Boolean(
      activity.contextSummary &&
      !activity.contextSummary.startsWith('Segment ') &&
      !activity.contextSummary.includes('Covers ') &&
      activity.contextSummary.trim() !== ActivityGenerator.sanitizePrompt(activity.prompt)
    );

    wrapper.innerHTML = `
      <div class="yt-learn-card">
        <div class="yt-learn-card-header">
          <div class="yt-learn-badge-row">
            ${activity.isSummary ? '<span class="yt-learn-badge summary-badge" style="background:#fde047;color:#0f172a;font-weight:700;">🎓 End-of-Video Summary</span>' : ''}
            <span class="yt-learn-badge ${isPrediction ? 'prediction' : ''}">
              ${this.escapeHtml(activity.title || this.formatActivityType(activity.type))}
            </span>
            <span class="yt-learn-badge difficulty">${this.escapeHtml(activity.difficulty || 'medium')}</span>
          </div>
          <div class="yt-learn-header-actions" style="display:flex;gap:6px;align-items:center;">
            <button class="yt-learn-btn-icon yt-learn-minimize-btn" id="yt-learn-minimize-btn" title="Minimize overlay to floating pill">─</button>
            <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-close-btn" title="Skip & Resume">✕</button>
          </div>
        </div>

        <div class="yt-learn-card-body" id="yt-learn-activity-body">
          <h3 class="yt-learn-concept-title">${this.escapeHtml(displayConceptTitle)}</h3>

          ${
            hasHelpfulContext
              ? `<div class="yt-learn-context-box">${this.escapeHtml(activity.contextSummary)}</div>`
              : ''
          }

          <div class="yt-learn-prompt">${this.escapeHtml(ActivityGenerator.sanitizePrompt(activity.prompt))}</div>

          ${
            activity.codeOrScenarioSnippet
              ? `<pre class="yt-learn-code-block">${this.escapeHtml(activity.codeOrScenarioSnippet)}</pre>`
              : ''
          }

          <div id="yt-learn-input-mount"></div>

          <div id="yt-learn-hint-area" style="display:none;font-size:12.5px;color:#38bdf8;background:rgba(56,189,248,0.1);padding:8px 12px;border-radius:8px;">
            💡 <strong>Hint:</strong> ${this.escapeHtml(activity.hint || 'Think about what the speaker just said or showed on screen.')}
          </div>

          <div id="yt-learn-status-mount"></div>
          <div id="yt-learn-eval-mount"></div>
          <div id="yt-learn-explain-mount"></div>
        </div>

        <div class="yt-learn-card-footer" id="yt-learn-activity-footer">
          <div style="display:flex;gap:6px;">
            <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-skip-btn">Skip & Resume</button>
            <button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-hint-btn">Hint</button>
            <button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-explain-btn">Explain Concept</button>
          </div>
          <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-submit-btn">Submit Answer</button>
        </div>
      </div>
    `;

    this.rootContainer.appendChild(wrapper);

    const inputMount = wrapper.querySelector('#yt-learn-input-mount');
    const statusMount = wrapper.querySelector('#yt-learn-status-mount');
    const evalMount = wrapper.querySelector('#yt-learn-eval-mount');
    const footerMount = wrapper.querySelector('#yt-learn-activity-footer');
    const submitBtn = wrapper.querySelector('#yt-learn-submit-btn');

    const { getValue, setDisabled } = this.mountActivityInputWidget(
      inputMount,
      activity,
      isCodeOrMistake,
      restoredAnswer
    );

    wrapper.querySelector('#yt-learn-minimize-btn')?.addEventListener('click', () => {
      this.minimizeActivity(activity, getValue());
    });

    wrapper.querySelector('#yt-learn-close-btn')?.addEventListener('click', () => {
      if (this.isSubmitting) return;
      this.closeOverlay();
      this.callbacks.onSkipActivity(activity);
    });

    wrapper.querySelector('#yt-learn-skip-btn')?.addEventListener('click', () => {
      if (this.isSubmitting) return;
      this.closeOverlay();
      this.callbacks.onSkipActivity(activity);
    });

    wrapper.querySelector('#yt-learn-hint-btn')?.addEventListener('click', () => {
      const hintEl = wrapper.querySelector('#yt-learn-hint-area');
      if (hintEl) hintEl.style.display = 'block';
    });

    wrapper.querySelector('#yt-learn-explain-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Explaining...';
      try {
        const explanation = await this.callbacks.onRequestExplanation(activity);
        if (this.activeActivityId === activity.id) {
          this.renderConceptExplanation(wrapper.querySelector('#yt-learn-explain-mount'), explanation);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Explain Concept';
      }
    });

    submitBtn?.addEventListener('click', async () => {
      if (this.isSubmitting) return;

      const userAnswer = getValue();
      const isEmpty =
        userAnswer === null ||
        userAnswer === undefined ||
        (typeof userAnswer === 'string' && !userAnswer.trim()) ||
        (Array.isArray(userAnswer) && userAnswer.length === 0);

      if (isEmpty) {
        statusMount.innerHTML = `
          <div class="yt-learn-error-banner">
            ⚠️ Please enter your answer or select an option before clicking Submit.
          </div>
        `;
        return;
      }

      this.isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Grading...';
      setDisabled(true);

      statusMount.innerHTML = `
        <div class="yt-learn-loading-banner" id="yt-learn-grading-loader">
          <div class="yt-learn-spinner"></div>
          <span>Evaluating your response...</span>
        </div>
      `;

      try {
        const evaluation = await this.callbacks.onSubmitAnswer(activity, userAnswer);

        if (this.activePanel !== 'activity' || this.activeActivityId !== activity.id) {
          return;
        }

        statusMount.innerHTML = '';
        this.renderEvaluationFeedback(evalMount, footerMount, activity, evaluation, () => {
          evalMount.innerHTML = '';
          statusMount.innerHTML = '';
          setDisabled(false);
          this.restoreSubmitFooter(footerMount, activity, submitBtn);
        }, userAnswer);
      } catch (err) {
        if (this.activePanel !== 'activity' || this.activeActivityId !== activity.id) {
          return;
        }
        setDisabled(false);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Answer';
        statusMount.innerHTML = `
          <div class="yt-learn-error-banner" id="yt-learn-grading-error">
            <div style="font-weight:700;margin-bottom:4px;">⚠️ Grading Service Unavailable</div>
            <div style="margin-bottom:8px;">${this.escapeHtml(err?.message || 'Unable to evaluate answer right now. Your response has been preserved.')}</div>
            <div style="display:flex;gap:8px;">
              <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-error-retry-btn">🔄 Retry Grading</button>
              <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-error-skip-btn">Skip Activity</button>
            </div>
          </div>
        `;
        statusMount.querySelector('#yt-learn-error-retry-btn')?.addEventListener('click', () => {
          submitBtn.click();
        });
        statusMount.querySelector('#yt-learn-error-skip-btn')?.addEventListener('click', () => {
          this.closeOverlay();
          this.callbacks.onSkipActivity(activity);
        });
      } finally {
        this.isSubmitting = false;
      }
    });
  }

  minimizeActivity(activity, currentAnswer = '') {
    this.isActivityMinimized = true;
    this.minimizedActivityData = {
      activity,
      userAnswer: currentAnswer
    };
    this.rootContainer.innerHTML = '';

    const pill = document.createElement('div');
    pill.className = 'yt-learn-minimized-pill';
    pill.id = 'yt-learn-minimized-pill';
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute(
      'aria-label',
      `Learning question in progress: ${activity.conceptName || 'Question'}. Click to expand.`
    );

    pill.innerHTML = `
      <div class="yt-learn-pill-left">
        <span class="yt-learn-pill-dot"></span>
        <span class="yt-learn-pill-badge">${this.escapeHtml(this.formatActivityType(activity.type))}</span>
        <span class="yt-learn-pill-title">${this.escapeHtml(activity.conceptName || 'Question in progress')}</span>
      </div>
      <button class="yt-learn-pill-expand-btn" id="yt-learn-pill-restore-btn" title="Restore Activity">Expand ↗</button>
    `;

    const restore = () => {
      this.isActivityMinimized = false;
      const saved = this.minimizedActivityData;
      this.minimizedActivityData = null;
      this.showActivityOverlay(saved?.activity || activity, saved?.userAnswer);
    };

    pill.addEventListener('click', restore);
    this.rootContainer.appendChild(pill);
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

      evalContainer.innerHTML = `
        <div class="yt-learn-eval-box" id="yt-learn-grading-result">
          <div class="yt-learn-eval-verdict ${verdictStatus}">
            <span id="yt-learn-verdict-label">
              ${verdictIcon} ${this.escapeHtml(evaluation.verdictLabel || verdictLabel)}
            </span>
            <span id="yt-learn-score-badge">${score}/100 Score</span>
          </div>

          <div class="yt-learn-mc-concise-card" id="yt-learn-mc-concise-explanation">
            <div style="color:#a7f3d0;">
              <strong>✓ Why the correct answer works:</strong> ${this.escapeHtml(mc.whyCorrect || '')}
            </div>
            <div style="color:#fde68a;">
              <strong>△ Why the other options fail:</strong> ${this.escapeHtml(mc.whyOthersIncorrect || '')}
            </div>
            <div style="color:#93c5fd;border-top:1px solid rgba(148,163,184,0.2);padding-top:6px;">
              <strong>💡 Core Concept:</strong> ${this.escapeHtml(mc.coreConceptTakeaway || '')}
            </div>
          </div>
        </div>
      `;
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

      evalContainer.innerHTML = `
        <div class="yt-learn-eval-box" id="yt-learn-grading-result">
          <div class="yt-learn-eval-verdict ${verdictStatus}">
            <span id="yt-learn-verdict-label">
              ${verdictIcon} ${this.escapeHtml(evaluation.verdictLabel || verdictLabel)}
              ${confidence != null ? `<span style="font-size:11px;font-weight:500;opacity:0.8;margin-left:6px;">(${confidence}% confidence)</span>` : ''}
            </span>
            <span id="yt-learn-score-badge">Score: <strong>${score}/100</strong></span>
          </div>

          ${feedback ? `<div style="font-size:12.5px;color:#cbd5e1;line-height:1.5;background:rgba(30,41,59,0.5);padding:8px 10px;border-radius:8px;">${this.escapeHtml(feedback)}</div>` : ''}

          ${correctPointsHtml}
          ${missingPointsHtml}
          ${suggestedAnswerHtml}
        </div>
      `;
    }

    // Mount Interactive AI Tutor Follow-Up Dialog
    const evalBox = evalContainer.querySelector('#yt-learn-grading-result');
    if (evalBox) {
      const followupContainer = document.createElement('div');
      followupContainer.className = 'yt-learn-tutor-followup';
      followupContainer.id = 'yt-learn-tutor-followup';
      followupContainer.innerHTML = `
        <div class="yt-learn-tutor-followup-header">
          <div class="yt-learn-tutor-followup-title">💬 Have a question for the AI Tutor?</div>
          <div class="yt-learn-tutor-followup-subtitle">Ask why an answer was graded this way, or clarify the concept</div>
        </div>
        <div class="yt-learn-tutor-chat-history" id="yt-learn-tutor-chat-history"></div>
        <div class="yt-learn-tutor-input-row">
          <input type="text" class="yt-learn-input yt-learn-tutor-input" id="yt-learn-tutor-input" placeholder="Type your follow-up question here..." />
          <button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-tutor-ask-btn" type="button">Ask Tutor</button>
        </div>
      `;
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
    this.rootContainer.innerHTML = '';

    const s = this.settings;
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-learn-overlay-backdrop';

    let primaryOptionsHtml = `<option value="auto" ${s.primarySubtitleLang === 'auto' || !s.primarySubtitleLang ? 'selected' : ''}>Auto (Video Spoken Language)</option>`;
    if (this.availableTracks.length > 0) {
      primaryOptionsHtml += this.availableTracks
        .map(
          (t) =>
            `<option value="${this.escapeHtml(t.languageCode)}" ${s.primarySubtitleLang === t.languageCode ? 'selected' : ''}>${this.escapeHtml(t.name || t.languageCode)} (${this.escapeHtml(t.languageCode)})</option>`
        )
        .join('');
    } else {
      primaryOptionsHtml += `
        <option value="en" ${s.primarySubtitleLang === 'en' ? 'selected' : ''}>English</option>
        <option value="de" ${s.primarySubtitleLang === 'de' ? 'selected' : ''}>German (Deutsch)</option>
        <option value="es" ${s.primarySubtitleLang === 'es' ? 'selected' : ''}>Spanish (Español)</option>
        <option value="fr" ${s.primarySubtitleLang === 'fr' ? 'selected' : ''}>French (Français)</option>
        <option value="ja" ${s.primarySubtitleLang === 'ja' ? 'selected' : ''}>Japanese (日本語)</option>
        <option value="zh" ${s.primarySubtitleLang === 'zh' ? 'selected' : ''}>Chinese (中文)</option>
      `;
    }

    let secondaryOptionsHtml = '<option value="none" ' + (s.secondarySubtitleLang === 'none' ? 'selected' : '') + '>Sub 2: Off</option>';
    if (this.availableTracks && this.availableTracks.length > 0) {
      secondaryOptionsHtml += this.availableTracks
        .map(
          (t) =>
            `<option value="${this.escapeHtml(t.languageCode)}" ${s.secondarySubtitleLang === t.languageCode ? 'selected' : ''}>${this.escapeHtml(t.name || t.languageCode)} (${this.escapeHtml(t.languageCode)})${t.kind === 'asr' ? ' (Auto)' : ''}</option>`
        )
        .join('');
    } else {
      secondaryOptionsHtml += '<option value="none" disabled>No tracks available for current video</option>';
    }

    wrapper.innerHTML = `
      <div class="yt-learn-card">
        <div class="yt-learn-card-header">
          <h3 class="yt-learn-concept-title" style="font-size:16px;">⚙️ Learning Assistant Settings</h3>
          <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-settings-close">✕</button>
        </div>

        <div class="yt-learn-card-body">
          <div class="yt-learn-form-group">
            <label>AI Provider</label>
            <select class="yt-learn-select" id="yt-set-provider">
              <option value="gemini" ${s.provider === 'gemini' ? 'selected' : ''}>Google Gemini (Recommended)</option>
              <option value="openai-compatible" ${s.provider === 'openai-compatible' ? 'selected' : ''}>OpenAI-Compatible / Local Ollama</option>
            </select>
          </div>

          <div class="yt-learn-form-group">
            <label>API Key (Stored Locally in Extension Storage Only)</label>
            <input type="password" class="yt-learn-input" id="yt-set-apikey" placeholder="AIzaSy... or Bearer token" value="${this.escapeHtml(s.apiKey || '')}" />
          </div>

          <div class="yt-learn-form-group">
            <label>Model Name (Default: gemini-3.8-flash)</label>
            <input type="text" class="yt-learn-input" id="yt-set-model" value="${this.escapeHtml(s.model || 'gemini-3.8-flash')}" />
          </div>

          <div class="yt-learn-form-group">
            <label>Break Frequency Preset</label>
            <select class="yt-learn-select" id="yt-set-freq">
              <option value="low" ${s.breakFrequency === 'low' ? 'selected' : ''}>Low (Every ~7–12 mins, major milestones only)</option>
              <option value="medium" ${s.breakFrequency === 'medium' || !s.breakFrequency ? 'selected' : ''}>Medium (Every ~5–10 mins, standard selective learning)</option>
              <option value="high" ${s.breakFrequency === 'high' ? 'selected' : ''}>High (Every ~5–7.5 mins, intensive)</option>
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="yt-learn-form-group">
              <label>Min Interval (sec) — 5 min default</label>
              <input type="number" class="yt-learn-input" id="yt-set-min" value="${Number(s.minIntervalSeconds || 300)}" min="60" max="1200" />
            </div>
            <div class="yt-learn-form-group">
              <label>Max Interval (sec)</label>
              <input type="number" class="yt-learn-input" id="yt-set-max" value="${Number(s.maxIntervalSeconds || 600)}" min="120" max="1800" />
            </div>
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Use YouTube Chapters as Breakpoints</span>
            <input type="checkbox" id="yt-set-chapters" ${s.useYoutubeChapters !== false ? 'checked' : ''} />
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Use AI Semantic Breakpoints</span>
            <input type="checkbox" id="yt-set-aibp" ${s.useAiBreakpoints !== false ? 'checked' : ''} />
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Automatically Pause Video at Breakpoints</span>
            <input type="checkbox" id="yt-set-autopause" ${s.autoPause !== false ? 'checked' : ''} />
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Skip Minor Activities (Strong Concepts Only)</span>
            <input type="checkbox" id="yt-set-skipminor" ${s.skipMinorActivities ? 'checked' : ''} />
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Active Intervention: Redirect to YouTube Home (~5m on Non-Educational Videos)</span>
            <input type="checkbox" id="yt-set-intervention" ${s.enableNonEducationalIntervention !== false ? 'checked' : ''} />
          </div>

          <div style="margin: 16px 0 8px; font-weight: 700; font-size: 13px; color: #38bdf8; display: flex; align-items: center; gap: 6px; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 12px;">
            <span>💬 2nd Subtitle (Displayed alongside YouTube native captions)</span>
          </div>
          <div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px;">
            YouTube natively displays the main subtitle. The assistant downloads a 2nd subtitle on demand from YouTube and renders it alongside without hiding YouTube&#39;s captions.
          </div>

          <div class="yt-learn-checkbox-row">
            <span>Enable 2nd Subtitle on Video Player</span>
            <input type="checkbox" id="yt-set-dualsubs" ${s.enableDualSubtitles !== false ? 'checked' : ''} />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="yt-learn-form-group">
              <label>2nd Subtitle Language (On-Demand)</label>
              <select class="yt-learn-select" id="yt-set-secondary-lang">
                ${secondaryOptionsHtml}
              </select>
            </div>
            <div class="yt-learn-form-group">
              <label>Subtitle Font Size</label>
              <select class="yt-learn-select" id="yt-set-sub-size">
                <option value="small" ${s.subtitleFontSize === 'small' ? 'selected' : ''}>Small (13px)</option>
                <option value="medium" ${s.subtitleFontSize === 'medium' || !s.subtitleFontSize ? 'selected' : ''}>Medium (16px)</option>
                <option value="large" ${s.subtitleFontSize === 'large' ? 'selected' : ''}>Large (20px)</option>
              </select>
            </div>
          </div>
          <input type="hidden" id="yt-set-primary-lang" value="${this.escapeHtml(s.primarySubtitleLang || 'auto')}" />
          <input type="checkbox" id="yt-set-hidenative" style="display:none;" />
        </div>

        <div class="yt-learn-card-footer">
          <span id="yt-learn-save-msg" style="font-size:12px;color:#10b981;"></span>
          <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-settings-save">Save Settings</button>
        </div>
      </div>
    `;

    this.rootContainer.appendChild(wrapper);

    wrapper.querySelector('#yt-learn-settings-close')?.addEventListener('click', () => this.closeOverlay());

    wrapper.querySelector('#yt-learn-settings-save')?.addEventListener('click', async () => {
      const updated = {
        provider: wrapper.querySelector('#yt-set-provider').value,
        apiKey: wrapper.querySelector('#yt-set-apikey').value.trim(),
        model: wrapper.querySelector('#yt-set-model').value.trim() || 'gemini-3.8-flash',
        breakFrequency: wrapper.querySelector('#yt-set-freq').value,
        minIntervalSeconds: Math.max(60, Number(wrapper.querySelector('#yt-set-min').value) || 300),
        maxIntervalSeconds: Math.max(120, Number(wrapper.querySelector('#yt-set-max').value) || 600),
        useYoutubeChapters: wrapper.querySelector('#yt-set-chapters').checked,
        useAiBreakpoints: wrapper.querySelector('#yt-set-aibp').checked,
        autoPause: wrapper.querySelector('#yt-set-autopause').checked,
        skipMinorActivities: wrapper.querySelector('#yt-set-skipminor').checked,
        enableNonEducationalIntervention: wrapper.querySelector('#yt-set-intervention').checked,
        enableDualSubtitles: wrapper.querySelector('#yt-set-dualsubs').checked,
        primarySubtitleLang: wrapper.querySelector('#yt-set-primary-lang')?.value || 'auto',
        secondarySubtitleLang: wrapper.querySelector('#yt-set-secondary-lang')?.value || 'en',
        subtitleFontSize: wrapper.querySelector('#yt-set-sub-size')?.value || 'medium',
        hideNativeSubtitles: wrapper.querySelector('#yt-set-hidenative')?.checked ?? false
      };

      this.settings = { ...this.settings, ...updated };
      if (updated.enableDualSubtitles === false) {
        this.clearDualSubtitles();
      }
      await this.callbacks.onSaveSettings(updated);
      const msg = wrapper.querySelector('#yt-learn-save-msg');
      if (msg) msg.textContent = '✓ Saved!';
      setTimeout(() => this.closeOverlay(), 600);
    });
  }

  async showDashboardDrawer() {
    this.ensureOverlayHost();
    this.activePanel = 'dashboard';
    this.rootContainer.innerHTML = '';

    const data = await this.callbacks.onLoadDashboardData();
    const { stats, concepts = [], upcomingBreakpoints = [] } = data || {};

    const wrapper = document.createElement('div');
    wrapper.className = 'yt-learn-overlay-backdrop';

    const conceptRows = concepts
      .slice(0, 8)
      .map(
        (c) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(30,41,59,0.6);border-radius:6px;font-size:12.5px;">
          <span>${this.escapeHtml(c.name)}</span>
          <span style="color:${c.masteryScore >= 75 ? '#10b981' : c.masteryScore >= 50 ? '#38bdf8' : '#f59e0b'};font-weight:700;">
            ${c.masteryScore}%
          </span>
        </div>`
      )
      .join('');

    const historyRows = (stats?.recentItems || [])
      .slice(0, 6)
      .map(
        (h) => `
        <div style="padding:8px 10px;background:rgba(30,41,59,0.45);border-radius:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;color:#94a3b8;">
            <span>${this.formatActivityType(h.activityType)}</span>
            <span>${h.skipped ? 'Skipped' : `${Math.round((h.scoreNormalized || 0) * 100)}%`}</span>
          </div>
          <div style="font-weight:600;color:#f1f5f9;margin-top:2px;">${this.escapeHtml(h.conceptName)}</div>
        </div>`
      )
      .join('');

    wrapper.innerHTML = `
      <div class="yt-learn-card">
        <div class="yt-learn-card-header">
          <h3 class="yt-learn-concept-title" style="font-size:16px;">📊 Learning Profile & Progress</h3>
          <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-dash-close">✕</button>
        </div>

        <div class="yt-learn-card-body">
          <div class="yt-learn-rubric-grid">
            <div class="yt-learn-rubric-cell"><span>Completed</span><strong>${stats?.totalCompleted || 0}</strong></div>
            <div class="yt-learn-rubric-cell"><span>Avg Mastery</span><strong>${stats?.averageMasteryPercent || 0}%</strong></div>
            <div class="yt-learn-rubric-cell"><span>This Video</span><strong>${stats?.currentVideoCount || 0}</strong></div>
            <div class="yt-learn-rubric-cell"><span>Queued Ahead</span><strong>${upcomingBreakpoints.length}</strong></div>
          </div>

          <div style="font-weight:700;font-size:13px;margin-top:6px;">Tracked Concept Mastery (Spaced Repetition)</div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${conceptRows || '<div style="font-size:12.5px;color:#94a3b8;">Complete your first activity to build your adaptive concept profile.</div>'}
          </div>

          <div style="font-weight:700;font-size:13px;margin-top:6px;">Recent Activity History</div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${historyRows || '<div style="font-size:12.5px;color:#94a3b8;">No activities recorded yet.</div>'}
          </div>
        </div>
      </div>
    `;

    this.rootContainer.appendChild(wrapper);
    wrapper.querySelector('#yt-learn-dash-close')?.addEventListener('click', () => this.closeOverlay());
  }

  showQuickGlanceToast(words = []) {
    if (!Array.isArray(words) || words.length === 0) return;
    if (this.activePanel !== null) return;
    if (typeof document === 'undefined') return;
    this.ensureOverlayHost();
    if (!this.rootContainer) return;

    const existing = this.rootContainer.querySelector?.('.yt-learn-quick-glance-toast');
    if (existing && typeof existing.remove === 'function') {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'yt-learn-toast yt-learn-quick-glance-toast';
    toast.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">📖</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:#f1f5f9;">
              ${words.length} New Words in Original Language
            </div>
            <div style="font-size:11.5px;color:#94a3b8;">
              Quick glance before diving into the video.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-quick-glance-btn" style="font-size:11.5px;padding:4px 10px;white-space:nowrap;">
            Quick Glance
          </button>
          <button class="yt-learn-btn-ghost" id="yt-learn-quick-glance-close" style="border:none;cursor:pointer;color:#94a3b8;font-size:14px;padding:4px 6px;">✕</button>
        </div>
      </div>
    `;

    this.rootContainer.appendChild(toast);

    const dismiss = () => {
      if (toast && typeof toast.remove === 'function') {
        toast.remove();
      }
    };

    toast.querySelector?.('#yt-learn-quick-glance-close')?.addEventListener('click', dismiss);
    toast.querySelector?.('#yt-learn-quick-glance-btn')?.addEventListener('click', () => {
      dismiss();
      this.showVocabularyDrawer();
    });

    setTimeout(dismiss, 12000);
  }

  showVocabularyDrawer() {
    if (typeof document === 'undefined') return;
    this.ensureOverlayHost();
    this.activePanel = 'vocabulary';
    if (this.rootContainer) {
      this.rootContainer.innerHTML = '';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'yt-learn-overlay-backdrop yt-learn-vocab-backdrop';

    const words = Array.isArray(this.vocabulary) ? this.vocabulary : [];
    const isPreparing = this.statusState === 'preparing';

    let contentHtml = '';
    if (words.length === 0) {
      if (isPreparing) {
        contentHtml = `
          <div style="text-align:center;padding:36px 20px;color:#94a3b8;">
            <div style="font-size:24px;margin-bottom:8px;">⏳</div>
            <div style="font-weight:600;font-size:14px;color:#f1f5f9;">Analyzing Transcript for New Words...</div>
            <div style="font-size:12.5px;margin-top:6px;">Gemini is compiling a table of new vocabulary in the original language. It will appear here shortly so you can take a quick glance before diving into the video.</div>
          </div>
        `;
      } else {
        contentHtml = `
          <div style="text-align:center;padding:36px 20px;color:#94a3b8;">
            <div style="font-size:24px;margin-bottom:8px;">📖</div>
            <div style="font-weight:600;font-size:14px;color:#f1f5f9;">No New Words Available Yet</div>
            <div style="font-size:12.5px;margin-top:6px;">Ensure the video has captions/subtitles loaded so Gemini can extract the vocabulary.</div>
          </div>
        `;
      }
    } else {
      const renderWordRows = (items) => items.map((w, index) => `
        <tr class="yt-learn-vocab-row" data-index="${index}">
          <td class="yt-learn-vocab-col-word">
            <div class="yt-learn-vocab-word">${this.escapeHtml(w.word || '')}</div>
            ${w.pronunciation ? `<div class="yt-learn-vocab-pron">[${this.escapeHtml(w.pronunciation)}]</div>` : ''}
          </td>
          <td class="yt-learn-vocab-col-meaning">
            <div class="yt-learn-vocab-meaning">${this.escapeHtml(w.meaning || '')}</div>
          </td>
          <td class="yt-learn-vocab-col-context">
            ${w.context ? `<div class="yt-learn-vocab-context">"${this.escapeHtml(w.context)}"</div>` : '<span style="color:#64748b;">—</span>'}
          </td>
          <td class="yt-learn-vocab-col-action">
            ${typeof w.timestamp === 'number' && !isNaN(w.timestamp) ? `
              <button class="yt-learn-btn yt-learn-btn-secondary yt-learn-timestamp-btn" data-time="${w.timestamp}" title="Jump to ${UIManager.formatTimestamp(w.timestamp)} in video">
                ⏱️ ${UIManager.formatTimestamp(w.timestamp)}
              </button>
            ` : '<span style="color:#64748b;">—</span>'}
          </td>
        </tr>
      `).join('');

      contentHtml = `
        <div class="yt-learn-vocab-toolbar">
          <input type="text" id="yt-learn-vocab-filter" class="yt-learn-vocab-search" placeholder="🔍 Filter words, meanings, or context..." />
          <div style="font-size:12px;color:#94a3b8;white-space:nowrap;">
            Showing <strong id="yt-learn-vocab-visible-count" style="color:#38bdf8;">${words.length}</strong> of ${words.length}
          </div>
        </div>
        <div class="yt-learn-vocab-table-container">
          <table class="yt-learn-vocab-table">
            <thead>
              <tr>
                <th style="width:24%;">Word (Original)</th>
                <th style="width:34%;">Meaning / Translation</th>
                <th style="width:30%;">Context in Video</th>
                <th style="width:12%;text-align:center;">Jump</th>
              </tr>
            </thead>
            <tbody id="yt-learn-vocab-tbody">
              ${renderWordRows(words)}
            </tbody>
          </table>
        </div>
      `;
    }

    wrapper.innerHTML = `
      <div class="yt-learn-card yt-learn-vocab-card">
        <div class="yt-learn-card-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <h3 class="yt-learn-concept-title" style="font-size:16px;">📖 New Words & Key Vocabulary</h3>
              <span class="yt-learn-badge" style="background:rgba(56,189,248,0.18);color:#7dd3fc;border-color:rgba(56,189,248,0.35);">
                Original Language
              </span>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;">
              Quick glance before diving into the video • Independent from breakpoints
            </div>
          </div>
          <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-vocab-close" title="Close">✕</button>
        </div>

        <div class="yt-learn-card-body" style="padding:14px 18px;max-height:68vh;overflow-y:auto;">
          ${contentHtml}
        </div>

        <div class="yt-learn-card-footer" style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:1px solid rgba(148,163,184,0.15);font-size:12px;color:#94a3b8;">
          <div>💡 <em>Click any timestamp to jump directly to where the word is spoken in the video.</em></div>
          <div style="display:flex;gap:8px;">
            ${words.length > 0 ? `<button class="yt-learn-btn yt-learn-btn-secondary" id="yt-learn-vocab-copy" style="font-size:12px;padding:6px 12px;">📋 Copy List</button>` : ''}
            <button class="yt-learn-btn yt-learn-btn-primary" id="yt-learn-vocab-done" style="font-size:12px;padding:6px 14px;">Done</button>
          </div>
        </div>
      </div>
    `;

    if (this.rootContainer) {
      this.rootContainer.appendChild(wrapper);
    }

    // Event listeners
    wrapper.querySelector?.('#yt-learn-vocab-close')?.addEventListener('click', () => this.closeOverlay());
    wrapper.querySelector?.('#yt-learn-vocab-done')?.addEventListener('click', () => this.closeOverlay());

    // Timestamp seek buttons
    wrapper.querySelectorAll?.('.yt-learn-timestamp-btn')?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const time = parseFloat(btn.dataset.time);
        if (!isNaN(time) && typeof this.callbacks.onSeekToTimestamp === 'function') {
          this.callbacks.onSeekToTimestamp(time);
        }
      });
    });

    // Filter input
    const filterInput = wrapper.querySelector?.('#yt-learn-vocab-filter');
    const tbody = wrapper.querySelector?.('#yt-learn-vocab-tbody');
    const visibleCountEl = wrapper.querySelector?.('#yt-learn-vocab-visible-count');

    if (filterInput && tbody) {
      filterInput.addEventListener('input', () => {
        const query = filterInput.value.trim().toLowerCase();
        const rows = tbody.querySelectorAll?.('.yt-learn-vocab-row') || [];
        let visibleCount = 0;

        rows.forEach((row) => {
          const idx = parseInt(row.dataset.index, 10);
          const item = words[idx];
          if (!item) return;

          const match =
            !query ||
            (item.word && item.word.toLowerCase().includes(query)) ||
            (item.meaning && item.meaning.toLowerCase().includes(query)) ||
            (item.context && item.context.toLowerCase().includes(query)) ||
            (item.pronunciation && item.pronunciation.toLowerCase().includes(query));

          if (match) {
            row.style.display = '';
            visibleCount++;
          } else {
            row.style.display = 'none';
          }
        });

        if (visibleCountEl) {
          visibleCountEl.textContent = String(visibleCount);
        }
      });
    }

    // Copy list button
    wrapper.querySelector?.('#yt-learn-vocab-copy')?.addEventListener('click', (e) => {
      const textToCopy = words
        .map((w) => `${w.word}${w.pronunciation ? ` [${w.pronunciation}]` : ''} - ${w.meaning}${w.context ? ` ("${w.context}")` : ''}`)
        .join('\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
      const copyBtn = e.target;
      if (copyBtn) {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = '📋 Copy List';
        }, 1500);
      }
    });
  }

  closeOverlay() {
    this.activePanel = null;
    this.activeActivityId = null;
    this.isSubmitting = false;
    if (this.rootContainer) {
      this.rootContainer.innerHTML = '';
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
    container.innerHTML = `
      <div class="yt-learn-dual-subtitles-box yt-learn-secondary-subtitle-box" id="yt-learn-dual-subtitles-box" style="display:none;" title="Drag to reposition subtitle | Double-click to reset">
        <div class="yt-learn-sub-line yt-learn-sub-primary" id="yt-learn-sub-primary" style="display:none;"></div>
        <div class="yt-learn-sub-line yt-learn-sub-secondary yt-learn-secondary-subtitle-text" id="yt-learn-sub-secondary"></div>
      </div>
    `;

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
        } catch {}
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
        } catch {}
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
