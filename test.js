'use strict';

/*
 * 2048 — test suite.
 * Run with:  node --test test.js   (Node 18+)
 *
 * Covers: merge rules, move semantics, scoring, win/lose detection,
 * deterministic seeded play, undo (including RNG rewind), random playout
 * sweeps across board sizes, and HTML/script consistency checks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Game = require('./game.js');

const DIR = __dirname;
const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeGame(seed, opts) {
  return Game.createGame(Object.assign({ seed: seed }, opts || {}));
}

function plant(game, values) {
  assert.equal(values.length, game.size * game.size, 'fixture size mismatch');
  game.board = values.slice();
  return game;
}

function serialize(game) {
  return JSON.stringify({
    board: game.board,
    score: game.score,
    won: game.won,
    over: game.over,
    moves: game.moves,
    rng: game.rng.a
  });
}

function boardSum(board) {
  return board.reduce(function (a, b) { return a + b; }, 0);
}

function isPowerOfTwo(v) {
  return v > 0 && (v & (v - 1)) === 0;
}

/* Board with the tile spawned by a move removed (for exact fixture checks). */
function boardWithoutSpawn(game, res) {
  const board = game.board.slice();
  if (res.spawned) board[res.spawned.index] = 0;
  return board;
}

/* Tiny deterministic chooser for random playouts. */
function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// pure line merging
// ---------------------------------------------------------------------------

test('slideLine: merges equal neighbours once, pads toward the target', function () {
  assert.deepEqual(Game.slideLine([2, 2, 4, 4]), { line: [4, 8, 0, 0], gained: 12 });
  assert.deepEqual(Game.slideLine([2, 2, 2, 0]), { line: [4, 2, 0, 0], gained: 4 });
  assert.deepEqual(Game.slideLine([4, 4, 4, 4]), { line: [8, 8, 0, 0], gained: 16 });
  assert.deepEqual(Game.slideLine([2, 0, 2, 4]), { line: [4, 4, 0, 0], gained: 4 });
  assert.deepEqual(Game.slideLine([0, 0, 0, 0]), { line: [0, 0, 0, 0], gained: 0 });
  assert.deepEqual(Game.slideLine([2, 4, 8, 16]), { line: [2, 4, 8, 16], gained: 0 });
  // a merged tile never merges again within the same move
  assert.deepEqual(Game.slideLine([2, 2, 2, 2, 2]), { line: [4, 4, 2, 0, 0], gained: 8 });
});

// ---------------------------------------------------------------------------
// game creation
// ---------------------------------------------------------------------------

test('createGame: two valid starting tiles, deterministic per seed', function () {
  for (const seed of [1, 7, 42, 123456]) {
    const game = makeGame(seed);
    const tiles = game.board.filter(function (v) { return v !== 0; });
    assert.equal(tiles.length, 2);
    for (const v of tiles) assert.ok(v === 2 || v === 4, 'tile is 2 or 4, got ' + v);
    assert.equal(game.score, 0);
    assert.equal(game.moves, 0);
    assert.equal(game.won, false);
    assert.equal(game.over, false);
    assert.equal(game.board.length, 16);
    assert.deepEqual(game, makeGame(seed), 'same seed -> same starting board');
  }
  // an unseeded game also starts with two tiles
  assert.equal(Game.createGame({}).board.filter(function (v) { return v !== 0; }).length, 2);
});

// ---------------------------------------------------------------------------
// move semantics (fixture boards, exact results)
// ---------------------------------------------------------------------------

