/**
 * @fileoverview YouTube Video Controller & SPA Navigation Monitor (`video-controller.js`)
 *
 * Updates:
 * - Added `seekTo(seconds)` so clicking a breakpoint marker on YouTube's progress bar
 *   seeks the video directly to that timestamp.
 * - Added `loadedmetadata` / `durationchange` listener so timeline markers automatically
 *   reposition if the video duration resolves after initial attachment.
 */

export class VideoController {
  /**
   * @param {object} callbacks
   * @param {(videoInfo: {videoId: string, sessionEpoch: number, metadata: object}) => void} callbacks.onVideoChanged
   * @param {(currentTime: number, videoId: string, sessionEpoch: number, playbackRate: number) => void} callbacks.onTimeUpdate
   * @param {(newTime: number, videoId: string, sessionEpoch: number) => void} [callbacks.onUserSeek]
   * @param {(duration: number) => void} [callbacks.onDurationChange]
   * @param {(msg: string) => void} [callbacks.logger]
   */
  constructor({
    onVideoChanged,
    onTimeUpdate,
    onUserSeek = null,
    onDurationChange = null,
    logger = console.log
  }) {
    this.onVideoChanged = onVideoChanged;
    this.onTimeUpdate = onTimeUpdate;
    this.onUserSeek = onUserSeek;
    this.onDurationChange = onDurationChange;
    this.log = logger;

    /** @type {HTMLVideoElement|null} */
    this.videoElement = null;
    this.currentVideoId = null;
    this.sessionEpoch = 0;
    this.lastProcessedBucket = -1;
    this.isSystemPausing = false;
    this.isProgrammaticSeek = false;

    this.boundTimeUpdate = this.handleTimeUpdate.bind(this);
    this.boundSeeked = this.handleSeeked.bind(this);
    this.boundRateChange = this.handleRateChange.bind(this);
    this.boundDurationChange = this.handleDurationChange.bind(this);
    this.boundNavigateFinish = this.handleNavigation.bind(this);
    this.mutationObserver = null;
  }

  init() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    window.addEventListener('yt-navigate-finish', this.boundNavigateFinish);
    window.addEventListener('popstate', this.boundNavigateFinish);

    this.mutationObserver = new MutationObserver(() => {
      const urlVideoId = VideoController.extractVideoIdFromUrl();
      if (urlVideoId && urlVideoId !== this.currentVideoId) {
        this.handleNavigation();
      } else if (urlVideoId && (!this.videoElement || !this.videoElement.isConnected)) {
        this.attachToVideoElement();
      }
    });

    if (document.body) {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    this.handleNavigation();
  }

