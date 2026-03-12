// Quiddlish UI — DOM rendering and event wiring
// All rendering is done by fully replacing innerHTML of specific containers.

// ─── Card element factory ────────────────────────────────────────────────────

function makeCardEl(card, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (opts.faceDown ? ' face-down' : '');
  el.dataset.cardId = card.id;
  if (!opts.faceDown) {
    const lettersEl = document.createElement('span');
    lettersEl.className = 'card-letters';
    lettersEl.textContent = card.letters;
    const ptsEl = document.createElement('span');
    ptsEl.className = 'card-points';
    ptsEl.textContent = card.points;
    el.appendChild(lettersEl);
    el.appendChild(ptsEl);
  }
  return el;
}

// ─── Computer hand ───────────────────────────────────────────────────────────

function renderComputerHand(state, faceUpCardId) {
  const el = document.getElementById('computer-hand');
  el.innerHTML = '';
  el.classList.add('facedown-spread');
  const n = state.computer.hand.length;
  for (let i = 0; i < n; i++) {
    const card = state.computer.hand[i];
    const faceDown = card.id !== faceUpCardId;
    el.appendChild(makeCardEl(card, { faceDown }));
  }
  const label = document.getElementById('computer-hand-label');
  if (label) label.textContent = `Computer (${n} card${n !== 1 ? 's' : ''})`;
}

// Reveal computer's words after round ends
function renderComputerReveal(state) {
  const el = document.getElementById('computer-hand');
  el.innerHTML = '';
  el.classList.remove('facedown-spread');
  if (state.computer.words.length > 0) {
    for (const group of state.computer.words) {
      const wordEl = document.createElement('div');
      wordEl.className = 'revealed-word';
      for (const c of group) wordEl.appendChild(makeCardEl(c));
      const pts = group.reduce((s, c) => s + c.points, 0);
      const ptsEl = document.createElement('span');
      ptsEl.className = 'word-points';
      ptsEl.textContent = `+${pts}`;
      wordEl.appendChild(ptsEl);
      el.appendChild(wordEl);
    }
    if (state.computer.hand.length > 0) {
      const unusedEl = document.createElement('div');
      unusedEl.className = 'revealed-word unused-cards';
      for (const c of state.computer.hand) unusedEl.appendChild(makeCardEl(c));
      const pts = state.computer.hand.reduce((s, c) => s + c.points, 0);
      const ptsEl = document.createElement('span');
      ptsEl.className = 'word-points';
      ptsEl.textContent = `-${pts}`;
      unusedEl.appendChild(ptsEl);
      el.appendChild(unusedEl);
    }
  } else {
    const unusedEl = document.createElement('div');
    unusedEl.className = 'revealed-word unused-cards';
    for (const c of state.computer.hand) unusedEl.appendChild(makeCardEl(c, { faceDown: false }));
    const pts = state.computer.hand.reduce((s, c) => s + c.points, 0);
    const ptsEl = document.createElement('span');
    ptsEl.className = 'word-points';
    ptsEl.textContent = `-${pts}`;
    unusedEl.appendChild(ptsEl);
    el.appendChild(unusedEl);
  }
}

// ─── Deck and discard ────────────────────────────────────────────────────────

function renderDeckAndDiscard(state) {
  const deckEl = document.getElementById('deck-pile');
  const discardEl = document.getElementById('discard-pile');

  deckEl.innerHTML = '';
  const deckCard = document.createElement('div');
  deckCard.className = 'card face-down deck-card';
  deckCard.id = 'deck-card';
  const deckCount = document.createElement('span');
  deckCount.className = 'deck-count';
  deckCount.textContent = state.deck.length;
  deckCard.appendChild(deckCount);
  deckEl.appendChild(deckCard);

  discardEl.innerHTML = '';
  if (state.discard.length > 0) {
    const top = state.discard[state.discard.length - 1];
    discardEl.appendChild(makeCardEl(top));
  } else {
    const empty = document.createElement('div');
    empty.className = 'card card-empty';
    empty.textContent = 'Empty';
    discardEl.appendChild(empty);
  }
}

