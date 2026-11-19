/**
 * @fileoverview SettingsDrawer Component (Preact)
 * Renders configuration drawer for API keys, AI model selection, breakpoint spacing,
 * subtitle preferences, and active learning settings.
 */

import { html, useSafeState } from './render-helper.js';

export function SettingsDrawer({
  settings = {},
  availableTracks = [],
  onClose = () => {},
  onSave = async () => {}
}) {
  const [provider, setProvider] = useSafeState(settings.provider || 'gemini');
  const [apiKey, setApiKey] = useSafeState(settings.apiKey || '');
  const [model, setModel] = useSafeState(settings.model || 'gemini-3.5-flash-lite');
  const [enableVocabularyPrep, setEnableVocabularyPrep] = useSafeState(
    Boolean(settings.enableVocabularyPrep)
  );
  const [breakFrequency, setBreakFrequency] = useSafeState(settings.breakFrequency || 'medium');
  const [minIntervalSeconds, setMinIntervalSeconds] = useSafeState(
    Number(settings.minIntervalSeconds || 300)
  );
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useSafeState(
    Number(settings.maxIntervalSeconds || 600)
  );
  const [useYoutubeChapters, setUseYoutubeChapters] = useSafeState(
    settings.useYoutubeChapters !== false
  );
  const [useAiBreakpoints, setUseAiBreakpoints] = useSafeState(
    settings.useAiBreakpoints !== false
  );
  const [autoPause, setAutoPause] = useSafeState(settings.autoPause !== false);
  const [skipMinorActivities, setSkipMinorActivities] = useSafeState(
    Boolean(settings.skipMinorActivities)
  );
  const [enableNonEducationalIntervention, setEnableNonEducationalIntervention] = useSafeState(
    settings.enableNonEducationalIntervention !== false
  );
  const [enableDualSubtitles, setEnableDualSubtitles] = useSafeState(
    settings.enableDualSubtitles !== false
  );
  const [secondarySubtitleLang, setSecondarySubtitleLang] = useSafeState(
    settings.secondarySubtitleLang || 'en'
  );
  const [subtitleFontSize, setSubtitleFontSize] = useSafeState(
    settings.subtitleFontSize || 'medium'
  );
  const [primarySubtitleLang, setPrimarySubtitleLang] = useSafeState(
    settings.primarySubtitleLang || 'auto'
  );
  const [hideNativeSubtitles, setHideNativeSubtitles] = useSafeState(
    Boolean(settings.hideNativeSubtitles)
  );
  const [saveStatus, setSaveStatus] = useSafeState('');

  const handleSave = async () => {
    const updated = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || 'gemini-3.5-flash-lite',
      enableVocabularyPrep,
      breakFrequency,
      minIntervalSeconds: Math.max(60, Number(minIntervalSeconds) || 300),
      maxIntervalSeconds: Math.max(120, Number(maxIntervalSeconds) || 600),
      useYoutubeChapters,
      useAiBreakpoints,
      autoPause,
      skipMinorActivities,
      enableNonEducationalIntervention,
      enableDualSubtitles,
      primarySubtitleLang: primarySubtitleLang || 'auto',
      secondarySubtitleLang: secondarySubtitleLang || 'en',
      subtitleFontSize: subtitleFontSize || 'medium',
      hideNativeSubtitles
    };

    setSaveStatus('Saving...');
    await onSave(updated);
    setSaveStatus('✓ Saved!');
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return html`
    <div
      class="yt-learn-overlay-backdrop"
      onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
    >
      <div
        class="yt-learn-card yt-learn-settings-card"
        onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
      >
        <div class="yt-learn-card-header">
          <div class="yt-learn-card-title-group">
            <span class="yt-learn-card-icon">⚙️</span>
            <h3 class="yt-learn-card-title">Assistant Settings</h3>
          </div>
          <button
            class="yt-learn-btn yt-learn-btn-ghost"
            id="yt-learn-settings-close"
            aria-label="Close"
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div class="yt-learn-card-body yt-learn-settings-body">
          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-provider">AI Provider</label>
            <select
              class="yt-learn-select"
              id="yt-set-provider"
              value=${provider}
              onChange=${(e) => setProvider(e.target.value)}
            >
              <option value="gemini" selected=${provider === 'gemini'}>Google Gemini API</option>
              <option value="openai-compatible" selected=${provider === 'openai-compatible'}>
                OpenAI-Compatible (Ollama / Local LLM)
              </option>
            </select>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-apikey">API Key</label>
            <input
              type="password"
              class="yt-learn-input"
              id="yt-set-apikey"
              placeholder="AIzaSy..."
              value=${apiKey}
              onInput=${(e) => setApiKey(e.target.value)}
            />
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-model">Model Name</label>
            <input
              type="text"
              class="yt-learn-input"
              id="yt-set-model"
              placeholder="gemini-3.5-flash-lite"
              value=${model}
              onInput=${(e) => setModel(e.target.value)}
            />
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-vocab-prep"
                checked=${enableVocabularyPrep}
                onChange=${(e) => setEnableVocabularyPrep(e.target.checked)}
              />
              <span>Enable Pre-Video Vocabulary Preparation</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-freq">Break Frequency</label>
            <select
              class="yt-learn-select"
              id="yt-set-freq"
              value=${breakFrequency}
              onChange=${(e) => setBreakFrequency(e.target.value)}
            >
              <option value="low" selected=${breakFrequency === 'low'}>Low (Fewer checks)</option>
              <option value="medium" selected=${breakFrequency === 'medium'}>Medium (Recommended)</option>
              <option value="high" selected=${breakFrequency === 'high'}>High (Intense practice)</option>
            </select>
          </div>

          <div class="yt-learn-form-row" style="display:flex;gap:12px;">
            <div class="yt-learn-form-group" style="flex:1;">
              <label class="yt-learn-label" for="yt-set-min">Min Interval (sec)</label>
              <input
                type="number"
                class="yt-learn-input"
                id="yt-set-min"
                min="60"
                step="30"
                value=${minIntervalSeconds}
                onInput=${(e) => setMinIntervalSeconds(e.target.value)}
              />
            </div>
            <div class="yt-learn-form-group" style="flex:1;">
              <label class="yt-learn-label" for="yt-set-max">Max Interval (sec)</label>
              <input
                type="number"
                class="yt-learn-input"
                id="yt-set-max"
                min="120"
                step="30"
                value=${maxIntervalSeconds}
                onInput=${(e) => setMaxIntervalSeconds(e.target.value)}
              />
            </div>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-chapters"
                checked=${useYoutubeChapters}
                onChange=${(e) => setUseYoutubeChapters(e.target.checked)}
              />
              <span>Use YouTube Chapters for Breakpoints</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-aibp"
                checked=${useAiBreakpoints}
                onChange=${(e) => setUseAiBreakpoints(e.target.checked)}
              />
              <span>Use AI Semantic Breakpoint Detection</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-autopause"
                checked=${autoPause}
                onChange=${(e) => setAutoPause(e.target.checked)}
              />
              <span>Auto-Pause Video at Breakpoints</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-skipminor"
                checked=${skipMinorActivities}
                onChange=${(e) => setSkipMinorActivities(e.target.checked)}
              />
              <span>Skip Minor Activities</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-intervention"
                checked=${enableNonEducationalIntervention}
                onChange=${(e) => setEnableNonEducationalIntervention(e.target.checked)}
              />
              <span>Non-Educational Video Intervention</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-checkbox-label">
              <input
                type="checkbox"
                id="yt-set-dualsubs"
                checked=${enableDualSubtitles}
                onChange=${(e) => setEnableDualSubtitles(e.target.checked)}
              />
              <span>Enable Companion Dual Subtitles Overlay</span>
            </label>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-secondary-lang">Companion (2nd) Subtitle Language</label>
            <select
              class="yt-learn-select"
              id="yt-set-secondary-lang"
              value=${secondarySubtitleLang}
              onChange=${(e) => setSecondarySubtitleLang(e.target.value)}
            >
              <option value="none" selected=${secondarySubtitleLang === 'none'}>Sub 2: Off</option>
              ${availableTracks.length > 0
                ? availableTracks.map(
                    (t) => html`
                      <option
                        value=${t.languageCode}
                        selected=${secondarySubtitleLang === t.languageCode}
                      >
                        ${t.name || t.languageCode} (${t.languageCode})${t.kind === 'asr' ? ' (Auto)' : ''}
                      </option>
                    `
                  )
                : html`<option value="none" disabled>No tracks available for current video</option>`}
            </select>
          </div>

          <div class="yt-learn-form-group">
            <label class="yt-learn-label" for="yt-set-sub-size">Subtitle Font Size</label>
            <select
              class="yt-learn-select"
              id="yt-set-sub-size"
              value=${subtitleFontSize}
              onChange=${(e) => setSubtitleFontSize(e.target.value)}
            >
              <option value="small" selected=${subtitleFontSize === 'small'}>Small</option>
              <option value="medium" selected=${subtitleFontSize === 'medium'}>Medium</option>
              <option value="large" selected=${subtitleFontSize === 'large'}>Large</option>
            </select>
          </div>

          <!-- Hidden inputs for backward compatibility -->
          <input type="hidden" id="yt-set-primary-lang" value=${primarySubtitleLang} />
          <input
            type="checkbox"
            id="yt-set-hidenative"
            style="display:none;"
            checked=${hideNativeSubtitles}
          />
        </div>

        <div class="yt-learn-card-footer" style="display:flex;justify-content:space-between;align-items:center;">
          <span class="yt-learn-save-msg" id="yt-learn-save-msg" style="color:#10b981;font-weight:600;">
            ${saveStatus}
          </span>
          <button
            class="yt-learn-btn yt-learn-btn-primary"
            id="yt-learn-settings-save"
            type="button"
            onClick=${(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              handleSave();
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  `;
}
