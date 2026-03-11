// Drag-and-drop support for Quiddlish
// Handles two contexts:
//   1. Reordering cards within the player's hand
//   2. Moving cards between hand and word-zone rows

let dragState = null; // { cardId, sourceType: 'hand'|'word', wordRowIndex? }

/**
 * Call once after the hand and word-zone are rendered.
 * Attaches drag listeners and reports changes via callbacks.
 *
 * @param {object} opts
 * @param {function} opts.onHandReorder(newOrder: Card[]) — hand array after reorder
 * @param {function} opts.onCardToWord(cardId, rowIndex) — card moved from hand → word row
 * @param {function} opts.onWordToHand(cardId, rowIndex) — card moved from word row → hand
 * @param {function} opts.onWordToWord(cardId, fromRow, toRow) — card moved between word rows
 * @param {function} opts.onHandReorderById(dragId, targetId) — swap positions in hand
 */
function initDragAndDrop(opts) {
  // ── hand card drag-start ──────────────────────────────────────────────────
  document.querySelectorAll('#player-hand .card').forEach(el => {
    el.setAttribute('draggable', 'true');

    el.addEventListener('dragstart', e => {
      dragState = { cardId: el.dataset.cardId, sourceType: 'hand' };
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });

    // Allow dropping another hand card here (for reordering)
    el.addEventListener('dragover', e => {
      if (dragState && dragState.sourceType === 'hand') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      }
    });

    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragState && dragState.sourceType === 'hand' && dragState.cardId !== el.dataset.cardId) {
        opts.onHandReorderById(dragState.cardId, el.dataset.cardId);
      } else if (dragState && dragState.sourceType === 'word') {
        // Word card dropped onto a hand card → move to hand
        opts.onWordToHand(dragState.cardId, dragState.wordRowIndex);
      }
      dragState = null;
    });
  });

  // ── hand zone background drop (for word→hand when not over a card) ────────
  const handEl = document.getElementById('player-hand');
  if (handEl) {
    handEl.addEventListener('dragover', e => {
      if (dragState && dragState.sourceType === 'word') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    handEl.addEventListener('drop', e => {
      e.preventDefault();
      if (dragState && dragState.sourceType === 'word') {
        opts.onWordToHand(dragState.cardId, dragState.wordRowIndex);
        dragState = null;
      }
    });
  }

  // ── word-zone card drag-start ─────────────────────────────────────────────
  document.querySelectorAll('#word-zone .card').forEach(el => {
    el.setAttribute('draggable', 'true');

    el.addEventListener('dragstart', e => {
      const rowIndex = parseInt(el.closest('.word-row').dataset.rowIndex, 10);
      dragState = { cardId: el.dataset.cardId, sourceType: 'word', wordRowIndex: rowIndex };
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });

    // Drop a hand card onto a word-zone card (insert into same row)
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const targetRow = parseInt(el.closest('.word-row').dataset.rowIndex, 10);
      if (!dragState) return;
      if (dragState.sourceType === 'hand') {
        opts.onCardToWord(dragState.cardId, targetRow);
      } else if (dragState.sourceType === 'word') {
        if (dragState.wordRowIndex !== targetRow) {
          opts.onWordToWord(dragState.cardId, dragState.wordRowIndex, targetRow);
        } else if (dragState.cardId !== el.dataset.cardId) {
          opts.onWordReorderById(dragState.cardId, targetRow, el.dataset.cardId);
        }
      }
      dragState = null;
    });
  });

  // ── discard pile drop zone (drag hand card to discard = end turn) ─────────
  const discardPileEl = document.getElementById('discard-pile');
  if (discardPileEl) {
    discardPileEl.addEventListener('dragover', e => {
      if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'word')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        discardPileEl.classList.add('drag-over');
      }
    });
    discardPileEl.addEventListener('dragleave', () => discardPileEl.classList.remove('drag-over'));
    discardPileEl.addEventListener('drop', e => {
      e.preventDefault();
      discardPileEl.classList.remove('drag-over');
      if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'word')) {
        opts.onDiscardCard(dragState.cardId);
      }
      dragState = null;
    });
  }

  // ── word-row drop zones (empty rows and row backgrounds) ─────────────────
  document.querySelectorAll('#word-zone .word-row').forEach(rowEl => {
    rowEl.addEventListener('dragover', e => {
      if (dragState) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        rowEl.classList.add('drag-over');
      }
    });

    rowEl.addEventListener('dragleave', e => {
      // Only remove if we're leaving the row itself, not a child
      if (!rowEl.contains(e.relatedTarget)) {
        rowEl.classList.remove('drag-over');
      }
    });

    rowEl.addEventListener('drop', e => {
      e.preventDefault();
      rowEl.classList.remove('drag-over');
      const targetRow = parseInt(rowEl.dataset.rowIndex, 10);
      if (!dragState) return;
      if (dragState.sourceType === 'hand') {
        opts.onCardToWord(dragState.cardId, targetRow);
      } else if (dragState.sourceType === 'word') {
        if (dragState.wordRowIndex !== targetRow) {
          opts.onWordToWord(dragState.cardId, dragState.wordRowIndex, targetRow);
        } else {
          opts.onWordMoveToEnd(dragState.cardId, targetRow);
        }
      }
      dragState = null;
    });
  });

  // ── touch drag-and-drop (iOS Safari) ─────────────────────────────────────
  initTouchDragAndDrop(opts);
}

