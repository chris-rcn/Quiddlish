// Quiddlish — main entry point
// Wires together: game engine, AI, UI, and drag-and-drop.

// ─── App state ───────────────────────────────────────────────────────────────

let gameState = null;
let dict = null;
let wordIndex = null;

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

// ─── Round-score logging ──────────────────────────────────────────────────────

function logRoundScores(state) {
  const pLong = state.player.longestWord;
  const cLong = state.computer.longestWord;
  if (pLong > cLong) {
    renderMessage('Longest-word bonus: You +10 pts');
  } else if (cLong > pLong) {
    renderMessage('Longest-word bonus: Computer +10 pts');
  }
  for (const [who, label] of [['computer', 'Computer'], ['player', 'You']]) {
    const p = state[who];
    const wordsPoints = p.words.flat().reduce((s, c) => s + c.points, 0);
    const unusedPoints = p.hand.reduce((s, c) => s + c.points, 0);
    const parts = [`${label}: words +${wordsPoints}`];
    if (unusedPoints > 0) parts.push(`unused −${unusedPoints}`);
    renderMessage(parts.join(', '));
  }
}

// ─── Draw-from-discard helpers (used by drag callbacks) ──────────────────────

function doDrawFromDiscard() {
  if (gameState.turn !== 'player' || gameState.turnPhase !== 'draw' || gameState.phase !== 'round') return false;
  if (!gameState.discard.length) return false;
  drawFromDiscard(gameState);
  return true;
}

function refreshAfterDiscardDraw() {
  const isFinal = gameState.outBy !== null;
  refresh(isFinal
    ? 'Your final turn! Arrange words then drag a card to discard.'
    : 'Drew from discard. Arrange words, then drag a card to discard.');
}

// ─── Drag integration ────────────────────────────────────────────────────────

