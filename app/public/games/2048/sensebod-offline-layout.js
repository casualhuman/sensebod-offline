/*
 * Sensebod Offline: board size and page behaviour for 2048.
 *
 * The game runs in a frame that is 284 x 409 px on a 320px phone and much
 * larger on a tablet or laptop. The project's style sheet has two fixed board
 * sizes (500px and 280px); neither fits. This file measures the frame and
 * writes the sizes of the board, the cells and the tiles so that the title,
 * the scores, "New Game" and the 4 x 4 board always fit with no scrolling.
 * It runs again whenever the frame changes size (a sandboxed frame can be
 * 0 x 0 for a moment while it loads).
 *
 * It also stops the page itself from scrolling or bouncing under a finger.
 * Plain ES5: it must run on Chrome 58. No eval.
 */
(function () {
  'use strict';

  var HEADER = 112;   // 4 + 44 (title, scores) + 6 + 48 (hint, New Game) + 6 + board + 4
  var MAX_BOARD = 500; // the project's own desktop size
  var MIN_BOARD = 150;
  var styleEl = null;
  var lastKey = '';

  function frameSize() {
    var w = window.innerWidth || document.documentElement.clientWidth || 0;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    return { w: w, h: h };
  }

  function layout() {
    var size = frameSize();
    var w = size.w;
    var h = size.h;
    // Not measured yet: use the size of the frame on a 320px phone.
    if (!(w > 0) || !(h > 0)) {
      w = 284;
      h = 409;
    }
    var key = w + 'x' + h;
    if (key === lastKey) return;
    lastKey = key;

    var board = Math.min(w - 8, h - HEADER, MAX_BOARD);
    if (board < MIN_BOARD) board = MIN_BOARD;
    var gap = Math.max(5, Math.round(board * 0.03));
    var tile = Math.floor((board - 5 * gap) / 4);
    board = 4 * tile + 5 * gap;
    var step = tile + gap;
    var px = 'px';

    var css = '';
    // The title, scores and "New Game" use the frame's width even when a low
    // frame makes the board narrower; the board sits in the middle below them.
    var head = Math.max(board, Math.min(w - 8, 340));
    css += '.container{width:' + head + px + '}';
    css += '.game-container{width:' + board + px + ';height:' + board + px + ';padding:' + gap + px + '}';
    css += '.grid-row{margin-bottom:' + gap + px + '}';
    css += '.grid-row:last-child{margin-bottom:0}';
    css += '.grid-cell{width:' + tile + px + ';height:' + tile + px + ';margin-right:' + gap + px + '}';
    css += '.grid-cell:last-child{margin-right:0}';
    css += '.tile,.tile .tile-inner{width:' + tile + px + ';height:' + tile + px + ';line-height:' + tile + px + '}';
    css += '.tile .tile-inner{font-size:' + Math.round(tile * 0.55) + px + '}';
    css += '.tile.tile-128 .tile-inner,.tile.tile-256 .tile-inner,.tile.tile-512 .tile-inner{font-size:' +
      Math.round(tile * 0.42) + px + '}';
    css += '.tile.tile-1024 .tile-inner,.tile.tile-2048 .tile-inner{font-size:' + Math.round(tile * 0.33) + px + '}';
    css += '.tile.tile-super .tile-inner{font-size:' + Math.round(tile * 0.25) + px + '}';
    css += '.game-message p{font-size:' + Math.max(24, Math.round(board * 0.11)) + px + '}';
    for (var x = 1; x <= 4; x++) {
      for (var y = 1; y <= 4; y++) {
        var t = 'translate(' + (step * (x - 1)) + px + ',' + (step * (y - 1)) + px + ')';
        css += '.tile.tile-position-' + x + '-' + y + '{-webkit-transform:' + t + ';transform:' + t + '}';
      }
    }

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('id', 'sensebod-offline-layout');
      (document.head || document.getElementsByTagName('head')[0]).appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);

  // A frame that was 0 x 0 at start-up does not always send "resize" on old
  // browsers: look again for the first few seconds.
  var tries = 0;
  var timer = window.setInterval(function () {
    layout();
    tries += 1;
    if (tries >= 40) window.clearInterval(timer);
  }, 250);

  // The page must not scroll, bounce or zoom while a finger swipes. Since
  // Chrome 56 a touch listener on the document is "passive" unless told
  // otherwise, so ask for a real one where the browser understands options.
  var passiveKnown = false;
  try {
    var probe = Object.defineProperty({}, 'passive', {
      get: function () {
        passiveKnown = true;
        return false;
      }
    });
    window.addEventListener('sensebod-offline-probe', null, probe);
    window.removeEventListener('sensebod-offline-probe', null, probe);
  } catch (e) {}

  document.addEventListener('touchmove', function (event) {
    if (event.cancelable) event.preventDefault();
  }, passiveKnown ? { passive: false } : false);

  // No long-press menu and no text selection drag inside the game.
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  });
  document.addEventListener('gesturestart', function (event) {
    event.preventDefault();
  });
})();
