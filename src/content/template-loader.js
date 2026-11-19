/**
 * @fileoverview Pure HTML Template Loader (`template-loader.js`)
 *
 * Loads, caches, and renders pure `.html` template files for the YouTube AI Learning Assistant.
 * Keeps HTML completely separated from JS files.
 *
 * Supports:
 * - Chrome/Firefox Extension (preloads via fetch() from chrome.runtime.getURL)
 * - Node.js testing environment (loads via node:fs readFileSync)
 * - Fast, synchronous rendering using TemplateLoader.render('template-name.html', data)
 */

let nodeFs = null;
if (typeof process !== 'undefined' && process?.versions?.node) {
  try {
    nodeFs = await import('node:fs');
  } catch (err) {
    // Non-Node environment or restricted
  }
}

export const ALL_TEMPLATES = [
  'bar-collapsed.html',
  'bar-expanded.html',
  'bar-classification-pill.html',
  'timeline-marker.html',
  'activity-toast.html',
  'activity-overlay.html',
  'activity-minimized-pill.html',
  'activity-multiple-choice.html',
  'activity-short-answer.html',
  'activity-flashcard.html',
  'activity-teach-back.html',
  'activity-prediction.html',
  'activity-evaluation-card.html',
  'activity-mc-explanation.html',
  'activity-followup-chat.html',
  'settings-drawer.html',
  'dashboard-drawer.html',
  'dashboard-history-item.html',
  'vocabulary-drawer.html',
  'vocabulary-list-item.html',
  'vocabulary-empty.html',
  'dual-subtitles.html'
];

export class TemplateLoader {
  static cache = new Map();

  /**
   * Preloads all extension HTML templates in browser runtime.
   * @returns {Promise<void>}
   */
  static async preloadAll() {
    return TemplateLoader.preload(ALL_TEMPLATES);
  }

  /**
   * Preloads templates in browser extension runtime.
   * @param {string[]} templateNames
   * @returns {Promise<void>}
   */
  static async preload(templateNames = []) {
    const runtime =
      typeof browser !== 'undefined' && browser?.runtime
        ? browser.runtime
        : typeof chrome !== 'undefined' && chrome?.runtime
        ? chrome.runtime
        : null;

    if (!runtime || typeof fetch === 'undefined') return;

    await Promise.all(
      templateNames.map(async (name) => {
        if (TemplateLoader.cache.has(name)) return;
        try {
          const url = runtime.getURL(`src/templates/${name}`);
          const res = await fetch(url);
          if (res.ok) {
            const html = await res.text();
            TemplateLoader.cache.set(name, html);
          }
        } catch (err) {
          console.warn(`[TemplateLoader] Failed to preload template: ${name}`, err);
        }
      })
    );
  }

  /**
   * Synchronously retrieves raw HTML template string.
   * @param {string} name - e.g. 'bar-expanded.html'
   * @returns {string}
   */
  static get(name) {
    if (TemplateLoader.cache.has(name)) {
      return TemplateLoader.cache.get(name);
    }

    // In Node.js testing environment, load from disk synchronously
    if (nodeFs && typeof nodeFs.readFileSync === 'function') {
      try {
        const fileUrl = new URL(`../templates/${name}`, import.meta.url);
        const html = nodeFs.readFileSync(fileUrl, 'utf-8');
        TemplateLoader.cache.set(name, html);
        return html;
      } catch (err) {
        console.warn(`[TemplateLoader] Node readFileSync failed for ${name}:`, err.message);
      }
    }

    return '';
  }

  /**
   * Interpolates data into an HTML template: {{key}} -> data[key].
   * @param {string} name - Template file name (e.g. 'activity-overlay.html')
   * @param {Record<string, any>} [data] - Template parameters
   * @returns {string} Fully rendered HTML string
   */
  static render(name, data = {}) {
    const raw = TemplateLoader.get(name);
    if (!raw) return '';

    return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      const val = data[key];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  /**
   * Safely escapes HTML special characters.
   * @param {string} str
   * @returns {string}
   */
  static escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
