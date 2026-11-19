/**
 * @fileoverview DedicatedBar Component (Preact)
 * Renders the top/bottom floating toolbar for AI Tutor, companion subtitles,
 * vocabulary prep, and learning controls.
 */

import { html } from '../preact-htm.js';

export function DedicatedBar({
  barCollapsed = false,
  statusText = 'Active',
  statusState = 'ready',
  settings = {},
  videoClassification = null,
  userClassificationOverride = false,
  localServerConnected = false,
  vocabulary = [],
  availableTracks = [],
  activePanel = null,
  onToggleCollapse = () => {},
  onToggleAi = () => {},
  onToggleDualSubs = () => {},
  onSelectSub1 = () => {},
  onSelectSub2 = () => {},
  onToggleVocab = () => {},
  onManualTrigger = () => {},
  onOpenDashboard = () => {},
  onOpenSettings = () => {},
  onOverrideClassification = () => {},
  onRetryMetadataCheck = () => {},
  onBackgroundClick = () => {}
}) {
  const isEnabled = settings.enabled !== false;
  const isDualOn = settings.enableDualSubtitles !== false;
  const isVocabOn = Boolean(settings.enableVocabularyPrep);
  const vocabCount = Array.isArray(vocabulary) ? vocabulary.length : 0;
  const statusClass = isEnabled ? statusState : 'disabled';
  const displayStatus = isEnabled ? statusText : 'Off';

  const handleContainerClick = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (barCollapsed) return;
    const targetEl = e.target?.nodeType === 3 ? e.target.parentElement : e.target;
    if (targetEl && typeof targetEl.closest === 'function') {
      if (targetEl.closest('button, select, input, option, a, label')) return;
    }
    onBackgroundClick(e);
  };

  if (barCollapsed) {
    return html`
      <div class="yt-learn-bar-collapsed-inner">
        <button
          class="yt-learn-fab yt-learn-collapsed-btn"
          id="yt-learn-expand-bar-btn"
          title="Expand AI Tutor Bar"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onToggleCollapse();
          }}
        >
          <span class="yt-learn-status-dot ${statusClass}"></span>
          <span>🎓 AI Tutor: <strong>${displayStatus}</strong></span>
          <span style="font-size:10px;margin-left:4px;opacity:0.8;">▲ Expand</span>
        </button>
      </div>
    `;
  }

  // Classification pill
  let classificationBadge = null;
  if (videoClassification) {
    const catLower = String(videoClassification.category || 'Educational').toLowerCase();
    const isPausedForEnt = !videoClassification.shouldActivateLearning && !userClassificationOverride;
    const overrideLabel = isPausedForEnt
      ? ' (Intervention Active — Click to Enable Learning)'
      : userClassificationOverride
        ? ' (User Override)'
        : '';
    const reasoningTitle = `${videoClassification.reasoning || ''} | Learning Potential: ${videoClassification.learningPotential || ''}`;

    classificationBadge = html`
      <button
        class="yt-learn-pill yt-learn-classification-pill ${catLower}"
        id="yt-learn-classification-btn"
        title=${reasoningTitle}
        onClick=${(e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          onOverrideClassification();
        }}
      >
        <span>${videoClassification.category || 'Educational'} (${videoClassification.educationalValue ?? 100}%)${overrideLabel}</span>
      </button>
    `;
  }

  // Subtitle options
  let sub2Options = [];
  if (availableTracks && availableTracks.length > 0) {
    sub2Options = [
      html`<option value="none" selected=${settings.secondarySubtitleLang === 'none'}>Sub 2: Off</option>`,
      ...availableTracks.map(
        (t) => html`
          <option
            value=${t.languageCode}
            selected=${settings.secondarySubtitleLang === t.languageCode}
          >
            ${t.name || t.languageCode} (${t.languageCode})${t.kind === 'asr' ? ' (Auto)' : ''}
          </option>
        `
      )
    ];
  } else {
    sub2Options = [
      html`<option value="none" selected=${settings.secondarySubtitleLang === 'none'}>Sub 2: Off</option>`,
      html`<option value="en" selected=${(settings.secondarySubtitleLang || 'en') === 'en'}>English (en)</option>`,
      html`<option value="de" selected=${settings.secondarySubtitleLang === 'de'}>German (de)</option>`,
      html`<option value="es" selected=${settings.secondarySubtitleLang === 'es'}>Spanish (es)</option>`,
      html`<option value="fr" selected=${settings.secondarySubtitleLang === 'fr'}>French (fr)</option>`,
      html`<option value="ja" selected=${settings.secondarySubtitleLang === 'ja'}>Japanese (ja)</option>`,
      html`<option value="zh-Hant" selected=${settings.secondarySubtitleLang === 'zh-Hant'}>Chinese (Traditional)</option>`
    ];
  }

  let sub1Options = [
    html`<option value="auto" selected=${settings.primarySubtitleLang === 'auto' || !settings.primarySubtitleLang}>Auto (Video Spoken Language)</option>`
  ];
  if (availableTracks && availableTracks.length > 0) {
    sub1Options = sub1Options.concat(
      availableTracks.map(
        (t) => html`
          <option
            value=${t.languageCode}
            selected=${settings.primarySubtitleLang === t.languageCode}
          >
            ${t.name || t.languageCode} (${t.languageCode})
          </option>
        `
      )
    );
  }

  const serverBadge = localServerConnected
    ? html`<span class="yt-learn-server-badge" title="Local Subtitle Server connected in terminal">🖥️</span>`
    : '';
  const serverTitle = localServerConnected ? ' [🖥️ Terminal Server Connected]' : '';

  return html`
    <div
      class="yt-learn-bar-expanded-wrapper"
      onClick=${handleContainerClick}
    >
      <div class="yt-learn-bar-left">
        <button
          class="yt-learn-fab"
          id="yt-learn-toggle-btn"
          title="Click to toggle AI Learning Assistant"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onToggleAi();
          }}
        >
          <span class="yt-learn-status-dot ${statusClass}" id="yt-learn-status-dot"></span>
          <span>AI Tutor: <strong>${displayStatus}</strong></span>
        </button>
        ${classificationBadge}
      </div>

      <div class="yt-learn-bar-right">
        <div class="yt-learn-dual-subs-group">
          <button
            class="yt-learn-icon-btn ${isDualOn ? 'active-toggle' : ''}"
            id="yt-learn-dual-subs-btn"
            title="Toggle 2nd Subtitle on/off (displayed alongside YouTube native subtitles)${serverTitle}"
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              onToggleDualSubs();
            }}
          >
            💬 2nd Sub: <strong>${isDualOn ? 'ON' : 'Off'}</strong>${serverBadge}
          </button>

          ${isDualOn
            ? html`
                <select
                  class="yt-learn-sub-dropdown yt-learn-sub2-dropdown"
                  id="yt-learn-sub2-select"
                  title="2nd Subtitle Language (Downloaded on demand from YouTube)"
                  onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
                  onChange=${(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    onSelectSub2(e.target.value);
                  }}
                >
                  ${sub2Options}
                </select>
                <select
                  class="yt-learn-sub-dropdown yt-learn-sub1-dropdown"
                  id="yt-learn-sub1-select"
                  style="display:none;"
                  title="Main Subtitle Track"
                  onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
                  onChange=${(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    onSelectSub1(e.target.value);
                  }}
                >
                  ${sub1Options}
                </select>
              `
            : ''}
        </div>

        <button
          class="yt-learn-icon-btn yt-learn-vocab-btn ${isVocabOn ? 'active-toggle' : (vocabCount > 0 ? 'active-vocab' : '')}"
          id="yt-learn-vocab-btn"
          title="Pre-video vocabulary prep: Click to open/toggle list"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onToggleVocab();
          }}
        >
          📖 Vocab: <strong>${isVocabOn ? 'ON' : 'Off'}</strong>${vocabCount > 0 ? html` <strong>(${vocabCount})</strong>` : ''}
        </button>

        <button
          class="yt-learn-icon-btn"
          id="yt-learn-now-btn"
          title="Generate activity for current section now"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onManualTrigger();
          }}
        >
          ⚡ Quiz Now
        </button>

        <button
          class="yt-learn-icon-btn ${activePanel === 'dashboard' ? 'is-active' : ''}"
          id="yt-learn-dashboard-btn"
          title="Learning Profile & Activity History"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onOpenDashboard();
          }}
        >
          📊 Progress
        </button>

        <button
          class="yt-learn-icon-btn ${activePanel === 'settings' ? 'is-active' : ''}"
          id="yt-learn-settings-btn"
          title="Assistant Settings & API Key"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onOpenSettings();
          }}
        >
          ⚙️ Settings
        </button>

        <button
          class="yt-learn-icon-btn yt-learn-collapse-bar-btn"
          id="yt-learn-collapse-bar-btn"
          title="Collapse Bar to Mini Pill"
          onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onToggleCollapse();
          }}
        >
          ▾
        </button>
      </div>
    </div>
  `;
}
