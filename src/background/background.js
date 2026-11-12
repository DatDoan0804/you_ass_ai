/**
 * @fileoverview Extension Background Service Worker (`background.js`)
 *
 * Responsibilities:
 * 1. Security Isolation: Holds the user's API key in extension storage and executes all external
 *    AI API requests (`generativelanguage.googleapis.com` or local LLM endpoints) from the privileged
 *    background context. The YouTube page DOM and main-world scripts NEVER have access to the API key.
 * 2. Stale Session Cancellation: Tracks active `videoId` and `sessionEpoch` per tab. When a user
 *    navigates to a new YouTube video (`ABORT_STALE_REQUESTS`), all in-flight `AbortController`
 *    instances for the previous video are immediately aborted so stale responses never leak.
 * 3. Persistent AI Caching: Checks an in-memory & storage cache before calling Gemini to minimize
 *    token usage and latency.
 */

import { Database } from '../storage/database.js';
import { createAIProvider } from '../ai/gemini-provider.js';

/** @type {Map<string, AbortController>} requestKey -> AbortController */
const inFlightControllers = new Map();

/** @type {Map<string, Promise<any>>} cacheKey -> in-flight AI request promise */
const inFlightAIRequests = new Map();

/** @type {Map<string, object>} cacheKey -> cached AI response payload */
const memoryCache = new Map();

/** @type {Map<number, {videoId: string, sessionEpoch: number}>} tabId -> active session state */
const activeTabSessions = new Map();

const runtimeApi = typeof browser !== 'undefined' && browser.runtime ? browser.runtime : chrome.runtime;

runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  const tabId = sender?.tab?.id ?? 0;

  handleMessage(message, tabId)
    .then((result) => sendResponse(result))
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err?.message || String(err),
        code: err?.code || 'BACKGROUND_ERROR'
      });
    });

  // Return true to keep the message channel open for async sendResponse
  return true;
});

/**
 * Handles incoming messages from the content script.
 * @param {object} message
 * @param {number} tabId
 */
async function handleMessage(message, tabId) {
  const { action, payload = {} } = message;

  switch (action) {
    case 'REGISTER_VIDEO_SESSION': {
      const { videoId, sessionEpoch } = payload;
      abortControllersForTab(tabId);
      activeTabSessions.set(tabId, { videoId, sessionEpoch });
      return { ok: true, videoId, sessionEpoch };
    }

    case 'ABORT_STALE_REQUESTS': {
      abortControllersForTab(tabId);
      return { ok: true };
    }

    case 'GET_SETTINGS': {
      const settings = await Database.getSettings();
      return { ok: true, data: settings };
    }

    case 'SAVE_SETTINGS': {
      const updated = await Database.saveSettings(payload.settings || {});
      return { ok: true, data: updated };
    }

    case 'FETCH_CAPTION_TRACK': {
      // Fetches a YouTube timedtext URL from background context if needed
      const { url } = payload;
      if (!url || !/^https?:\/\/([a-z0-9-]+\.)?(youtube(-nocookie)?\.com\/api\/timedtext|googlevideo\.com\/)/i.test(url)) {
        return { ok: false, status: 400, error: 'Invalid caption track URL.' };
      }
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          return { ok: false, status: res.status, error: `Caption fetch HTTP ${res.status}` };
        }
        const text = await res.text();
        return { ok: true, status: res.status, data: text };
      } catch (err) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            return { ok: false, status: res.status, error: `Caption fetch HTTP ${res.status}` };
          }
          const text = await res.text();
          return { ok: true, status: res.status, data: text };
        } catch (fetchErr) {
          return { ok: false, status: 0, error: fetchErr.message };
        }
      }
    }

    case 'FETCH_LOCAL_SUBTITLE': {
      const { videoId, lang = 'en', port = 8765 } = payload || {};
      if (!videoId) return { ok: false, error: 'Missing videoId' };
      const url = `http://127.0.0.1:${port}/subtitles?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for terminal yt-dlp downloads and translation
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          return { ok: false, status: res.status, error: `Local server returned ${res.status}` };
        }
        const data = await res.json();
        return { ok: true, data };
      } catch (err) {
        return { ok: false, isServerOffline: true, error: err.message };
      }
    }

    case 'CHECK_LOCAL_SUB_SERVER': {
      const { port = 8765 } = payload || {};
      const url = `http://127.0.0.1:${port}/health`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return { ok: false, status: res.status };
        const data = await res.json();
        return { ok: true, data };
      } catch {
        return { ok: false, error: 'Local server not running' };
      }
    }

    case 'AI_ANALYZE_SECTION':
    case 'AI_GENERATE_ACTIVITY':
    case 'AI_EVALUATE_ANSWER':
    case 'AI_EXPLAIN_CONCEPT':
    case 'AI_TUTOR_FOLLOW_UP':
    case 'AI_SYNTHESIZE_MILESTONE_TITLE':
    case 'AI_GENERATE_VIDEO_VOCABULARY':
    case 'AI_PLAN_BREAKPOINTS_AND_ACTIVITIES': {
      return executeAiRequest(tabId, action, payload);
    }

    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

