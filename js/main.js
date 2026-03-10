// Quiddlish — main entry point
// Wires together: game engine, AI, UI, and drag-and-drop.

// ─── App state ───────────────────────────────────────────────────────────────

let gameState = null;
let dict = null;

// Player's current word-zone arrangement (Card[][]) — lives here, not in gameState.
// Word-zone cards are removed from player.hand when dragged in, and restored when dragged back.
let playerWordGroups = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function refresh(message) {
  renderAll(gameState, playerWordGroups, dict, message);
  // Re-attach drag listeners; skip if player already committed their words
  if (gameState.phase === 'round' && gameState.outBy !== 'player') {
    attachDragListeners();
  }
}

// ─── Drag integration ────────────────────────────────────────────────────────

function attachDragListeners() {
  initDragAndDrop({
    onHandReorderById(dragId, targetId) {
      const hand = gameState.player.hand;
      const fromIdx = hand.findIndex(c => c.id === dragId);
      const toIdx   = hand.findIndex(c => c.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      [hand[fromIdx], hand[toIdx]] = [hand[toIdx], hand[fromIdx]];
      refresh();
    },

    onCardToWord(cardId, rowIndex) {
      const hand = gameState.player.hand;
      const cardIdx = hand.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = hand.splice(cardIdx, 1);
      while (playerWordGroups.length <= rowIndex) playerWordGroups.push([]);
      playerWordGroups[rowIndex].push(card);
      refresh();
    },

    onWordToHand(cardId, rowIndex) {
      if (rowIndex >= playerWordGroups.length) return;
      const group = playerWordGroups[rowIndex];
      const cardIdx = group.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = group.splice(cardIdx, 1);
      gameState.player.hand.push(card);
      // Remove now-empty row (unless it's the last one)
      if (group.length === 0 && playerWordGroups.length > 1) {
        playerWordGroups.splice(rowIndex, 1);
      }
      refresh();
    },

    onWordToWord(cardId, fromRow, toRow) {
      if (fromRow >= playerWordGroups.length) return;
      const srcGroup = playerWordGroups[fromRow];
      const cardIdx  = srcGroup.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = srcGroup.splice(cardIdx, 1);
      while (playerWordGroups.length <= toRow) playerWordGroups.push([]);
      playerWordGroups[toRow].push(card);
      if (srcGroup.length === 0 && playerWordGroups.length > 1) {
        playerWordGroups.splice(fromRow, 1);
      }
      refresh();
    },

    onDiscardCard(cardId) {
      if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;
      if (!gameState.player.hand.find(c => c.id === cardId)) return;
      discardAndEndTurn(cardId);
    },
  });
}

// ─── Button / click event delegation ─────────────────────────────────────────

document.addEventListener('click', e => {
  if (!gameState) return;

  // ── New Game / Play Again ─────────────────────────────────────────────────
  if (e.target.id === 'new-game-btn' || e.target.id === 'play-again-btn') {
    startNewGame();
    return;
  }

  // ── Next Round ────────────────────────────────────────────────────────────
  if (e.target.id === 'next-round-btn') {
    startNextRound();
    return;
  }

  // ── Draw from deck (button or clicking deck pile) ─────────────────────────
  if (e.target.id === 'draw-deck-btn' || e.target.closest('#deck-pile')) {
    handleDrawDeck();
    return;
  }

  // ── Draw from discard (button or clicking discard pile) ───────────────────
  if (e.target.id === 'draw-discard-btn' || e.target.closest('#discard-pile')) {
    handleDrawDiscard();
    return;
  }

  // ── Add word row ──────────────────────────────────────────────────────────
  if (e.target.id === 'add-word-btn') {
    playerWordGroups.push([]);
    refresh();
    return;
  }

  // ── Remove word row ───────────────────────────────────────────────────────
  if (e.target.classList.contains('remove-row')) {
    const rowIndex = parseInt(e.target.dataset.rowIndex, 10);
    const removed = playerWordGroups.splice(rowIndex, 1)[0] || [];
    gameState.player.hand.push(...removed);
    refresh();
    return;
  }

  // ── Go Out ────────────────────────────────────────────────────────────────
  if (e.target.id === 'go-out-btn') {
    handleGoOut();
    return;
  }

  // ── End Turn ──────────────────────────────────────────────────────────────
  if (e.target.id === 'end-turn-btn') {
    handleEndTurn();
    return;
  }

  // ── Card click in player hand → select for discard ────────────────────────
  if (
    gameState.turn === 'player' &&
    gameState.turnPhase === 'discard' &&
    gameState.phase === 'round'
  ) {
    const cardEl = e.target.closest('#player-hand .card');
    if (cardEl) {
      const alreadySelected = cardEl.classList.contains('selected');
      document.querySelectorAll('#player-hand .card').forEach(c => c.classList.remove('selected'));
      if (!alreadySelected) cardEl.classList.add('selected');
    }
  }
});

// ─── Draw handlers ────────────────────────────────────────────────────────────

function handleDrawDeck() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'draw' || gameState.phase !== 'round') return;
  if (gameState.deck.length === 0) {
    refresh('The deck is empty — you must draw from the discard pile.');
    return;
  }
  drawFromDeck(gameState);
  const isFinal = gameState.outBy !== null;
  refresh(isFinal
    ? 'Your final turn! Arrange words then discard a card (or click Go Out! with one card in hand).'
    : 'Drew from deck. Arrange words, then discard a card to end your turn (or Go Out! with one left).');
}

