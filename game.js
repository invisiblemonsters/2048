/*
 * 2048 — core game logic.
 *
 * Pure, dependency-free and deterministic: with a given seed, a given move
 * sequence always produces the same game, which makes the whole thing easy
 * to test. Runs in the browser (defines window.Game2048) and in Node
 * (module.exports).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Game2048 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 4;                 // default board width/height
  var WIN_TILE = 2048;          // default winning tile
  var SPAWN_FOUR_CHANCE = 0.1;  // probability a spawned tile is 4 (else 2)
  var MAX_HISTORY = 64;         // undo depth

  var DIRECTIONS = ['up', 'right', 'down', 'left'];

  /* ------------------------------------------------------------------ *
   * Deterministic RNG (mulberry32). The state lives on the game object
   * so a snapshot can be rolled back exactly for undo().
   * ------------------------------------------------------------------ */
  function nextRandom(game) {
    var a = game.rng.a | 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    game.rng.a = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function createGame(opts) {
    opts = opts || {};
    var size = opts.size || SIZE;
    var seed = (opts.seed == null)
      ? ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0)
      : (opts.seed >>> 0);

    var game = {
      size: size,
      winTile: opts.winTile || WIN_TILE,
      board: new Array(size * size).fill(0), // row-major, 0 = empty
      score: 0,
      won: false,    // true once winTile has been reached
      over: false,   // true once no move is possible
      moves: 0,
      rng: { a: seed },
      history: []
    };
    spawnTile(game);
    spawnTile(game);
    return game;
  }

  function emptyCells(game) {
    var cells = [];
    for (var i = 0; i < game.board.length; i++) {
      if (game.board[i] === 0) cells.push(i);
    }
    return cells;
  }

  /* Place one tile (90% a 2, 10% a 4) on a random empty cell. */
  function spawnTile(game) {
    var empties = emptyCells(game);
    if (empties.length === 0) return null;
    var index = empties[Math.floor(nextRandom(game) * empties.length)];
    var value = nextRandom(game) < SPAWN_FOUR_CHANCE ? 4 : 2;
    game.board[index] = value;
    return { index: index, value: value };
  }

  /*
   * Slide a single line toward index 0, merging equal neighbours once
   * (a tile that was already produced by a merge cannot merge again).
   */
  function slideLine(line) {
    var values = line.filter(function (v) { return v !== 0; });
    var out = [];
    var gained = 0;
    for (var i = 0; i < values.length; i++) {
      if (i + 1 < values.length && values[i] === values[i + 1]) {
        var merged = values[i] * 2;
        out.push(merged);
        gained += merged;
        i += 1;
      } else {
        out.push(values[i]);
      }
    }
    while (out.length < line.length) out.push(0);
    return { line: out, gained: gained };
  }

  /* Board indices of line `line` (0..size-1), ordered toward `direction`. */
  function lineIndices(size, direction, line) {
    var indices = [];
    for (var k = 0; k < size; k++) {
      if (direction === 'left') indices.push(line * size + k);
      else if (direction === 'right') indices.push(line * size + (size - 1 - k));
      else if (direction === 'up') indices.push(k * size + line);
      else if (direction === 'down') indices.push((size - 1 - k) * size + line);
      else throw new Error('Unknown direction: ' + direction);
    }
    return indices;
  }

  function canMove(board, size) {
    for (var i = 0; i < board.length; i++) {
      if (board[i] === 0) return true;
    }
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = board[r * size + c];
        if (c + 1 < size && board[r * size + c + 1] === v) return true;
        if (r + 1 < size && board[(r + 1) * size + c] === v) return true;
      }
    }
    return false;
  }

  function hasWon(game) {
    return game.board.some(function (v) { return v >= game.winTile; });
  }

  function snapshot(game) {
    return {
      board: game.board.slice(),
      score: game.score,
      won: game.won,
      over: game.over,
      moves: game.moves,
      rngA: game.rng.a
    };
  }

  /*
   * Apply a move. Returns { moved, gained, spawned }. A successful move
   * spawns exactly one new tile and is undoable.
   */
  function move(game, direction) {
    if (game.over) return { moved: false, gained: 0, spawned: null };
    if (DIRECTIONS.indexOf(direction) === -1) {
      throw new Error('Unknown direction: ' + direction);
    }

    var before = snapshot(game);
    var gained = 0;
    var size = game.size;

    for (var line = 0; line < size; line++) {
      var indices = lineIndices(size, direction, line);
      var values = indices.map(function (i) { return game.board[i]; });
      var result = slideLine(values);
      gained += result.gained;
      for (var k = 0; k < size; k++) game.board[indices[k]] = result.line[k];
    }

    var changed = game.board.some(function (v, i) { return v !== before.board[i]; });
    if (!changed) {
      game.board = before.board; // nothing happened
      return { moved: false, gained: 0, spawned: null };
    }

    game.score += gained;
    game.moves += 1;
    var spawned = spawnTile(game);
    if (!game.won && hasWon(game)) game.won = true;
    game.over = !canMove(game.board, game.size);

    game.history.push(before);
    if (game.history.length > MAX_HISTORY) game.history.shift();

    return { moved: true, gained: gained, spawned: spawned };
  }

  /* Undo the most recent successful move. Returns true if something moved back. */
  function undo(game) {
    if (game.history.length === 0) return false;
    var snap = game.history.pop();
    game.board = snap.board.slice();
    game.score = snap.score;
    game.won = snap.won;
    game.over = snap.over;
    game.moves = snap.moves;
    game.rng.a = snap.rngA;
    return true;
  }

  return {
    SIZE: SIZE,
    WIN_TILE: WIN_TILE,
    DIRECTIONS: DIRECTIONS,
    createGame: createGame,
    move: move,
    undo: undo,
    spawnTile: spawnTile,
    slideLine: slideLine,
    canMove: canMove,
    hasWon: hasWon,
    emptyCells: emptyCells
  };
});