test('move left: merges a row, scores it, spawns exactly one tile', function () {
  const game = makeGame(1);
  plant(game, [
    2, 2, 2, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  const res = Game.move(game, 'left');
  assert.equal(res.moved, true);
  assert.equal(res.gained, 8);
  assert.equal(game.score, 8);
  assert.ok(res.spawned, 'one tile spawned');
  assert.ok(res.spawned.value === 2 || res.spawned.value === 4);
  assert.deepEqual(boardWithoutSpawn(game, res).slice(0, 4), [4, 4, 0, 0]);
});

test('move right: merges at the right edge', function () {
  const game = makeGame(2);
  plant(game, [
    2, 2, 4, 4,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  const res = Game.move(game, 'right');
  assert.equal(res.moved, true);
  assert.equal(game.score, 12);
  assert.deepEqual(boardWithoutSpawn(game, res).slice(0, 4), [0, 0, 4, 8]);
});

test('move up and down: merges by column', function () {
  const up = makeGame(3);
  plant(up, [
    2, 0, 0, 0,
    2, 0, 0, 0,
    4, 0, 0, 0,
    4, 0, 0, 0
  ]);
  const resUp = Game.move(up, 'up');
  assert.equal(resUp.gained, 12);
  assert.equal(up.score, 12);
  assert.equal(up.board[0], 4); // merged at the top
  assert.equal(up.board[4], 8);

  const down = makeGame(3);
  plant(down, [
    2, 0, 0, 0,
    2, 0, 0, 0,
    4, 0, 0, 0,
    4, 0, 0, 0
  ]);
  const resDown = Game.move(down, 'down');
  assert.equal(resDown.gained, 12);
  assert.equal(down.board[12], 8); // merged at the bottom
  assert.equal(down.board[8], 4);
});

test('a move that changes nothing is a no-op (no spawn, no history, no RNG use)', function () {
  const game = makeGame(4);
  plant(game, [
    2, 4, 8, 16,
    4, 8, 16, 32,
    8, 16, 32, 64,
    16, 32, 64, 128
  ]);
  const before = serialize(game);
  const res = Game.move(game, 'left');
  assert.equal(res.moved, false);
  assert.equal(res.gained, 0);
  assert.equal(res.spawned, null);
  assert.equal(serialize(game), before, 'nothing changed at all');
  assert.equal(game.history.length, 0, 'no snapshot for a no-op');
  // this full staircase has no possible moves even though the flag wasn't recomputed
  assert.equal(Game.canMove(game.board, 4), false);
});

// ---------------------------------------------------------------------------
// win / lose
// ---------------------------------------------------------------------------

test('reaching the win tile sets the won flag', function () {
  const game = makeGame(5);
  plant(game, [
    1024, 1024, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  assert.equal(game.won, false);
  const res = Game.move(game, 'left');
  assert.equal(res.gained, 2048);
  assert.equal(game.won, true);
});

test('canMove / game over detection', function () {
  const deadFull = [
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2
  ];
  assert.equal(Game.canMove(deadFull, 4), false);

  const fullWithPair = [
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 2, 4
  ];
  assert.equal(Game.canMove(fullWithPair, 4), true);

  assert.equal(Game.canMove([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4), true);
});

test('moves are ignored once the game is over', function () {
  const game = makeGame(6);
  plant(game, [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
  game.over = true;
  const before = serialize(game);
  const res = Game.move(game, 'left');
  assert.equal(res.moved, false);
  assert.equal(serialize(game), before);
});

// ---------------------------------------------------------------------------
// undo / determinism
// ---------------------------------------------------------------------------

test('undo restores the previous state exactly', function () {
  const game = makeGame(9);
  assert.equal(Game.undo(game), false, 'nothing to undo on a fresh game');

  const before = serialize(game);
  let moved = false;
  for (const dir of Game.DIRECTIONS) {
    const res = Game.move(game, dir);
    if (res.moved) { moved = true; break; }
  }
  assert.ok(moved, 'some move must change the starting board');
  assert.notEqual(serialize(game), before);

  assert.equal(Game.undo(game), true);
  assert.equal(serialize(game), before, 'board, score, flags and RNG all restored');
});

test('undo rewinds the RNG: replaying the same move reproduces the same board', function () {
  const game = makeGame(11);
  let dirUsed = null;
  for (const dir of Game.DIRECTIONS) {
    const res = Game.move(game, dir);
    if (res.moved) { dirUsed = dir; break; }
  }
  assert.ok(dirUsed, 'a move must exist');
  const afterFirst = serialize(game);

  Game.undo(game);
  Game.move(game, dirUsed);
  assert.equal(serialize(game), afterFirst, 'same state -> same move -> same result');
});

test('seeded games are fully deterministic and different seeds differ', function () {
  const moves = ['left', 'up', 'right', 'down', 'left', 'left', 'down', 'right'];
  const a = makeGame(2024);
  const b = makeGame(2024);
  for (const dir of moves) {
    Game.move(a, dir);
    Game.move(b, dir);
    assert.equal(serialize(a), serialize(b));
  }
  assert.notEqual(serialize(makeGame(1)), serialize(makeGame(2)));
});

// ---------------------------------------------------------------------------
// random playout sweeps
// ---------------------------------------------------------------------------

test('sweep: 60 seeded random playouts — invariants hold, every game terminates', function () {
  const LIMIT = 5000;
  const maxTiles = [];

  for (let seed = 1; seed <= 60; seed++) {
    const game = makeGame(seed * 7919);
    const rand = lcg(seed);
    let successful = 0;
    let maxTile = 0;

    while (!game.over) {
      assert.ok(successful < LIMIT, 'seed ' + seed + ': game did not end within ' + LIMIT);
      const dir = Game.DIRECTIONS[Math.floor(rand() * 4)];
      const sumBefore = boardSum(game.board);
      const res = Game.move(game, dir);

      if (res.moved) {
        successful += 1;
        assert.ok(res.spawned, 'successful move spawns exactly one tile');
        assert.ok(res.spawned.value === 2 || res.spawned.value === 4);
        // merging preserves the sum; only the new tile adds to it
        assert.equal(boardSum(game.board), sumBefore + res.spawned.value,
          'sum grows exactly by the spawned tile');
        assert.equal(game.moves, successful);
      } else {
        assert.equal(res.spawned, null);
        assert.equal(boardSum(game.board), sumBefore);
      }

      for (const v of game.board) {
        assert.ok(v === 0 || isPowerOfTwo(v), 'tile is 0 or a power of two: ' + v);
      }
      assert.equal(game.board.length, game.size * game.size);
      assert.equal(game.over, !Game.canMove(game.board, game.size),
        'over flag must always agree with the board');
      maxTile = Math.max(maxTile, ...game.board);
    }

    assert.ok(successful > 0, 'seed ' + seed + ': some moves happened');
    maxTiles.push(maxTile);
  }

  // random play always makes real progress on a 4x4 board
  assert.ok(Math.min(...maxTiles) >= 16,
    'every playout reaches at least a 16 tile, got: ' + maxTiles.join(','));
});

test('sweep: other board sizes (3 and 5) play and terminate cleanly', function () {
  for (const size of [3, 5]) {
    const game = makeGame(1234, { size: size });
    assert.equal(game.board.length, size * size);
    assert.equal(game.board.filter(function (v) { return v !== 0; }).length, 2);

    const rand = lcg(99 + size);
    let attempts = 0;
    while (!game.over) {
      attempts += 1;
      assert.ok(attempts < 20000, 'size ' + size + ': too many attempts');
      const dir = Game.DIRECTIONS[Math.floor(rand() * 4)];
      Game.move(game, dir);
    }
    assert.ok(game.over, 'size ' + size + ' game terminates');
  }
});

test('size-3 board: right and down moves are mirror-correct', function () {
  const right = makeGame(21, { size: 3 });
  plant(right, [
    2, 2, 4,
    0, 0, 0,
    4, 4, 2
  ]);
  const res = Game.move(right, 'right');
  assert.equal(res.gained, 12); // row 0: 2+2 -> 4; row 2: 4+4 -> 8
  const board = boardWithoutSpawn(right, res);
  assert.deepEqual(board.slice(0, 3), [0, 4, 4]);
  assert.deepEqual(board.slice(6, 9), [0, 8, 2]);

  const down = makeGame(22, { size: 3 });
  plant(down, [
    2, 0, 0,
    2, 0, 0,
    4, 0, 0
  ]);
  const resD = Game.move(down, 'down');
  assert.equal(resD.gained, 4); // 2+2 -> 4
  assert.equal(boardWithoutSpawn(down, resD)[6], 4); // bottom-left
});

// ---------------------------------------------------------------------------
// HTML / script consistency (lightweight, no browser needed)
// ---------------------------------------------------------------------------

test('index.html: scripts load in the right order, inline scripts compile', function () {
  const gameIdx = HTML.indexOf('src="game.js"');
  const uiIdx = HTML.indexOf('src="ui.js"');
  assert.ok(gameIdx !== -1, 'index.html loads game.js');
  assert.ok(uiIdx !== -1, 'index.html loads ui.js');
  assert.ok(gameIdx < uiIdx, 'game.js loads before ui.js');

  assert.match(HTML, /<title>[^<]*2048[^<]*<\/title>/);
  assert.match(HTML, /<meta charset="utf-8">/i);

  const inline = HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  let count = 0;
  for (const match of inline) {
    count += 1;
    assert.doesNotThrow(function () { new vm.Script(match[1]); },
      'inline script #' + count + ' must compile');
  }
});

test('ui.js: parses, and every element it looks up exists in index.html', function () {
  const uiSource = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
  assert.doesNotThrow(function () { new vm.Script(uiSource); }, 'ui.js must compile');

  const gameSource = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8');
  assert.doesNotThrow(function () { new vm.Script(gameSource); }, 'game.js must compile');

  const ids = new Set();
  for (const match of uiSource.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
    ids.add(match[1]);
  }
  assert.ok(ids.size >= 8, 'ui.js looks up the expected elements (found ' + ids.size + ')');
  for (const id of ids) {
    assert.ok(HTML.includes('id="' + id + '"'),
      'index.html must contain an element with id "' + id + '"');
  }
});