// ─── Word zone ───────────────────────────────────────────────────────────────

/**
 * Render the word-zone rows.
 * @param {Card[][]} wordGroups
 * @param {Set<string>} dict
 * @param {boolean} interactive — show drag targets, add-word button, etc.
 */
function renderWordZone(wordGroups, dict, interactive) {
  const zone = document.getElementById('word-zone');
  zone.innerHTML = '';

  // Always show at least one empty row when interactive
  const rows = wordGroups.length > 0 ? wordGroups : (interactive ? [[]] : []);

  rows.forEach((group, rowIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'word-row';
    rowEl.dataset.rowIndex = rowIndex;

    // Validity badge
    const word = group.map(c => c.letters).join('').toLowerCase();
    const isValid = group.length >= 3 && dict && dict.has(word);
    const isEmpty = group.length === 0;
    rowEl.classList.add(isEmpty ? 'row-empty' : isValid ? 'row-valid' : 'row-invalid');

    // Cards in this row
    const cardsEl = document.createElement('div');
    cardsEl.className = 'word-row-cards';
    for (const card of group) {
      cardsEl.appendChild(makeCardEl(card));
    }
    rowEl.appendChild(cardsEl);

    // Badge
    if (!isEmpty) {
      const badge = document.createElement('span');
      badge.className = 'word-badge';
      if (isValid) {
        const pts = group.reduce((s, c) => s + c.points, 0);
        badge.textContent = `+${pts}`;
        badge.classList.add('badge-valid');
      } else if (group.length < 3) {
        badge.textContent = 'Need 3+ cards';
        badge.classList.add('badge-invalid');
      }
      rowEl.appendChild(badge);
    }

    zone.appendChild(rowEl);
  });
}

// ─── Player hand ─────────────────────────────────────────────────────────────

function renderPlayerHand(state) {
  const el = document.getElementById('player-hand');
  el.innerHTML = '';
  for (const card of state.player.hand) {
    el.appendChild(makeCardEl(card));
  }
}

// ─── Score display ───────────────────────────────────────────────────────────

function renderScores(state) {
  document.getElementById('player-score').textContent = state.player.score;
  document.getElementById('computer-score').textContent = state.computer.score;
  document.getElementById('round-display').textContent =
    state.phase === 'gameEnd' ? 'Game Over' : `Round ${state.round} of 8`;
}

// ─── Buttons visibility ──────────────────────────────────────────────────────

function renderButtons(state) {
  const isPlayerTurn = state.turn === 'player' && state.phase === 'round';
  const drawPhase = state.turnPhase === 'draw';

  // Draw buttons: visible on player's draw phase
  document.getElementById('draw-deck-btn').disabled = !(isPlayerTurn && drawPhase);
  document.getElementById('draw-discard-btn').disabled =
    !(isPlayerTurn && drawPhase && state.discard.length > 0);

  // Next round / play again
  const nextRoundBtn = document.getElementById('next-round-btn');
  const playAgainBtn = document.getElementById('play-again-btn');
  nextRoundBtn.classList.toggle('hidden', state.phase !== 'roundEnd' || state.round >= 8);
  playAgainBtn.classList.toggle('hidden', state.phase !== 'gameEnd');

  // Word-zone is always visible during a round
  const wordZone = document.getElementById('word-zone');
  wordZone.classList.toggle('hidden', state.phase === 'start');

  // Shuffle hand button: available any time it's the player's turn
  const shuffleBtn = document.getElementById('shuffle-hand-btn');
  if (shuffleBtn) shuffleBtn.disabled = !isPlayerTurn;

  // Piles section hint message
  const pilesMsg = document.getElementById('piles-message');
  if (pilesMsg) {
    if (isPlayerTurn && drawPhase) {
      pilesMsg.textContent = 'Draw from the deck or discard pile';
    } else if (isPlayerTurn && !drawPhase) {
      pilesMsg.textContent = 'Discard a card to end your turn';
    } else {
      pilesMsg.textContent = '';
    }
  }

  // "Final Turn!" banner and yellow border — only when it's the player's last turn
  const isFinalPlayerTurn = state.outBy === 'computer' && state.phase === 'round';
  const playerSection = document.getElementById('player-section');
  playerSection.classList.toggle('final-turn', isFinalPlayerTurn);
  const finalBanner = document.getElementById('final-turn-banner');
  if (finalBanner) finalBanner.classList.toggle('hidden', !isFinalPlayerTurn);
}

