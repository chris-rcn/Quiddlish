// Quiddlish Game Engine — state machine and rules

const TOTAL_ROUNDS = 8;
function cardsForRound(round) { return round + 2; } // round 1 → 3 cards

/**
 * Create a fresh game state.
 */
function createGameState() {
  return {
    phase: 'start',   // 'start' | 'round' | 'roundEnd' | 'gameEnd'
    round: 0,
    deck: [],
    discard: null,
    player: {
      hand: [],
      words: [],      // Card[][] — groups committed as words
      score: 0,
      roundScore: 0,
      longestWord: 0,
    },
    computer: {
      hand: [],
      words: [],
      score: 0,
      roundScore: 0,
      longestWord: 0,
    },
    turn: 'player',             // whose turn it is right now
    roundFirstPlayer: 'player', // who goes first this round
    turnPhase: 'draw',          // 'draw' | 'discard'
    outBy: null,                // null | 'player' | 'computer' — who went out first
    finalTurnDone: false,       // has the other player taken their bonus turn
    message: '',
  };
}

/**
 * Start a new round: increment round counter, deal cards, set first player.
 * @param {object} state — mutated in place
 * @param {Card[]} freshDeck — a new shuffled deck
 */
function dealRound(state, freshDeck) {
  state.round += 1;
  state.deck = freshDeck;
  state.discard = null;
  state.outBy = null;
  state.finalTurnDone = false;
  state.phase = 'round';

  // Determine first player
  if (state.round === 1) {
    state.roundFirstPlayer = Math.random() < 0.5 ? 'player' : 'computer';
  } else {
    state.roundFirstPlayer = state.roundFirstPlayer === 'player' ? 'computer' : 'player';
  }
  state.turn = state.roundFirstPlayer;
  state.turnPhase = 'draw';

  const n = cardsForRound(state.round);

  // Reset per-round fields
  for (const who of ['player', 'computer']) {
    state[who].hand = [];
    state[who].words = [];
    state[who].roundScore = 0;
    state[who].longestWord = 0;
  }

  // Deal n cards to each player
  for (let i = 0; i < n; i++) {
    state.player.hand.push(state.deck.pop());
    state.computer.hand.push(state.deck.pop());
  }

  // Flip one card to start the discard
  state.discard = state.deck.pop();
}

/** Reshuffle the deck (called after every draw per game rules). */
function reshuffle(state) {
  shuffleDeck(state.deck);
}

/** Draw top card from deck into the active player's hand. */
function drawFromDeck(state) {
  if (state.deck.length === 0) return null;
  const card = state.deck.pop();
  state[state.turn].hand.push(card);
  reshuffle(state);
  state.turnPhase = 'discard';
  return card;
}

/** Draw the discard card into the active player's hand. */
function drawFromDiscard(state) {
  if (state.discard === null) return null;
  const card = state.discard;
  state.discard = null;
  state[state.turn].hand.push(card);
  reshuffle(state);
  state.turnPhase = 'discard';
  return card;
}

/**
 * Discard a card from the active player's hand.
 * @param {object} state
 * @param {string} cardId
 * @returns {Card|null}
 */
function discardCard(state, cardId) {
  const player = state[state.turn];
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx === -1) return null;
  const [card] = player.hand.splice(idx, 1);
  state.discard = card;
  return card;
}

/**
 * Validate a set of word groups.
 * Each group must have ≥3 cards and the concatenated letters must be in the dictionary.
 * @param {Card[][]} groups
 * @param {Set<string>} dict
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateWordGroups(groups, dict) {
  const errors = [];
  if (groups.length === 0) {
    errors.push('No words formed.');
    return { valid: false, errors };
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.length < 3) {
      errors.push(`Word ${i + 1} needs at least 3 cards.`);
      continue;
    }
    const word = g.map(c => c.letters).join('').toLowerCase();
    if (!dict.has(word)) {
      errors.push(`"${word.toUpperCase()}" is not a valid word.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Declare "go out" using the given word groups.
 * wordGroups must cover all cards not already in opponent's zone.
 * The caller (main.js) is responsible for ensuring all hand cards are in wordGroups.
 *
 * If this is the first player to go out → give the other player one final turn.
 * If the other player already went out → this is a final turn; round ends.
 *
 * @returns {{ success: boolean, errors: string[], isFinalTurn: boolean }}
 */
function goOut(state, wordGroups, dict) {
  const who = state.turn;
  const player = state[who];

  const validation = validateWordGroups(wordGroups, dict);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, isFinalTurn: false };
  }

  player.words = wordGroups;
  player.hand = []; // all cards committed; main.js verified nothing left in hand

  const isFinalTurn = state.outBy !== null;

  if (isFinalTurn) {
    // This player is taking their bonus final turn and goes out — round ends
    state.finalTurnDone = true;
  } else {
    // First player to go out — give other player their one final turn
    state.outBy = who;
    const other = who === 'player' ? 'computer' : 'player';
    state.turn = other;
    state.turnPhase = 'draw';
  }

  return { success: true, errors: [], isFinalTurn };
}

/**
 * End the other player's final turn (when they cannot or choose not to go out).
 * Commits valid word groups; cards in invalid groups stay in hand as unused.
 * Then scores the round.
 *
 * @param {object} state   — state.turn should still be the player taking the final turn
 * @param {Card[][]} wordGroups
 * @param {Set<string>} dict
 */
function endFinalTurn(state, wordGroups, dict) {
  const who = state.turn;
  const player = state[who];

  // Separate valid words from invalid ones
  const validGroups = [];
  const unusedFromInvalid = [];
  for (const g of wordGroups) {
    if (g.length >= 3) {
      const word = g.map(c => c.letters).join('').toLowerCase();
      if (dict.has(word)) {
        validGroups.push(g);
        continue;
      }
    }
    unusedFromInvalid.push(...g);
  }

  // Cards from invalid groups return to hand (counted as unused)
  player.hand.push(...unusedFromInvalid);
  player.words = validGroups;
  // Note: valid word cards were already removed from player.hand via drag-and-drop

  state.finalTurnDone = true;
  scoreRound(state);
  state.phase = 'roundEnd';
}

/**
 * Score the current round for both players.
 * Assumes player.words (committed words) and player.hand (unused cards) are final.
 */
function scoreRound(state) {
  for (const who of ['player', 'computer']) {
    const p = state[who];
    const wordsPoints = p.words.flat().reduce((s, c) => s + c.points, 0);
    const unusedPoints = p.hand.reduce((s, c) => s + c.points, 0);
    p.roundScore = wordsPoints - unusedPoints;

    p.longestWord = p.words.reduce((max, g) => {
      const len = g.map(c => c.letters).join('').length;
      return Math.max(max, len);
    }, 0);
  }

  // Longest-word bonus: +10 to whoever has the longer word
  if (state.player.longestWord > state.computer.longestWord) {
    state.player.roundScore += 10;
  } else if (state.computer.longestWord > state.player.longestWord) {
    state.computer.roundScore += 10;
  }

  state.player.score += state.player.roundScore;
  state.computer.score += state.computer.roundScore;
}

/** Advance turn to the next player (after a normal discard). */
function advanceTurn(state) {
  state.turn = state.turn === 'player' ? 'computer' : 'player';
  state.turnPhase = 'draw';
}

/** If all 8 rounds are done, move to gameEnd. Returns true if game is over. */
function checkGameEnd(state) {
  if (state.round >= TOTAL_ROUNDS && state.phase === 'roundEnd') {
    state.phase = 'gameEnd';
    return true;
  }
  return false;
}
