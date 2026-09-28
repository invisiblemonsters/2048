/*
 * 2048 — browser UI: rendering, keyboard/touch input, score, undo, new game.
 * Depends on game.js (window.Game2048) being loaded first.
 */
(function () {
  'use strict';

  if (!window.Game2048) {
    throw new Error('2048: game.js must be loaded before ui.js');
  }
  var Game = window.Game2048;
  var BEST_KEY = 'game-2048-best';

  // --- DOM ---------------------------------------------------------------
  var boardEl = document.getElementById('board');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var undoBtn = document.getElementById('undo');
  var newBtn = document.getElementById('new-game');
  var overlayEl = document.getElementById('overlay');
  var overlayTitleEl = document.getElementById('overlay-title');
  var overlayTextEl = document.getElementById('overlay-text');
  var overlayBtn = document.getElementById('overlay-btn');

  // --- state -------------------------------------------------------------
  var best = loadBest();
  var game = newGame();
  var dismissedWin = false;

  function newGame() {
    return Game.createGame({});
  }

  function loadBest() {
    try {
      var v = parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (err) {
      return 0; // storage unavailable — scores just won't persist
    }
  }

  function saveBest(value) {
    try { window.localStorage.setItem(BEST_KEY, String(value)); } catch (err) { /* ignore */ }
  }

  // --- board cells (built once, re-rendered on every change) --------------
  var cellEls = [];
  for (var i = 0; i < 16; i++) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.addEventListener('animationend', function () { this.classList.remove('pop'); });
    boardEl.appendChild(cell);
    cellEls.push(cell);
  }

  function tileClass(value) {
    if (!value) return 'cell';
    return 'cell tile tile-' + (value <= 2048 ? value : 'super');
  }

  function render() {
    for (var i = 0; i < cellEls.length; i++) {
      var el = cellEls[i];
      var value = game.board[i];
      var text = value ? String(value) : '';
      var cls = tileClass(value);
      var changed = el.textContent !== text || el.className !== cls;

      el.textContent = text;
      el.className = cls;

      if (changed && text) { // little pop for new/merged tiles
        el.classList.remove('pop');
        void el.offsetWidth; // restart the animation
        el.classList.add('pop');
      }
    }
  }

  function updateMeta() {
    scoreEl.textContent = String(game.score);
    if (game.score > best) {
      best = game.score;
      saveBest(best);
    }
    bestEl.textContent = String(best);
    undoBtn.disabled = game.history.length === 0;
  }

  function showOverlay(title, text, buttonLabel) {
    overlayTitleEl.textContent = title;
    overlayTextEl.textContent = text;
    overlayBtn.textContent = buttonLabel;
    overlayEl.hidden = false;
  }

  function updateOverlay() {
    if (game.over) {
      showOverlay('Game over!', 'No moves left — final score: ' + game.score, 'Try again');
    } else if (game.won && !dismissedWin) {
      showOverlay('You win!', 'You reached ' + game.winTile + ' — keep going for a higher score.', 'Keep going');
    } else {
      overlayEl.hidden = true;
    }
  }

  function refresh() {
    render();
    updateMeta();
    updateOverlay();
  }

  // --- actions -------------------------------------------------------------
  function doMove(direction) {
    var result = Game.move(game, direction);
    if (result.moved) refresh();
  }

  function restart() {
    game = newGame();
    dismissedWin = false;
    refresh();
  }

  overlayBtn.addEventListener('click', function () {
    if (game.over) {
      restart();
    } else {
      dismissedWin = true;
      updateOverlay();
    }
  });

  newBtn.addEventListener('click', restart);

  undoBtn.addEventListener('click', function () {
    if (Game.undo(game)) refresh();
  });

  // --- keyboard ------------------------------------------------------------
  var KEY_DIRECTIONS = {
    ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };

  document.addEventListener('keydown', function (event) {
    var direction = KEY_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      doMove(direction);
    }
  });

  // --- touch ----------------------------------------------------------------
  var touchStart = null;

  boardEl.addEventListener('touchstart', function (event) {
    var t = event.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  boardEl.addEventListener('touchmove', function (event) {
    event.preventDefault(); // keep the page from scrolling while swiping
  }, { passive: false });

  boardEl.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    var t = event.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;

    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return; // a tap, not a swipe
    if (absX > absY) {
      doMove(dx > 0 ? 'right' : 'left');
    } else {
      doMove(dy > 0 ? 'down' : 'up');
    }
  }, { passive: true });

  // --- go -------------------------------------------------------------------
  refresh();
})();
