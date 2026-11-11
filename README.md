# AI-Powered Interactive YouTube Learning Assistant

A Firefox-first (and Chromium-compatible) Manifest V3 browser extension that transforms passive YouTube video watching into an active, adaptive learning loop:

**Watch → Understand → Pause at a Natural Breakpoint → Think → Answer → Receive Tutor Feedback → Continue**

---

## 1. Project Structure

```text
youtube-ai-learning-assistant/
│
├── manifest.json                 # Firefox (115+) & Chromium Manifest V3 config
├── package.json                  # Project metadata & scripts
├── README.md                     # Architecture, installation, and testing guide
├── assets/
│   └── icon.svg                  # Extension vector icon
│
└── src/
    ├── background/
    │   └── background.js         # Privileged service worker: API key isolation, Gemini calls, caching, AbortController cancellation
    │
    ├── content/
    │   ├── loader.js             # Content script bootstrapper (injects page-bridge & imports ES module entry)
    │   ├── page-bridge.js        # Main-world script: reads YouTube player caption tracks & chapters safely
    │   ├── index.js              # Main orchestrator connecting lookahead pipeline, breakpoints, and UI
    │   ├── video-controller.js   # SPA navigation (`yt-navigate-finish` + MutationObserver), playback sync, sessionEpoch guard
    │   ├── subtitle-manager.js   # Caption track discovery, JSON3/XML parsing, sentence-aligned chunking
    │   ├── breakpoint-detector.js# Multi-source breakpoint engine (Chapters + Linguistic + AI Semantic + Time constraints)
    │   └── ui-manager.js         # Non-intrusive floating pill, 9 activity overlays, rubric table, settings & profile drawers
    │
    ├── ai/
    │   ├── ai-provider.js        # BaseAIProvider abstraction + OpenAI-Compatible/Local Ollama provider
    │   ├── gemini-provider.js    # Google Gemini REST provider with JSON schema validation & exponential backoff
    │   ├── prompt-builder.js     # Grounded system prompts & JSON schemas for analysis, 9 activities, and rubric evaluation
    │   ├── content-analyzer.js   # Semantic section analysis & subtitle cue timestamp snapping
    │   ├── activity-generator.js # Activity generation & diversification across all 9 active-learning modes
    │   └── answer-evaluator.js   # AI tutor evaluation with 4-part rubric (Accuracy, Completeness, Reasoning, Clarity)
    │
    ├── learning/
    │   ├── learning-manager.js   # Adaptive difficulty scaling, interruption frequency adjustment, learner context
    │   ├── history-manager.js    # Session and cross-video activity history
    │   └── spaced-repetition.js  # SM-2 inspired concept mastery & review scheduler
    │
    ├── storage/
    │   └── database.js           # IndexedDB persistent store + browser.storage.local settings wrapper
    │
    └── styles/
        └── main.css              # Modern glassmorphic dark UI that never blocks YouTube player controls
```

---

## 2. How to Install in Firefox (Step-by-Step)

1. Open **Firefox** and navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
2. Click the **"Load Temporary Add-on..."** button.
3. Browse to the `youtube-ai-learning-assistant/` directory and select **`manifest.json`** (or select the packaged `youtube-ai-learning-assistant.zip` file).
4. Open any educational YouTube video with captions enabled or available (for example, a programming tutorial, computer science lecture, or science explainer).
5. Look at the **bottom-right corner** of the YouTube page: you will see the floating pill **`AI Tutor: Ready`** along with three quick-action buttons:
   - **`⚡` (Trigger Activity Now)**: Immediately pauses playback and generates a transcript-grounded activity for the current section.
   - **`📊` (Learning Profile & History)**: Opens your concept mastery dashboard, spaced-repetition queue, and recent scores.
   - **`⚙️` (Settings)**: Configure your Google Gemini API key (or local Ollama endpoint), model (`gemini-2.5-flash`), break frequency (`Low`, `Medium`, `High`), and automatic pause preferences.

---

## 3. Practical Testing Procedure

1. **Test Offline / Local Fallback Mode First (No API Key Required)**:
   - Load the extension in Firefox and open a YouTube video with subtitles.
   - Verify the bottom-right pill transitions from `Loading Captions...` to `Ready (N sections)`.
   - Click the **`⚡`** button to trigger an immediate activity, or watch until the first natural breakpoint (~90 seconds).
   - Verify the video pauses automatically, the glassmorphic overlay opens on the right without covering the bottom YouTube scrubber bar, and you can submit an answer, view the 4-criterion rubric (`Accuracy`, `Completeness`, `Reasoning`, `Clarity`), or click **Skip & Resume**.
2. **Test Full Gemini AI Pipeline**:
   - Click **`⚙️`** in the floating pill, paste your Google Gemini API key (`AIzaSy...`), keep the model as `gemini-2.5-flash`, and click **Save Settings**.
   - Play a programming or science video. Observe the status pill briefly show `Preparing Activity...` **ahead of playback** and then `Active (1 queued)`.
   - When playback reaches the sentence-aligned breakpoint, test **Hint**, **Explain Concept**, **Submit Answer**, **Retry Answer**, and **Continue Watching**.
3. **Test SPA Navigation & Stale-Request Protection**:
   - While watching Video A (or while an AI request is preparing), click a recommended video in YouTube's sidebar to navigate to Video B without a full page reload.
   - Verify the overlay closes cleanly, `sessionEpoch` increments, any in-flight request from Video A is aborted in `background.js`, and Video B's captions load cleanly.
---

## 4. Dual Subtitles & Terminal Subtitle Server (Zero 429 Server Blocks)

To completely eliminate YouTube rate limits (HTTP 429) and ensure seamless companion subtitles on any video:
The extension supports an ultra-lightweight **Terminal Subtitle Server**.

### Option A: Automatic Subtitle Server
Start the local server in your terminal:
```bash
npm run server
```
- Listens on `http://127.0.0.1:8765`.
- Whenever you enable **💬 2nd Sub** or select a language on YouTube, the extension asks the local server.
- The server automatically downloads only that 1 subtitle via terminal `yt-dlp` and sends it to the extension.
- The Dedicated Bar displays `💬 2nd Sub: ON 🖥️` indicating the terminal companion server is connected.

### Option B: Download Subtitles in Terminal on Demand
You can download subtitles for any video directly using the CLI:
```bash
npm run get-sub -- <videoId or YouTube URL> [lang]
```
Examples:
```bash
npm run get-sub -- jNQXAC9IVRw en
npm run get-sub -- "https://www.youtube.com/watch?v=02KLnAH2bVs" es
```

### Option C: Drop Any Custom Subtitle File
You can drop any `.vtt` or `.srt` file directly into:
```text
subtitles_cache/<videoId>.<lang>.vtt
```
The extension will immediately load and display it on the video with 0 requests to YouTube!

