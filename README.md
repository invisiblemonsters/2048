# 2048

A small, dependency-free implementation of the classic **2048** sliding-tile puzzle.

- Zero dependencies — one HTML page plus two plain JavaScript files.
- Deterministic core: given a seed, a game plays out identically every time (which is what makes it testable).
- Undo (one step), score, and best score saved locally.
- Keyboard (arrow keys / WASD) and touch (swipe) controls.
- Clean separation: `game.js` is pure logic, `ui.js` is only the DOM layer.

## Play

Open `index.html` in a browser — no build step, no server required.

Or serve it locally if you prefer:

```bash
python -m http.server
# then open http://localhost:8000
```

**How to play:** slide the tiles with the arrow keys (or WASD / swipe). Equal
tiles merge when they collide. Reach the 2048 tile to win — then keep going
for a higher score. The game ends when no move is possible.

## Tests

```bash
node --test test.js
```

(or `npm test`). Node 18+ required (the test runner uses `node:test`).

The suite covers:

- merge rules (including "a merged tile never merges again in the same move"),
- move semantics in all four directions on exact fixture boards,
- no-op detection (no spawn, no score, no RNG use),
- win and game-over detection,
- undo, including RNG rewind (replaying a move after undo reproduces it exactly),
- deterministic seeded play and distinctness across seeds,
- 60 seeded random playouts asserting invariants after every move (consistent
  over flag, powers-of-two tiles, board sum grows exactly by the spawned tile)
  and clean termination,
- extra board sizes (3 and 5),
- HTML/script consistency: script order, compile checks for inline and linked
  scripts, and a cross-check that every element id `ui.js` looks up exists in
  `index.html`.

## Files

| File | Purpose |
| ---- | ------- |
| `index.html` | Markup + styles |
| `game.js` | Board model, sliding/merging, scoring, spawning, win/lose, seeded RNG |
| `ui.js` | Rendering, input, score/best, undo and new-game controls |
| `test.js` | Test suite (`node --test test.js`) |

## License

MIT
