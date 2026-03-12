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
// --ai1 / --ai2 Agent config names — see AGENT_CONFIGS below.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Load game source files into a shared sandbox ──────────────────────────────

const ROOT = __dirname;

const G = vm.createContext({
  Math, Date, Set, Map, Array, Object, console, JSON,
  parseInt, parseFloat, Number, isNaN, isFinite, String, Boolean,
});

for (const file of ['js/cards.js', 'js/gameEngine.js', 'js/wordIndex.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), G);
}

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

// ── Agent configs ─────────────────────────────────────────────────────────────
// Each entry is an Agent object passed to G.aiTakeTurn(state, dict, wordIndex, agent).
// Agent parameters:
//   mcSims {number} — MC samples for the draw decision (0 = simple heuristic)
//
// Add new configs here to compare strategies against each other.

// Built once after dict loads; shared across all games
let _wordIndex = null;

const AGENT_CONFIGS = {
  default: { mcSims: 10 },
  old:     { mcSims: 0  },
  mc1:     { mcSims: 1  },
  mc2:     { mcSims: 2  },
  mc5:     { mcSims: 5  },
  mc10:    { mcSims: 10 },
  mc25:    { mcSims: 25 },
};

// ── Round runner ──────────────────────────────────────────────────────────────

const MAX_TURNS_PER_ROUND = 300; // safety valve

function runRound(state, agent1, agent2, dict, verbose) {
  const roundStats = { turns: 0, discardDraws: 0, wentOutFirst: null };

  while (state.phase === 'round') {
    if (roundStats.turns >= MAX_TURNS_PER_ROUND) {
      // Force round end — current player takes their best partial
      _forceEndFinalTurn(state, state.turn, dict);
      break;
    }

    const who    = state.turn;
    const agent  = who === 'player' ? agent1 : agent2;
    const result = G.aiTakeTurn(state, dict, _wordIndex, agent);

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
  const partial  = G.findPartialPartition(state[who].hand, dict, _wordIndex);
  const usedIds  = new Set(partial.words.flat().map(c => c.id));
  state[who].words = partial.words;
  state[who].hand  = state[who].hand.filter(c => !usedIds.has(c.id));
  G.scoreRound(state);
  state.finalTurnDone = true;
  state.phase = 'roundEnd';
}

// ── Full game runner ──────────────────────────────────────────────────────────

function runGame(agent1, agent2, dict, verbose) {
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

    const roundStats = runRound(state, agent1, agent2, dict, verbose);
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

  if (!AGENT_CONFIGS[args.ai1]) { console.error(`Unknown agent: ${args.ai1}. Available: ${Object.keys(AGENT_CONFIGS).join(', ')}`); process.exit(1); }
  if (!AGENT_CONFIGS[args.ai2]) { console.error(`Unknown agent: ${args.ai2}. Available: ${Object.keys(AGENT_CONFIGS).join(', ')}`); process.exit(1); }

  const agent1 = AGENT_CONFIGS[args.ai1];
  const agent2 = AGENT_CONFIGS[args.ai2];

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
    results.push(runGame(agent1, agent2, dict, args.verbose));
    if (!args.verbose && (i + 1) % dots === 0) process.stdout.write('.');
  }
  if (!args.verbose) process.stdout.write('\n');

  printStats(aggregateStats(results), args.ai1, args.ai2);
}

main();
