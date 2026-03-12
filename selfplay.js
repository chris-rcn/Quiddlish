#!/usr/bin/env node
'use strict';

// ── Selfplay harness for Quiddlish ────────────────────────────────────────────
// Runs N full computer-vs-computer games and prints statistics.
//
// Usage:
//   node selfplay.js --ai1 <agent> --ai2 <agent> [--games N] [--verbose]
//
// --ai1 / --ai2 Agent config names (required) — see AGENT_CONFIGS below.
// --games N     Number of games to simulate (default: 500)
// --verbose     Print every turn

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
  old:  { mcSims: 0  },
  mc1:  { mcSims: 1  },
  mc2:  { mcSims: 2  },
  mc5:  { mcSims: 5  },
  mc10: { mcSims: 10 },
  mc25: { mcSims: 25 },
};

// ── Round runner ──────────────────────────────────────────────────────────────

const MAX_TURNS_PER_ROUND = 300; // safety valve

function runRound(state, agent1, agent2, ai1Name, ai2Name, dict, verbose) {
  const roundStats = {
    turns: 0, discardDraws: 0, wentOutFirst: null, wentOutLongestWord: 0,
    ai1TurnMs: 0, ai1MaxMs: 0, ai1Turns: 0,
    ai2TurnMs: 0, ai2MaxMs: 0, ai2Turns: 0,
  };

  while (state.phase === 'round') {
    if (roundStats.turns >= MAX_TURNS_PER_ROUND) {
      // Force round end — current player takes their best partial
      _forceEndFinalTurn(state, state.turn, dict);
      break;
    }

    const who       = state.turn;
    const agent     = who === 'player' ? agent1 : agent2;
    const agentName = who === 'player' ? ai1Name : ai2Name;
    const t0        = Date.now();
    const result    = G.aiTakeTurn(state, dict, _wordIndex, agent);
    const elapsed   = Date.now() - t0;

    roundStats.turns++;
    if (result.drewFrom === 'discard') roundStats.discardDraws++;
    if (who === 'player') {
      roundStats.ai1TurnMs += elapsed;
      roundStats.ai1Turns++;
      if (elapsed > roundStats.ai1MaxMs) roundStats.ai1MaxMs = elapsed;
    } else {
      roundStats.ai2TurnMs += elapsed;
      roundStats.ai2Turns++;
      if (elapsed > roundStats.ai2MaxMs) roundStats.ai2MaxMs = elapsed;
    }

    if (verbose) {
      const wordStr = result.wentOut
        ? result.words.map(w => w.map(c => c.letters).join('')).join(', ')
        : '';
      const action = result.wentOut
        ? `WENT OUT [${wordStr}]`
        : `discarded ${result.discarded ? result.discarded.letters : '?'}`;
      process.stdout.write(
        `  R${state.round} T${roundStats.turns}: ${agentName.padEnd(8)} drew from ${result.drewFrom.padEnd(7)} → ${action}\n`
      );
    }

    if (result.wentOut) {
      if (roundStats.wentOutFirst === null) {
        roundStats.wentOutFirst = who;
        roundStats.wentOutLongestWord = Math.max(
          ...result.words.map(g => g.reduce((s, c) => s + c.letters.length, 0))
        );
      }

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

/**
 * Run a full game.
 * @param {object}   agent1
 * @param {object}   agent2
 * @param {string}   ai1Name
 * @param {string}   ai2Name
 * @param {Set}      dict
 * @param {boolean}  verbose
 * @param {Array}    [deckSequence]       Pre-generated decks, one per round.
 *                                        When provided, createDeck() is not called.
 * @param {string}   [round1FirstPlayer]  Force round-1 first player ('player'|'computer').
 */
function runGame(agent1, agent2, ai1Name, ai2Name, dict, verbose, deckSequence, round1FirstPlayer) {
  const state = G.createGameState();
  const gameStats = {
    rounds: [],
    playerFinalScore: 0,
    computerFinalScore: 0,
    winner: null,
  };
  let deckIndex = 0;

  while (state.phase !== 'gameEnd') {
    const freshDeck = deckSequence ? deckSequence[deckIndex++] : G.createDeck();
    G.dealRound(state, freshDeck);

    // Override the random first-player choice when a fixed value is requested
    if (state.round === 1 && round1FirstPlayer) {
      state.roundFirstPlayer = round1FirstPlayer;
      state.turn = round1FirstPlayer;
    }

    if (verbose) {
      const n = state.player.hand.length;
      const firstAgent = state.turn === 'player' ? ai1Name : ai2Name;
      process.stdout.write(`\nRound ${state.round} (${n} cards each), ${firstAgent} goes first\n`);
    }

    const roundStats = runRound(state, agent1, agent2, ai1Name, ai2Name, dict, verbose);
    roundStats.round          = state.round;
    roundStats.playerScore    = state.player.roundScore;
    roundStats.computerScore  = state.computer.roundScore;
    roundStats.playerWords    = state.player.words.length;
    roundStats.computerWords  = state.computer.words.length;
    gameStats.rounds.push(roundStats);

    if (verbose) {
      const wentOutName = roundStats.wentOutFirst === 'player' ? ai1Name
        : roundStats.wentOutFirst === 'computer' ? ai2Name : 'neither';
      process.stdout.write(
        `  → Round ${state.round}: ${ai1Name} ${state.player.roundScore > 0 ? '+' : ''}${state.player.roundScore}` +
        ` | ${ai2Name} ${state.computer.roundScore > 0 ? '+' : ''}${state.computer.roundScore}` +
        ` | wentOutFirst: ${wentOutName}\n`
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
      `\nGAME OVER: ${ai1Name} ${state.player.score} | ${ai2Name} ${state.computer.score}` +
      ` → ${gameStats.winner === 'player' ? ai1Name : gameStats.winner === 'computer' ? ai2Name : 'TIE'}\n`
    );
  }

  return gameStats;
}

// ── Fair-selfplay pair runner ─────────────────────────────────────────────────

/**
 * Swap player/computer fields in a game result so that the result is expressed
 * from the perspective where agent1='player' and agent2='computer', regardless
 * of which physical seat each agent occupied.
 */
function swapGameResult(g) {
  return {
    rounds: g.rounds.map(r => ({
      ...r,
      playerScore:   r.computerScore,
      computerScore: r.playerScore,
      playerWords:   r.computerWords,
      computerWords: r.playerWords,
      wentOutFirst:
        r.wentOutFirst === 'player'   ? 'computer' :
        r.wentOutFirst === 'computer' ? 'player'   : null,
      ai1TurnMs: r.ai2TurnMs,
      ai1MaxMs:  r.ai2MaxMs,
      ai1Turns:  r.ai2Turns,
      ai2TurnMs: r.ai1TurnMs,
      ai2MaxMs:  r.ai1MaxMs,
      ai2Turns:  r.ai1Turns,
    })),
    playerFinalScore:   g.computerFinalScore,
    computerFinalScore: g.playerFinalScore,
    winner:
      g.winner === 'player'   ? 'computer' :
      g.winner === 'computer' ? 'player'   : 'tie',
  };
}

/**
 * Run a matched pair of games using the same deck sequence.
 *
 * Game A: agent1 as 'player', agent2 as 'computer', agent1 goes first in round 1.
 * Game B: agent2 as 'player', agent1 as 'computer', agent2 goes first in round 1
 *         (achieved by setting round1FirstPlayer='player' with swapped agents).
 *
 * Game B's result is normalised back to agent1/agent2 perspective via swapGameResult,
 * so both results can be fed directly into aggregateStats.
 *
 * @returns {[object, object]}  [gameAStats, gameBStatsNormalised]
 */
function runGamePair(agent1, agent2, ai1Name, ai2Name, dict, verbose) {
  // Pre-generate one deck per round (8 rounds per game).
  // dealRound mutates decks by popping cards, so each game gets a shallow clone
  // of each deck array (card objects themselves are not mutated).
  const decks = Array.from({ length: 8 }, () => G.createDeck());
  const cloneDecks = () => decks.map(d => [...d]);

  if (verbose) process.stdout.write('\n── Game A (deck-normal) ─────────────────────────\n');
  const gameA = runGame(agent1, agent2, ai1Name, ai2Name, dict, verbose, cloneDecks(), 'player');

  if (verbose) process.stdout.write('\n── Game B (positions swapped) ───────────────────\n');
  const gameBRaw = runGame(agent2, agent1, ai2Name, ai1Name, dict, verbose, cloneDecks(), 'player');
  const gameB    = swapGameResult(gameBRaw);

  return [gameA, gameB];
}

// ── Statistics aggregator ─────────────────────────────────────────────────────

function aggregateStats(results, pairs) {
  const n = results.length;
  let playerWins = 0, computerWins = 0, ties = 0;
  let totalPlayerScore = 0, totalComputerScore = 0;
  let totalTurns = 0, totalDiscardDraws = 0;
  let ai1TotalMs = 0, ai1TotalTurns = 0, ai1MaxMs = 0;
  let ai2TotalMs = 0, ai2TotalTurns = 0, ai2MaxMs = 0;

  // Per-round-number stats (round 1–8)
  const byRound = Array.from({ length: 8 }, () => ({
    playerWentOut: 0, computerWentOut: 0, neither: 0,
    totalTurns: 0, playerScore: 0, computerScore: 0, games: 0,
    longestWordTotal: 0, longestWordGames: 0,
  }));

  for (const g of results) {
    if (g.winner === 'player')   playerWins++;
    else if (g.winner === 'computer') computerWins++;
    else ties++;

    totalPlayerScore   += g.playerFinalScore;
    totalComputerScore += g.computerFinalScore;

    for (const r of g.rounds) {
      totalTurns        += r.turns;
      totalDiscardDraws += r.discardDraws;
      ai1TotalMs        += r.ai1TurnMs;
      ai1TotalTurns     += r.ai1Turns;
      ai2TotalMs        += r.ai2TurnMs;
      ai2TotalTurns     += r.ai2Turns;
      if (r.ai1MaxMs > ai1MaxMs) ai1MaxMs = r.ai1MaxMs;
      if (r.ai2MaxMs > ai2MaxMs) ai2MaxMs = r.ai2MaxMs;

      const rb = byRound[r.round - 1];
      rb.games++;
      rb.totalTurns    += r.turns;
      rb.playerScore   += r.playerScore;
      rb.computerScore += r.computerScore;
      if      (r.wentOutFirst === 'player')   rb.playerWentOut++;
      else if (r.wentOutFirst === 'computer') rb.computerWentOut++;
      else                                    rb.neither++;
      if (r.wentOutLongestWord > 0) {
        rb.longestWordTotal += r.wentOutLongestWord;
        rb.longestWordGames++;
      }
    }
  }

  return {
    n, pairs: pairs || n,
    playerWins, computerWins, ties,
    playerWinPct:   (playerWins   / n * 100).toFixed(1),
    computerWinPct: (computerWins / n * 100).toFixed(1),
    tiePct:         (ties         / n * 100).toFixed(1),
    avgPlayerScore:   (totalPlayerScore   / n).toFixed(1),
    avgComputerScore: (totalComputerScore / n).toFixed(1),
    avgTurnsPerGame:  (totalTurns         / n).toFixed(1),
    discardDrawPct:   (totalDiscardDraws  / totalTurns * 100).toFixed(1),
    ai1AvgMs: ai1TotalTurns ? (ai1TotalMs / ai1TotalTurns).toFixed(2) : '0.00',
    ai1MaxMs,
    ai2AvgMs: ai2TotalTurns ? (ai2TotalMs / ai2TotalTurns).toFixed(2) : '0.00',
    ai2MaxMs,
    byRound,
  };
}

function printStats(stats, ai1Name, ai2Name) {
  const { n } = stats;
  const w = (s, len) => String(s).padStart(len);
  const col = Math.max(ai1Name.length, ai2Name.length);

  console.log('\n════════════════════════════════════════════════════════');
  console.log(` Quiddlish Self-Play: ${ai1Name} vs ${ai2Name}`);
  console.log(` ${stats.pairs.toLocaleString()} deck shuffles × 2 positions = ${n.toLocaleString()} games`);
  console.log('════════════════════════════════════════════════════════');
  console.log(`\n  Outcomes`);
  console.log(`    ${ai1Name.padEnd(col)} wins: ${w(stats.playerWins, 6)} (${stats.playerWinPct}%)`);
  console.log(`    ${ai2Name.padEnd(col)} wins: ${w(stats.computerWins, 6)} (${stats.computerWinPct}%)`);
  console.log(`    ${'Ties'.padEnd(col)}      : ${w(stats.ties, 6)} (${stats.tiePct}%)`);
  console.log(`\n  Scores (per game average)`);
  console.log(`    ${ai1Name.padEnd(col)}: ${stats.avgPlayerScore}`);
  console.log(`    ${ai2Name.padEnd(col)}: ${stats.avgComputerScore}`);
  console.log(`\n  Turn behaviour`);
  console.log(`    Avg turns/game  : ${stats.avgTurnsPerGame}`);
  console.log(`    Discard draw %  : ${stats.discardDrawPct}%`);
  console.log(`\n  Time per turn (ms)`);
  console.log(`    ${ai1Name.padEnd(col)}  avg ${stats.ai1AvgMs}  max ${stats.ai1MaxMs}`);
  console.log(`    ${ai2Name.padEnd(col)}  avg ${stats.ai2AvgMs}  max ${stats.ai2MaxMs}`);

  const a1Out = `${ai1Name}Out%`.padEnd(9);
  const a2Out = `${ai2Name}Out%`.padEnd(9);
  const a1Pts = `${ai1Name}Pts`.padEnd(11);
  const a2Pts = `${ai2Name}Pts`.padEnd(9);
  console.log(`\n  Per-round breakdown`);
  console.log(`  ${'Rnd'.padEnd(4)} ${'Cards'.padEnd(6)} ${'AvgTurns'.padEnd(9)} ${a1Out} ${a2Out} ${a1Pts} ${a2Pts} ${'AvgLong'}`);
  for (let i = 0; i < 8; i++) {
    const rb    = stats.byRound[i];
    const cards = i + 3; // round 1 = 3 cards
    if (rb.games === 0) continue;
    const avgT  = (rb.totalTurns      / rb.games).toFixed(1);
    const pOut  = (rb.playerWentOut   / rb.games * 100).toFixed(1);
    const cOut  = (rb.computerWentOut / rb.games * 100).toFixed(1);
    const avgP  = (rb.playerScore     / rb.games).toFixed(1);
    const avgC  = (rb.computerScore   / rb.games).toFixed(1);
    const avgL  = rb.longestWordGames ? (rb.longestWordTotal / rb.longestWordGames).toFixed(1) : '-';
    console.log(`  ${String(i+1).padEnd(4)} ${String(cards).padEnd(6)} ${avgT.padEnd(9)} ${(pOut+'%').padEnd(9)} ${(cOut+'%').padEnd(9)} ${avgP.padEnd(11)} ${avgC.padEnd(9)} ${avgL}`);
  }
  console.log('════════════════════════════════════════════════════════\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { games: 500, verbose: false, ai1: null, ai2: null };
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

  const available = Object.keys(AGENT_CONFIGS).join(', ');
  if (!args.ai1 || !args.ai2) { console.error(`Usage: node selfplay.js --games N --ai1 <agent> --ai2 <agent>\nAvailable agents: ${available}`); process.exit(1); }
  if (!AGENT_CONFIGS[args.ai1]) { console.error(`Unknown agent: ${args.ai1}. Available: ${available}`); process.exit(1); }
  if (!AGENT_CONFIGS[args.ai2]) { console.error(`Unknown agent: ${args.ai2}. Available: ${available}`); process.exit(1); }

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
    const [gameA, gameB] = runGamePair(agent1, agent2, args.ai1, args.ai2, dict, args.verbose);
    results.push(gameA, gameB);
    if (!args.verbose && (i + 1) % dots === 0) process.stdout.write('.');
  }
  if (!args.verbose) process.stdout.write('\n');

  printStats(aggregateStats(results, args.games), args.ai1, args.ai2);
}

main();