/**
 * Executes an AI request with caching, AbortController lifecycle management, and
 * stale-video verification before and after the network call.
 */
async function executeAiRequest(tabId, action, payload) {
  const { videoId, sessionEpoch, cacheKey, promptSpec } = payload;

  // 1. Return cached response immediately if available
  if (cacheKey && memoryCache.has(cacheKey)) {
    return { ok: true, data: memoryCache.get(cacheKey), cached: true };
  }

  // 2. Deduplicate in-flight identical AI requests
  if (cacheKey && inFlightAIRequests.has(cacheKey)) {
    return await inFlightAIRequests.get(cacheKey);
  }

  // 3. Verify session is still current before starting network call
  const activeSession = activeTabSessions.get(tabId);
  if (
    activeSession &&
    (activeSession.videoId !== videoId || activeSession.sessionEpoch !== sessionEpoch)
  ) {
    return { ok: false, stale: true, error: 'Request discarded: video session changed.' };
  }

  const aiJob = (async () => {
    const settings = await Database.getSettings();
    const provider = createAIProvider(settings);

    const controller = new AbortController();
    const requestId = `${tabId}:${videoId}:${sessionEpoch}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    inFlightControllers.set(requestId, controller);

    try {
      const result = await provider.generateStructuredJSON({
        systemPrompt: promptSpec.systemPrompt,
        userPrompt: promptSpec.userPrompt,
        responseSchema: promptSpec.schema,
        temperature: action === 'AI_GENERATE_ACTIVITY' ? 0.35 : 0.2,
        signal: controller.signal
      });

      // 4. Re-verify session after async completion so a slow request never mutates a newly opened video
      const postSession = activeTabSessions.get(tabId);
      if (
        postSession &&
        (postSession.videoId !== videoId || postSession.sessionEpoch !== sessionEpoch)
      ) {
        return { ok: false, stale: true, error: 'Response discarded after completion: video changed.' };
      }

      if (cacheKey && result) {
        // Keep memory cache bounded to 250 entries
        if (memoryCache.size > 250) {
          const oldestKey = memoryCache.keys().next().value;
          memoryCache.delete(oldestKey);
        }
        memoryCache.set(cacheKey, result);
      }

      return { ok: true, data: result, cached: false };
    } finally {
      inFlightControllers.delete(requestId);
    }
  })();

  if (cacheKey) {
    inFlightAIRequests.set(cacheKey, aiJob);
  }

  try {
    return await aiJob;
  } finally {
    if (cacheKey) {
      inFlightAIRequests.delete(cacheKey);
    }
  }
}

/**
 * Aborts all in-flight AI requests associated with a given browser tab.
 * @param {number} tabId
 */
function abortControllersForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const [key, controller] of inFlightControllers.entries()) {
    if (key.startsWith(prefix)) {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors
      }
      inFlightControllers.delete(key);
    }
  }
}
