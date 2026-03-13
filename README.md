# Quiddlish

Quiddlish is a single-player word-building card game played against a computer opponent over
eight rounds. Each round you are dealt a hand of lettered tiles, and the goal is to arrange
all of them into valid English words and "go out" before your opponent does. Points come from
the tiles committed to words, offset by any tiles left unused, with a +10 bonus each round
to whoever forms the single longest word.

---

## The Deck

The deck contains **118 cards** across 31 tile types. Most tiles carry a single letter; five
are two-letter tiles that represent common digraphs and are treated as one card.

| Tile | Points | Copies | Tile | Points | Copies |
|------|--------|--------|------|--------|--------|
| A    | 2      | 10     | S    | 3      | 4      |
| B    | 8      | 2      | T    | 3      | 6      |
| C    | 8      | 2      | U    | 4      | 6      |
| D    | 5      | 4      | V    | 11     | 2      |
| E    | 2      | 12     | W    | 10     | 2      |
| F    | 6      | 2      | X    | 12     | 2      |
| G    | 6      | 4      | Y    | 4      | 4      |
| H    | 7      | 2      | Z    | 14     | 2      |
| I    | 2      | 8      | **QU** | 9   | 2      |
| J    | 13     | 2      | **IN** | 7   | 2      |
| K    | 8      | 2      | **ER** | 7   | 2      |
| L    | 3      | 4      | **CL** | 9   | 2      |
| M    | 5      | 2      | **TH** | 9   | 2      |
| N    | 5      | 6      |      |        |        |
| O    | 2      | 8      |      |        |        |
| P    | 6      | 2      |      |        |        |
| Q    | 15     | 2      |      |        |        |
| R    | 3      | 6      |      |        |        |

The two-letter tiles (bold) let you spell common letter pairs with a single card, which is
strategically important: a TH tile contributes 9 points to a word and frees up a card slot
compared with using separate T and H tiles.

The deck is shuffled before every round and reshuffled after every draw.

---

## Rules

### Rounds

The game lasts **8 rounds**. Round *n* deals **n + 2 cards** to each player:

| Round | Cards per player |
|-------|-----------------|
| 1     | 3               |
| 2     | 4               |
| 3     | 5               |
| 4     | 6               |
| 5     | 7               |
| 6     | 8               |
| 7     | 9               |
| 8     | 10              |

One additional card is flipped face-up to seed the discard pile. The first player of each
round alternates; within a round players take turns until the round ends.

### Turn Structure

Each turn has two phases:

1. **Draw** — take either the top card of the deck or the face-up discard card.
2. **Discard** — place exactly one card from your hand onto the discard pile.

### Going Out

After discarding, if every remaining card in your hand can be arranged into valid word groups
you may **go out**:

- Each word group must contain **at least 3 cards**.
- The cards' letters, read in order, must spell a word that appears in the dictionary.
- All cards in hand (after the discard) must be covered — no leftovers.

The first player to go out gives their opponent **one bonus final turn**. On that final turn
the opponent may also try to go out (using all their cards), or simply commit whatever valid
words they can from their hand and leave the rest unused.

### Scoring

At the end of each round each player's round score is:

```
roundScore = (sum of point values of cards in valid words)
           − (sum of point values of unused cards)
           + longestWordBonus
```

The **longest-word bonus** awards **+10 points** to whichever player's single longest word
contains more letters. Letter count is computed from the actual letters spelled, not the
number of cards (so a TH tile counts as 2 letters). If both players' longest words are the
same length no bonus is awarded.

Round scores accumulate across all 8 rounds. The player with the higher total after round 8
wins.

---

## How the Computer Plays

The computer AI runs a pipeline of decisions on every turn. Each decision is independent
and described below.

### Word Index

Before the game starts, the AI pre-processes the dictionary into a **token-multiset index**.
Every word is decomposed into all possible sequences of tiles (e.g. "the" can be tiled as
`[T, H, E]` or `[TH, E]`). Each decomposition is stored under a canonical key formed by
sorting its tiles alphabetically and joining them. This means that given any set of cards the
AI can look up all words those cards can spell in O(1) time, without testing every
permutation.

### Finding a Word Partition

**Complete partition** (`findBestWordPartition`): The AI uses a backtracking search to find
a way to assign all cards into valid word groups simultaneously. It tries subsets of size 3
up to the full hand size, consults the word index for each subset, and recurses on the
remaining cards. The first solution found is returned; `null` means "cannot go out".

**Partial partition** (`findPartialPartition`): The same search is run, but the best partial
result seen during traversal is kept rather than requiring all cards to be covered. The
objective is to maximise the total point value of cards placed into words (unused cards will
later be a penalty). This is used whenever the AI cannot go out.

### Draw Decision

`shouldDrawDiscard` decides whether to take the visible discard card or draw blind from the
deck. Two modes are available, controlled by the `mcSims` agent parameter:

- **Heuristic (`mcSims = 0`)** — compute the partial-partition score of the hand *with* the
  discard added, and compare it to the current score without. Take the discard only if it
  strictly improves the score.

