/**
 * @fileoverview TimelineMarkers Component (Preact)
 * Renders interactive breakpoint checkpoints and edge-aware hover tooltips
 * directly onto the YouTube video progress bar.
 */

import { html } from '../preact-htm.js';

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
      return 'Teach-Back';
    default:
      return type
        ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Checkpoint';
  }
}

function computePopupAlignment(pct, barWidthPx = 800, estimatedPopupWidthPx = 240) {
  const halfWidthPct = ((estimatedPopupWidthPx / 2) / barWidthPx) * 100;
  const marginPct = (8 / barWidthPx) * 100;

  if (pct - halfWidthPct < marginPct) {
    const targetCenterPct = marginPct + halfWidthPct;
    const shiftPx = ((targetCenterPct - pct) / 100) * barWidthPx;
    return { alignClass: 'align-left', shiftPx: Math.round(shiftPx) };
  }

  if (pct + halfWidthPct > 100 - marginPct) {
    const targetCenterPct = 100 - marginPct - halfWidthPct;
    const shiftPx = ((targetCenterPct - pct) / 100) * barWidthPx;
    return { alignClass: 'align-right', shiftPx: Math.round(shiftPx) };
  }

  return { alignClass: 'align-center', shiftPx: 0 };
}

export function TimelineMarkers({
  breakpoints = [],
  duration = 0,
  triggeredIds = new Set(),
  barWidthPx = 800,
  safeBottomPx = 48,
  onSeek = () => {}
}) {
  if (!duration || duration <= 0 || !Array.isArray(breakpoints) || breakpoints.length === 0) {
    return null;
  }

  return html`
    <div class="yt-learn-timeline-markers-layer">
      ${breakpoints.map((bp) => {
        const ts = Number(bp.timestamp);
        if (!Number.isFinite(ts) || ts < 0 || ts > duration) return null;

        const rawPct = (ts / duration) * 100;
        const clampedPct = Math.max(0.5, Math.min(99.5, rawPct));
        const strength = bp.strength || 'normal';
        const isCompleted = triggeredIds instanceof Set ? triggeredIds.has(bp.id) : false;
        const formattedTime = formatTimestamp(ts);
        const conceptLabel = bp.activity?.conceptName || bp.reason || 'Learning Breakpoint';
        const activityBadge = formatActivityType(bp.activity?.type || 'check');

        const { alignClass, shiftPx } = computePopupAlignment(clampedPct, barWidthPx, 240);

        return html`
          <div
            class="yt-learn-timeline-marker strength-${strength} ${isCompleted ? 'completed' : ''}"
            style="left: ${clampedPct.toFixed(3)}%;"
            data-breakpoint-id=${bp.id}
            data-timestamp=${String(ts)}
            data-popup-align=${alignClass}
            aria-label="Learning breakpoint at ${formattedTime}: ${conceptLabel}"
            onClick=${(e) => {
              e.stopPropagation();
              onSeek(ts);
            }}
          >
            <div class="yt-learn-marker-dot"></div>
            <div
              class="yt-learn-marker-tooltip ${alignClass}"
              style="--yt-learn-popup-shift: ${shiftPx}px; --yt-learn-popup-bottom: ${safeBottomPx}px;"
            >
              <div class="yt-learn-marker-tooltip-header">
                <span class="yt-learn-marker-time">⏱️ ${formattedTime}</span>
                <span class="yt-learn-marker-type">${activityBadge}</span>
              </div>
              <div class="yt-learn-marker-tooltip-title">${conceptLabel}</div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}
