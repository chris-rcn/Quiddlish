// wordIndex.js — token-multiset index for fast word lookup
//
// Preprocessing step: for every dictionary word, find all ways to decompose it
// into game card tokens (the 31 tile letter-strings: A-Z plus QU, IN, ER, CL, TH).
// Store in a Map keyed by the SORTED canonical token-multiset so that any card
// subset can be checked in O(1) instead of generating k! permutations.
//
// Speedup example: 9-card hand → 466 subset lookups vs ~986K permutation checks.

/**
 * Build the token-multiset → word index.
 *
 * @param {Set<string>} dict  — lowercase dictionary words (from loadDictionary)
 * @param {Array<{letters:string}>} cardDefs — CARD_DEFINITIONS array
 * @returns {Map<string, Array<{word:string, tokenOrder:string[]}>>}
 *   Key: sorted token strings joined by '|', e.g. 'a|e|t'
 *   Value: array of {word, tokenOrder} where tokenOrder is the ordered token
 *          sequence that produces the word, e.g. {word:'eat', tokenOrder:['e','a','t']}
 */
function buildWordIndex(dict, cardDefs) {
  const t0 = Date.now();

  // Collect unique token strings from card definitions (lowercase)
  const tokens = [...new Set(cardDefs.map(d => d.letters.toLowerCase()))];

  // Sort longer tokens first so the DFS prefers multi-char tiles over single
  // chars — avoids missing decompositions where a 2-letter token could match.
  // We actually need ALL decompositions, so we iterate all tokens each step.

  const index = new Map();

  for (const word of dict) {
    const decomps = _findDecompositions(word, tokens);
    for (const tokenOrder of decomps) {
      const key = [...tokenOrder].sort().join('|');
      let arr = index.get(key);
      if (!arr) { arr = []; index.set(key, arr); }
      arr.push({ word, tokenOrder });
    }
  }

  const ms = Date.now() - t0;
  console.log(`[wordIndex] built ${index.size.toLocaleString()} entries from ${dict.size.toLocaleString()} words in ${ms}ms`);
  return index;
}

/**
 * Find all ways to decompose `word` into a sequence of token strings.
 * @param {string} word   — lowercase word, e.g. 'the'
 * @param {string[]} tokens — all valid token strings, e.g. ['a','b',...,'th','qu',...]
 * @returns {string[][]} — array of token-sequence arrays, e.g. [['t','h','e'],['th','e']]
 */
function _findDecompositions(word, tokens) {
  const results = [];
  function dfs(pos, current) {
    if (pos === word.length) {
      results.push(current.slice());
      return;
    }
    for (const token of tokens) {
      if (word.startsWith(token, pos)) {
        current.push(token);
        dfs(pos + token.length, current);
        current.pop();
      }
    }
  }
  dfs(0, []);
  return results;
}

/**
 * Compute the canonical key for a multiset of card objects.
 * @param {Array<{letters:string}>} cards
 * @returns {string}
 */
function cardSubsetKey(cards) {
  return cards.map(c => c.letters.toLowerCase()).sort().join('|');
}

/**
 * Given a card subset and a stored tokenOrder, return the cards arranged
 * in the order that produces the word.  Handles duplicate tokens by
 * consuming cards greedily in the order they appear.
 *
 * @param {Array<{letters:string}>} cardSubset
 * @param {string[]} tokenOrder — e.g. ['e','a','t']
 * @returns {Array<{letters:string}>|null} — ordered cards, or null on failure
 */
function arrangeCards(cardSubset, tokenOrder) {
  const remaining = cardSubset.slice();
  const result = [];
  for (const token of tokenOrder) {
    const idx = remaining.findIndex(c => c.letters.toLowerCase() === token);
    if (idx === -1) return null;
    result.push(remaining.splice(idx, 1)[0]);
  }
  return result;
}
