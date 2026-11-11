/**
 * @fileoverview Local Subtitle Server for YouTube AI Learning Assistant (`server/subtitle-server.js`)
 *
 * Runs in the terminal as a local companion service.
 * Responsibilities:
 * 1. Serves subtitle files directly to the YouTube browser extension with ZERO YouTube 429 blocks.
 * 2. Checks local disk cache (`./subtitles_cache/`) for pre-downloaded or user-provided subtitles (.vtt, .srt, .json).
 * 3. On-demand subtitle downloading via terminal `yt-dlp` when requested by the extension.
 * 4. Parses VTT / SRT files into standard `{ start, end, text }` cues and sends JSON to the browser extension.
 *
 * Usage:
 *   node server/subtitle-server.js
 *   npm run server
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.resolve(ROOT_DIR, 'subtitles_cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = '127.0.0.1';

/**
 * Parses WebVTT or SubRip (SRT) format into normalized cue objects.
 * @param {string} content - Raw VTT or SRT string
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function parseVttOrSrt(content) {
  if (!content || typeof content !== 'string') return [];
  const cues = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let currentStart = null;
  let currentEnd = null;
  let currentText = [];

  const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  const parseSec = (hh, mm, ss, ms) => {
    const h = hh ? parseInt(hh, 10) : 0;
    const m = parseInt(mm, 10);
    const s = parseInt(ss, 10);
    const millis = parseInt(ms, 10);
    return Number((h * 3600 + m * 60 + s + millis / 1000).toFixed(2));
  };

  const cleanText = (raw) => {
    return raw
      .replace(/<[^>]+>/g, '') // remove HTML/VTT tags like <c>, <b>, <v>
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(timeRegex);
    if (match) {
      if (currentStart !== null && currentText.length > 0) {
        const text = cleanText(currentText.join(' '));
        if (text) {
          cues.push({ start: currentStart, end: currentEnd, text });
        }
        currentText = [];
      }
      currentStart = parseSec(match[1], match[2], match[3], match[4]);
      currentEnd = parseSec(match[5], match[6], match[7], match[8]);
    } else if (
      currentStart !== null &&
      line &&
      !/^\d+$/.test(line) &&
      !line.startsWith('NOTE') &&
      !line.startsWith('WEBVTT') &&
      !line.startsWith('Kind:') &&
      !line.startsWith('Language:')
    ) {
      currentText.push(line);
    }
  }

  if (currentStart !== null && currentText.length > 0) {
    const text = cleanText(currentText.join(' '));
    if (text) {
      cues.push({ start: currentStart, end: currentEnd, text });
    }
  }

  return cues;
}

/**
 * Searches local cache directory for any matching subtitle file.
 */
export function findInCache(videoId, lang = 'en') {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs.readdirSync(CACHE_DIR);
  const cleanVid = videoId.toLowerCase();
  const cleanLang = (lang || 'en').toLowerCase().split('-')[0];

  // 1. Exact match: <videoId>.<lang>.vtt / .srt / .json
  const exactCandidates = [
    `${videoId}.${lang}.vtt`,
    `${videoId}.${lang}.srt`,
    `${videoId}.${lang}.json`,
    `${videoId}.${cleanLang}.vtt`,
    `${videoId}.${cleanLang}.srt`
  ];

  for (const candidate of exactCandidates) {
    const fullPath = path.join(CACHE_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size > 80) {
          return { filePath: fullPath, matchedLang: lang };
        }
      } catch (_) {}
    }
  }

  // 2. Auto-generated / translated suffix match: e.g. <videoId>.<lang>-en.vtt or <videoId>.*<lang>*.vtt
  const matched = files.find((f) => {
    const lower = f.toLowerCase();
    if (!lower.startsWith(cleanVid)) return false;
    const isLangMatch = lower.includes(`.${cleanLang}.`) || lower.includes(`.${cleanLang}-`) || lower.endsWith(`.${cleanLang}.vtt`) || lower.endsWith(`.${cleanLang}.srt`);
    if (!isLangMatch) return false;
    try {
      const stats = fs.statSync(path.join(CACHE_DIR, f));
      return stats.size > 80;
    } catch (_) {
      return false;
    }
  });

  if (matched) {
    return { filePath: path.join(CACHE_DIR, matched), matchedLang: lang };
  }

  return null;
}

/**
 * Finds ANY subtitle file for videoId in local cache (used for translation fallback).
 * @param {string} videoId
 * @returns {{filePath: string, matchedLang: string}|null}
 */