function handleDrawDiscard() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'draw' || gameState.phase !== 'round') return;
  if (gameState.discard.length === 0) {
    refresh('Discard pile is empty.');
    return;
  }
  drawFromDiscard(gameState);
  const isFinal = gameState.outBy !== null;
  refresh(isFinal
    ? 'Your final turn! Arrange words then discard a card (or click Go Out! with one card in hand).'
    : 'Drew from discard. Arrange words, then discard a card to end your turn (or Go Out! with one left).');
}

// ─── Go Out ───────────────────────────────────────────────────────────────────

function handleGoOut() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;

  // Must have exactly 1 card in hand (the required discard) and valid words in the zone.
  if (gameState.player.hand.length === 0) {
    refresh('You must keep one card in hand to discard — drag a card back from the word zone.');
    return;
  }
  if (gameState.player.hand.length > 1) {
    refresh(`Move all but one card into the word zone — the remaining hand card will be discarded.`);
    return;
  }
  if (playerWordGroups.length === 0 || playerWordGroups.every(g => g.length === 0)) {
    refresh('Arrange your cards into words first.');
    return;
  }

  // Discard the single remaining hand card, then declare go-out.
  const discardId = gameState.player.hand[0].id;
  discardCard(gameState, discardId);
  const result = goOut(gameState, playerWordGroups, dict);
  if (!result.success) {
    refresh('Cannot go out: ' + result.errors.join(' '));
    return;
  }

  playerWordGroups = [];

  if (result.isFinalTurn) {
    scoreRound(gameState);
    gameState.phase = 'roundEnd';
    checkGameEnd(gameState);
    refresh();
  } else {
    refresh('You went out! Computer takes one final turn…');
    setTimeout(runComputerFinalTurn, 400);
  }
}

// ─── End Turn (discard a card) ────────────────────────────────────────────────

function discardAndEndTurn(cardId) {
  const isFinalTurn = gameState.outBy !== null;
  if (isFinalTurn) {
    discardCard(gameState, cardId);
    endFinalTurn(gameState, playerWordGroups, dict);
    playerWordGroups = [];
    checkGameEnd(gameState);
    refresh();
  } else {
    // If the card being discarded is the only card left in hand and the word
    // zone holds valid words, treat this discard as going out.
    if (gameState.player.hand.length === 1 &&
        gameState.player.hand[0].id === cardId &&
        playerWordGroups.length > 0 &&
        validateWordGroups(playerWordGroups, dict).valid) {
      discardCard(gameState, cardId);      // hand is now empty
      const result = goOut(gameState, playerWordGroups, dict);
      playerWordGroups = [];
      if (result.isFinalTurn) {
        scoreRound(gameState);
        gameState.phase = 'roundEnd';
        checkGameEnd(gameState);
        refresh();
      } else {
        refresh('You went out! Computer takes one final turn…');
        setTimeout(runComputerFinalTurn, 400);
      }
      return;
    }

    discardCard(gameState, cardId);
    advanceTurn(gameState);
    refresh('Computer is thinking…');
    setTimeout(runComputerTurn, 400);
  }
}

