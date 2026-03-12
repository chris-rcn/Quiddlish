// Quiddlish AI — rule-based computer player

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

/**
 * Decide whether to draw from the discard pile.
 * Heuristic: try adding topDiscard to hand and see if it improves the partition.
 * @param {Card[]} hand
 * @param {Card} topDiscard
 * @param {Set<string>} dict
 * @param {Map} wordIndex
 * @returns {boolean}
 */
function shouldDrawDiscard(hand, topDiscard, dict, wordIndex) {
  if (!topDiscard) return false;
  const without  = findPartialPartition(hand, dict, wordIndex);
  const withCard = findPartialPartition([...hand, topDiscard], dict, wordIndex);
  const gainedPts = withCard.words.flat().reduce((s, c) => s + c.points, 0)
    - without.words.flat().reduce((s, c) => s + c.points, 0);
  return gainedPts > 0;
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
 * @returns {{ drewFrom, discarded, wentOut, words }}
 */
function aiTakeTurn(state, dict, wordIndex) {
  const who = state.turn;
  const hand = [...state[who].hand];
  const topDiscard = state.discard;

  // 1. Decide draw source
  const drawDiscard = shouldDrawDiscard(hand, topDiscard, dict, wordIndex);
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

