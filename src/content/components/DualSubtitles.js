/**
 * @fileoverview DualSubtitles Component (Preact)
 * Renders the floating, draggable companion subtitle overlay that displays
 * alongside YouTube's native captions.
 */

import { html, useSafeState, useSafeRef, useSafeEffect } from './render-helper.js';

export function DualSubtitles({
  primaryText = '',
  secondaryText = '',
  fontSize = 'medium',
  customPosition = null,
  onPositionChange = () => {},
  onResetPosition = () => {}
}) {
  const [position, setPosition] = useSafeState(customPosition);
  const [isDragging, setIsDragging] = useSafeState(false);
  const dragRef = useSafeRef(null);
  const dragStartRef = useSafeRef({ startX: 0, startY: 0, initialLeft: 50, initialTop: 82 });

  useSafeEffect(() => {
    setPosition(customPosition);
  }, [customPosition]);

  const displayText = (secondaryText || primaryText || '').trim();

  // Mouse / Touch Dragging Handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Primary click only
    e.preventDefault();

    const box = dragRef.current;
    const player = box?.closest('#movie_player, .html5-video-player') || document.body;
    const playerRect = player.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    const currentLeftPct = ((boxRect.left + boxRect.width / 2 - playerRect.left) / playerRect.width) * 100;
    const currentTopPct = ((boxRect.top - playerRect.top) / playerRect.height) * 100;

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeftPct: isNaN(currentLeftPct) ? 50 : currentLeftPct,
      initialTopPct: isNaN(currentTopPct) ? 82 : currentTopPct,
      playerWidth: playerRect.width,
      playerHeight: playerRect.height
    };

    setIsDragging(true);

    let currentNewPos = null;

    const onMouseMove = (moveEvent) => {
      const { startX, startY, initialLeftPct, initialTopPct, playerWidth, playerHeight } =
        dragStartRef.current;
      const deltaXPct = ((moveEvent.clientX - startX) / playerWidth) * 100;
      const deltaYPct = ((moveEvent.clientY - startY) / playerHeight) * 100;

      const newLeft = Math.max(5, Math.min(95, initialLeftPct + deltaXPct));
      const newTop = Math.max(5, Math.min(95, initialTopPct + deltaYPct));

      currentNewPos = { left: `${newLeft.toFixed(1)}%`, top: `${newTop.toFixed(1)}%` };
      setPosition(currentNewPos);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
      if (currentNewPos) {
        onPositionChange(currentNewPos);
      } else if (position) {
        onPositionChange(position);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    setPosition(null);
    onResetPosition();
  };

  const styleObj = position
    ? {
        left: position.left,
        top: position.top,
        bottom: 'auto',
        transform: 'translateX(-50%)'
      }
    : {};

  const sizeClass = `font-size-${fontSize || 'medium'}`;

  return html`
    <div
      class="yt-learn-dual-subtitles-container ${sizeClass}"
      id="yt-learn-dual-subtitles-container"
      style=${styleObj}
    >
      <div
        ref=${dragRef}
        class="yt-learn-dual-subtitles-box ${isDragging ? 'is-dragging' : ''}"
        id="yt-learn-dual-subtitles-box"
        style=${displayText || isDragging ? { display: 'inline-flex' } : { display: 'none' }}
        onMouseDown=${handleMouseDown}
        onDblClick=${handleDoubleClick}
        title="Companion Subtitle (Drag to reposition, double-click to reset)"
      >
        <span class="yt-learn-drag-handle" title="Drag to reposition">⋮⋮</span>
        <span class="yt-learn-sub-primary" id="yt-learn-sub-primary" style="display:none;">
          ${primaryText}
        </span>
        <span
          class="yt-learn-sub-secondary"
          id="yt-learn-sub-secondary"
          style=${displayText ? { display: 'block' } : { display: 'none' }}
        >
          ${displayText}
        </span>
      </div>
    </div>
  `;
}
