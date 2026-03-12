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
 * Choose the card to discard: lowest-value card not contributing to any found word.
 * @param {Card[]} hand
 * @param {Card[][]} foundWords — current best partition
 * @returns {Card}
 */
function chooseBestDiscard(hand, foundWords) {
  const usedIds = new Set(foundWords.flat().map(c => c.id));
  const candidates = hand.filter(c => !usedIds.has(c.id));
  if (candidates.length > 0) {
    // Discard the lowest-value unused card
    return candidates.reduce((min, c) => c.points < min.points ? c : min, candidates[0]);
  }
  // All cards are in words — discard the lowest-value card from the least-valuable word
  return hand.reduce((min, c) => c.points < min.points ? c : min, hand[0]);
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
  const topDiscard = state.discard[state.discard.length - 1] || null;

  // 1. Decide draw source
  const drawDiscard = shouldDrawDiscard(hand, topDiscard, dict, wordIndex);
  let drewFrom;
  if (drawDiscard && topDiscard) {
    drawFromDiscard(state);
    drewFrom = 'discard';
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
        return { drewFrom, discarded: discardCandidate, wentOut: true, words: full, isFinalTurn: result.isFinalTurn };
      }
    }
  }

  // 3. Cannot go out — find partial partition and choose best discard
  const partial = findPartialPartition(newHand, dict, wordIndex);
  const cardToDiscard = chooseBestDiscard(newHand, partial.words);
  discardCard(state, cardToDiscard.id);

  return { drewFrom, discarded: cardToDiscard, wentOut: false, words: partial.words, isFinalTurn: false };
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

