/**
 * @fileoverview Content Script Bootstrap Loader (`loader.js`)
 *
 * Responsibilities:
 * 1. Injects `src/content/page-bridge.js` into YouTube's Main JavaScript World.
 * 2. Waits for the `onload` signal of `page-bridge.js` (with a safety timeout) BEFORE
 *    importing `src/content/index.js`, eliminating the race condition where the first
 *    `YT_AI_LEARNING_REQUEST_METADATA` postMessage was fired before `page-bridge.js`
 *    had registered its `window.addEventListener('message')` listener.
 */

(async function bootstrapContentScript() {
  try {
    const runtime =
      typeof browser !== 'undefined' && browser.runtime ? browser.runtime : chrome.runtime;

    await new Promise((resolve) => {
      const existing = document.getElementById('yt-ai-learning-page-bridge');
      if (existing && existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      const script = existing || document.createElement('script');
      script.id = 'yt-ai-learning-page-bridge';
      script.src = runtime.getURL('src/content/page-bridge.js');
      script.async = false;

      const timer = setTimeout(resolve, 400);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        script.dataset.loaded = 'true';
        resolve();
      });
      script.addEventListener('error', () => {
        clearTimeout(timer);
        resolve();
      });

      if (!existing) {
        (document.head || document.documentElement).appendChild(script);
      }
    });

    const mainModuleUrl = runtime.getURL('src/content/index.js');
    await import(mainModuleUrl);
  } catch (err) {
    console.error('[YT-Learn Loader] Failed to initialize extension modules:', err);
  }
})();