export function findAnyInCache(videoId) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs.readdirSync(CACHE_DIR);
  const cleanVid = (videoId || '').trim().toLowerCase();

  const match = files.find((f) => {
    const fl = f.toLowerCase();
    if (!fl.startsWith(cleanVid)) return false;
    if (!fl.endsWith('.vtt') && !fl.endsWith('.srt') && !fl.endsWith('.json')) return false;
    try {
      const stats = fs.statSync(path.join(CACHE_DIR, f));
      return stats.size > 80;
    } catch (_) {
      return false;
    }
  });

  if (!match) return null;

  const parts = match.split('.');
  const matchedLang = parts.length >= 3 ? parts[parts.length - 2] : 'auto';
  return { filePath: path.join(CACHE_DIR, match), matchedLang };
}

/**
 * Translates an array of texts into target language using Google Translate API.
 * Batches lines with POST requests and handles 429 rate limits gracefully.
 * @param {string[]} texts
 * @param {string} targetLang
 * @returns {Promise<string[]>}
 */
export async function translateTexts(texts, targetLang = 'en') {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const batchSize = 60;
  const translated = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    const combined = chunk.join('\n');
    let success = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: `q=${encodeURIComponent(combined)}`,
          signal: AbortSignal.timeout(12000)
        });

        if (res.status === 429) {
          console.warn(`[LocalServer] Translate endpoint HTTP 429 rate limit. Waiting 2000ms...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const translatedChunkText = (data && data[0]) ? data[0].map((item) => item[0]).join('') : '';
        const translatedLines = translatedChunkText.split('\n');
        for (let j = 0; j < chunk.length; j++) {
          translated.push((translatedLines[j] || '').trim() || chunk[j]);
        }
        success = true;
        break;
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
        } else {
          console.warn(`[LocalServer] Batch translation failed (${err.message}). Preserving original text.`);
        }
      }
    }

    if (!success) {
      for (const line of chunk) {
        translated.push(line);
      }
    }

    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return translated;
}

/**
 * Translates cue objects to target language.
 * @param {Array<{start: number, end: number, text: string}>} cues
 * @param {string} targetLang
 * @returns {Promise<Array<{start: number, end: number, text: string}>>}
 */
export async function translateCues(cues, targetLang = 'en') {
  if (!Array.isArray(cues) || cues.length === 0) return [];
  const texts = cues.map((c) => c.text);
  const translatedTexts = await translateTexts(texts, targetLang);
  return cues.map((cue, idx) => ({
    start: cue.start,
    end: cue.end,
    text: translatedTexts[idx] || cue.text
  }));
}

/**
 * Converts array of cue objects to standard WebVTT text.
 * @param {Array<{start: number, end: number, text: string}>} cues
 * @returns {string}
 */
export function cuesToVtt(cues) {
  let out = 'WEBVTT\n\n';
  const formatTime = (sec) => {
    const totalMs = Math.round(sec * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  for (const cue of cues) {
    out += `${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.text}\n\n`;
  }
  return out;
}

/**
 * Executes yt-dlp command.
 * @param {string} videoId
 * @param {string[]} extraArgs
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runYtDlp(videoId, extraArgs = []) {
  return new Promise((resolve) => {
    const outputTemplate = path.join(CACHE_DIR, `${videoId}.%(ext)s`);
    const args = [
      '--skip-download',
      '--sub-format', 'vtt/srt/best',
      '-o', outputTemplate,
      ...extraArgs,
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    if (fs.existsSync('/usr/bin/node')) {
      args.unshift('--js-runtimes', 'node:/usr/bin/node');
    }

    console.log(`[LocalServer] Executing in terminal: yt-dlp ${args.join(' ')}`);

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      console.error(`[LocalServer] Failed to spawn yt-dlp: ${err.message}`);
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

/** @type {Map<string, Promise<{filePath: string, matchedLang: string}|null>>} */
const inFlightDownloads = new Map();

/** @type {Map<string, number>} cacheKey -> expiresAt timestamp */
const negativeSubCache = new Map();

/**
 * Invokes yt-dlp in terminal to download subtitles for a video.
 * Uses native download + fast translation to guarantee 0 HTTP 429 blocks.
 * Deduplicates in-flight calls and implements negative caching.
 * @param {string} videoId
 * @param {string} lang
 * @returns {Promise<{filePath: string, matchedLang: string}|null>}
 */
export async function downloadSubtitlesWithYtDlp(videoId, lang = 'en') {
  const cleanLang = (lang || 'en').toLowerCase().split('-')[0];
  const cacheKey = `${videoId}:${cleanLang}`;

  // 1. Check local cache first (0 network calls)
  const cached = findInCache(videoId, lang);
  if (cached) return cached;

  // 2. Negative cache: if this video+lang failed in the last 45s, skip to prevent hammering
  const failedUntil = negativeSubCache.get(cacheKey);
  if (failedUntil && Date.now() < failedUntil) {
    return null;
  }

  // 3. In-flight request deduplication: return existing pending promise if already downloading
  if (inFlightDownloads.has(cacheKey)) {
    return await inFlightDownloads.get(cacheKey);
  }

  const downloadJob = (async () => {
    // Discover video's original language in ~1 second via yt-dlp metadata
    let videoLang = '';
    try {
      const detectArgs = ['--print', '%(language)s', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`];
      if (fs.existsSync('/usr/bin/node')) {
        detectArgs.unshift('--js-runtimes', 'node:/usr/bin/node');
      }
      const { stdout } = await new Promise((res) => {
        const p = spawn('yt-dlp', detectArgs);
        let out = '';
        p.stdout.on('data', (d) => { out += d.toString(); });
        p.on('close', () => res({ stdout: out }));
        p.on('error', () => res({ stdout: '' }));
      });
      const rawLang = stdout.trim().split('\n')[0].trim();
      if (rawLang && rawLang !== 'NA' && rawLang !== 'null') {
        videoLang = rawLang.toLowerCase().split('-')[0];
      }
    } catch (_) {}

    if (!videoLang) {
      videoLang = cleanLang;
    }

    // If target language matches video native language, download direct + auto-subs in one fast shot
    if (cleanLang === videoLang) {
      console.log(`[LocalServer] Video native language matches requested language '${lang}'. Downloading direct + auto captions...`);
      await runYtDlp(videoId, [
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        `${cleanLang}-orig,${cleanLang}.*,${cleanLang},${lang}`
      ]);

      const directMatch = findInCache(videoId, lang);
      if (directMatch) {
        console.log(`[LocalServer] Direct native subtitle found: ${path.basename(directMatch.filePath)}`);
        return directMatch;
      }
    } else {
      // Target language is DIFFERENT from video native language (e.g. German video requested in English or Vietnamese)
      // First try downloading authored OR auto-generated subtitle in target language:
      console.log(`[LocalServer] Checking for '${lang}' subtitles...`);
      await runYtDlp(videoId, [
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        `${cleanLang}.*,${cleanLang},${lang}`
      ]);
      const directMatch = findInCache(videoId, lang);
      if (directMatch) {
        console.log(`[LocalServer] Authored/auto '${lang}' subtitle found: ${path.basename(directMatch.filePath)}`);
        return directMatch;
      }

      // If no subtitle in target language, download ONLY the video's native spoken captions (NO ',all,'!)
      console.log(`[LocalServer] Downloading video native language captions (${videoLang}) for translation to '${lang}'...`);
      await runYtDlp(videoId, [
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        `${videoLang}-orig,${videoLang}.*,${videoLang}`
      ]);
    }

    // Find any available subtitle for this video in cache
    let nativeSub = findInCache(videoId, lang) || findAnyInCache(videoId);
    if (!nativeSub) {
      console.warn(`[LocalServer] No subtitles found for videoId=${videoId}`);
      return null;
    }

    // If native subtitle is already in requested language, return it
    if (nativeSub.matchedLang === lang || nativeSub.matchedLang.startsWith(cleanLang)) {
      return nativeSub;
    }

    // Translate native subtitle to target language using batch POST translator
    console.log(`[LocalServer] Translating native subtitle (${path.basename(nativeSub.filePath)}) to '${lang}'...`);
    const rawCues = loadSubtitleFile(nativeSub.filePath);
    if (!rawCues || rawCues.length === 0) {
      return nativeSub;
    }

    const translatedCues = await translateCues(rawCues, lang);
    const targetPath = path.join(CACHE_DIR, `${videoId}.${lang}.vtt`);
    fs.writeFileSync(targetPath, cuesToVtt(translatedCues), 'utf8');
    console.log(`[LocalServer] Successfully translated and cached: ${path.basename(targetPath)}`);

    return { filePath: targetPath, matchedLang: lang };
  })();

  inFlightDownloads.set(cacheKey, downloadJob);
  try {
    const result = await downloadJob;
    if (!result) {
      negativeSubCache.set(cacheKey, Date.now() + 45000); // Negative cache for 45 seconds
    }
    return result;
  } finally {
    inFlightDownloads.delete(cacheKey);
  }
}

