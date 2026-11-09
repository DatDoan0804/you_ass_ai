/**
 * @fileoverview IndexedDB & Extension Storage Wrapper (`database.js`)
 *
 * Updates:
 * - Added `enableNonEducationalIntervention: true` to `DEFAULT_SETTINGS`.
 * - Added `Database.getInterventionState(videoId)` and `Database.saveInterventionState(videoId, state)`
 *   so accumulated active playback seconds and the randomized ~5-minute intervention target threshold
 *   persist across page reloads (`F5`) without resetting!
 */

const DB_NAME = 'YouTubeAILearningAssistantDB';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'gemini', // 'gemini' | 'openai-compatible'
  apiKey: '',
  model: 'gemini-3.8-flash',
  customEndpoint: 'http://localhost:11434/v1/chat/completions',
  breakFrequency: 'medium', // 'low' | 'medium' | 'high'
  minIntervalSeconds: 90,
  maxIntervalSeconds: 360,
  useYoutubeChapters: true,
  useAiBreakpoints: true,
  autoPause: true,
  notificationOnlyMode: false,
  skipMinorActivities: false,
  enableNonEducationalIntervention: true, // Redirects to YouTube home after ~5 mins of actual playback on non-educational videos
  preferredActivityTypes: [
    'multiple_choice',
    'short_answer',
    'prediction',
    'teach_back',
    'critical_thinking',
    'spot_the_mistake',
    'practical_application',
    'connect_concepts',
    'compare_concepts',
    'writing_exercise',
    'memory_reinforcement'
  ],
  learnerLevel: 'intermediate'
};

const memoryInterventionStore = new Map();

export class Database {
  constructor() {
    /** @type {IDBDatabase|null} */
    this.db = null;
    this.initPromise = null;
    this.memoryFallback = {
      transcripts: new Map(),
      ai_cache: new Map(),
      activity_history: new Map(),
      concepts: new Map()
    };
  }

  async init() {
    if (typeof indexedDB === 'undefined') {
      return null;
    }
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('transcripts')) {
          db.createObjectStore('transcripts', { keyPath: 'videoId' });
        }

        if (!db.objectStoreNames.contains('ai_cache')) {
          const cacheStore = db.createObjectStore('ai_cache', { keyPath: 'cacheKey' });
          cacheStore.createIndex('videoId', 'videoId', { unique: false });
          cacheStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('activity_history')) {
          const historyStore = db.createObjectStore('activity_history', { keyPath: 'id' });
          historyStore.createIndex('videoId', 'videoId', { unique: false });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('conceptTag', 'conceptTag', { unique: false });
        }

        if (!db.objectStoreNames.contains('concepts')) {
          const conceptStore = db.createObjectStore('concepts', { keyPath: 'conceptId' });
          conceptStore.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
          conceptStore.createIndex('masteryScore', 'masteryScore', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[YT-Learn DB] Failed to open IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  async withStore(storeName, mode, callback) {
    const db = await this.init();
    if (!db) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      try {
        request = callback(store);
      } catch (err) {
        reject(err);
        return;
      }

      if (request && typeof request === 'object' && 'onsuccess' in request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      }
    });
  }

