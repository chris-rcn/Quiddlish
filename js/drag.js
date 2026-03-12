// Drag-and-drop support for Quiddlish
// Handles two contexts:
//   1. Reordering cards within the player's hand
//   2. Moving cards between hand and word-zone rows

let dragState = null; // { cardId, sourceType: 'hand'|'word', wordRowIndex? }
let pilesDropEnterCount = 0; // tracks nested dragenter/dragleave within #piles-section

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
/**
 * Find the card to insert before when dropping at (clientX, clientY) in the hand.
 * Handles wrapped rows: only considers cards on the same visual row as the drop,
 * then falls back to the first card of the next row, then null (append to end).
 * @param {number} clientX
 * @param {number} clientY
 * @param {string|null} excludeCardId — the dragged card's id (excluded from targets)
 * @returns {Element|null}
 */
function findHandInsertPosition(clientX, clientY, excludeCardId) {
  const all = [...document.querySelectorAll('#player-hand .card')];
  const cards = excludeCardId ? all.filter(c => c.dataset.cardId !== excludeCardId) : all;
  if (cards.length === 0) return null;

  // Cards whose Y-range overlaps the drop point (same visual row)
  const sameRow = cards.filter(c => {
    const r = c.getBoundingClientRect();
    return clientY >= r.top - 4 && clientY <= r.bottom + 4;
  });

  if (sameRow.length > 0) {
    // First card in this row whose centre is right of the drop X
    const hit = sameRow.find(c => {
      const r = c.getBoundingClientRect();
      return clientX < r.left + r.width / 2;
    });
    if (hit) return hit;
    // Drop is past the last card in this row → first card of the next row
    const rowBottom = Math.max(...sameRow.map(c => c.getBoundingClientRect().bottom));
    return cards.find(c => c.getBoundingClientRect().top > rowBottom + 2) || null;
  }

  // Drop is between rows: first card below the drop point
  return cards.find(c => c.getBoundingClientRect().top > clientY) || null;
}

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

    // Allow dropping another hand card or the discard top card here
    el.addEventListener('dragover', e => {
      if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'discard')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      }
    });

    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!dragState) return;
      const ins = findHandInsertPosition(e.clientX, e.clientY, dragState.sourceType === 'hand' ? dragState.cardId : null);
      if (dragState.sourceType === 'hand' && dragState.cardId !== el.dataset.cardId) {
        if (ins) opts.onHandReorderById(dragState.cardId, ins.dataset.cardId);
        else opts.onHandMoveToEnd(dragState.cardId);
      } else if (dragState.sourceType === 'word') {
        if (ins) opts.onWordToHandInsertBefore(dragState.cardId, dragState.wordRowIndex, ins.dataset.cardId);
        else opts.onWordToHand(dragState.cardId, dragState.wordRowIndex);
      } else if (dragState.sourceType === 'discard') {
        if (ins) opts.onDrawFromDiscardToHandBefore(ins.dataset.cardId);
        else opts.onDrawFromDiscardToHand();
      }
      dragState = null;
    });
  });

  // ── hand zone background drop (for word→hand and discard→hand) ───────────
  const handEl = document.getElementById('player-hand');
  if (handEl) {
    handEl.addEventListener('dragover', e => {
      if (dragState) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    handEl.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragState) return;
      const ins = findHandInsertPosition(e.clientX, e.clientY, dragState.sourceType === 'hand' ? dragState.cardId : null);
      if (dragState.sourceType === 'hand') {
        if (ins) opts.onHandReorderById(dragState.cardId, ins.dataset.cardId);
        else opts.onHandMoveToEnd(dragState.cardId);
      } else if (dragState.sourceType === 'word') {
        if (ins) opts.onWordToHandInsertBefore(dragState.cardId, dragState.wordRowIndex, ins.dataset.cardId);
        else opts.onWordToHand(dragState.cardId, dragState.wordRowIndex);
      } else if (dragState.sourceType === 'discard') {
        if (ins) opts.onDrawFromDiscardToHandBefore(ins.dataset.cardId);
        else opts.onDrawFromDiscardToHand();
      }
      dragState = null;
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
        opts.onCardToWordInsertBefore(dragState.cardId, targetRow, el.dataset.cardId);
      } else if (dragState.sourceType === 'word') {
        if (dragState.wordRowIndex !== targetRow) {
          opts.onWordToWordInsertBefore(dragState.cardId, dragState.wordRowIndex, targetRow, el.dataset.cardId);
        } else {
          // Midpoint scan: insert before the first card whose centre is to the right of the drop X
          const rowCards = [...el.closest('.word-row-cards').querySelectorAll('.card')]
            .filter(c => c.dataset.cardId !== dragState.cardId);
          const nearest = rowCards.find(c => {
            const r = c.getBoundingClientRect();
            return e.clientX < r.left + r.width / 2;
          });
          if (nearest) {
            opts.onWordReorderById(dragState.cardId, targetRow, nearest.dataset.cardId);
          } else {
            opts.onWordMoveToEnd(dragState.cardId, targetRow);
          }
        }
      } else if (dragState.sourceType === 'discard') {
        opts.onDrawFromDiscardToWordBefore(targetRow, el.dataset.cardId);
      }
      dragState = null;
    });
  });

  // ── piles section drop zone (drag hand/word card anywhere in piles panel = discard) ──
  const pilesSectionEl = document.getElementById('piles-section');
  if (pilesSectionEl) {
    // Chrome requires e.preventDefault() on the direct element under the cursor, not just
    // an ancestor. Add dragover to every child so any element in the panel accepts the drop.
    pilesSectionEl.querySelectorAll('*').forEach(child => {
      child.addEventListener('dragover', e => {
        if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'word')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
    });

    // Use a counter for reliable highlight across nested children (dragleave fires on every
    // child transition, so a simple contains() check can miss cases).
    pilesSectionEl.addEventListener('dragenter', e => {
      if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'word')) {
        pilesDropEnterCount++;
        pilesSectionEl.classList.add('drag-over');
      }
    });
    pilesSectionEl.addEventListener('dragleave', () => {
      if (pilesDropEnterCount > 0) pilesDropEnterCount--;
      if (pilesDropEnterCount <= 0) {
        pilesDropEnterCount = 0;
        pilesSectionEl.classList.remove('drag-over');
      }
    });
    pilesSectionEl.addEventListener('dragover', e => {
      if (dragState && (dragState.sourceType === 'hand' || dragState.sourceType === 'word')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    pilesSectionEl.addEventListener('drop', e => {
      e.preventDefault();
      pilesDropEnterCount = 0;
      pilesSectionEl.classList.remove('drag-over');
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
      } else if (dragState.sourceType === 'discard') {
        opts.onDrawFromDiscardToWord(targetRow);
      }
      dragState = null;
    });
  });

  // ── discard pile top card as a drag source (draw by dragging) ───────────
  const discardTopCard = document.querySelector('#discard-pile .card:not(.card-empty)');
  if (discardTopCard) {
    discardTopCard.setAttribute('draggable', 'true');
    discardTopCard.addEventListener('dragstart', e => {
      dragState = { cardId: discardTopCard.dataset.cardId, sourceType: 'discard' };
      e.dataTransfer.effectAllowed = 'move';
      discardTopCard.classList.add('dragging');
    });
    discardTopCard.addEventListener('dragend', () => {
      discardTopCard.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });
  }

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
    if (el.closest('#piles-section')) {
      return { type: 'discard' };
    }
    // Fallback: finger may have gone past the right edge of a word-row.
    // Match on Y position only — if the finger's vertical position is within
    // a row, treat it as a drop onto that row regardless of X.
    const wordRows = document.querySelectorAll('#word-zone .word-row');
    for (const row of wordRows) {
      const rect = row.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { type: 'word-row', rowIndex: parseInt(row.dataset.rowIndex, 10) };
      }
    }
    // Fallback: finger may have gone past the right edge of the player hand.
    const handFallback = document.getElementById('player-hand');
    if (handFallback) {
      const rect = handFallback.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { type: 'hand' };
      }
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
          // Centre-based detection in the target row for position-aware insert.
          const rowCards = [...document.querySelectorAll(
            `#word-zone .word-row[data-row-index="${target.rowIndex}"] .card`
          )];
          const nearest = rowCards.find(el => {
            const r = el.getBoundingClientRect();
            return touch.clientX < r.left + r.width / 2;
          });
          if (nearest) {
            touchOpts.onCardToWordInsertBefore(cardId, target.rowIndex, nearest.dataset.cardId);
          } else {
            touchOpts.onCardToWord(cardId, target.rowIndex);
          }
        } else if (target.type === 'hand-card' || target.type === 'hand') {
          const ins = findHandInsertPosition(touch.clientX, touch.clientY, cardId);
          if (ins) touchOpts.onHandReorderById(cardId, ins.dataset.cardId);
          else touchOpts.onHandMoveToEnd(cardId);
        }
      } else if (sourceType === 'word') {
        if (target.type === 'discard') {
          touchOpts.onDiscardCard(cardId);
        } else if (target.type === 'word-card' && target.rowIndex !== wordRowIndex) {
          // Dropped onto a specific card in another row → insert before it
          touchOpts.onWordToWordInsertBefore(cardId, wordRowIndex, target.rowIndex, target.cardId);
        } else if (target.type === 'word-card' && target.rowIndex === wordRowIndex) {
          // Midpoint scan: insert before the first card whose centre is to the right of the drop X
          const rowCards = [...document.querySelectorAll(
            `#word-zone .word-row[data-row-index="${wordRowIndex}"] .card`
          )].filter(el => el.dataset.cardId !== cardId);
          const nearest = rowCards.find(el => {
            const r = el.getBoundingClientRect();
            return touch.clientX < r.left + r.width / 2;
          });
          if (nearest) {
            touchOpts.onWordReorderById(cardId, wordRowIndex, nearest.dataset.cardId);
          } else {
            touchOpts.onWordMoveToEnd(cardId, wordRowIndex);
          }
        } else if (target.type === 'word-row' && target.rowIndex !== wordRowIndex) {
          // Dropped on a row's background → append to end
          touchOpts.onWordToWord(cardId, wordRowIndex, target.rowIndex);
        } else if (target.type === 'word-row' && target.rowIndex === wordRowIndex) {
          // Dropped on same row's background → move to end
          touchOpts.onWordMoveToEnd(cardId, wordRowIndex);
        } else if (target.type === 'hand-card' || target.type === 'hand') {
          const ins = findHandInsertPosition(touch.clientX, touch.clientY, null);
          if (ins) touchOpts.onWordToHandInsertBefore(cardId, wordRowIndex, ins.dataset.cardId);
          else touchOpts.onWordToHand(cardId, wordRowIndex);
        }
      } else if (sourceType === 'discard') {
        if (target.type === 'word-card' || target.type === 'word-row') {
          const rowCards = [...document.querySelectorAll(
            `#word-zone .word-row[data-row-index="${target.rowIndex}"] .card`
          )];
          const nearest = rowCards.find(el => {
            const r = el.getBoundingClientRect();
            return touch.clientX < r.left + r.width / 2;
          });
          if (nearest) {
            touchOpts.onDrawFromDiscardToWordBefore(target.rowIndex, nearest.dataset.cardId);
          } else {
            touchOpts.onDrawFromDiscardToWord(target.rowIndex);
          }
        } else if (target.type === 'hand-card' || target.type === 'hand') {
          const ins = findHandInsertPosition(touch.clientX, touch.clientY, null);
          if (ins) touchOpts.onDrawFromDiscardToHandBefore(ins.dataset.cardId);
          else touchOpts.onDrawFromDiscardToHand();
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
  const discardTouchCard = document.querySelector('#discard-pile .card:not(.card-empty)');
  if (discardTouchCard) {
    attachTouch(discardTouchCard, 'discard', null);
  }
}