  static extractVideoIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      if (window.__YT_LEARN_SIMULATED_VIDEO_ID__) {
        return window.__YT_LEARN_SIMULATED_VIDEO_ID__;
      }
    } catch {
      // Ignore URL parse errors
    }
    return null;
  }

  async handleNavigation() {
    const newVideoId = VideoController.extractVideoIdFromUrl();

    if (!newVideoId) {
      this.detachVideoListeners();
      this.currentVideoId = null;
      this.sessionEpoch += 1;
      return;
    }

    if (newVideoId === this.currentVideoId && this.videoElement?.isConnected) {
      return;
    }

    this.currentVideoId = newVideoId;
    this.sessionEpoch += 1;
    this.lastProcessedBucket = -1;
    const capturedEpoch = this.sessionEpoch;

    this.attachToVideoElement();

    const metadata = await this.fetchPlayerMetadataWithRetry(newVideoId, capturedEpoch);

    if (this.currentVideoId !== newVideoId || this.sessionEpoch !== capturedEpoch) {
      return;
    }

    this.log(`[Breakpoint] Video detected: ${newVideoId}`);

    this.onVideoChanged({
      videoId: newVideoId,
      sessionEpoch: capturedEpoch,
      metadata
    });
  }

  attachToVideoElement(explicitVideoEl = null) {
    const candidate =
      explicitVideoEl ||
      (typeof document !== 'undefined'
        ? document.querySelector('video.html5-main-video') || document.querySelector('video')
        : null);

    if (!candidate || candidate === this.videoElement) return;

    this.detachVideoListeners();
    this.videoElement = candidate;
    this.videoElement.addEventListener('timeupdate', this.boundTimeUpdate);
    this.videoElement.addEventListener('seeked', this.boundSeeked);
    this.videoElement.addEventListener('ratechange', this.boundRateChange);
    this.videoElement.addEventListener('durationchange', this.boundDurationChange);
    this.videoElement.addEventListener('loadedmetadata', this.boundDurationChange);
  }

  detachVideoListeners() {
    if (this.videoElement) {
      this.videoElement.removeEventListener('timeupdate', this.boundTimeUpdate);
      this.videoElement.removeEventListener('seeked', this.boundSeeked);
      this.videoElement.removeEventListener('ratechange', this.boundRateChange);
      this.videoElement.removeEventListener('durationchange', this.boundDurationChange);
      this.videoElement.removeEventListener('loadedmetadata', this.boundDurationChange);
      this.videoElement = null;
    }
  }

  handleTimeUpdate() {
    if (!this.videoElement || !this.currentVideoId) return;
    if (this.videoElement.paused || this.videoElement.seeking) return;

    const currentTime = this.videoElement.currentTime;
    const bucket = Math.floor(currentTime * 5) / 5;

    if (bucket === this.lastProcessedBucket) return;
    this.lastProcessedBucket = bucket;

    const rate = this.videoElement.playbackRate || 1.0;
    this.onTimeUpdate(currentTime, this.currentVideoId, this.sessionEpoch, rate);
  }

  handleSeeked() {
    if (!this.videoElement || !this.currentVideoId) return;
    this.lastProcessedBucket = -1;
    if (this.isProgrammaticSeek) {
      this.isProgrammaticSeek = false;
      return;
    }
    if (typeof this.onUserSeek === 'function') {
      this.onUserSeek(this.videoElement.currentTime, this.currentVideoId, this.sessionEpoch);
    }
  }

  handleRateChange() {
    this.lastProcessedBucket = -1;
  }

  handleDurationChange() {
    if (!this.videoElement) return;
    const dur = this.videoElement.duration;
    if (Number.isFinite(dur) && dur > 0 && typeof this.onDurationChange === 'function') {
      this.onDurationChange(dur);
    }
  }

  /**
   * Programmatically seeks the video to `targetSeconds` (used when clicking a timeline marker).
   * @param {number} targetSeconds
   */
  seekTo(targetSeconds) {
    const ts = Math.max(0, Number(targetSeconds) || 0);
    this.log(`[Breakpoint] Seeking video to breakpoint: ${ts.toFixed(1)}s`);
    if (this.videoElement) {
      this.isProgrammaticSeek = true;
      this.videoElement.currentTime = ts;
      this.lastProcessedBucket = -1;
    }
  }

  async fetchPlayerMetadataWithRetry(expectedVideoId, expectedEpoch) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.currentVideoId !== expectedVideoId || this.sessionEpoch !== expectedEpoch) {
        return { videoId: expectedVideoId, captionTracks: [], chapters: [] };
      }

      const metadata = await this.requestBridgeMetadata();
      if (
        metadata &&
        metadata.videoId === expectedVideoId &&
        (metadata.captionTracks?.length > 0 || metadata.chapters?.length > 0 || attempt >= 2)
      ) {
        return metadata;
      }

      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }

    return {
      videoId: expectedVideoId,
      title: typeof document !== 'undefined' ? document.title.replace(/ - YouTube$/, '') : expectedVideoId,
      shortDescription: '',
      lengthSeconds:
        this.videoElement && Number.isFinite(this.videoElement.duration)
          ? Math.round(this.videoElement.duration)
          : 0,
      captionTracks: [],
      chapters: []
    };
  }

  requestBridgeMetadata() {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, 1200);

      function onMessage(event) {
        if (
          event.source === window &&
          event.data &&
          event.data.source === 'YT_AI_LEARNING_BRIDGE' &&
          event.data.requestId === requestId
        ) {
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(event.data.payload);
        }
      }

      window.addEventListener('message', onMessage);
      window.postMessage(
        {
          type: 'YT_AI_LEARNING_REQUEST_METADATA',
          requestId
        },
        '*'
      );
    });
  }

  pause() {
    this.log(`[Breakpoint] Pausing video`);
    if (this.videoElement && !this.videoElement.paused) {
      this.isSystemPausing = true;
      this.videoElement.pause();
      this.isSystemPausing = false;
    }
  }

  resume() {
    this.log(`[Breakpoint] Resuming playback`);
    if (this.videoElement && this.videoElement.paused) {
      this.videoElement.play().catch((err) => {
        console.warn('[YT-Learn VideoController] Auto-resume blocked by browser policy:', err.message);
      });
    }
  }

  getCurrentTime() {
    return this.videoElement ? this.videoElement.currentTime : 0;
  }

  getDuration() {
    if (this.videoElement && Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0) {
      return this.videoElement.duration;
    }
    return 0;
  }

  getPlaybackRate() {
    return this.videoElement ? this.videoElement.playbackRate || 1.0 : 1.0;
  }

  isSessionValid(videoId, sessionEpoch) {
    return this.currentVideoId === videoId && this.sessionEpoch === sessionEpoch;
  }
}
