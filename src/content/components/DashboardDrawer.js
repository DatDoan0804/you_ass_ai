/**
 * @fileoverview DashboardDrawer Component (Preact)
 * Renders learning analytics, mastery progress per concept, and recent activity history.
 */

import { html } from '../preact-htm.js';

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

export function DashboardDrawer({
  data = {},
  onClose = () => {}
}) {
  const { stats = {}, concepts = [], upcomingBreakpoints = [] } = data || {};

  const totalCompleted = stats?.totalCompleted || 0;
  const averageMastery = stats?.averageMasteryPercent || 0;
  const currentVideoCount = stats?.currentVideoCount || 0;
  const queuedAheadCount = Array.isArray(upcomingBreakpoints) ? upcomingBreakpoints.length : 0;

  const conceptList = Array.isArray(concepts) ? concepts.slice(0, 8) : [];
  const historyList = Array.isArray(stats?.recentItems) ? stats.recentItems.slice(0, 6) : [];

  return html`
    <div
      class="yt-learn-overlay-backdrop"
      onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
    >
      <div
        class="yt-learn-card yt-learn-dashboard-card"
        onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
      >
        <div class="yt-learn-card-header">
          <div class="yt-learn-card-title-group">
            <span class="yt-learn-card-icon">📊</span>
            <h3 class="yt-learn-card-title">Learning Dashboard</h3>
          </div>
          <button
            class="yt-learn-btn yt-learn-btn-ghost"
            id="yt-learn-dash-close"
            aria-label="Close"
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div class="yt-learn-card-body yt-learn-dashboard-body">
          <!-- Metric Cards Grid -->
          <div class="yt-learn-stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:18px;">
            <div class="yt-learn-stat-box" style="padding:12px;background:rgba(30,41,59,0.7);border-radius:8px;text-align:center;">
              <div style="font-size:20px;font-weight:750;color:#38bdf8;">${totalCompleted}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Completed</div>
            </div>
            <div class="yt-learn-stat-box" style="padding:12px;background:rgba(30,41,59,0.7);border-radius:8px;text-align:center;">
              <div style="font-size:20px;font-weight:750;color:#10b981;">${averageMastery}%</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Avg Mastery</div>
            </div>
            <div class="yt-learn-stat-box" style="padding:12px;background:rgba(30,41,59,0.7);border-radius:8px;text-align:center;">
              <div style="font-size:20px;font-weight:750;color:#f59e0b;">${currentVideoCount}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">This Video</div>
            </div>
            <div class="yt-learn-stat-box" style="padding:12px;background:rgba(30,41,59,0.7);border-radius:8px;text-align:center;">
              <div style="font-size:20px;font-weight:750;color:#a855f7;">${queuedAheadCount}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Queued Ahead</div>
            </div>
          </div>

          <!-- Concept Mastery Progress -->
          <div style="margin-bottom:18px;">
            <h4 style="font-size:13px;color:#cbd5e1;margin-bottom:8px;">Concept Mastery</h4>
            ${conceptList.length > 0
              ? html`
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${conceptList.map(
                      (c) => html`
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(30,41,59,0.6);border-radius:6px;font-size:12.5px;">
                          <span>${c.name}</span>
                          <span style="color:${c.masteryScore >= 75 ? '#10b981' : c.masteryScore >= 50 ? '#38bdf8' : '#f59e0b'};font-weight:700;">
                            ${c.masteryScore}%
                          </span>
                        </div>
                      `
                    )}
                  </div>
                `
              : html`
                  <div style="font-size:12.5px;color:#94a3b8;">
                    Complete your first activity to build your adaptive concept profile.
                  </div>
                `}
          </div>

          <!-- Recent Activity History -->
          <div>
            <h4 style="font-size:13px;color:#cbd5e1;margin-bottom:8px;">Recent History</h4>
            ${historyList.length > 0
              ? html`
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${historyList.map(
                      (h) => html`
                        <div style="padding:8px 10px;background:rgba(30,41,59,0.45);border-radius:6px;font-size:12px;">
                          <div style="display:flex;justify-content:space-between;color:#94a3b8;">
                            <span>${formatActivityType(h.activityType)}</span>
                            <span>${h.skipped ? 'Skipped' : `${Math.round((h.scoreNormalized || 0) * 100)}%`}</span>
                          </div>
                          <div style="font-weight:600;color:#f1f5f9;margin-top:2px;">
                            ${h.conceptName || 'Question in lesson'}
                          </div>
                        </div>
                      `
                    )}
                  </div>
                `
              : html`
                  <div style="font-size:12.5px;color:#94a3b8;">
                    No activities recorded yet.
                  </div>
                `}
          </div>
        </div>
      </div>
    </div>
  `;
}