// ─── Touch drag-and-drop ──────────────────────────────────────────────────────
// iOS Safari doesn't support the HTML5 drag API, so we roll our own using
// touchstart / touchmove / touchend + elementFromPoint for drop detection.

let touchDrag = null; // { cardId, sourceType, wordRowIndex, clone, origX, origY, startX, startY, sourceEl }
let touchOpts = null; // always points to the latest opts (updated each refresh)
let touchDocListenersAttached = false;

function initTouchDragAndDrop(opts) {
  function getDropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const wordCard = el.closest('#word-zone .card');
    if (wordCard) {
      const rowEl = wordCard.closest('.word-row');
      return { type: 'word-card', cardId: wordCard.dataset.cardId, rowIndex: parseInt(rowEl.dataset.rowIndex, 10) };
    }
    const wordRow = el.closest('#word-zone .word-row');
    if (wordRow) {
      return { type: 'word-row', rowIndex: parseInt(wordRow.dataset.rowIndex, 10) };
    }
    const handCard = el.closest('#player-hand .card');
    if (handCard) {
      return { type: 'hand-card', cardId: handCard.dataset.cardId };
    }
    if (el.closest('#player-hand')) {
      return { type: 'hand' };
    }
    if (el.closest('#discard-pile')) {
      return { type: 'discard' };
    }
    return null;
  }

  function attachTouch(el, sourceType, getRowIndex) {
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = el.getBoundingClientRect();
      const clone = el.cloneNode(true);
      clone.style.cssText = `
        position: fixed;
        left: ${rect.left}px; top: ${rect.top}px;
        width: ${rect.width}px; height: ${rect.height}px;
        opacity: 0.85; pointer-events: none; z-index: 9999;
        transform: rotate(3deg) scale(1.07); transition: none;
      `;
      document.body.appendChild(clone);
      touchDrag = {
        cardId: el.dataset.cardId,
        sourceType,
        wordRowIndex: sourceType === 'word' ? getRowIndex() : undefined,
        clone,
        origX: rect.left, origY: rect.top,
        startX: touch.clientX, startY: touch.clientY,
        sourceEl: el,
      };
      el.classList.add('dragging');
    }, { passive: false });
  }

  if (!touchDocListenersAttached) {
    touchDocListenersAttached = true;

    document.addEventListener('touchmove', e => {
      if (!touchDrag) return;
      e.preventDefault();
      const touch = e.touches[0];
      touchDrag.clone.style.left = (touchDrag.origX + touch.clientX - touchDrag.startX) + 'px';
      touchDrag.clone.style.top  = (touchDrag.origY + touch.clientY - touchDrag.startY) + 'px';
    }, { passive: false });

    document.addEventListener('touchend', e => {
      if (!touchDrag) return;
      const touch = e.changedTouches[0];
      touchDrag.clone.remove();
      touchDrag.sourceEl.classList.remove('dragging');
      const { cardId, sourceType, wordRowIndex } = touchDrag;
      touchDrag = null;

      // Use the current opts from the module-level reference
      const target = getDropTarget(touch.clientX, touch.clientY);
      if (!target) return;

      if (sourceType === 'hand') {
        if (target.type === 'discard') {
          touchOpts.onDiscardCard(cardId);
        } else if (target.type === 'word-card' || target.type === 'word-row') {
          touchOpts.onCardToWord(cardId, target.rowIndex);
        } else if (target.type === 'hand-card' && target.cardId !== cardId) {
          touchOpts.onHandReorderById(cardId, target.cardId);
        }
      } else if (sourceType === 'word') {
        if (target.type === 'discard') {
          touchOpts.onDiscardCard(cardId);
        } else if (target.type === 'word-card' && target.rowIndex === wordRowIndex && target.cardId !== cardId) {
          touchOpts.onWordReorderById(cardId, wordRowIndex, target.cardId);
        } else if ((target.type === 'word-card' || target.type === 'word-row') && target.rowIndex !== wordRowIndex) {
          touchOpts.onWordToWord(cardId, wordRowIndex, target.rowIndex);
        } else if (target.type === 'word-row' && target.rowIndex === wordRowIndex) {
          touchOpts.onWordMoveToEnd(cardId, wordRowIndex);
        } else if (target.type === 'hand-card' || target.type === 'hand') {
          touchOpts.onWordToHand(cardId, wordRowIndex);
        }
      }
    });
  }

  // Update the shared opts reference so the single touchend handler uses current callbacks
  touchOpts = opts;

  document.querySelectorAll('#player-hand .card').forEach(el => {
    attachTouch(el, 'hand', null);
  });
  document.querySelectorAll('#word-zone .card').forEach(el => {
    attachTouch(el, 'word', () => parseInt(el.closest('.word-row').dataset.rowIndex, 10));
  });
}