- **Monte Carlo (`mcSims > 0`)** — sample `min(deck size, mcSims)` cards at random from the
  deck, compute the average expected partial-partition score across those samples, and compare
  it to the known score of taking the discard. This accounts for the distribution of what a
  deck draw might bring. The default browser agent uses `mcSims = 10`.

### Go-Out Attempt

After drawing, the AI tries to go out. It sorts the hand by point value (ascending) and for
each card tests whether discarding it leaves a complete valid partition of the rest. The
first candidate that works triggers a go-out. Sorting by ascending value maximises the
chance of shedding a low-value card — the AI prefers not to waste a high-value tile as the
discard.

### Discard Selection

When the AI cannot go out it must choose which card to discard. Each candidate card is
scored:

```
score = wordCardPoints + longestWordFeatureWeight × (10·P(win) − 10·P(lose))
```

**`wordCardPoints`** is the total point value of cards covered by the best partial partition
of the n−1 remaining cards. This is the primary objective.

**The longest-word bonus term** (enabled when `longestWordFeatureWeight > 0`) adjusts the
score based on the probability that the hero's longest word will beat the opponent's at
round end, adding up to ±10 points to steer the AI toward building longer words when it is
worth it.

Let `h` = the letter-count of the longest word in the hero's partial partition after the
hypothetical discard.

**If the opponent has already gone out**, their committed words are fully visible. Let `v` be
their longest word letter-count. The comparison is exact:

| h vs v | Bonus |
|--------|-------|
| h > v  | +10   |
| h = v  | 0     |
| h < v  | −10   |

**If the opponent has not yet gone out**, their eventual longest word is unknown. The AI
models it as a normal distribution `N(μ, σ)` where:

- `μ` is the round-specific average observed in self-play (see table below)
- `σ = longestWordSigma` (default 1.5)

```
P(win) = Φ((h − μ) / σ)
bonus  = 10 × (2·P(win) − 1)
```

`Φ` is the standard normal CDF (Abramowitz & Stegun approximation, error < 7.5 × 10⁻⁸).
The bonus ranges continuously from −10 (very likely to lose the bonus) to +10 (very likely
to win it).

**Observed average longest word length by round** (from self-play data):

| Round | Cards | Avg longest word (letters) |
|-------|-------|---------------------------|
| 1     | 3     | 3.2                       |
| 2     | 4     | 4.3                       |
| 3     | 5     | 5.2                       |
| 4     | 6     | 3.5                       |
| 5     | 7     | 4.3                       |
| 6     | 8     | 5.2                       |
| 7     | 9     | 4.1                       |
| 8     | 10    | 4.4                       |

The non-monotone pattern (e.g. round 4 average drops from round 3) reflects that with more
cards there are more valid partitions available, which can spread letters across several
shorter words rather than concentrating them into one long word.

When `longestWordFeatureWeight = 0` (the browser default) the bonus term disappears and the
AI optimises purely for word-card points.

---

## Agent Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mcSims` | number | 10 (browser) / 0 (selfplay) | Monte Carlo samples for the draw decision. 0 uses the simple heuristic. |
| `longestWordFeatureWeight` | number | 0 | Scale factor for the longest-word bonus term in discard scoring. 0 disables it; 1 applies the full ±10 expected bonus. |
| `longestWordSigma` | number | 1.5 | Standard deviation of the normal model for the opponent's longest word when they have not yet gone out. |

---

## Self-Play

`selfplay.js` is a Node.js harness for running computer-vs-computer games to measure and
compare agent configurations.

```bash
node selfplay.js --ai1 <json> --ai2 <json> [--games N] [--verbose]
```

**Arguments**

| Flag | Default | Description |
|------|---------|-------------|
| `--ai1 <json>` | required | Agent config for player 1 (merged onto `BASE_AGENT`). Add a `"name"` key for labelling. |
| `--ai2 <json>` | required | Agent config for player 2. |
| `--games N` | 500 | Number of deck shuffles. Each shuffle runs two games (positions swapped) for a total of 2N games. |
| `--verbose` / `-v` | false | Print every turn and per-round summaries. |

**Examples**

```bash
# Baseline vs. longest-word-aware agent
node selfplay.js \
  --ai1 '{"name":"base"}' \
  --ai2 '{"name":"lww1","longestWordFeatureWeight":1}' \
  --games 500

# Compare different sigma values
node selfplay.js \
  --ai1 '{"name":"lww1","longestWordFeatureWeight":1,"longestWordSigma":1.5}' \
  --ai2 '{"name":"lww1s1","longestWordFeatureWeight":1,"longestWordSigma":1.0}' \
  --games 200
```

**Fair comparison methodology** — each "game pair" runs two games using the same deck
sequence but with the agents swapped between the player-1 and player-2 seats. This
cancels first-player advantage from the statistics. The output reports win/loss/tie
percentages, average scores, longest-word bonus capture rates, and per-round breakdowns.
