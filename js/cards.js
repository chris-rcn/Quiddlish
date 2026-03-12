// Card definitions for Quiddlish
// Each definition: { letters, points, count }

const CARD_DEFINITIONS = [
  // Single letters — frequency-based counts, rarity-based points
  { letters: 'A',  points: 2,  count: 10 },
  { letters: 'B',  points: 8,  count: 2  },
  { letters: 'C',  points: 8,  count: 2  },
  { letters: 'D',  points: 5,  count: 4  },
  { letters: 'E',  points: 2,  count: 12 },
  { letters: 'F',  points: 6,  count: 2  },
  { letters: 'G',  points: 6,  count: 4  },
  { letters: 'H',  points: 7,  count: 2  },
  { letters: 'I',  points: 2,  count: 8  },
  { letters: 'J',  points: 13, count: 2  },
  { letters: 'K',  points: 8,  count: 2  },
  { letters: 'L',  points: 3,  count: 4  },
  { letters: 'M',  points: 5,  count: 2  },
  { letters: 'N',  points: 5,  count: 6  },
  { letters: 'O',  points: 2,  count: 8  },
  { letters: 'P',  points: 6,  count: 2  },
  { letters: 'Q',  points: 15, count: 2  },
  { letters: 'R',  points: 3,  count: 6  },
  { letters: 'S',  points: 3,  count: 4  },
  { letters: 'T',  points: 3,  count: 6  },
  { letters: 'U',  points: 4,  count: 6  },
  { letters: 'V',  points: 11, count: 2  },
  { letters: 'W',  points: 10, count: 2  },
  { letters: 'X',  points: 12, count: 2  },
  { letters: 'Y',  points: 4,  count: 4  },
  { letters: 'Z',  points: 14, count: 2  },
  // 2-letter combos
  { letters: 'QU', points: 9,  count: 2  },
  { letters: 'IN', points: 7,  count: 2  },
  { letters: 'ER', points: 7,  count: 2  },
  { letters: 'CL', points: 9,  count: 2  },
  { letters: 'TH', points: 9,  count: 2  },
];

/**
 * Create a full shuffled deck of Card objects.
 * Each card: { id, letters, points }
 */
function createDeck() {
  const deck = [];
  for (const def of CARD_DEFINITIONS) {
    for (let i = 1; i <= def.count; i++) {
      deck.push({
        id: `${def.letters}-${i}`,
        letters: def.letters,
        points: def.points,
      });
    }
  }
  shuffleDeck(deck);
  return deck;
}

/** Fisher-Yates in-place shuffle */
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
