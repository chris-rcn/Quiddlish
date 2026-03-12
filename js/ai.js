// Quiddlish AI — rule-based computer player

/**
 * Agent configuration object controlling AI behaviour.
 * @typedef {object} Agent
 * @property {number} mcSims — Monte Carlo samples for draw decision (0 = simple heuristic)
 */

/** Default agent used by the browser game. */
const DEFAULT_AGENT = { mcSims: 10 };

/**
 * Find the best partition of hand cards into valid words.
 * @param {Card[]} hand
 * @param {Set<string>} dict  (unused — kept for API compatibility)
 * @param {Map} wordIndex — precomputed token-multiset index from buildWordIndex()
 * @returns {Card[][]|null} — array of word groups using all cards, or null if not found
 */
function findBestWordPartition(hand, dict, wordIndex) {
  function backtrack(remaining, groups) {
    if (remaining.length === 0) return groups;
    for (let size = 3; size <= remaining.length; size++) {
      for (const subset of combinations(remaining, size)) {
        const hits = wordIndex.get(cardSubsetKey(subset));
        if (hits) {
          const arranged = arrangeCards(subset, hits[0].tokenOrder);
          if (arranged) {
            const rest = remaining.filter(c => !subset.includes(c));
            const result = backtrack(rest, [...groups, arranged]);
            if (result !== null) return result;
          }
        }
      }
    }
    return null;
  }
  return backtrack(hand, []);
}

/**
 * Find the best PARTIAL partition — maximizes word points covered.
 * Returns { words: Card[][], unused: Card[] }
 * @param {Card[]} hand
 * @param {Set<string>} dict  (unused — kept for API compatibility)
 * @param {Map} wordIndex — precomputed token-multiset index from buildWordIndex()
 */
function findPartialPartition(hand, dict, wordIndex) {
  let bestResult = { words: [], unused: [...hand] };
  let bestWordsPoints = 0;

  function updateBest(groups, remaining) {
    const pts = groups.flat().reduce((s, c) => s + c.points, 0);
    if (pts > bestWordsPoints && groups.length > 0) {
      bestWordsPoints = pts;
      bestResult = { words: [...groups], unused: [...remaining] };
    }
  }

  function backtrack(remaining, groups) {
    if (remaining.length === 0) { updateBest(groups, []); return; }
    updateBest(groups, remaining);
    for (let size = 3; size <= remaining.length; size++) {
      for (const subset of combinations(remaining, size)) {
        const hits = wordIndex.get(cardSubsetKey(subset));
        if (hits) {
          const arranged = arrangeCards(subset, hits[0].tokenOrder);
          if (arranged) {
            backtrack(remaining.filter(c => !subset.includes(c)), [...groups, arranged]);
          }
        }
      }
    }
  }

  backtrack(hand, []);
  return bestResult;
}

/** Sum of word-card points in the best partial partition of hand. */
function partitionScore(hand, dict, wordIndex) {
  return findPartialPartition(hand, dict, wordIndex)
    .words.flat().reduce((s, c) => s + c.points, 0);
}

/**
 * Decide whether to draw from the discard pile.
 * When agent.mcSims > 0: Monte Carlo — compare the known value of taking the
 * discard against the expected value of drawing a random card from the deck.
 * When agent.mcSims === 0: simple heuristic — take discard only if it improves
 * the partition score over the current hand.
 * @param {Card[]} hand
 * @param {Card|null} topDiscard
 * @param {Card[]} deck  — remaining deck (used for MC sampling)
 * @param {Set<string>} dict
 * @param {Map} wordIndex
 * @param {Agent} agent
 * @returns {boolean}
 */
function shouldDrawDiscard(hand, topDiscard, deck, dict, wordIndex, agent) {
  if (!topDiscard) return false;

  const discardScore = partitionScore([...hand, topDiscard], dict, wordIndex);

  const sampleSize = Math.min(deck.length, agent.mcSims);
  if (sampleSize === 0) return discardScore > partitionScore(hand, dict, wordIndex);

  let deckTotal = 0;
  for (let i = 0; i < sampleSize; i++) {
    const card = deck[Math.floor(Math.random() * deck.length)];
    deckTotal += partitionScore([...hand, card], dict, wordIndex);
  }
  return discardScore > deckTotal / sampleSize;
}

/**
 * Choose the card to discard: the one whose removal leaves the highest-scoring
 * partial partition on the remaining hand (one-step lookahead).
 * @param {Card[]} hand
 * @param {Set<string>} dict
 * @param {Map} wordIndex
 * @returns {Card}
 */
function chooseBestDiscard(hand, dict, wordIndex) {
  let bestScore = -1;
  let bestCard = hand[0];
  for (const card of hand) {
    const remaining = hand.filter(c => c.id !== card.id);
    const pts = findPartialPartition(remaining, dict, wordIndex)
      .words.flat().reduce((s, c) => s + c.points, 0);
    if (pts > bestScore) { bestScore = pts; bestCard = card; }
  }
  return bestCard;
}

/**
 * Execute the computer's full turn.
 * Mutates state via gameEngine functions.
 * @param {object} state
 * @param {Set<string>} dict
 * @param {Map} wordIndex — precomputed token-multiset index from buildWordIndex()
 * @param {Agent} [agent] — defaults to DEFAULT_AGENT
 * @returns {{ drewFrom, discarded, wentOut, words }}
 */
function aiTakeTurn(state, dict, wordIndex, agent = DEFAULT_AGENT) {
  const who = state.turn;
  const hand = [...state[who].hand];
  const topDiscard = state.discard;

  // 1. Decide draw source
  const drawDiscard = shouldDrawDiscard(hand, topDiscard, state.deck, dict, wordIndex, agent);
  let drewFrom;
  let drawnCard = null;
  if (drawDiscard && topDiscard) {
    drawFromDiscard(state);
    drewFrom = 'discard';
    drawnCard = state[who].hand[state[who].hand.length - 1];
  } else {
    drawFromDeck(state);
    drewFrom = 'deck';
  }

  const newHand = state[who].hand;

  // 2. Can go out? Try each card as the discard (lowest-value first);
  //    check whether the remaining n-1 cards form a complete valid word partition.
  const byValueAsc = [...newHand].sort((a, b) => a.points - b.points);
  for (const discardCandidate of byValueAsc) {
    const remaining = newHand.filter(c => c.id !== discardCandidate.id);
    const full = findBestWordPartition(remaining, dict, wordIndex);
    if (full) {
      discardCard(state, discardCandidate.id);
      const result = goOut(state, full, dict);
      if (result.success) {
        return { drewFrom, drawnCard, discarded: discardCandidate, wentOut: true, words: full, isFinalTurn: result.isFinalTurn };
      }
    }
  }

  // 3. Cannot go out — choose discard that leaves the best remaining partition
  const partial = findPartialPartition(newHand, dict, wordIndex);
  const cardToDiscard = chooseBestDiscard(newHand, dict, wordIndex);
  discardCard(state, cardToDiscard.id);

  return { drewFrom, drawnCard, discarded: cardToDiscard, wentOut: false, words: partial.words, isFinalTurn: false };
}

// ─── Combinatorics helpers ───────────────────────────────────────────────────

/** Generate all combinations of `arr` of length `k`. */
function* combinations(arr, k) {
  if (k === 0) { yield []; return; }
  if (arr.length < k) return;
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}
