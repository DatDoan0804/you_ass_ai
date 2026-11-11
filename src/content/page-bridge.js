/**
 * @fileoverview Main-World Page Bridge (`page-bridge.js`)
 *
 * Runs in YouTube's Main JavaScript World (zero access to `browser.storage` or user API keys).
 * Extracts:
 * - Video ID, Title, Short Description, Author, Duration (falling back to `video.duration`)
 * - Caption tracks (`playerCaptionsTracklistRenderer.captionTracks`)
 * - Chapter markers from description timestamps AND YouTube's macroMarkersListEntity / DOM chapter panels
 */

(function initYouTubePageBridge() {
  const BRIDGE_SOURCE = 'YT_AI_LEARNING_BRIDGE';
  const REQUEST_EVENT = 'YT_AI_LEARNING_REQUEST_METADATA';

  let activeTimedtextBaseUrl = '';

  function findActiveTimedtextFromPerformance() {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
      return '';
    }
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i]?.name || '';
        if (name && (name.includes('/api/timedtext') || name.includes('/videoplayback?')) && !name.includes('tlang=')) {
          return name;
        }
      }
    } catch {}
    return '';
  }

  function extractPlayerMetadata() {
    try {
      const playerEl = document.getElementById('movie_player');
      const videoEl =
        document.querySelector('video.html5-main-video') || document.querySelector('video');
      let playerResponse = null;

      if (playerEl && typeof playerEl.getPlayerResponse === 'function') {
        playerResponse = playerEl.getPlayerResponse();
      }

      if (!playerResponse && window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
      }

      if (!playerResponse) {
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy && flexy.playerData) {
          playerResponse = flexy.playerData;
        }
      }

      const videoDetails = playerResponse?.videoDetails || {};
      let captionTracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        playerResponse?.captions?.playerCaptionsRenderer?.captionTracks ||
        [];

      let translationLanguages =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.translationLanguages ||
        playerResponse?.captions?.playerCaptionsRenderer?.translationLanguages ||
        [];

      // Fallback 1: Query YouTube Player API options directly
      if (captionTracks.length === 0 && playerEl && typeof playerEl.getOption === 'function') {
        try {
          const optTracks = playerEl.getOption('captions', 'tracklist');
          if (Array.isArray(optTracks) && optTracks.length > 0) {
            captionTracks = optTracks;
          }
        } catch {}
      }

      if (translationLanguages.length === 0 && playerEl && typeof playerEl.getOption === 'function') {
        try {
          const optLangs = playerEl.getOption('captions', 'translationLanguages');
          if (Array.isArray(optLangs) && optLangs.length > 0) {
            translationLanguages = optLangs;
          }
        } catch {}
      }

      // Fallback 2: Check window.ytInitialPlayerResponse if not checked yet
      if (captionTracks.length === 0 && window.ytInitialPlayerResponse?.captions) {
        captionTracks =
          window.ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
          window.ytInitialPlayerResponse.captions?.playerCaptionsRenderer?.captionTracks ||
          [];
      }

      if (translationLanguages.length === 0 && window.ytInitialPlayerResponse?.captions) {
        translationLanguages =
          window.ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.translationLanguages ||
          window.ytInitialPlayerResponse.captions?.playerCaptionsRenderer?.translationLanguages ||
          [];
      }

      const activePerfTimedtext = findActiveTimedtextFromPerformance();
      const detectedActiveBaseUrl = activeTimedtextBaseUrl || activePerfTimedtext;

      const title =
        videoDetails.title ||
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
        document.title.replace(/ - YouTube$/, '');

      const shortDescription =
        videoDetails.shortDescription ||
        document.querySelector('#description-inline-expander')?.textContent?.trim() ||
        '';

      const domDuration =
        videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0
          ? Math.round(videoEl.duration)
          : 0;
      const lengthSeconds = Number(videoDetails.lengthSeconds || domDuration || 0);

      const videoId =
        videoDetails.videoId || new URLSearchParams(window.location.search).get('v') || '';

      // 1. Parse chapters from description timestamps
      let chapters = parseChaptersFromDescription(shortDescription, lengthSeconds);

      // 2. Parse native chapters from window.ytInitialData (macroMarkers / engagementPanels)
      if (chapters.length === 0 && window.ytInitialData) {
        chapters = extractChaptersFromInitialData(window.ytInitialData, lengthSeconds);
      }

      // 3. Fallback: Parse chapters from YouTube DOM elements
      if (chapters.length === 0) {
        chapters = extractChaptersFromDOM(lengthSeconds);
      }

      // 4. Test harness fallback
      if (chapters.length === 0 && Array.isArray(window.__YT_LEARN_TEST_CHAPTERS__)) {
        chapters = window.__YT_LEARN_TEST_CHAPTERS__;
      }

      return {
        videoId,
        title,
        shortDescription,
        author: videoDetails.author || '',
        lengthSeconds,
        activeTimedtextBaseUrl: detectedActiveBaseUrl,
        captionTracks: captionTracks
          .filter((t) => Boolean(t.baseUrl || detectedActiveBaseUrl))
          .map((t) => ({
            baseUrl: t.baseUrl || detectedActiveBaseUrl || '',
            languageCode: t.languageCode,
            name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageName || t.displayName || t.languageCode,
            kind: t.kind || 'standard',
            isTranslatable: t.isTranslatable !== false
          })),
        translationLanguages: translationLanguages.map((tl) => ({
          languageCode: tl.languageCode,
          name: tl.languageName?.simpleText || tl.languageName?.runs?.[0]?.text || tl.displayName || tl.languageCode
        })),
        chapters
      };
    } catch (err) {
      return {
        error: err.message,
        videoId: new URLSearchParams(window.location.search).get('v') || '',
        captionTracks: [],
        chapters: []
      };
    }
  }

  /**
   * Parses timestamp lines like `0:00 Intro`, `0:20 First chapter` from the video description.
   * @param {string} description
   * @param {number} totalDuration
   */
  function parseChaptersFromDescription(description, totalDuration) {
    if (!description) return [];
    const lines = description.split('\n');
    const timestampRegex = /(?:^|\s)(\d{1,2}:)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+)$/;
    const rawChapters = [];

    for (const line of lines) {
      const match = line.trim().match(timestampRegex);
      if (match) {
        const hours = match[1] ? parseInt(match[1].replace(':', ''), 10) : 0;
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const startSeconds = hours * 3600 + minutes * 60 + seconds;
        const label = match[4].trim();
        if (label && (!totalDuration || startSeconds < totalDuration)) {
          rawChapters.push({ start: startSeconds, title: label });
        }
      }
    }

    rawChapters.sort((a, b) => a.start - b.start);
    return rawChapters.map((ch, idx) => ({
      index: idx,
      start: ch.start,
      end: rawChapters[idx + 1]
        ? rawChapters[idx + 1].start
        : totalDuration > ch.start
        ? totalDuration
        : ch.start + 60,
      title: ch.title
    }));
  }

  function parseTimestampToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = String(timeStr).trim().split(':').map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function extractChaptersFromInitialData(data, totalDuration = 0) {
    if (!data || typeof data !== 'object') return [];
    const chapters = [];
    const seen = new Set();

    function recurse(node) {
      if (!node || typeof node !== 'object') return;
      if (node.macroMarkersListItemRenderer) {
        const m = node.macroMarkersListItemRenderer;
        const title =
          m.title?.simpleText ||
          m.title?.runs?.[0]?.text ||
          '';
        const timeDesc =
          m.timeDescription?.simpleText ||
          m.timeDescription?.runs?.[0]?.text ||
          '';
        if (title && timeDesc) {
          const start = parseTimestampToSeconds(timeDesc);
          const key = `${start}_${title.trim().toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            chapters.push({ title: title.trim(), start });
          }
        }
      }
      if (node.chapterRenderer) {
        const cr = node.chapterRenderer;
        const title = cr.title?.simpleText || cr.title?.runs?.[0]?.text || '';
        const start = Math.round(Number(cr.timeRangeStartMillis || 0) / 1000);
        if (title) {
          const key = `${start}_${title.trim().toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            chapters.push({ title: title.trim(), start });
          }
        }
      }
      if (Array.isArray(node)) {
        for (const item of node) recurse(item);
      } else {
        for (const val of Object.values(node)) recurse(val);
      }
    }

    recurse(data);
    if (chapters.length === 0) return [];

    chapters.sort((a, b) => a.start - b.start);
    return chapters.map((ch, idx) => ({
      index: idx,
      start: ch.start,
      end: chapters[idx + 1]
        ? chapters[idx + 1].start
        : totalDuration > ch.start
        ? totalDuration
        : ch.start + 60,
      title: ch.title
    }));
  }

  function extractChaptersFromDOM(totalDuration = 0) {
    if (typeof document === 'undefined') return [];
    const elements = document.querySelectorAll(
      'ytd-macro-markers-list-item-renderer, ytd-chapter-renderer, .ytd-macro-markers-list-item-renderer'
    );
    if (!elements || elements.length === 0) return [];
    const chapters = [];
    const seen = new Set();

    elements.forEach((el) => {
      const titleEl =
        el.querySelector('#details h4') ||
        el.querySelector('.macro-markers') ||
        el.querySelector('h4') ||
        el.querySelector('#title');
      const timeEl =
        el.querySelector('#time') ||
        el.querySelector('.ytd-thumbnail-overlay-time-status-renderer') ||
        el.querySelector('.macro-markers-time-description');

      const title = titleEl?.textContent?.trim() || '';
      const timeStr = timeEl?.textContent?.trim() || '';
      if (title && timeStr) {
        const start = parseTimestampToSeconds(timeStr);
        const key = `${start}_${title.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          chapters.push({ title, start });
        }
      }
    });

    if (chapters.length === 0) return [];
    chapters.sort((a, b) => a.start - b.start);
    return chapters.map((ch, idx) => ({
      index: idx,
      start: ch.start,
      end: chapters[idx + 1]
        ? chapters[idx + 1].start
        : totalDuration > ch.start
        ? totalDuration
        : ch.start + 60,
      title: ch.title
    }));
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === REQUEST_EVENT) {
      const metadata = extractPlayerMetadata();
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          requestId: event.data.requestId,
          metadata,
          payload: metadata
        },
        '*'
      );
      return;
    }

    if (event.data.type === 'YT_AI_LEARNING_FETCH_TIMEDTEXT') {
      const { requestId, url } = event.data;
      if (!url || typeof url !== 'string' || (!url.includes('/api/timedtext') && !url.includes('/videoplayback?'))) {
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            requestId,
            ok: false,
            status: 400,
            error: 'Invalid timedtext URL'
          },
          '*'
        );
        return;
      }

      try {
        const res = await window.fetch(url, { credentials: 'same-origin' });
        const data = await res.text();
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            requestId,
            ok: res.ok,
            status: res.status,
            data
          },
          '*'
        );
      } catch (err) {
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            requestId,
            ok: false,
            error: err.message
          },
          '*'
        );
      }
      return;
    }
  });
})();