// ─── Game log ─────────────────────────────────────────────────────────────────

function prependLogEntry(el) {
  const log = document.getElementById('game-log');
  log.insertBefore(el, log.firstChild);
}

function renderMessage(text) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = text;
  prependLogEntry(entry);
}

function clearGameLog() {
  document.getElementById('game-log').innerHTML = '';
}

// ─── Round / game end log entry ───────────────────────────────────────────────

function renderRoundResult(state) {
  const entry = document.createElement('div');
  entry.className = 'log-entry log-result';

  const isGame = state.phase === 'gameEnd';

  const title = document.createElement('div');
  title.className = 'log-result-title';
  title.textContent = isGame ? 'Game Over!' : `Round ${state.round} Results`;
  entry.appendChild(title);

  function resultRow(label, value) {
    const row = document.createElement('div');
    row.className = 'log-result-row';
    row.innerHTML = `<strong>${label}:</strong> ${value}`;
    entry.appendChild(row);
  }

  if (!isGame) {
    resultRow('Your score this round', state.player.roundScore);
    resultRow('Computer score this round', state.computer.roundScore);
    const pLong = state.player.longestWord;
    const cLong = state.computer.longestWord;
    if (pLong > cLong) resultRow('Longest word bonus', 'You +10 pts');
    else if (cLong > pLong) resultRow('Longest word bonus', 'Computer +10 pts');
    else if (pLong > 0) resultRow('Longest word bonus', 'Tie — no bonus');
  }

  resultRow('Your total', state.player.score);
  resultRow('Computer total', state.computer.score);

  if (isGame) {
    const winner = document.createElement('div');
    winner.className = 'log-winner';
    if (state.player.score > state.computer.score) {
      winner.textContent = 'You win!';
    } else if (state.computer.score > state.player.score) {
      winner.textContent = 'Computer wins!';
    } else {
      winner.textContent = "It's a tie!";
    }
    entry.appendChild(winner);
  }

  prependLogEntry(entry);
}

function hideResultPanel() { /* no-op — results now live in the game log */ }

// ─── Master render ────────────────────────────────────────────────────────────

/**
 * Full re-render. Should be called after every state change.
 * @param {object} state
 * @param {Card[][]} wordGroups — player's current word zone arrangement
 * @param {Set<string>} dict
 * @param {string} message
 */
function renderAll(state, wordGroups, dict, message, faceUpComputerCardId) {
  renderScores(state);
  renderDeckAndDiscard(state);
  renderPlayerHand(state);
  renderButtons(state);

  // After player commits their words, show them read-only.
  const displayGroups = (state.phase === 'roundEnd' || state.phase === 'gameEnd' || state.outBy === 'player')
    ? state.player.words
    : wordGroups;
  const interactive = state.phase === 'round' && state.outBy !== 'player';

  if (state.phase === 'roundEnd' || state.phase === 'gameEnd') {
    renderComputerReveal(state);
    renderWordZone(displayGroups, dict, false);
  } else if (state.outBy === 'computer') {
    renderComputerReveal(state);
    hideResultPanel();
    renderWordZone(displayGroups, dict, interactive);
  } else {
    renderComputerHand(state, faceUpComputerCardId);
    hideResultPanel();
    renderWordZone(displayGroups, dict, interactive);
  }

  if (message !== undefined) renderMessage(message);
}
