/**
 * @fileoverview VocabularyDrawer Component (Preact)
 * Renders vocabulary preparation cards in a responsive carousel with
 * keyboard arrow key navigation (Left/Right) and on-screen controls.
 */

import { html, useSafeState, useSafeEffect } from './render-helper.js';

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VocabularyDrawer({
  words = [],
  state = 'ready',
  message = '',
  isGate = false,
  onClose = () => { },
  onRetry = () => { },
  onContinue = () => { },
  onSeekToTimestamp = () => { }
}) {
  const [currentIndex, setCurrentIndex] = useSafeState(0);

  const cleanWords = (Array.isArray(words) ? words : [])
    .filter((item) => item && typeof item.word === 'string' && item.word.trim())
    .map((item) => ({
      word: item.word.trim(),
      translation:
        typeof item.translation === 'string'
          ? item.translation.trim()
          : typeof item.meaning === 'string'
            ? item.meaning.trim()
            : '',
      meaning:
        typeof item.translation === 'string'
          ? item.translation.trim()
          : typeof item.meaning === 'string'
            ? item.meaning.trim()
            : '',
      contextualMeaning:
        typeof item.contextualMeaning === 'string' ? item.contextualMeaning.trim() : '',
      example:
        typeof item.example === 'string'
          ? item.example.trim()
          : typeof item.context === 'string'
            ? item.context.trim()
            : '',
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : null
    }));

  const totalWords = cleanWords.length;

  // Keyboard navigation: Left and Right arrows
  useSafeEffect(() => {
    if (totalWords <= 1) return;

    const handleKeyDown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      // Don't intercept if user is typing in an input/textarea/select or contenteditable
      if (
        e.target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)
      ) {
        return;
      }

      // Focus the card only for a navigation key, then keep the key from reaching YouTube.
      const cardEl = document.querySelector('.yt-learn-vocab-card');
      if (cardEl && !cardEl.contains(document.activeElement)) {
        cardEl.focus({ preventScroll: true });
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => Math.min(totalWords - 1, prev + 1));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [totalWords]);

  // Keep index within bounds if word list changes
  const activeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, totalWords - 1));
  const currentWord = cleanWords[activeIndex];

  const handlePrev = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setCurrentIndex((prev) => Math.min(totalWords - 1, prev + 1));
  };

  // Status / Empty states
  let content = null;
  const preparing = state === 'preparing' || state === 'unknown';

  if (totalWords === 0) {
    if (preparing) {
      content = html`
        <div class="yt-learn-vocab-empty">
          <div class="yt-learn-vocab-empty-icon">⏳</div>
          <h4>Preparing Vocabulary</h4>
          <p>${message || 'Retrieving subtitles with yt-dlp and analyzing key vocabulary with Gemini...'}</p>
        </div>
      `;
    } else if (state === 'unavailable') {
      content = html`
        <div class="yt-learn-vocab-empty">
          <div class="yt-learn-vocab-empty-icon">💬</div>
          <h4>No Subtitles Available</h4>
          <p>${message || 'This video does not have any subtitles available. Subtitles are required to prepare vocabulary.'}</p>
          <button
            class="yt-learn-btn yt-learn-btn-secondary"
            id="yt-learn-vocab-retry"
            type="button"
            style="margin-top:14px;"
            onClick=${(e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          onRetry();
        }}
          >
            Try again
          </button>
        </div>
      `;
    } else if (state === 'error') {
      content = html`
        <div class="yt-learn-vocab-empty">
          <div class="yt-learn-vocab-empty-icon">⚠️</div>
          <h4>Couldn’t prepare the word cards</h4>
          <p>${message || 'An error occurred while preparing vocabulary.'}</p>
          <button
            class="yt-learn-btn yt-learn-btn-primary"
            id="yt-learn-vocab-retry"
            type="button"
            style="margin-top:14px;"
            onClick=${(e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          onRetry();
        }}
          >
            Try again
          </button>
        </div>
      `;
    } else {
      content = html`
        <div class="yt-learn-vocab-empty">
          <div class="yt-learn-vocab-empty-icon">📖</div>
          <h4>No Key Vocabulary Found</h4>
          <p>${message || 'The subtitles did not contain notable vocabulary to prepare.'}</p>
          <button
            class="yt-learn-btn yt-learn-btn-secondary"
            id="yt-learn-vocab-retry"
            type="button"
            style="margin-top:14px;"
            onClick=${(e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          onRetry();
        }}
          >
            Try again
          </button>
        </div>
      `;
    }
  } else {
    // Single-card view with Carousel & Arrow navigation
    const progressPct = ((activeIndex + 1) / totalWords) * 100;
    const meaning = currentWord.translation || currentWord.meaning;

    content = html`
      <div class="yt-learn-vocab-study">
        <div class="yt-learn-vocab-progress-label">
          <span>Card ${activeIndex + 1} of ${totalWords}</span>
          <span>Use ◀ / ▶ arrows or buttons</span>
        </div>
        <div class="yt-learn-vocab-progress">
          <span style="width: ${progressPct}%"></span>
        </div>

        <div class="yt-learn-vocab-flashcard">
          <div class="yt-learn-vocab-card-kicker">KEY VOCABULARY</div>
          <div class="yt-learn-vocab-card-word">${currentWord.word}</div>

          ${meaning
        ? html`
                <div class="yt-learn-vocab-answer">
                  <div class="yt-learn-vocab-meaning">${meaning}</div>
                  ${currentWord.contextualMeaning
            ? html`<div class="yt-learn-vocab-context-meaning">
                        <strong>Context: </strong>${currentWord.contextualMeaning}
                      </div>`
            : ''}
                  ${currentWord.example
            ? html`<blockquote>"${currentWord.example}"</blockquote>`
            : ''}
                </div>
              `
        : ''}

          ${currentWord.timestamp !== null && !isNaN(currentWord.timestamp)
        ? html`
                <button
                  class="yt-learn-btn yt-learn-btn-secondary yt-learn-timestamp-btn"
                  data-time=${currentWord.timestamp}
                  title="Jump to ${formatTimestamp(currentWord.timestamp)} in video"
                  onClick=${(e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            onSeekToTimestamp(currentWord.timestamp);
          }}
                >
                  ⏱️ ${formatTimestamp(currentWord.timestamp)}
                </button>
              `
        : ''}
        </div>

        <div class="yt-learn-vocab-actions">
          <button
            class="yt-learn-btn yt-learn-btn-secondary"
            id="yt-learn-vocab-prev"
            type="button"
            disabled=${activeIndex === 0}
            onClick=${handlePrev}
          >
            ◀ Prev
          </button>
          <button
            class="yt-learn-btn yt-learn-btn-primary"
            id="yt-learn-vocab-next"
            type="button"
            disabled=${activeIndex === totalWords - 1}
            onClick=${handleNext}
          >
            Next ▶
          </button>
        </div>
      </div>
    `;
  }

  const footerText = isGate
    ? 'Review vocabulary, then continue to the video.'
    : 'Browse vocabulary · stays available while watching';
  const continueButtonText = isGate ? 'Start watching' : 'Done';

  return html`
    <div
      class="yt-learn-overlay-backdrop yt-learn-vocab-backdrop"
      onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
    >
      <div
        class="yt-learn-card yt-learn-vocab-card"
        tabindex="-1"
        onClick=${(e) => e && e.stopPropagation && e.stopPropagation()}
      >
        <div class="yt-learn-card-header">
          <div class="yt-learn-card-title-group">
            <span class="yt-learn-card-icon">📖</span>
            <h3 class="yt-learn-card-title">Pre-Video Vocabulary</h3>
          </div>
          ${!isGate
      ? html`
                <button
                  class="yt-learn-btn yt-learn-btn-ghost"
                  id="yt-learn-vocab-close"
                  aria-label="Close"
                  onClick=${(e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          onClose();
        }}
                >
                  ✕
                </button>
              `
      : ''}
        </div>

        <div class="yt-learn-card-body">
          ${content}
        </div>

        <div class="yt-learn-card-footer">
          <span class="yt-learn-footer-text">${footerText}</span>
          <button
            class="yt-learn-btn yt-learn-btn-primary"
            id="yt-learn-vocab-continue"
            type="button"
            onClick=${(e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      onContinue();
    }}
          >
            ${continueButtonText}
          </button>
        </div>
      </div>
    </div>
  `;
}
