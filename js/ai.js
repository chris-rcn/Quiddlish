// Quiddlish AI — rule-based computer player

/**
 * Agent configuration object controlling AI behaviour.
 * @typedef {object} Agent
 * @property {number} mcSims                  — Monte Carlo samples for draw decision (0 = simple heuristic)
 * @property {number} longestWordFeatureWeight — scales the ±10 longest-word bonus term in discard
 *   scoring (0 = disabled; 1 = full expected bonus; default 0)
 * @property {number} longestWordSigma         — std-dev of the normal model used to estimate the
 *   opponent's longest word when they haven't gone out yet (default 1.5)
 */

/** Default agent used by the browser game. */
const DEFAULT_AGENT = { mcSims: 10, longestWordFeatureWeight: 0, longestWordSigma: 1.5 };

// Self-play observed average longest-word letter-length per round (index 0 unused).
const AVG_LONG_BY_ROUND = [0, 3.2, 4.3, 5.2, 3.5, 4.3, 5.2, 4.1, 4.4];

/**
 * Normal CDF via Abramowitz & Stegun rational approximation (error < 7.5e-8).
 * @param {number} x
 * @returns {number} Φ(x)
 */
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.39894228 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.31938153 + t * (-0.35656378 + t * (1.78147794 + t * (-1.82125598 + t * 1.33027443))));
  return x >= 0 ? 1 - p : p;
}

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
 * Choose the card to discard: one-step lookahead maximising
 *
 *   score = wordCardPoints + longestWordFeatureWeight · (10·P(win) − 10·P(lose))
 *
 * When longestWordFeatureWeight is 0 (default) this reduces to the original
 * word-card point sum, preserving existing behaviour exactly.
 *
 * P(win) / P(lose) depend on whether the opponent has already gone out:
 *  - Opponent went out: their words are visible; comparison is exact (+10 / 0 / −10).
 *  - Opponent still playing: model their longest word as N(μ, σ²) where μ comes
 *    from AVG_LONG_BY_ROUND[roundNumber] and σ = agent.longestWordSigma.
 *
 * @param {Card[]} hand
 * @param {Set<string>} dict
 * @param {Map} wordIndex
 * @param {Agent} [agent]
 * @param {{ roundNumber: number, opponentLongestWord: number|null }} [ctx]
 *   opponentLongestWord: null   = opponent hasn't gone out yet (use normal-CDF model)
 *                        number = opponent's known longest word letter-length
 * @returns {Card}
 */
function chooseBestDiscard(hand, dict, wordIndex, agent = DEFAULT_AGENT, ctx = { roundNumber: 1, opponentLongestWord: null }) {
  const w = agent.longestWordFeatureWeight ?? 0;
  let bestScore = -Infinity;
  let bestCard = hand[0];

  for (const card of hand) {
    const remaining = hand.filter(c => c.id !== card.id);
    const partition = findPartialPartition(remaining, dict, wordIndex);
    const pts = partition.words.flat().reduce((s, c) => s + c.points, 0);

    let bonus = 0;
    if (w !== 0) {
      const h = partition.words.reduce(
        (max, g) => Math.max(max, g.map(c => c.letters).join('').length), 0);

      if (ctx.opponentLongestWord !== null) {
        // Opponent already went out — exact comparison
        const v = ctx.opponentLongestWord;
        bonus = h > v ? 10 : h < v ? -10 : 0;
      } else {
        // Opponent not yet out — normal-CDF approximation
        const mu = AVG_LONG_BY_ROUND[ctx.roundNumber] ?? 4.0;
        const sigma = agent.longestWordSigma ?? 1.5;
        const pWin = normalCDF((h - mu) / sigma);
        bonus = 10 * (2 * pWin - 1);
      }
    }

    const score = pts + w * bonus;
    if (score > bestScore) { bestScore = score; bestCard = card; }
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
  const opponent = who === 'player' ? 'computer' : 'player';
  const opponentLongestWord = state.outBy !== null
    ? state[opponent].words.reduce(
        (max, g) => Math.max(max, g.map(c => c.letters).join('').length), 0)
    : null;
  const cardToDiscard = chooseBestDiscard(newHand, dict, wordIndex, agent, {
    roundNumber: state.round,
    opponentLongestWord,
  });
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
