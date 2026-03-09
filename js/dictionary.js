// Dictionary loading and word validation

let dictionary = null; // Set of lowercase words

/**
 * Load the word list from data/words.txt.
 * Returns a Promise that resolves to the loaded Set.
 */
async function loadDictionary() {
  const response = await fetch('data/words.txt');
  if (!response.ok) throw new Error('Failed to load dictionary');
  const text = await response.text();
  const words = text.split('\n');
  dictionary = new Set();
  for (const word of words) {
    const w = word.trim().toLowerCase();
    if (w.length >= 3 && w.length <= 20) {
      dictionary.add(w);
    }
  }
  return dictionary;
}

/**
 * Check whether a word string is in the dictionary.
 * @param {string} word
 * @returns {boolean}
 */
function isValidWord(word) {
  if (!dictionary) return false;
  return dictionary.has(word.toLowerCase());
}

/**
 * Get the loaded dictionary Set (for passing to AI).
 */
function getDictionary() {
  return dictionary;
}
