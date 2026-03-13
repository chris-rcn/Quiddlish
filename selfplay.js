#!/usr/bin/env node
'use strict';

// ── Selfplay harness for Quiddlish ────────────────────────────────────────────
// Runs N full computer-vs-computer games and prints statistics.
//
// Usage:
//   node selfplay.js --ai1 <json> --ai2 <json> [--games N] [--verbose]
//
// --ai1 / --ai2 JSON override objects merged onto BASE_AGENT (required).
//               Supply a "name" key to control the display label.
//               Examples:  --ai1 '{}'  --ai2 '{"mcSims":5}'
//                          --ai1 '{"name":"base"}' --ai2 '{"name":"mc10","mcSims":10}'
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

// ── Base agent config ─────────────────────────────────────────────────────────
// Agent parameters passed to G.aiTakeTurn(state, dict, wordIndex, agent):
//   mcSims {number}                   — MC samples for draw decision (0 = simple heuristic)
//   longestWordFeatureWeight {number}  — scales the ±10 longest-word bonus term in discard
//                                        scoring (0 = disabled, 1 = full; default 0)
//   longestWordSigma {number}          — std-dev of the normal model for the opponent's
//                                        longest word when they haven't gone out yet (default 1.5)
//
// Override values are supplied on the command line as JSON objects merged onto
// BASE_AGENT.  A "name" key in the override sets the display label.
// Examples:
//   --ai1 '{"name":"base"}'
//   --ai2 '{"name":"lww1","longestWordFeatureWeight":1}'
//   --ai2 '{"name":"lww1s1","longestWordFeatureWeight":1,"longestWordSigma":1.0}'

// Built once after dict loads; shared across all games
let _wordIndex = null;

const BASE_AGENT = { mcSims: 0, longestWordFeatureWeight: 0, longestWordSigma: 1.5 };

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
        roundStats.wentOutFirst = who === 'player' ? 'ai1' : 'ai2';
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
function runGame(agent1, agent2, ai1Name, ai2Name, dict, verbose, deckSequence, round1FirstPlayer, totalRounds = 8) {
  const state = G.createGameState();
  const gameStats = {
    rounds: [],
    ai1FinalScore: 0,
    ai2FinalScore: 0,
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
    roundStats.round     = state.round;
    roundStats.ai1Score  = state.player.roundScore;
    roundStats.ai2Score  = state.computer.roundScore;
    roundStats.ai1Words  = state.player.words.length;
    roundStats.ai2Words  = state.computer.words.length;
    gameStats.rounds.push(roundStats);

    if (verbose) {
      const wentOutName = roundStats.wentOutFirst === 'ai1' ? ai1Name
        : roundStats.wentOutFirst === 'ai2' ? ai2Name : 'neither';
      process.stdout.write(
        `  → Round ${state.round}: ${ai1Name} ${state.player.roundScore > 0 ? '+' : ''}${state.player.roundScore}` +
        ` | ${ai2Name} ${state.computer.roundScore > 0 ? '+' : ''}${state.computer.roundScore}` +
        ` | wentOutFirst: ${wentOutName}\n`
      );
    }

    if (state.round >= totalRounds && state.phase === 'roundEnd') state.phase = 'gameEnd';
  }

  gameStats.ai1FinalScore = state.player.score;
  gameStats.ai2FinalScore = state.computer.score;
  if (state.player.score > state.computer.score)       gameStats.winner = 'ai1';
  else if (state.computer.score > state.player.score)  gameStats.winner = 'ai2';
  else                                                  gameStats.winner = 'tie';

  if (verbose) {
    process.stdout.write(
      `\nGAME OVER: ${ai1Name} ${state.player.score} | ${ai2Name} ${state.computer.score}` +
      ` → ${gameStats.winner === 'ai1' ? ai1Name : gameStats.winner === 'ai2' ? ai2Name : 'TIE'}\n`
    );
  }

  return gameStats;
}

// ── Fair-selfplay pair runner ─────────────────────────────────────────────────

/**
 * Swap ai1/ai2 fields in a game result so that the result is always expressed
 * from the perspective where ai1 is the first argument, regardless of which
 * physical seat each agent occupied.
 */