function handleEndTurn() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;

  if (gameState.player.hand.length === 0) {
    refresh('All cards are in the word zone — drag one back to hand to discard, or click Go Out! if your words are ready.');
    return;
  }

  const selectedEl = document.querySelector('#player-hand .card.selected');
  if (!selectedEl) {
    refresh('Click a card in your hand to select it for discard, then click End Turn.');
    return;
  }

  discardAndEndTurn(selectedEl.dataset.cardId);
}

// ─── Computer turns ───────────────────────────────────────────────────────────

/** Normal computer turn during a round. */
function runComputerTurn() {
  if (gameState.phase !== 'round' || gameState.turn !== 'computer') return;

  const result = aiTakeTurn(gameState, dict);

  if (result.wentOut) {
    // Computer went out — player gets one final turn (turn already set to 'player' by goOut)
    refresh(`Computer went out with ${result.words.length} word(s)! Your final turn — draw a card.`);
    return;
  }

  const drewMsg = result.drewFrom === 'discard' ? 'drew from discard' : 'drew from deck';
  const discMsg = result.discarded ? `and discarded ${result.discarded.letters}` : '';
  advanceTurn(gameState);
  refresh(`Computer ${drewMsg} ${discMsg}. Your turn — draw a card.`);
}

/** Computer's one bonus final turn after the player went out. */
function runComputerFinalTurn() {
  if (gameState.phase !== 'round' || gameState.turn !== 'computer') {
    // Safety: score and end if state is unexpected
    scoreRound(gameState);
    gameState.phase = 'roundEnd';
    checkGameEnd(gameState);
    refresh();
    return;
  }

  const result = aiTakeTurn(gameState, dict);

  if (!result.wentOut) {
    // Computer couldn't go out — commit its best partial word arrangement
    const partial = findPartialPartition(gameState.computer.hand, dict, 300);
    const usedIds = new Set(partial.words.flat().map(c => c.id));
    gameState.computer.words = partial.words;
    gameState.computer.hand = gameState.computer.hand.filter(c => !usedIds.has(c.id));
  }
  // If wentOut: goOut() already committed computer.words and cleared computer.hand

  scoreRound(gameState);
  gameState.finalTurnDone = true;
  gameState.phase = 'roundEnd';
  checkGameEnd(gameState);
  refresh();
}

// ─── Round / game management ──────────────────────────────────────────────────

function startNewGame() {
  gameState = createGameState();
  playerWordGroups = [];
  startNextRound();
}

function startNextRound() {
  const freshDeck = createDeck();
  dealRound(gameState, freshDeck);
  playerWordGroups = [];

  const firstMsg = gameState.turn === 'player'
    ? 'You go first — draw a card.'
    : 'Computer goes first…';

  refresh(firstMsg);

  if (gameState.turn === 'computer') {
    setTimeout(runComputerTurn, 400);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  renderMessage('Loading dictionary…');
  try {
    dict = await loadDictionary();
    document.getElementById('new-game-btn').disabled = false;
    startNewGame(); // auto-deal on load
  } catch (err) {
    renderMessage('Failed to load dictionary. Serve the game with a local web server (e.g. python3 -m http.server).');
    console.error(err);
  }
}

init();

// ─── Build timestamp ──────────────────────────────────────────────────────────
// Issue HEAD requests for every source file and display the newest Last-Modified.

(async function stampBuildTime() {
  const sources = [
    'index.html', 'css/style.css', 'data/words.txt',
    'js/cards.js', 'js/dictionary.js', 'js/gameEngine.js',
    'js/ai.js', 'js/ui.js', 'js/drag.js', 'js/main.js',
  ];

  let maxTime = 0;
  await Promise.all(sources.map(async src => {
    try {
      const res = await fetch(src, { method: 'HEAD' });
      const lm = res.headers.get('Last-Modified');
      if (lm) maxTime = Math.max(maxTime, new Date(lm).getTime());
    } catch { /* ignore individual failures */ }
  }));

  // Fall back to the HTML page's own modification time
  if (!maxTime && document.lastModified) {
    maxTime = new Date(document.lastModified).getTime();
  }

  if (maxTime) {
    const stamp = new Date(maxTime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const el = document.getElementById('build-stamp');
    if (el) el.textContent = stamp;
  }
})();
