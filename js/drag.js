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
      } else if (dragState.sourceType === 'word' && dragState.wordRowIndex !== targetRow) {
        opts.onWordToWord(dragState.cardId, dragState.wordRowIndex, targetRow);
      }
      dragState = null;
    });
  });

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
      } else if (dragState.sourceType === 'word' && dragState.wordRowIndex !== targetRow) {
        opts.onWordToWord(dragState.cardId, dragState.wordRowIndex, targetRow);
      }
      dragState = null;
    });
  });
}
