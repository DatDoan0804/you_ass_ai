/**
 * @fileoverview CLI Subtitle Downloader (`server/get-sub.js`)
 *
 * Downloads subtitles for a YouTube video in your terminal and caches them
 * so the YouTube extension receives them with ZERO browser requests to YouTube.
 *
 * Usage:
 *   node server/get-sub.js <videoId or URL> [lang]
 *   npm run get-sub -- <videoId or URL> [lang]
 *
 * Examples:
 *   npm run get-sub -- dQw4w9WgXcQ es
 *   npm run get-sub -- https://www.youtube.com/watch?v=jNQXAC9IVRw vi
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadSubtitlesWithYtDlp, findInCache, loadSubtitleFile } from './subtitle-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.resolve(ROOT_DIR, 'subtitles_cache');

function extractVideoId(input) {
  if (!input) return '';
  const str = String(input).trim();
  // Standard full or short YouTube URLs
  const urlMatch = str.match(/(?:v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (urlMatch) return urlMatch[1];
  // Direct 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  return str;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`\nUsage:`);
    console.log(`  node server/get-sub.js <videoId or URL> [lang]`);
    console.log(`  npm run get-sub -- <videoId or URL> [lang]\n`);
    console.log(`Examples:`);
    console.log(`  npm run get-sub -- jNQXAC9IVRw en`);
    console.log(`  npm run get-sub -- "https://www.youtube.com/watch?v=jNQXAC9IVRw" es\n`);
    process.exit(0);
  }

  const rawInput = args[0];
  const lang = args[1] || 'en';
  const videoId = extractVideoId(rawInput);

  if (!videoId) {
    console.error(`❌ Error: Invalid YouTube Video ID or URL: "${rawInput}"`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`📥 Downloading Subtitle in Terminal`);
  console.log(`🎬 Video ID:  ${videoId}`);
  console.log(`🌐 Language:  ${lang}`);
  console.log(`📂 Cache Dir: ${CACHE_DIR}`);
  console.log(`======================================================\n`);

  // Check if already in cache
  const existing = findInCache(videoId, lang);
  if (existing) {
    const cues = loadSubtitleFile(existing.filePath);
    console.log(`✨ Already in local cache!`);
    console.log(`📁 File: ${existing.filePath}`);
    console.log(`📊 Cues: ${cues.length} entries`);
    console.log(`\nReady to be delivered to your YouTube extension!`);
    process.exit(0);
  }

  const result = await downloadSubtitlesWithYtDlp(videoId, lang);
  if (result) {
    const cues = loadSubtitleFile(result.filePath);
    console.log(`\n======================================================`);
    console.log(`✅ Success! Subtitle downloaded in terminal.`);
    console.log(`📁 Saved to: ${path.basename(result.filePath)}`);
    console.log(`📊 Parsed:   ${cues.length} subtitle cues`);
    console.log(`------------------------------------------------------`);
    console.log(`The YouTube extension will now load this subtitle`);
    console.log(`with ZERO network calls to YouTube (No 429 possible)!`);
    console.log(`======================================================\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed to download subtitle via yt-dlp.`);
    console.log(`Tip: You can manually copy any .vtt or .srt file to:`);
    console.log(`  ${CACHE_DIR}/${videoId}.${lang}.vtt\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
