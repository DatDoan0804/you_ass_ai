// src/content/shortcut-manager.js

export class ShortcutManager {
  /**
   * @param {import('./index.js').YouTubeLearningAssistantApp} app
   */
  constructor(app) {
    this.app = app;
    this.boundHandler = this.handleKeyDown.bind(this);

    // =========================================================
    // SHORTCUT REGISTRY: Add new shortcuts here!
    // =========================================================
    this.shortcuts = [
      {
        id: 'toggle-bar',
        name: 'Toggle Assistant Bar',
        key: 'o',
        alt: true,
        action: () => this.app.uiManager.toggleBar()
      },
      {
        id: 'toggle-vocab',
        name: 'Toggle Vocabulary Drawer',
        key: ';',
        alt: true,
        action: () => this.app.uiManager.toggleVocabularyDrawer()
      },
      /*
      {
        id: 'quiz-now',
        name: 'Trigger Activity Immediately',
        key: 'q',
        alt: true,
        action: () => this.app.handleManualTriggerActivity()
      }
      */
    ];
  }

  /**
   * Prevents triggering hotkeys when user is typing in a form or comment
   */
  isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      Boolean(target.isContentEditable) ||
      Boolean(target.closest?.('#contenteditable-root, ytd-commentbox, #search-form'))
    );
  }

  handleKeyDown(e) {
    // Debug log to see any key press with Alt/Ctrl
    if (e.altKey || e.ctrlKey) {
      console.log('[YT-Learn Shortcut] Key detected:', {
        key: e.key,
        code: e.code,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        target: e.target?.tagName
      });
    }

    // 1. Guard against typing in input/comment boxes
    if (this.isEditableTarget(e.target)) return;

    // 2. Normalize key
    const pressedKey = e.key ? e.key.toLowerCase() : '';
    const pressedCode = e.code ? e.code.toLowerCase() : '';

    // 3. Find matching shortcut
    const match = this.shortcuts.find((s) => {
      const targetKey = s.key.toLowerCase();
      // Match by character (e.key) OR physical key code (e.code e.g. 'KeyO' or 'Semicolon')
      const keyMatches =
        targetKey === pressedKey ||
        (s.code && s.code.toLowerCase() === pressedCode) ||
        (targetKey.length === 1 && `key${targetKey}` === pressedCode) ||
        (targetKey === ';' && pressedCode === 'semicolon');

      const altMatches = Boolean(s.alt) === e.altKey;
      const ctrlMatches = Boolean(s.ctrl) === (e.ctrlKey || e.metaKey);
      const shiftMatches = Boolean(s.shift) === e.shiftKey;
      return keyMatches && altMatches && ctrlMatches && shiftMatches;
    });

    if (match) {
      console.log(`[YT-Learn Shortcut] Triggered shortcut: ${match.id} (${match.name})`);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      try {
        match.action();
      } catch (err) {
        console.error(`[YT-Learn Shortcut] Error executing ${match.id}:`, err);
      }
    }
  }

  init() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundHandler, true); // Capture phase
      console.log('[YT-Learn Shortcut] Initialized with registered shortcuts:', this.shortcuts);
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundHandler, true);
    }
  }
}
