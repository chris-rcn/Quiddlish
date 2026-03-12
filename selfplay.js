#!/usr/bin/env node
'use strict';

// ── Selfplay harness for Quiddlish ────────────────────────────────────────────
// Runs N full computer-vs-computer games and prints statistics.
//
// Usage:
//   node selfplay.js [--games N] [--verbose] [--ai1 default] [--ai2 default]
//
// --games N     Number of games to simulate (default: 500)
// --verbose     Print every turn
// --ai1 / --ai2 AI variant names (currently only "default" is defined)
//               Add new variants in the AI_VARIANTS map below.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Load game source files into a shared sandbox ──────────────────────────────

const ROOT = __dirname;

const SELFPLAY_MS = 5; // ms budget per backtracking call — raise for stronger but slower AI

const G = vm.createContext({
  Math, Date, Set, Map, Array, Object, console, JSON,
  parseInt, parseFloat, Number, isNaN, isFinite, String, Boolean,
  SELFPLAY_MS,
});

for (const file of ['js/cards.js', 'js/gameEngine.js', 'js/wordIndex.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), G);
}

// Patch shouldDrawDiscard to honour SELFPLAY_MS instead of the hardcoded 100ms
// that the browser build uses.  This is the main bottleneck in batch simulation.
vm.runInContext(`
shouldDrawDiscard = function selfplayDrawDiscard(hand, topDiscard, dict) {
  if (!topDiscard) return false;
  const without  = findPartialPartition(hand, dict, SELFPLAY_MS);
  const withCard = findPartialPartition([...hand, topDiscard], dict, SELFPLAY_MS);
  const gained   = withCard.words.flat().reduce((s, c) => s + c.points, 0)
                 - without.words.flat().reduce((s, c) => s + c.points, 0);
  return gained > 0;
};
`, G);

// ── Load dictionary ───────────────────────────────────────────────────────────

function loadDictionary() {
  const text = fs.readFileSync(path.join(ROOT, 'data/words.txt'), 'utf8');
  const dict = new Set();
  for (const line of text.split('\n')) {
    const w = line.trim().toLowerCase();
    if (w.length >= 3 && w.length <= 20) dict.add(w);
  }
  return dict;
}

// ── AI variants ───────────────────────────────────────────────────────────────
// Each variant is a function: (state, who, dict) → { drewFrom, discarded, wentOut, words, isFinalTurn }
// `who` is 'player' | 'computer'.  state.turn is already set to `who`.
//
// Add new strategies here to compare them against each other.
//
// Time budget notes:
//   The browser game uses 300ms per call; self-play uses SELFPLAY_MS (default 5ms)
//   so that hundreds of games run in reasonable time.  Raise SELFPLAY_MS at the
//   top of the file for stronger but slower AI.

function makeTurn(state, who, dict, ms, wi = null) {
  const hand       = [...state[who].hand];
  const topDiscard = state.discard[state.discard.length - 1] || null;

  // Draw phase — inline shouldDrawDiscard so the per-variant budget applies
  let drewFrom;
  if (topDiscard) {
    const without  = G.findPartialPartition(hand, dict, ms, wi);
    const withCard = G.findPartialPartition([...hand, topDiscard], dict, ms, wi);
    const gained   = withCard.words.flat().reduce((s, c) => s + c.points, 0)
                   - without.words.flat().reduce((s, c) => s + c.points, 0);
    if (gained > 0) {
      G.drawFromDiscard(state);
      drewFrom = 'discard';
    } else {
      G.drawFromDeck(state);
      drewFrom = 'deck';
    }
  } else {
    G.drawFromDeck(state);
    drewFrom = 'deck';
  }

  const newHand = state[who].hand;

  // Try to go out: try each card as the discard, lowest-value first
  const byValueAsc = [...newHand].sort((a, b) => a.points - b.points);
  for (const cand of byValueAsc) {
    const remaining = newHand.filter(c => c.id !== cand.id);
    const full = G.findBestWordPartition(remaining, dict, ms, wi);
    if (full) {
      G.discardCard(state, cand.id);
      const result = G.goOut(state, full, dict);
      if (result.success) {
        return { drewFrom, discarded: cand, wentOut: true, words: full, isFinalTurn: result.isFinalTurn };
      }
    }
  }

  // Cannot go out — find best partial and discard worst unused card
  const partial       = G.findPartialPartition(newHand, dict, ms, wi);
  const cardToDiscard = G.chooseBestDiscard(newHand, partial.words);
  G.discardCard(state, cardToDiscard.id);
  return { drewFrom, discarded: cardToDiscard, wentOut: false, words: partial.words, isFinalTurn: false };
}

// Built once after dict loads; shared across all games and variants
let _wordIndex = null;

const AI_VARIANTS = {

  // Standard strategy with SELFPLAY_MS (5ms) budget, no index
  default(state, who, dict) {
    return makeTurn(state, who, dict, SELFPLAY_MS);
  },

  // Stronger search — 10ms per backtracking call, no index
  ms10(state, who, dict) {
    return makeTurn(state, who, dict, 10);
  },

  // Token-multiset index — O(1) per subset, minimal time budget needed
  indexed(state, who, dict) {
    return makeTurn(state, who, dict, 1, _wordIndex);
  },

};

// ── Round runner ──────────────────────────────────────────────────────────────

const MAX_TURNS_PER_ROUND = 300; // safety valve

function runRound(state, ai1, ai2, dict, verbose) {
  const roundStats = { turns: 0, discardDraws: 0, wentOutFirst: null };

  while (state.phase === 'round') {
    if (roundStats.turns >= MAX_TURNS_PER_ROUND) {
      // Force round end — current player takes their best partial
      _forceEndFinalTurn(state, state.turn, dict);
      break;
    }

    const who    = state.turn;
    const aiFn   = who === 'player' ? ai1 : ai2;
    const result = aiFn(state, who, dict);

    roundStats.turns++;
    if (result.drewFrom === 'discard') roundStats.discardDraws++;

    if (verbose) {
      const wordStr = result.wentOut
        ? result.words.map(w => w.map(c => c.letters).join('')).join(', ')
        : '';
      const action = result.wentOut
        ? `WENT OUT [${wordStr}]`
        : `discarded ${result.discarded ? result.discarded.letters : '?'}`;
      process.stdout.write(
        `  R${state.round} T${roundStats.turns}: ${who.padEnd(8)} drew from ${result.drewFrom.padEnd(7)} → ${action}\n`
      );
    }

    if (result.wentOut) {
      if (roundStats.wentOutFirst === null) roundStats.wentOutFirst = who;

      if (result.isFinalTurn) {
        // Second player went out → score and end round
        _finishRound(state, who, null, dict);
      }
      // else: game engine already flipped state.turn to the other player for their final turn

    } else {
      // Normal discard — check if this was the final turn slot
      if (state.outBy !== null) {
        // This player just took their final turn but couldn't go out
        _finishRound(state, who, result.words, dict);
      } else {
        G.advanceTurn(state);
      }
    }
  }

  return roundStats;
}

/** Finish a round after the second player's final turn. */
function _finishRound(state, who, partialWords, dict) {
  if (partialWords !== null) {
    // Player didn't go out — commit their best partial arrangement
    const usedIds = new Set(partialWords.flat().map(c => c.id));
    state[who].words = partialWords;
    state[who].hand  = state[who].hand.filter(c => !usedIds.has(c.id));
  }
  // else: goOut() already committed words and cleared hand

  G.scoreRound(state);
  state.finalTurnDone = true;
  state.phase = 'roundEnd';
}

/** Safety: force the current player to end their final turn. */
function _forceEndFinalTurn(state, who, dict) {
  const partial  = G.findPartialPartition(state[who].hand, dict, 200);
  const usedIds  = new Set(partial.words.flat().map(c => c.id));
  state[who].words = partial.words;
  state[who].hand  = state[who].hand.filter(c => !usedIds.has(c.id));
  G.scoreRound(state);
  state.finalTurnDone = true;
  state.phase = 'roundEnd';
}

// ── Full game runner ──────────────────────────────────────────────────────────

function runGame(ai1, ai2, dict, verbose) {
  const state = G.createGameState();
  const gameStats = {
    rounds: [],
    playerFinalScore: 0,
    computerFinalScore: 0,
    winner: null,
  };

  while (state.phase !== 'gameEnd') {
    const freshDeck = G.createDeck();
    G.dealRound(state, freshDeck);

    if (verbose) {
      const n = state.player.hand.length;
      process.stdout.write(`\nRound ${state.round} (${n} cards each), ${state.turn} goes first\n`);
    }

    const roundStats = runRound(state, ai1, ai2, dict, verbose);
    roundStats.round          = state.round;
    roundStats.playerScore    = state.player.roundScore;
    roundStats.computerScore  = state.computer.roundScore;
    roundStats.playerWords    = state.player.words.length;
    roundStats.computerWords  = state.computer.words.length;
    gameStats.rounds.push(roundStats);

    if (verbose) {
      process.stdout.write(
        `  → Round ${state.round}: player ${state.player.roundScore > 0 ? '+' : ''}${state.player.roundScore}` +
        ` | computer ${state.computer.roundScore > 0 ? '+' : ''}${state.computer.roundScore}` +
        ` | wentOutFirst: ${roundStats.wentOutFirst}\n`
      );
    }

    G.checkGameEnd(state);
  }

  gameStats.playerFinalScore   = state.player.score;
  gameStats.computerFinalScore = state.computer.score;
  if (state.player.score > state.computer.score)       gameStats.winner = 'player';
  else if (state.computer.score > state.player.score)  gameStats.winner = 'computer';
  else                                                  gameStats.winner = 'tie';

  if (verbose) {
    process.stdout.write(
      `\nGAME OVER: player ${state.player.score} | computer ${state.computer.score}` +
      ` → ${gameStats.winner.toUpperCase()}\n`
    );
  }

  return gameStats;
}

// ── Statistics aggregator ─────────────────────────────────────────────────────

function aggregateStats(results) {
  const n = results.length;
  let playerWins = 0, computerWins = 0, ties = 0;
  let totalPlayerScore = 0, totalComputerScore = 0;
  let totalTurns = 0, totalDiscardDraws = 0;

  // Per-round-number stats (round 1–8)
  const byRound = Array.from({ length: 8 }, () => ({
    playerWentOut: 0, computerWentOut: 0, neither: 0,
    totalTurns: 0, playerScore: 0, computerScore: 0, games: 0,
  }));

  for (const g of results) {
    if (g.winner === 'player')   playerWins++;
    else if (g.winner === 'computer') computerWins++;
    else ties++;

    totalPlayerScore   += g.playerFinalScore;
    totalComputerScore += g.computerFinalScore;

    for (const r of g.rounds) {
      totalTurns       += r.turns;
      totalDiscardDraws += r.discardDraws;

      const rb = byRound[r.round - 1];
      rb.games++;
      rb.totalTurns   += r.turns;
      rb.playerScore  += r.playerScore;
      rb.computerScore += r.computerScore;
      if      (r.wentOutFirst === 'player')   rb.playerWentOut++;
      else if (r.wentOutFirst === 'computer') rb.computerWentOut++;
      else                                    rb.neither++;
    }
  }

  return {
    n,
    playerWins, computerWins, ties,
    playerWinPct:   (playerWins   / n * 100).toFixed(1),
    computerWinPct: (computerWins / n * 100).toFixed(1),
    tiePct:         (ties         / n * 100).toFixed(1),
    avgPlayerScore:   (totalPlayerScore   / n).toFixed(1),
    avgComputerScore: (totalComputerScore / n).toFixed(1),
    avgTurnsPerGame:  (totalTurns         / n).toFixed(1),
    discardDrawPct:   (totalDiscardDraws  / totalTurns * 100).toFixed(1),
    byRound,
  };
}

function printStats(stats, ai1Name, ai2Name) {
  const { n } = stats;
  const w = (s, len) => String(s).padStart(len);

  console.log('\n════════════════════════════════════════════════════════');
  console.log(` Quiddlish Self-Play: ${ai1Name} (player) vs ${ai2Name} (computer)`);
  console.log(` ${n.toLocaleString()} games`);
  console.log('════════════════════════════════════════════════════════');
  console.log(`\n  Outcomes`);
  console.log(`    Player wins  : ${w(stats.playerWins, 6)} (${stats.playerWinPct}%)`);
  console.log(`    Computer wins: ${w(stats.computerWins, 6)} (${stats.computerWinPct}%)`);
  console.log(`    Ties         : ${w(stats.ties, 6)} (${stats.tiePct}%)`);
  console.log(`\n  Scores (per game average)`);
  console.log(`    Player  : ${stats.avgPlayerScore}`);
  console.log(`    Computer: ${stats.avgComputerScore}`);
  console.log(`\n  Turn behaviour`);
  console.log(`    Avg turns/game  : ${stats.avgTurnsPerGame}`);
  console.log(`    Discard draw %  : ${stats.discardDrawPct}%`);

  console.log(`\n  Per-round breakdown`);
  console.log(`  ${'Rnd'.padEnd(4)} ${'Cards'.padEnd(6)} ${'AvgTurns'.padEnd(9)} ${'PlrOut%'.padEnd(9)} ${'CmpOut%'.padEnd(9)} ${'AvgPlrPts'.padEnd(11)} ${'AvgCmpPts'}`);
  for (let i = 0; i < 8; i++) {
    const rb    = stats.byRound[i];
    const cards = i + 3; // round 1 = 3 cards
    if (rb.games === 0) continue;
    const avgT  = (rb.totalTurns    / rb.games).toFixed(1);
    const pOut  = (rb.playerWentOut  / rb.games * 100).toFixed(1);
    const cOut  = (rb.computerWentOut / rb.games * 100).toFixed(1);
    const avgP  = (rb.playerScore   / rb.games).toFixed(1);
    const avgC  = (rb.computerScore / rb.games).toFixed(1);
    console.log(`  ${String(i+1).padEnd(4)} ${String(cards).padEnd(6)} ${avgT.padEnd(9)} ${(pOut+'%').padEnd(9)} ${(cOut+'%').padEnd(9)} ${avgP.padEnd(11)} ${avgC}`);
  }
  console.log('════════════════════════════════════════════════════════\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { games: 500, verbose: false, ai1: 'default', ai2: 'default' };
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--games'   && argv[i+1]) { args.games   = parseInt(argv[++i], 10); }
    else if (argv[i] === '--verbose' || argv[i] === '-v') { args.verbose = true; }
    else if (argv[i] === '--ai1'     && argv[i+1]) { args.ai1    = argv[++i]; }
    else if (argv[i] === '--ai2'     && argv[i+1]) { args.ai2    = argv[++i]; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!AI_VARIANTS[args.ai1]) { console.error(`Unknown AI variant: ${args.ai1}`); process.exit(1); }
  if (!AI_VARIANTS[args.ai2]) { console.error(`Unknown AI variant: ${args.ai2}`); process.exit(1); }

  const ai1 = AI_VARIANTS[args.ai1];
  const ai2 = AI_VARIANTS[args.ai2];

  process.stdout.write('Loading dictionary… ');
  const dict = loadDictionary();
  console.log(`${dict.size.toLocaleString()} words loaded.`);

  // Build the token-multiset index inside the vm context, where CARD_DEFINITIONS
  // (a const) is accessible.  Pass dict in via the context object, retrieve index out.
  G._selfplayDict = dict;
  vm.runInContext('_selfplayWordIndex = buildWordIndex(_selfplayDict, CARD_DEFINITIONS);', G);
  _wordIndex = G._selfplayWordIndex;
  console.log(`Word index: ${_wordIndex.size.toLocaleString()} entries.\n`);

  const results = [];
  const dots = Math.max(1, Math.floor(args.games / 50));

  if (!args.verbose) process.stdout.write('Simulating');
  for (let i = 0; i < args.games; i++) {
    results.push(runGame(ai1, ai2, dict, args.verbose));
    if (!args.verbose && (i + 1) % dots === 0) process.stdout.write('.');
  }
  if (!args.verbose) process.stdout.write('\n');

  printStats(aggregateStats(results), args.ai1, args.ai2);
}

main();
