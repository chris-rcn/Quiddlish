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
  // Re-attach drag listeners after every render (DOM is fully replaced)
  if (
    gameState.phase === 'round' &&
    gameState.turn === 'player' &&
    gameState.turnPhase === 'discard'
  ) {
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
  playerWordGroups = []; // reset word zone on new draw
  const isFinal = gameState.outBy !== null;
  refresh(isFinal
    ? 'Your final turn! Arrange words then Go Out or select a card and End Turn.'
    : 'Drew from deck. Arrange words then Go Out, or select a card and End Turn.');
}

function handleDrawDiscard() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'draw' || gameState.phase !== 'round') return;
  if (gameState.discard.length === 0) {
    refresh('Discard pile is empty.');
    return;
  }
  drawFromDiscard(gameState);
  playerWordGroups = [];
  const isFinal = gameState.outBy !== null;
  refresh(isFinal
    ? 'Your final turn! Arrange words then Go Out or select a card and End Turn.'
    : 'Drew from discard. Arrange words then Go Out, or select a card and End Turn.');
}

// ─── Go Out ───────────────────────────────────────────────────────────────────

function handleGoOut() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;

  // Verify ALL hand cards have been placed into the word zone
  const unplaced = gameState.player.hand.length; // hand is empty when all dragged out
  if (unplaced > 0) {
    refresh(`Place all ${unplaced} remaining hand card(s) into words before going out.`);
    return;
  }
  if (playerWordGroups.length === 0 || playerWordGroups.every(g => g.length === 0)) {
    refresh('Arrange your cards into words first.');
    return;
  }

  const result = goOut(gameState, playerWordGroups, dict);
  if (!result.success) {
    refresh('Cannot go out: ' + result.errors.join(' '));
    return;
  }

  playerWordGroups = [];

  if (result.isFinalTurn) {
    // Player went out on their final turn (computer went out first) → score now
    scoreRound(gameState);
    gameState.phase = 'roundEnd';
    checkGameEnd(gameState);
    refresh();
  } else {
    // Player went out first → computer gets one final turn
    refresh('You went out! Computer takes one final turn…');
    setTimeout(runComputerFinalTurn, 400);
  }
}

// ─── End Turn (discard a selected hand card) ──────────────────────────────────

function handleEndTurn() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;

  // If all cards are in the word zone, remind player to Go Out instead
  if (gameState.player.hand.length === 0) {
    refresh('All cards are in the word zone — click "Go Out!" to declare your words, or drag some back to hand and discard one.');
    return;
  }

  const selectedEl = document.querySelector('#player-hand .card.selected');
  if (!selectedEl) {
    refresh('Click a card in your hand to select it for discard, then click End Turn.');
    return;
  }

  const cardId = selectedEl.dataset.cardId;
  const isFinalTurn = gameState.outBy !== null;

  if (isFinalTurn) {
    // Player's bonus final turn: commit word arrangement, discard one card, score
    discardCard(gameState, cardId);
    // playerWordGroups cards were already removed from hand via drag; commit them
    endFinalTurn(gameState, playerWordGroups, dict);
    playerWordGroups = [];
    checkGameEnd(gameState);
    refresh();
  } else {
    // Normal turn: return word zone cards to hand, discard, pass to computer
    const wordZoneCards = playerWordGroups.flat();
    gameState.player.hand.push(...wordZoneCards);
    playerWordGroups = [];
    discardCard(gameState, cardId);
    advanceTurn(gameState);
    refresh('Computer is thinking…');
    setTimeout(runComputerTurn, 400);
  }
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
