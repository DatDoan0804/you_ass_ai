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

export const PROXIMITY_ACTIVATE_PX = 26;
export const PROXIMITY_HYSTERESIS_PX = 34;

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
    this.boundProgressBarHost = null;
    this.activeProximityBpId = null;

    this.activePanel = null;
    this.activeActivityId = null;
    this.isSubmitting = false;
    this.statusText = 'Ready';
    this.statusState = 'ready';
    this.videoClassification = null;
    this.userClassificationOverride = null;

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

    this.boundProgressBarMouseMove = this.handleProgressBarMouseMove.bind(this);
    this.boundProgressBarMouseLeave = this.handleProgressBarMouseLeave.bind(this);
  }

  init(initialSettings) {
    this.settings = initialSettings || {};
    if (typeof document === 'undefined') return;

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

    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsElement) {
      this.barContainer.classList.add('floating-top-dock');
      if (this.barContainer.parentElement !== fsElement) {
        fsElement.appendChild(this.barContainer);
      }
      return;
    }

    const belowPlayerSlot =
      document.querySelector('ytd-watch-metadata #above-the-fold') ||
      document.querySelector('#below') ||
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

  renderDedicatedBar() {
    if (!this.barContainer) return;
    this.mountDedicatedBarInSafeSlot();

    const isEnabled = this.settings.enabled !== false;
    const cls = this.videoClassification;

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
        <button class="yt-learn-icon-btn" id="yt-learn-now-btn" title="Generate activity for current section now">⚡ Quiz Now</button>
        <button class="yt-learn-icon-btn" id="yt-learn-dashboard-btn" title="Learning Profile & Activity History">📊 Progress</button>
        <button class="yt-learn-icon-btn" id="yt-learn-settings-btn" title="Assistant Settings & API Key">⚙️ Settings</button>
      </div>
    `;

    this.barContainer.querySelector('#yt-learn-toggle-btn')?.addEventListener('click', async () => {
      const nextEnabled = !isEnabled;
      this.settings.enabled = nextEnabled;
      await this.callbacks.onSaveSettings({ enabled: nextEnabled });
      this.setStatus(nextEnabled ? 'Active' : 'Paused', nextEnabled ? 'ready' : 'disabled');
    });

    this.barContainer.querySelector('#yt-learn-classification-btn')?.addEventListener('click', () => {
      if (typeof this.callbacks.onOverrideClassification === 'function') {
        const nextOverride = !this.userClassificationOverride;
        this.callbacks.onOverrideClassification(nextOverride);
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
   * Handles mouse movement anywhere along YouTube's progress bar container:
   * 1. Calculates X-axis distance to all markers and activates the nearest one within tolerance.
   * 2. Adjusts `--yt-learn-popup-bottom` so the popup clears YouTube's `.ytp-tooltip` thumbnail preview.
   */
  handleProgressBarMouseMove(event) {
    if (!this.markersLayer || !this.boundProgressBarHost) return;
    const rect = this.boundProgressBarHost.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    const cursorX = event.clientX - rect.left;
    const { activeId } = UIManager.findNearestMarkerByX({
      cursorX,
      barWidthPx: rect.width,
      breakpoints: this.cachedBreakpoints,
      duration: this.cachedDuration,
      currentActiveId: this.activeProximityBpId
    });

    if (activeId !== this.activeProximityBpId) {
      this.activeProximityBpId = activeId;
      const safeBottomPx = UIManager.computeSafePopupBottomOffsetPx(this.boundProgressBarHost);

      const markerEls = this.markersLayer.querySelectorAll('.yt-learn-timeline-marker');
      markerEls.forEach((el) => {
        const isMatch = activeId && el.dataset.breakpointId === activeId;
        el.classList.toggle('proximity-active', Boolean(isMatch));
        if (isMatch) {
          const tooltip = el.querySelector('.yt-learn-marker-tooltip');
          if (tooltip) {
            tooltip.style.setProperty('--yt-learn-popup-bottom', `${safeBottomPx}px`);
          }
        }
      });
    }
  }

  handleProgressBarMouseLeave() {
    this.activeProximityBpId = null;
    if (!this.markersLayer) return;
    this.markersLayer
      .querySelectorAll('.yt-learn-timeline-marker.proximity-active')
      .forEach((el) => el.classList.remove('proximity-active'));
  }

  attachProgressBarProximityListeners(progressBar) {
    const host = progressBar.closest('.ytp-progress-bar-container') || progressBar;
    if (this.boundProgressBarHost === host) return;

    if (this.boundProgressBarHost) {
      this.boundProgressBarHost.removeEventListener('mousemove', this.boundProgressBarMouseMove);
      this.boundProgressBarHost.removeEventListener('mouseleave', this.boundProgressBarMouseLeave);
    }

    this.boundProgressBarHost = host;
    this.boundProgressBarHost.addEventListener('mousemove', this.boundProgressBarMouseMove);
    this.boundProgressBarHost.addEventListener('mouseleave', this.boundProgressBarMouseLeave);
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

    this.attachProgressBarProximityListeners(progressBar);

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
      marker.className = `yt-learn-timeline-marker strength-${strength}${isCompleted ? ' completed' : ''}${this.activeProximityBpId === bp.id ? ' proximity-active' : ''}`;
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

  showActivityOverlay(activity) {
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

    wrapper.innerHTML = `
      <div class="yt-learn-card">
        <div class="yt-learn-card-header">
          <div class="yt-learn-badge-row">
            <span class="yt-learn-badge ${isPrediction ? 'prediction' : ''}">
              ${this.escapeHtml(activity.title || this.formatActivityType(activity.type))}
            </span>
            <span class="yt-learn-badge difficulty">${this.escapeHtml(activity.difficulty || 'medium')}</span>
          </div>
          <button class="yt-learn-btn yt-learn-btn-ghost" id="yt-learn-close-btn" title="Skip & Resume">✕</button>
        </div>

        <div class="yt-learn-card-body" id="yt-learn-activity-body">
          <h3 class="yt-learn-concept-title">${this.escapeHtml(activity.conceptName || 'Concept Check')}</h3>

          ${
            activity.contextSummary
              ? `<div class="yt-learn-context-box">${this.escapeHtml(activity.contextSummary)}</div>`
              : ''
          }

          <div class="yt-learn-prompt">${this.escapeHtml(activity.prompt)}</div>

          ${
            activity.codeOrScenarioSnippet
              ? `<pre class="yt-learn-code-block">${this.escapeHtml(activity.codeOrScenarioSnippet)}</pre>`
              : ''
          }

          <div id="yt-learn-input-mount"></div>

          <div id="yt-learn-hint-area" style="display:none;font-size:12.5px;color:#38bdf8;background:rgba(56,189,248,0.1);padding:8px 12px;border-radius:8px;">
            💡 <strong>Hint:</strong> ${this.escapeHtml(activity.hint || 'Connect the setup at the beginning of this segment with its outcome.')}
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
      isCodeOrMistake
    );

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
        });
      } catch (err) {
        if (this.activePanel !== 'activity' || this.activeActivityId !== activity.id) {
          return;
        }
        setDisabled(false);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Answer';
        statusMount.innerHTML = `
          <div class="yt-learn-error-banner" id="yt-learn-grading-error">
            <strong>⚠️ Grading Error:</strong> ${this.escapeHtml(err?.message || 'Unable to evaluate answer right now. Your response has been preserved—please try submitting again.')}
          </div>
        `;
      } finally {
        this.isSubmitting = false;
      }
    });
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

  mountActivityInputWidget(container, activity, isCodeOrMistake) {
    const isChoice =
      ['multiple_choice', 'true_false', 'multiple_select'].includes(activity.type) &&
      Array.isArray(activity.options) &&
      activity.options.length > 0;

    if (isChoice) {
      const isMulti = activity.type === 'multiple_select';
      const selected = new Set();
      const list = document.createElement('div');
      list.className = 'yt-learn-options-list';
      const buttons = [];

      activity.options.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yt-learn-option-item';
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
   * - Issue 2: For `evaluationMode === 'objective'` (Multiple-Choice ABCD), renders a concise,
   *   focused card (`Why Correct`, `Why Other Options Are Incorrect`, and `Core Concept Takeaway`)
   *   without bloated per-option essays.
   * - For `evaluationMode === 'open_ended'`, renders the full 4-criterion breakdown (`Accuracy`,
   *   `Completeness`, `Reasoning`, `Clarity`), Overall Synthesis, and complete rewritten Improved Answer.
   */
  renderEvaluationFeedback(evalContainer, footerContainer, activity, evaluation, onRetry) {
    if (!evalContainer) return;

    const pct = evaluation.scorePercent ?? Math.round((evaluation.scoreNormalized ?? 0.7) * 100);
    const verdictStatus = evaluation.verdictStatus || 'good_understanding';
    const isObjective = evaluation.evaluationMode === 'objective';

    const verdictIcon =
      verdictStatus === 'excellent_understanding' || verdictStatus === 'good_understanding' || verdictStatus === 'correct'
        ? '✅'
        : verdictStatus === 'partial_understanding' || verdictStatus === 'partially_correct'
        ? '⚖️'
        : '🧭';

    if (isObjective) {
      const mc = evaluation.conciseMcExplanation || {
        whyCorrect: evaluation.whatWasCorrect,
        whyOthersIncorrect: evaluation.missingOrIncorrect,
        coreConceptTakeaway: evaluation.improvedAnswerExample
      };

      evalContainer.innerHTML = `
        <div class="yt-learn-eval-box" id="yt-learn-grading-result">
          <div class="yt-learn-eval-verdict ${verdictStatus}">
            <span id="yt-learn-verdict-label">
              ${verdictIcon} ${this.escapeHtml(evaluation.verdictLabel || 'Correct')}
            </span>
            <span id="yt-learn-score-badge">${pct}% Score</span>
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
      const criteria = Array.isArray(evaluation.criteriaBreakdown) ? evaluation.criteriaBreakdown : [];
      const overall = evaluation.overallFeedback || {};

      const criteriaCardsHtml = criteria
        .map(
          (c) => `
          <div class="yt-learn-criterion-card" data-criterion="${this.escapeHtml(c.name)}">
            <div class="yt-learn-criterion-header">
              <span>${this.escapeHtml(c.name)}</span>
              <span style="color:${c.score >= 4 ? '#10b981' : c.score >= 2 ? '#f59e0b' : '#f87171'};">
                ${this.escapeHtml(c.assessmentLabel)} (${c.score}/5)
              </span>
            </div>
            <div class="yt-learn-criterion-measures">${this.escapeHtml(c.measures)}</div>
            <div style="color:#a7f3d0;"><strong>✓ Did well:</strong> ${this.escapeHtml(c.whatUserDidWell)}</div>
            <div style="color:#fde68a;"><strong>△ Missing / Incorrect:</strong> ${this.escapeHtml(c.whatWasMissingOrIncorrect)}</div>
            <div style="color:#93c5fd;"><strong>→ Improvement:</strong> ${this.escapeHtml(c.specificImprovement)}</div>
          </div>`
        )
        .join('');

      evalContainer.innerHTML = `
        <div class="yt-learn-eval-box" id="yt-learn-grading-result">
          <div class="yt-learn-eval-verdict ${verdictStatus}">
            <span id="yt-learn-verdict-label">
              ${verdictIcon} ${this.escapeHtml(evaluation.verdictLabel || evaluation.qualitativeAssessment || 'Assessment Complete')}
            </span>
            <span id="yt-learn-score-badge">Understanding: ${pct}%</span>
          </div>

          <div style="font-weight:700;font-size:12.5px;color:#cbd5e1;">Detailed Criterion-by-Criterion Assessment</div>
          <div class="yt-learn-criteria-list" id="yt-learn-criteria-breakdown">
            ${criteriaCardsHtml}
          </div>

          <div class="yt-learn-overall-card" id="yt-learn-overall-feedback">
            <div style="font-weight:700;color:#38bdf8;font-size:12.5px;">Overall Tutor Synthesis</div>
            <div><strong>Overall Evaluation:</strong> ${this.escapeHtml(overall.overallEvaluation || evaluation.feedback || '')}</div>
            <div style="color:#a7f3d0;"><strong>★ Most Important Strength:</strong> ${this.escapeHtml(overall.mostImportantStrength || evaluation.whatWasCorrect || '')}</div>
            <div style="color:#fde68a;"><strong>△ Most Important Weakness:</strong> ${this.escapeHtml(overall.mostImportantWeakness || evaluation.missingOrIncorrect || '')}</div>
            <div style="color:#93c5fd;"><strong>🎯 Single Most Useful Next Step:</strong> ${this.escapeHtml(overall.singleMostUsefulImprovement || evaluation.followUpSuggestion || '')}</div>
          </div>

          <div class="yt-learn-improved-answer-card" id="yt-learn-improved-answer">
            <div style="font-weight:700;color:#10b981;font-size:13px;">Suggested Improved Answer</div>
            <div id="yt-learn-improved-answer-body" style="color:#f8fafc;line-height:1.5;">
              ${this.escapeHtml(evaluation.improvedAnswerExample || '')}
            </div>
            <div id="yt-learn-improved-answer-why" style="font-size:11.5px;color:#a7f3d0;border-top:1px solid rgba(16,185,129,0.25);padding-top:6px;">
              <strong>What makes this stronger:</strong> ${this.escapeHtml(evaluation.improvedAnswerExplanation || '')}
            </div>
          </div>
        </div>
      `;
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

  showSettingsDrawer() {
    this.ensureOverlayHost();
    this.activePanel = 'settings';
    this.rootContainer.innerHTML = '';

    const s = this.settings;
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-learn-overlay-backdrop';

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
              <option value="low" ${s.breakFrequency === 'low' ? 'selected' : ''}>Low (Every ~3–6 mins, major concepts)</option>
              <option value="medium" ${s.breakFrequency === 'medium' ? 'selected' : ''}>Medium (Every ~1.5–4 mins)</option>
              <option value="high" ${s.breakFrequency === 'high' ? 'selected' : ''}>High (Every ~45s–2.5 mins, intensive)</option>
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="yt-learn-form-group">
              <label>Min Interval (sec)</label>
              <input type="number" class="yt-learn-input" id="yt-set-min" value="${Number(s.minIntervalSeconds || 90)}" min="15" max="600" />
            </div>
            <div class="yt-learn-form-group">
              <label>Max Interval (sec)</label>
              <input type="number" class="yt-learn-input" id="yt-set-max" value="${Number(s.maxIntervalSeconds || 360)}" min="60" max="1200" />
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
        minIntervalSeconds: Number(wrapper.querySelector('#yt-set-min').value) || 90,
        maxIntervalSeconds: Number(wrapper.querySelector('#yt-set-max').value) || 360,
        useYoutubeChapters: wrapper.querySelector('#yt-set-chapters').checked,
        useAiBreakpoints: wrapper.querySelector('#yt-set-aibp').checked,
        autoPause: wrapper.querySelector('#yt-set-autopause').checked,
        skipMinorActivities: wrapper.querySelector('#yt-set-skipminor').checked,
        enableNonEducationalIntervention: wrapper.querySelector('#yt-set-intervention').checked
      };

      this.settings = { ...this.settings, ...updated };
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

  closeOverlay() {
    this.activePanel = null;
    this.activeActivityId = null;
    this.isSubmitting = false;
    if (this.rootContainer) {
      this.rootContainer.innerHTML = '';
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
