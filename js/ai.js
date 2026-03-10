// Quiddlish AI — rule-based computer player

/**
 * Find the best partition of hand cards into valid words.
 * Uses backtracking with a deadline to avoid excessive computation.
 * @param {Card[]} hand
 * @param {Set<string>} dict
 * @param {number} [timeLimitMs=400]
 * @returns {Card[][]|null} — array of word groups using all cards, or null if not found
 */
function findBestWordPartition(hand, dict, timeLimitMs = 400) {
  const deadline = Date.now() + timeLimitMs;

  function backtrack(remaining, groups) {
    if (Date.now() > deadline) return null;
    if (remaining.length === 0) return groups;

    const maxSize = remaining.length;
    for (let size = 3; size <= maxSize; size++) {
      for (const subset of combinations(remaining, size)) {
        for (const perm of permutations(subset)) {
          if (Date.now() > deadline) return null;
          const word = perm.map(c => c.letters).join('').toLowerCase();
          if (dict.has(word)) {
            const rest = remaining.filter(c => !subset.includes(c));
            const result = backtrack(rest, [...groups, perm]);
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
 * Find the best PARTIAL partition — maximizes word coverage.
 * Returns { words: Card[][], unused: Card[] }
 */
function findPartialPartition(hand, dict, timeLimitMs = 400) {
  const deadline = Date.now() + timeLimitMs;
  let bestResult = { words: [], unused: [...hand] };
  let bestWordsPoints = 0;

  function backtrack(remaining, groups) {
    if (Date.now() > deadline) return;
    if (remaining.length === 0) {
      const pts = groups.flat().reduce((s, c) => s + c.points, 0);
      if (pts > bestWordsPoints) {
        bestWordsPoints = pts;
        bestResult = { words: groups, unused: [] };
      }
      return;
    }

    // Record current state as a candidate (remaining cards are unused)
    const pts = groups.flat().reduce((s, c) => s + c.points, 0);
    if (pts > bestWordsPoints && groups.length > 0) {
      bestWordsPoints = pts;
      bestResult = { words: [...groups], unused: [...remaining] };
    }

    const maxSize = remaining.length;
    for (let size = 3; size <= maxSize; size++) {
      for (const subset of combinations(remaining, size)) {
        if (Date.now() > deadline) return;
        for (const perm of permutations(subset)) {
          const word = perm.map(c => c.letters).join('').toLowerCase();
          if (dict.has(word)) {
            const rest = remaining.filter(c => !subset.includes(c));
            backtrack(rest, [...groups, perm]);
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
 * @returns {boolean}
 */
function shouldDrawDiscard(hand, topDiscard, dict) {
  if (!topDiscard) return false;
  const without = findPartialPartition(hand, dict, 100);
  const withCard = findPartialPartition([...hand, topDiscard], dict, 100);
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
 * Returns { drewFrom: 'deck'|'discard', discarded: Card|null, wentOut: boolean, words: Card[][] }
 */
function aiTakeTurn(state, dict) {
  const hand = [...state.computer.hand];
  const topDiscard = state.discard[state.discard.length - 1] || null;

  // 1. Decide draw source
  const drawDiscard = shouldDrawDiscard(hand, topDiscard, dict);
  let drewFrom;
  if (drawDiscard && topDiscard) {
    drawFromDiscard(state);
    drewFrom = 'discard';
  } else {
    drawFromDeck(state);
    drewFrom = 'deck';
  }

  const newHand = state.computer.hand;

  // 2. Can go out? Must discard exactly 1 card — try each card as the discard,
  //    check whether the remaining n-1 cards form a complete valid word partition.
  //    Prefer discarding the lowest-value card to maximise score.
  const byValueAsc = [...newHand].sort((a, b) => a.points - b.points);
  for (const discardCandidate of byValueAsc) {
    const remaining = newHand.filter(c => c.id !== discardCandidate.id);
    const full = findBestWordPartition(remaining, dict, 300);
    if (full) {
      discardCard(state, discardCandidate.id);
      const result = goOut(state, full, dict);
      if (result.success) {
        return { drewFrom, discarded: discardCandidate, wentOut: true, words: full };
      }
    }
  }

  // 3. Cannot go out — find partial partition and choose best discard
  const partial = findPartialPartition(newHand, dict, 200);
  const cardToDiscard = chooseBestDiscard(newHand, partial.words);
  discardCard(state, cardToDiscard.id);

  return { drewFrom, discarded: cardToDiscard, wentOut: false, words: partial.words };
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

/** Generate all permutations of `arr`. */
function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      yield [arr[i], ...perm];
    }
  }
}