function attachDragListeners() {
  initDragAndDrop({
    onHandReorderById(dragId, targetId) {
      const hand = gameState.player.hand;
      const fromIdx = hand.findIndex(c => c.id === dragId);
      if (fromIdx === -1) return;
      const [card] = hand.splice(fromIdx, 1);
      const insertAt = hand.findIndex(c => c.id === targetId);
      if (insertAt === -1) { hand.push(card); return; }
      hand.splice(insertAt, 0, card);
      refresh();
    },

    onHandMoveToEnd(cardId) {
      const hand = gameState.player.hand;
      const idx = hand.findIndex(c => c.id === cardId);
      if (idx === -1) return;
      hand.push(hand.splice(idx, 1)[0]);
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

    onCardToWordInsertBefore(cardId, rowIndex, targetCardId) {
      const hand = gameState.player.hand;
      const cardIdx = hand.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = hand.splice(cardIdx, 1);
      while (playerWordGroups.length <= rowIndex) playerWordGroups.push([]);
      const group = playerWordGroups[rowIndex];
      const targetIdx = group.findIndex(c => c.id === targetCardId);
      if (targetIdx === -1) { group.push(card); } else { group.splice(targetIdx, 0, card); }
      refresh();
    },

    onWordToHand(cardId, rowIndex) {
      if (rowIndex >= playerWordGroups.length) return;
      const group = playerWordGroups[rowIndex];
      const cardIdx = group.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = group.splice(cardIdx, 1);
      gameState.player.hand.push(card);
      refresh();
    },

    onWordToHandInsertBefore(cardId, rowIndex, targetCardId) {
      if (rowIndex >= playerWordGroups.length) return;
      const group = playerWordGroups[rowIndex];
      const cardIdx = group.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = group.splice(cardIdx, 1);
      const hand = gameState.player.hand;
      const targetIdx = hand.findIndex(c => c.id === targetCardId);
      if (targetIdx === -1) { hand.push(card); } else { hand.splice(targetIdx, 0, card); }
      refresh();
    },

    onWordReorderById(cardId, rowIndex, targetCardId) {
      const group = playerWordGroups[rowIndex];
      if (!group) return;
      const fromIdx = group.findIndex(c => c.id === cardId);
      if (fromIdx === -1) return;
      const [card] = group.splice(fromIdx, 1);
      // Find target's position AFTER removing the source card so indices are already correct
      const toIdx = group.findIndex(c => c.id === targetCardId);
      if (toIdx === -1) { group.push(card); return; }
      group.splice(toIdx, 0, card);
      refresh();
    },

    onWordMoveToEnd(cardId, rowIndex) {
      const group = playerWordGroups[rowIndex];
      if (!group) return;
      const fromIdx = group.findIndex(c => c.id === cardId);
      if (fromIdx === -1 || fromIdx === group.length - 1) return;
      const [card] = group.splice(fromIdx, 1);
      group.push(card);
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
      refresh();
    },

    onWordToWordInsertBefore(cardId, fromRow, toRow, targetCardId) {
      if (fromRow >= playerWordGroups.length) return;
      const srcGroup = playerWordGroups[fromRow];
      const cardIdx  = srcGroup.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return;
      const [card] = srcGroup.splice(cardIdx, 1);
      while (playerWordGroups.length <= toRow) playerWordGroups.push([]);
      const dstGroup = playerWordGroups[toRow];
      const targetIdx = dstGroup.findIndex(c => c.id === targetCardId);
      if (targetIdx === -1) { dstGroup.push(card); } else { dstGroup.splice(targetIdx, 0, card); }
      refresh();
    },

    onDrawFromDiscardToHand() {
      if (!doDrawFromDiscard()) return;
      refreshAfterDiscardDraw();
    },

    onDrawFromDiscardToHandBefore(targetCardId) {
      if (!doDrawFromDiscard()) return;
      const hand = gameState.player.hand;
      const drawn = hand[hand.length - 1];
      const targetIdx = hand.findIndex(c => c.id === targetCardId);
      if (targetIdx !== -1 && targetIdx < hand.length - 1) {
        hand.splice(hand.length - 1, 1);
        hand.splice(targetIdx, 0, drawn);
      }
      refreshAfterDiscardDraw();
    },

    onDrawFromDiscardToWord(rowIndex) {
      if (!doDrawFromDiscard()) return;
      const drawn = gameState.player.hand.pop();
      while (playerWordGroups.length <= rowIndex) playerWordGroups.push([]);
      playerWordGroups[rowIndex].push(drawn);
      refreshAfterDiscardDraw();
    },

    onDrawFromDiscardToWordBefore(rowIndex, targetCardId) {
      if (!doDrawFromDiscard()) return;
      const drawn = gameState.player.hand.pop();
      while (playerWordGroups.length <= rowIndex) playerWordGroups.push([]);
      const group = playerWordGroups[rowIndex];
      const targetIdx = group.findIndex(c => c.id === targetCardId);
      if (targetIdx === -1) { group.push(drawn); } else { group.splice(targetIdx, 0, drawn); }
      refreshAfterDiscardDraw();
    },

    onDiscardCard(cardId) {
      if (gameState.turn !== 'player' || gameState.turnPhase !== 'discard' || gameState.phase !== 'round') return;
      // If the card is in a word group, move it to hand first
      if (!gameState.player.hand.find(c => c.id === cardId)) {
        for (const group of playerWordGroups) {
          const idx = group.findIndex(c => c.id === cardId);
          if (idx !== -1) {
            gameState.player.hand.push(...group.splice(idx, 1));
            break;
          }
        }
      }
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

  // ── Shuffle hand ──────────────────────────────────────────────────────────
  if (e.target.id === 'shuffle-hand-btn') {
    if (gameState.turn === 'player' && gameState.phase === 'round') {
      shuffleDeck(gameState.player.hand);
      refresh();
    }
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
    ? 'Your final turn! Arrange words then drag a card to discard.'
    : 'Drew from deck. Arrange words, then drag a card to discard.');
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
    ? 'Your final turn! Arrange words then drag a card to discard.'
    : 'Drew from discard. Arrange words, then drag a card to discard.');
}

// ─── End Turn (discard a card) ────────────────────────────────────────────────

function discardAndEndTurn(cardId) {
  const isFinalTurn = gameState.outBy !== null;
  if (isFinalTurn) {
    discardCard(gameState, cardId);
    endFinalTurn(gameState, playerWordGroups, dict);
    playerWordGroups = [];
    checkGameEnd(gameState);
    logRoundScores(gameState);
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
      const playerWordPts = gameState.player.words.flat().reduce((s, c) => s + c.points, 0);
      if (result.isFinalTurn) {
        scoreRound(gameState);
        gameState.phase = 'roundEnd';
        checkGameEnd(gameState);
        logRoundScores(gameState);
        refresh(`You went out — words scored +${playerWordPts} pts.`);
      } else {
        refresh(`You went out — words scored +${playerWordPts} pts. Computer takes one final turn…`);
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

// ─── Computer turns ───────────────────────────────────────────────────────────

/** Normal computer turn during a round. */
function runComputerTurn() {
  if (gameState.phase !== 'round' || gameState.turn !== 'computer') return;

  const result = aiTakeTurn(gameState, dict, wordIndex);

  if (result.wentOut) {
    // Computer went out — player gets one final turn (turn already set to 'player' by goOut)
    const computerWordPts = result.words.flat().reduce((s, c) => s + c.points, 0);
    refresh(`Computer went out with ${result.words.length} word(s) (+${computerWordPts} pts)! Your final turn — draw a card.`);
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
    logRoundScores(gameState);
    refresh();
    return;
  }

  const result = aiTakeTurn(gameState, dict, wordIndex);

  let computerGoOutMsg = null;
  if (result.wentOut) {
    const computerWordPts = result.words.flat().reduce((s, c) => s + c.points, 0);
    computerGoOutMsg = `Computer went out — words scored +${computerWordPts} pts.`;
  } else {
    // Computer couldn't go out — commit its best partial word arrangement
    const partial = findPartialPartition(gameState.computer.hand, dict, wordIndex);
    const usedIds = new Set(partial.words.flat().map(c => c.id));
    gameState.computer.words = partial.words;
    gameState.computer.hand = gameState.computer.hand.filter(c => !usedIds.has(c.id));
  }
  // If wentOut: goOut() already committed computer.words and cleared computer.hand

  scoreRound(gameState);
  gameState.finalTurnDone = true;
  gameState.phase = 'roundEnd';
  checkGameEnd(gameState);
  logRoundScores(gameState);
  refresh(computerGoOutMsg);
}

// ─── Round / game management ──────────────────────────────────────────────────

function startNewGame() {
  gameState = createGameState();
  playerWordGroups = [];
  clearGameLog();
  startNextRound();
}

function startNextRound() {
  const freshDeck = createDeck();
  dealRound(gameState, freshDeck);
  const slotCount = Math.floor(cardsForRound(gameState.round) / 3);
  playerWordGroups = Array.from({ length: Math.max(1, slotCount) }, () => []);

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
    wordIndex = buildWordIndex(dict, CARD_DEFINITIONS);
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