/**
 * Loads and parses subtitle file into cue array.
 */
export function loadSubtitleFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (filePath.endsWith('.json')) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.cues)) return data.cues;
      if (Array.isArray(data)) return data;
    }
    return parseVttOrSrt(raw);
  } catch (err) {
    console.error(`[LocalServer] Failed to read ${filePath}: ${err.message}`);
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  // Set CORS headers for browser extension communication
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = reqUrl.pathname;

  // Route 1: Health check
  if (pathname === '/health' || pathname === '/') {
    const cachedFiles = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        status: 'running',
        service: 'YouTube Local Subtitle Server',
        port: PORT,
        cachedCount: cachedFiles.length,
        cacheDirectory: CACHE_DIR
      })
    );
    return;
  }

  // Route 2: Get subtitles for videoId and lang
  if (pathname === '/subtitles' && req.method === 'GET') {
    const videoId = reqUrl.searchParams.get('videoId');
    const lang = reqUrl.searchParams.get('lang') || 'en';

    if (!videoId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing videoId parameter' }));
      return;
    }

    console.log(`[LocalServer] Extension requested subtitle: videoId=${videoId}, lang=${lang}`);

    // 1. Check local cache first (0 network calls)
    let cached = findInCache(videoId, lang);

    // 2. If not found in cache, download via yt-dlp in terminal
    if (!cached) {
      console.log(`[LocalServer] Not in local cache. Downloading in terminal via yt-dlp...`);
      cached = await downloadSubtitlesWithYtDlp(videoId, lang);
    }

    if (cached) {
      const cues = loadSubtitleFile(cached.filePath);
      if (cues && cues.length > 0) {
        console.log(`[LocalServer] Sending ${cues.length} cues for [${videoId} / ${lang}] to YouTube extension.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            source: 'local-server',
            videoId,
            lang: cached.matchedLang || lang,
            filePath: path.basename(cached.filePath),
            cues,
            trackInfo: {
              languageCode: cached.matchedLang || lang,
              name: `Local Sub (${(cached.matchedLang || lang).toUpperCase()})`,
              source: 'terminal-download'
            }
          })
        );
        return;
      }
    }

    // 3. Subtitle not available
    console.log(`[LocalServer] No subtitle found for videoId=${videoId}, lang=${lang}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: `Subtitle not found for videoId=${videoId}, lang=${lang}`,
        hint: `You can drop any .vtt or .srt file into subtitles_cache/${videoId}.${lang}.vtt`
      })
    );
    return;
  }

  // Route 3: Manual upload / post subtitle
  if (pathname === '/subtitles' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { videoId, lang = 'en', content, cues } = payload;
        if (!videoId || (!content && !cues)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing videoId or subtitle content' }));
          return;
        }

        const outPath = path.join(CACHE_DIR, `${videoId}.${lang}.vtt`);
        if (content) {
          fs.writeFileSync(outPath, content, 'utf8');
        } else if (Array.isArray(cues)) {
          fs.writeFileSync(path.join(CACHE_DIR, `${videoId}.${lang}.json`), JSON.stringify({ cues }, null, 2), 'utf8');
        }

        console.log(`[LocalServer] Saved manual subtitle for ${videoId} (${lang}) to cache.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: true, path: outPath }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Route 4: List cached subtitles
  if (pathname === '/list') {
    const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, files }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Endpoint not found' }));
});

const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));
const PID_FILE = path.resolve(ROOT_DIR, 'server', 'server.pid');

if (isDirectRun && process.env.NODE_ENV !== 'test' && !process.env.YT_LEARN_NO_LISTEN) {
  server.on('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      try {
        const res = await fetch(`http://${HOST}:${PORT}/health`);
        if (res.ok) {
          console.log(`[LocalServer] Server is already running and healthy on http://${HOST}:${PORT}.`);
          process.exit(0);
        }
      } catch {}
      console.error(`[LocalServer] Port ${PORT} is in use by another application.`);
      process.exit(1);
    } else {
      console.error(`[LocalServer] Server error:`, err);
    }
  });

  process.on('uncaughtException', (err) => {
    console.error(`[LocalServer] Caught unhandled exception (server kept running):`, err.message);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[LocalServer] Caught unhandled promise rejection:`, reason);
  });

  const cleanup = () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  server.listen(PORT, HOST, () => {
    try {
      fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    } catch {}
    console.log(`\n======================================================`);
    console.log(`🚀 YouTube Assistant Local Subtitle Server is running!`);
    console.log(`📡 URL:       http://${HOST}:${PORT}`);
    console.log(`📂 Cache Dir: ${CACHE_DIR}`);
    console.log(`🔢 PID:       ${process.pid}`);
    console.log(`------------------------------------------------------`);
    console.log(`How it works:`);
    console.log(`1. Runs as a background service managed by watchdog/cron.`);
    console.log(`2. The YouTube extension requests subtitles from here.`);
    console.log(`3. Subtitles are downloaded in terminal (0 YouTube blocks)!`);
    console.log(`4. You can also drop any .vtt or .srt file into:`);
    console.log(`   subtitles_cache/<videoId>.<lang>.vtt`);
    console.log(`======================================================\n`);
  });
}

export { server };