  async saveTranscript(videoId, transcriptData) {
    const record = {
      videoId,
      ...transcriptData,
      updatedAt: Date.now()
    };
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.transcripts.set(videoId, record);
      return record;
    }
    return this.withStore('transcripts', 'readwrite', (store) => store.put(record));
  }

  async getTranscript(videoId) {
    if (typeof indexedDB === 'undefined') {
      return this.memoryFallback.transcripts.get(videoId) || null;
    }
    const res = await this.withStore('transcripts', 'readonly', (store) =>
      store.get(videoId)
    );
    return res || null;
  }

  async setAiCache(cacheKey, videoId, payload) {
    const record = {
      cacheKey,
      videoId,
      payload,
      createdAt: Date.now()
    };
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.ai_cache.set(cacheKey, record);
      return record;
    }
    return this.withStore('ai_cache', 'readwrite', (store) => store.put(record));
  }

  async getAiCache(cacheKey) {
    if (typeof indexedDB === 'undefined') {
      const rec = this.memoryFallback.ai_cache.get(cacheKey);
      return rec ? rec.payload : null;
    }
    const record = await this.withStore('ai_cache', 'readonly', (store) =>
      store.get(cacheKey)
    );
    return record ? record.payload : null;
  }

  async addHistoryEntry(entry) {
    const record = {
      id: entry.id || `${entry.videoId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...entry
    };
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.activity_history.set(record.id, record);
      return record;
    }
    await this.withStore('activity_history', 'readwrite', (store) => store.put(record));
    return record;
  }

  async getRecentHistory(limit = 50) {
    if (typeof indexedDB === 'undefined') {
      return Array.from(this.memoryFallback.activity_history.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    }
    const all = await this.withStore('activity_history', 'readonly', (store) =>
      store.getAll()
    );
    return (all || [])
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getVideoHistory(videoId) {
    if (typeof indexedDB === 'undefined') {
      return Array.from(this.memoryFallback.activity_history.values())
        .filter((r) => r.videoId === videoId)
        .sort((a, b) => a.videoTime - b.videoTime);
    }
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('activity_history', 'readonly');
      const store = tx.objectStore('activity_history');
      const index = store.index('videoId');
      const request = index.getAll(IDBKeyRange.only(videoId));
      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => a.videoTime - b.videoTime);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async saveConcept(conceptRecord) {
    const record = {
      ...conceptRecord,
      updatedAt: Date.now()
    };
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.concepts.set(record.conceptId, record);
      return record;
    }
    return this.withStore('concepts', 'readwrite', (store) => store.put(record));
  }

  async getConcept(conceptId) {
    if (typeof indexedDB === 'undefined') {
      return this.memoryFallback.concepts.get(conceptId) || null;
    }
    const res = await this.withStore('concepts', 'readonly', (store) =>
      store.get(conceptId)
    );
    return res || null;
  }

  async getAllConcepts() {
    if (typeof indexedDB === 'undefined') {
      return Array.from(this.memoryFallback.concepts.values());
    }
    const all = await this.withStore('concepts', 'readonly', (store) =>
      store.getAll()
    );
    return all || [];
  }

  static getStorageApi() {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  static async getSettings() {
    const api = Database.getStorageApi();
    if (!api) {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('yt_ai_learning_settings');
          const parsed = raw ? JSON.parse(raw) : {};
          if (parsed.model === 'gemini-2.5-flash') {
            parsed.model = 'gemini-3.8-flash';
          }
          return { ...DEFAULT_SETTINGS, ...parsed };
        }
      } catch {
        // Ignore
      }
      return { ...DEFAULT_SETTINGS };
    }

    return new Promise((resolve) => {
      const resultOrPromise = api.get(['yt_ai_learning_settings'], (res) => {
        if (res && res.yt_ai_learning_settings) {
          const stored = { ...res.yt_ai_learning_settings };
          if (stored.model === 'gemini-2.5-flash') {
            stored.model = 'gemini-3.8-flash';
          }
          resolve({ ...DEFAULT_SETTINGS, ...stored });
        } else {
          resolve({ ...DEFAULT_SETTINGS });
        }
      });

      if (resultOrPromise && typeof resultOrPromise.then === 'function') {
        resultOrPromise
          .then((res) => {
            const stored = res && res.yt_ai_learning_settings ? { ...res.yt_ai_learning_settings } : {};
            if (stored.model === 'gemini-2.5-flash') {
              stored.model = 'gemini-3.8-flash';
            }
            resolve({
              ...DEFAULT_SETTINGS,
              ...stored
            });
          })
          .catch(() => resolve({ ...DEFAULT_SETTINGS }));
      }
    });
  }

  static async saveSettings(partialSettings) {
    const current = await Database.getSettings();
    const updated = { ...current, ...partialSettings };

    if (partialSettings.breakFrequency && !partialSettings.minIntervalSeconds) {
      if (updated.breakFrequency === 'low') {
        updated.minIntervalSeconds = 180;
        updated.maxIntervalSeconds = 540;
      } else if (updated.breakFrequency === 'medium') {
        updated.minIntervalSeconds = 90;
        updated.maxIntervalSeconds = 360;
      } else if (updated.breakFrequency === 'high') {
        updated.minIntervalSeconds = 45;
        updated.maxIntervalSeconds = 180;
      }
    }

    const api = Database.getStorageApi();
    if (!api) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('yt_ai_learning_settings', JSON.stringify(updated));
        }
      } catch (e) {
        console.warn('[YT-Learn DB] Failed to save settings to localStorage:', e);
      }
      return updated;
    }

    return new Promise((resolve) => {
      const p = api.set({ yt_ai_learning_settings: updated }, () => resolve(updated));
      if (p && typeof p.then === 'function') {
        p.then(() => resolve(updated)).catch(() => resolve(updated));
      }
    });
  }

  // ===========================================================================
  // Issue 4: Persistent Non-Educational Active Playback Intervention State
  // ===========================================================================

  /**
   * Retrieves the persisted playback intervention state for a non-educational video
   * so refreshing the page does not reset the accumulated active watch time or target interval.
   *
   * @param {string} videoId
   * @returns {Promise<{videoId: string, watchedSeconds: number, targetThresholdSeconds: number, redirectCount: number, updatedAt: number}|null>}
   */
  static async getInterventionState(videoId) {
    if (!videoId) return null;
    const storageKey = `yt_learn_intervention_${videoId}`;
    const api = Database.getStorageApi();

    if (!api) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          const raw = sessionStorage.getItem(storageKey);
          if (raw) return JSON.parse(raw);
        }
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(storageKey);
          if (raw) return JSON.parse(raw);
        }
      } catch {
        // Ignore storage read errors
      }
      return memoryInterventionStore.get(videoId) || null;
    }

    return new Promise((resolve) => {
      const p = api.get([storageKey], (res) => {
        resolve(res && res[storageKey] ? res[storageKey] : null);
      });
      if (p && typeof p.then === 'function') {
        p.then((res) => resolve(res && res[storageKey] ? res[storageKey] : null)).catch(() =>
          resolve(null)
        );
      }
    });
  }

  /**
   * Persists the active playback intervention state for a non-educational video.
   *
   * @param {string} videoId
   * @param {object} state
   */
  static async saveInterventionState(videoId, state) {
    if (!videoId || !state) return null;
    const storageKey = `yt_learn_intervention_${videoId}`;
    const record = {
      videoId,
      watchedSeconds: Number(state.watchedSeconds || 0),
      targetThresholdSeconds: Number(state.targetThresholdSeconds || 300),
      redirectCount: Number(state.redirectCount || 0),
      updatedAt: Date.now()
    };

    memoryInterventionStore.set(videoId, record);
    const api = Database.getStorageApi();

    if (!api) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(storageKey, JSON.stringify(record));
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(storageKey, JSON.stringify(record));
        }
      } catch {
        // Ignore
      }
      return record;
    }

    return new Promise((resolve) => {
      const p = api.set({ [storageKey]: record }, () => resolve(record));
      if (p && typeof p.then === 'function') {
        p.then(() => resolve(record)).catch(() => resolve(record));
      }
    });
  }
}

export const db = new Database();