function swapGameResult(g) {
  return {
    rounds: g.rounds.map(r => ({
      ...r,
      ai1Score: r.ai2Score,
      ai2Score: r.ai1Score,
      ai1Words: r.ai2Words,
      ai2Words: r.ai1Words,
      wentOutFirst:
        r.wentOutFirst === 'ai1' ? 'ai2' :
        r.wentOutFirst === 'ai2' ? 'ai1' : null,
      ai1TurnMs: r.ai2TurnMs,
      ai1MaxMs:  r.ai2MaxMs,
      ai1Turns:  r.ai2Turns,
      ai2TurnMs: r.ai1TurnMs,
      ai2MaxMs:  r.ai1MaxMs,
      ai2Turns:  r.ai1Turns,
    })),
    ai1FinalScore: g.ai2FinalScore,
    ai2FinalScore: g.ai1FinalScore,
    winner:
      g.winner === 'ai1' ? 'ai2' :
      g.winner === 'ai2' ? 'ai1' : 'tie',
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
function runGamePair(agent1, agent2, ai1Name, ai2Name, dict, verbose, totalRounds = 8) {
  // Pre-generate one deck per round. dealRound mutates decks by popping cards,
  // so each game gets a shallow clone of each deck array.
  const decks = Array.from({ length: totalRounds }, () => G.createDeck());
  const cloneDecks = () => decks.map(d => [...d]);

  if (verbose) process.stdout.write('\n── Game A (deck-normal) ─────────────────────────\n');
  const gameA = runGame(agent1, agent2, ai1Name, ai2Name, dict, verbose, cloneDecks(), 'player', totalRounds);

  if (verbose) process.stdout.write('\n── Game B (positions swapped) ───────────────────\n');
  const gameBRaw = runGame(agent2, agent1, ai2Name, ai1Name, dict, verbose, cloneDecks(), 'player', totalRounds);
  const gameB    = swapGameResult(gameBRaw);

  return [gameA, gameB];
}

// ── Statistics aggregator ─────────────────────────────────────────────────────

function aggregateStats(results, pairs) {
  const n = results.length;
  let ai1Wins = 0, ai2Wins = 0, ties = 0;
  let totalAi1Score = 0, totalAi2Score = 0;
  let totalTurns = 0, totalDiscardDraws = 0;
  let ai1TotalMs = 0, ai1TotalTurns = 0, ai1MaxMs = 0;
  let ai2TotalMs = 0, ai2TotalTurns = 0, ai2MaxMs = 0;

  // Per-round-number stats (round 1–8)
  const byRound = Array.from({ length: 8 }, () => ({
    ai1WentOut: 0, ai2WentOut: 0, neither: 0,
    totalTurns: 0, totalTurnMs: 0, ai1Score: 0, ai2Score: 0, games: 0,
    longestWordTotal: 0, longestWordGames: 0,
  }));

  for (const g of results) {
    if (g.winner === 'ai1')   ai1Wins++;
    else if (g.winner === 'ai2') ai2Wins++;
    else ties++;

    totalAi1Score += g.ai1FinalScore;
    totalAi2Score += g.ai2FinalScore;

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
      rb.totalTurnMs   += r.ai1TurnMs + r.ai2TurnMs;
      rb.ai1Score += r.ai1Score;
      rb.ai2Score += r.ai2Score;
      if      (r.wentOutFirst === 'ai1') rb.ai1WentOut++;
      else if (r.wentOutFirst === 'ai2') rb.ai2WentOut++;
      else                                    rb.neither++;
      if (r.wentOutLongestWord > 0) {
        rb.longestWordTotal += r.wentOutLongestWord;
        rb.longestWordGames++;
      }
    }
  }

  return {
    n, pairs: pairs || n,
    ai1Wins, ai2Wins, ties,
    ai1WinPct: (ai1Wins / n * 100).toFixed(1),
    ai2WinPct: (ai2Wins / n * 100).toFixed(1),
    tiePct:    (ties    / n * 100).toFixed(1),
    avgAi1Score: (totalAi1Score / n).toFixed(1),
    avgAi2Score: (totalAi2Score / n).toFixed(1),
    avgTurnsPerGame:  (totalTurns         / n).toFixed(1),
    discardDrawPct:   (totalDiscardDraws  / totalTurns * 100).toFixed(1),
    ai1AvgMs: ai1TotalTurns ? (ai1TotalMs / ai1TotalTurns).toFixed(2) : '0.00',
    ai1MaxMs,
    ai2AvgMs: ai2TotalTurns ? (ai2TotalMs / ai2TotalTurns).toFixed(2) : '0.00',
    ai2MaxMs,
    byRound,
  };
}

function printStats(stats, ai1Name, ai2Name, totalRounds = 8) {
  const { n } = stats;
  const w = (s, len) => String(s).padStart(len);
  const col = Math.max(ai1Name.length, ai2Name.length);

  console.log('\n════════════════════════════════════════════════════════');
  console.log(` Quiddlish Self-Play: ${ai1Name} vs ${ai2Name}`);
  const roundsNote = totalRounds < 8 ? ` (${totalRounds} rounds/game)` : '';
  console.log(` ${stats.pairs.toLocaleString()} deck shuffles × 2 positions = ${n.toLocaleString()} games${roundsNote}`);
  console.log('════════════════════════════════════════════════════════');
  console.log(`\n  Outcomes`);
  console.log(`    ${ai1Name.padEnd(col)} wins: ${w(stats.ai1Wins, 6)} (${stats.ai1WinPct}%)`);
  console.log(`    ${ai2Name.padEnd(col)} wins: ${w(stats.ai2Wins, 6)} (${stats.ai2WinPct}%)`);
  console.log(`    ${'Ties'.padEnd(col)}      : ${w(stats.ties, 6)} (${stats.tiePct}%)`);
  console.log(`\n  Scores (per game average)`);
  console.log(`    ${ai1Name.padEnd(col)}: ${stats.avgAi1Score}`);
  console.log(`    ${ai2Name.padEnd(col)}: ${stats.avgAi2Score}`);
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
  console.log(`  ${'Rnd'.padEnd(4)} ${'Cards'.padEnd(6)} ${'AvgTurns'.padEnd(9)} ${'AvgTurnMs'.padEnd(10)} ${a1Out} ${a2Out} ${a1Pts} ${a2Pts} ${'AvgLong'}`);
  for (let i = 0; i < 8; i++) {
    const rb    = stats.byRound[i];
    const cards = i + 3; // round 1 = 3 cards
    if (rb.games === 0) continue;
    const avgT  = (rb.totalTurns / rb.games).toFixed(1);
    const avgMs = rb.totalTurns ? (rb.totalTurnMs / rb.totalTurns).toFixed(2) : '-';
    const pOut  = (rb.ai1WentOut / rb.games * 100).toFixed(1);
    const cOut  = (rb.ai2WentOut / rb.games * 100).toFixed(1);
    const avgP  = (rb.ai1Score   / rb.games).toFixed(1);
    const avgC  = (rb.ai2Score   / rb.games).toFixed(1);
    const avgL  = rb.longestWordGames ? (rb.longestWordTotal / rb.longestWordGames).toFixed(1) : '-';
    console.log(`  ${String(i+1).padEnd(4)} ${String(cards).padEnd(6)} ${avgT.padEnd(9)} ${avgMs.padEnd(10)} ${(pOut+'%').padEnd(9)} ${(cOut+'%').padEnd(9)} ${avgP.padEnd(11)} ${avgC.padEnd(9)} ${avgL}`);
  }
  console.log('════════════════════════════════════════════════════════\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const VALID_AGENT_KEYS = new Set(Object.keys(BASE_AGENT));

function validateAgentOverrides(overrides, flag) {
  const unknown = Object.keys(overrides).filter(k => k !== 'name' && !VALID_AGENT_KEYS.has(k));
  if (unknown.length > 0) {
    console.error(`${flag}: unrecognized agent propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`);
    console.error(`  Valid: name, ${[...VALID_AGENT_KEYS].join(', ')}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = { games: 500, rounds: 8, verbose: false, ai1: null, ai2: null };
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--games'   && argv[i+1]) { args.games  = parseInt(argv[++i], 10); }
    else if (argv[i] === '--rounds'  && argv[i+1]) { args.rounds = parseInt(argv[++i], 10); }
    else if (argv[i] === '--verbose' || argv[i] === '-v') { args.verbose = true; }
    else if (argv[i] === '--ai1'     && argv[i+1]) { args.ai1   = argv[++i]; }
    else if (argv[i] === '--ai2'     && argv[i+1]) { args.ai2   = argv[++i]; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.ai1 || !args.ai2) {
    console.error('Usage: node selfplay.js --ai1 <json> --ai2 <json> [--games N] [--rounds N] [--verbose]');
    process.exit(1);
  }

  let ai1Overrides, ai2Overrides;
  try { ai1Overrides = JSON.parse(args.ai1); } catch { console.error(`--ai1: invalid JSON: ${args.ai1}`); process.exit(1); }
  try { ai2Overrides = JSON.parse(args.ai2); } catch { console.error(`--ai2: invalid JSON: ${args.ai2}`); process.exit(1); }
  validateAgentOverrides(ai1Overrides, '--ai1');
  validateAgentOverrides(ai2Overrides, '--ai2');

  const ai1Name = ai1Overrides.name || args.ai1;
  const ai2Name = ai2Overrides.name || args.ai2;
  const { name: _n1, ...ai1Config } = ai1Overrides;
  const { name: _n2, ...ai2Config } = ai2Overrides;
  const agent1 = { ...BASE_AGENT, ...ai1Config };
  const agent2 = { ...BASE_AGENT, ...ai2Config };

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
    const [gameA, gameB] = runGamePair(agent1, agent2, ai1Name, ai2Name, dict, args.verbose, args.rounds);
    results.push(gameA, gameB);
    if (!args.verbose && (i + 1) % dots === 0) process.stdout.write('.');
  }
  if (!args.verbose) process.stdout.write('\n');

  printStats(aggregateStats(results, args.games), ai1Name, ai2Name, args.rounds);
}

main();
