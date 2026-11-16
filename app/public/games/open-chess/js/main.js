/*
 * A simple chess AI, by someone who doesn't know how to play chess.
 * Uses the chessboard.js and chess.js libraries.
 *
 * Copyright (c) 2020 Zhang Zeyu
 *
 * Changed for Sensebod Offline on 2026-11-16 (see SENSEBOD-OFFLINE-CHANGES.txt):
 * the learner plays White against the computer, by touch, on a small old phone,
 * with no internet. The piece tables, evaluateBoard and minimax are the
 * project's own; the screen code around them was rewritten in plain ES5.
 */

var board = null;
var $board = $('#myBoard');
var game = new Chess();
var globalSum = 0; // always from black's perspective. Negative for white's perspective.

var squareClass = 'square-55d63';
var positionCount;

// Sensebod Offline: state of the screen
var started = false;
var timer = null; // the waiting computer move
var sumStack = []; // globalSum before each half-move, for Undo
var lastMoves = { w: null, b: null }; // squares to keep highlighted
var selected = null; // square of the piece the learner has picked
var targets = []; // squares the picked piece may go to
var wasSelected = false;
var confirmTimer = null;

// Search depth. 1 is the default: an old phone must not freeze.
var LEVELS = [
  { name: 'Easy', depth: 1 },
  { name: 'Medium', depth: 2 },
  { name: 'Hard', depth: 3 }
];
var level = 0;

// The search stops looking deeper after this many milliseconds.
var SEARCH_TIME_LIMIT = 4000;
var searchDeadline = 0;
var searchTimedOut = false;

/*
 * Piece Square Tables, adapted from Sunfish.py:
 * https://github.com/thomasahle/sunfish/blob/master/sunfish.py
 */

var weights = { p: 100, n: 280, b: 320, r: 479, q: 929, k: 60000, k_e: 60000 };
var pst_w = {
  p: [
    [100, 100, 100, 100, 105, 100, 100, 100],
    [78, 83, 86, 73, 102, 82, 85, 90],
    [7, 29, 21, 44, 40, 31, 44, 7],
    [-17, 16, -2, 15, 14, 0, 15, -13],
    [-26, 3, 10, 9, 6, 1, 0, -23],
    [-22, 9, 5, -11, -10, -2, 3, -19],
    [-31, 8, -7, -37, -36, -14, 3, -31],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],
  n: [
    [-66, -53, -75, -75, -10, -55, -58, -70],
    [-3, -6, 100, -36, 4, 62, -4, -14],
    [10, 67, 1, 74, 73, 27, 62, -2],
    [24, 24, 45, 37, 33, 41, 25, 17],
    [-1, 5, 31, 21, 22, 35, 2, 0],
    [-18, 10, 13, 22, 18, 15, 11, -14],
    [-23, -15, 2, 0, 2, 0, -23, -20],
    [-74, -23, -26, -24, -19, -35, -22, -69]
  ],
  b: [
    [-59, -78, -82, -76, -23, -107, -37, -50],
    [-11, 20, 35, -42, -39, 31, 2, -22],
    [-9, 39, -32, 41, 52, -10, 28, -14],
    [25, 17, 20, 34, 26, 25, 15, 10],
    [13, 10, 17, 23, 17, 16, 0, 7],
    [14, 25, 24, 15, 8, 25, 20, 15],
    [19, 20, 11, 6, 7, 6, 20, 16],
    [-7, 2, -15, -12, -14, -15, -10, -10]
  ],
  r: [
    [35, 29, 33, 4, 37, 33, 56, 50],
    [55, 29, 56, 67, 55, 62, 34, 60],
    [19, 35, 28, 33, 45, 27, 25, 15],
    [0, 5, 16, 13, 18, -4, -9, -6],
    [-28, -35, -16, -21, -13, -29, -46, -30],
    [-42, -28, -42, -25, -25, -35, -26, -46],
    [-53, -38, -31, -26, -29, -43, -44, -53],
    [-30, -24, -18, 5, -2, -18, -31, -32]
  ],
  q: [
    [6, 1, -8, -104, 69, 24, 88, 26],
    [14, 32, 60, -10, 20, 76, 57, 24],
    [-2, 43, 32, 60, 72, 63, 43, 2],
    [1, -16, 22, 17, 25, 20, -13, -6],
    [-14, -15, -2, -5, -1, -10, -20, -22],
    [-30, -6, -13, -11, -16, -11, -16, -27],
    [-36, -18, 0, -19, -15, -15, -21, -38],
    [-39, -30, -31, -13, -31, -36, -34, -42]
  ],
  k: [
    [4, 54, 47, -99, -99, 60, 83, -62],
    [-32, 10, 55, 56, 56, 55, 10, 3],
    [-62, 12, -57, 44, -67, 28, 37, -31],
    [-55, 50, 11, -4, -19, 13, 0, -49],
    [-55, -43, -52, -28, -51, -47, -8, -50],
    [-47, -42, -43, -79, -64, -32, -29, -32],
    [-4, 3, -14, -50, -57, -18, 13, 4],
    [17, 30, -3, -14, 6, -1, 40, 18]
  ],

  // Endgame King Table
  k_e: [
    [-50, -40, -30, -20, -20, -30, -40, -50],
    [-30, -20, -10, 0, 0, -10, -20, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -30, 0, 0, 0, 0, -30, -30],
    [-50, -30, -30, -30, -30, -30, -30, -50]
  ]
};
var pst_b = {
  p: pst_w['p'].slice().reverse(),
  n: pst_w['n'].slice().reverse(),
  b: pst_w['b'].slice().reverse(),
  r: pst_w['r'].slice().reverse(),
  q: pst_w['q'].slice().reverse(),
  k: pst_w['k'].slice().reverse(),
  k_e: pst_w['k_e'].slice().reverse()
};

var pstOpponent = { w: pst_b, b: pst_w };
var pstSelf = { w: pst_w, b: pst_b };

/*
 * Evaluates the board at this point in time,
 * using the material weights and piece square tables.
 */
function evaluateBoard(game, move, prevSum, color) {

  if (game.in_checkmate()) {

    // Opponent is in checkmate (good for us)
    if (move.color === color) {
      return 1e10;
    }
    // Our king's in checkmate (bad for us)
    else {
      return -1e10;
    }
  }

  // Sensebod Offline: in_draw() already covers the 50-move rule, stalemate,
  // insufficient material and threefold repetition. The project asked for
  // the last two a second time, which doubled the work at every position.
  if (game.in_draw())
  {
    return 0;
  }

  if (game.in_check()) {
    // Opponent is in check (good for us)
    if (move.color === color) {
      prevSum += 50;
    }
    // Our king's in check (bad for us)
    else {
      prevSum -= 50;
    }
  }

  var from = [
    8 - parseInt(move.from[1], 10),
    move.from.charCodeAt(0) - 'a'.charCodeAt(0)
  ];
  var to = [
    8 - parseInt(move.to[1], 10),
    move.to.charCodeAt(0) - 'a'.charCodeAt(0)
  ];

  // Change endgame behavior for kings
  if (prevSum < -1500) {
    if (move.piece === 'k') {
      move.piece = 'k_e';
    }
    // Kings can never be captured
    // else if (move.captured === 'k') {
    //   move.captured = 'k_e';
    // }
  }

  if ('captured' in move) {
    // Opponent piece was captured (good for us)
    if (move.color === color) {
      prevSum +=
        weights[move.captured] +
        pstOpponent[move.color][move.captured][to[0]][to[1]];
    }
    // Our piece was captured (bad for us)
    else {
      prevSum -=
        weights[move.captured] +
        pstSelf[move.color][move.captured][to[0]][to[1]];
    }
  }

  if (move.flags.indexOf('p') !== -1) {
    // NOTE: promote to queen for simplicity
    move.promotion = 'q';

    // Our piece was promoted (good for us)
    if (move.color === color) {
      prevSum -=
        weights[move.piece] + pstSelf[move.color][move.piece][from[0]][from[1]];
      prevSum +=
        weights[move.promotion] +
        pstSelf[move.color][move.promotion][to[0]][to[1]];
    }
    // Opponent piece was promoted (bad for us)
    else {
      prevSum +=
        weights[move.piece] + pstSelf[move.color][move.piece][from[0]][from[1]];
      prevSum -=
        weights[move.promotion] +
        pstSelf[move.color][move.promotion][to[0]][to[1]];
    }
  } else {
    // The moved piece still exists on the updated board, so we only need to update the position value
    if (move.color !== color) {
      prevSum += pstSelf[move.color][move.piece][from[0]][from[1]];
      prevSum -= pstSelf[move.color][move.piece][to[0]][to[1]];
    } else {
      prevSum -= pstSelf[move.color][move.piece][from[0]][from[1]];
      prevSum += pstSelf[move.color][move.piece][to[0]][to[1]];
    }
  }

  return prevSum;
}

/*
 * Performs the minimax algorithm to choose the best move: https://en.wikipedia.org/wiki/Minimax (pseudocode provided)
 * Recursively explores all possible moves up to a given depth, and evaluates the game board at the leaves.
 *
 * Basic idea: maximize the minimum value of the position resulting from the opponent's possible following moves.
 * Optimization: alpha-beta pruning: https://en.wikipedia.org/wiki/Alpha%E2%80%93beta_pruning (pseudocode provided)
 *
 * Inputs:
 *  - game:                 the game object.
 *  - depth:                the depth of the recursive tree of all possible moves (i.e. height limit).
 *  - isMaximizingPlayer:   true if the current layer is maximizing, false otherwise.
 *  - sum:                  the sum (evaluation) so far at the current layer.
 *  - color:                the color of the current player.
 *
 * Output:
 *  the best move at the root of the current subtree.
 */
function minimax(game, depth, alpha, beta, isMaximizingPlayer, sum, color) {
  positionCount++;

  // Sensebod Offline: the depth is tested before the moves are listed (the
  // answer is the same and a leaf costs much less), and a search that has
  // used its time stops going deeper.
  if (depth === 0) {
    return [null, sum];
  }
  if (!searchTimedOut && (positionCount & 31) === 0 && new Date().getTime() > searchDeadline) {
    searchTimedOut = true;
  }
  if (searchTimedOut) {
    return [null, sum];
  }

  var children = game.ugly_moves({ verbose: true });

  // Sort moves randomly, so the same move isn't always picked on ties
  children.sort(function (a, b) {
    return 0.5 - Math.random();
  });

  var currMove;
  // Node is a terminal node (no children)
  if (children.length === 0) {
    return [null, sum];
  }

  // Find maximum/minimum from list of 'children' (possible moves)
  var maxValue = Number.NEGATIVE_INFINITY;
  var minValue = Number.POSITIVE_INFINITY;
  var bestMove;
  for (var i = 0; i < children.length; i++) {
    currMove = children[i];

    // Note: in our case, the 'children' are simply modified game states
    var currPrettyMove = game.ugly_move(currMove);
    var newSum = evaluateBoard(game, currPrettyMove, sum, color);
    var childResult = minimax(
      game,
      depth - 1,
      alpha,
      beta,
      !isMaximizingPlayer,
      newSum,
      color
    );
    var childValue = childResult[1];

    game.undo();

    // Sensebod Offline: out of time. This last answer was cut short, so keep
    // the best of the moves that were looked at fully.
    if (searchTimedOut && bestMove !== undefined) {
      break;
    }

    if (isMaximizingPlayer) {
      if (childValue > maxValue) {
        maxValue = childValue;
        bestMove = currPrettyMove;
      }
      if (childValue > alpha) {
        alpha = childValue;
      }
    } else {
      if (childValue < minValue) {
        minValue = childValue;
        bestMove = currPrettyMove;
      }
      if (childValue < beta) {
        beta = childValue;
      }
    }

    // Alpha-beta pruning
    if (alpha >= beta) {
      break;
    }
  }

  if (isMaximizingPlayer) {
    return [bestMove, maxValue];
  } else {
    return [bestMove, minValue];
  }
}

/*
 * Calculates the best legal move for the given color.
 */
function getBestMove(game, color, currSum) {
  positionCount = 0;
  searchTimedOut = false;
  searchDeadline = new Date().getTime() + SEARCH_TIME_LIMIT;

  return minimax(
    game,
    LEVELS[level].depth,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    true,
    currSum,
    color
  );
}

/*
 * Sensebod Offline: the line of text above the board. It always says whose
 * turn it is, or how the game ended.
 */
function setStatus(text, kind) {
  var el = document.getElementById('status');
  el.textContent = text;
  el.className = kind || '';
}

function gameOverText() {
  if (game.in_checkmate()) {
    // the side to move has lost
    return game.turn() === 'b' ? 'Checkmate! You win.' : 'Checkmate. The computer wins.';
  }
  if (game.insufficient_material()) return 'Draw: not enough pieces to win.';
  if (game.in_threefold_repetition()) return 'Draw: the same position 3 times.';
  if (game.in_stalemate()) return 'Draw: no move is possible (stalemate).';
  return 'Draw: 50 moves with no capture.';
}

function updateStatus() {
  if (game.game_over()) {
    setStatus(gameOverText(), 'over');
  } else if (game.turn() === 'b') {
    setStatus(game.in_check() ? 'Check! The computer is thinking…' : 'The computer is thinking…', 'wait');
  } else if (game.in_check()) {
    setStatus('Check! Your turn: save your king.', 'check');
  } else {
    setStatus(game.history().length === 0 ? 'Your turn. You are White.' : 'Your turn (White).', 'you');
  }
  document.getElementById('undoBtn').disabled = game.history().length === 0;
}

/*
 * Sensebod Offline: square highlights (last moves, picked piece, where it may go).
 */
function paintHighlights() {
  $board.find('.' + squareClass).removeClass('highlight-white highlight-black oc-selected oc-target oc-capture');
  var colour, i;
  for (colour in lastMoves) {
    if (lastMoves[colour]) {
      var cls = colour === 'w' ? 'highlight-white' : 'highlight-black';
      $board.find('.square-' + lastMoves[colour].from).addClass(cls);
      $board.find('.square-' + lastMoves[colour].to).addClass(cls);
    }
  }
  if (selected) {
    $board.find('.square-' + selected).addClass('oc-selected');
    for (i = 0; i < targets.length; i++) {
      $board.find('.square-' + targets[i].to).addClass(targets[i].capture ? 'oc-capture' : 'oc-target');
    }
  }
}

function select(square) {
  selected = square;
  targets = [];
  if (square) {
    var moves = game.moves({ square: square, verbose: true });
    for (var i = 0; i < moves.length; i++) {
      targets.push({ to: moves[i].to, capture: moves[i].flags.indexOf('c') !== -1 || moves[i].flags.indexOf('e') !== -1 });
    }
  }
  paintHighlights();
}

function isTarget(square) {
  for (var i = 0; i < targets.length; i++) {
    if (targets[i].to === square) return true;
  }
  return false;
}

/*
 * Makes the best legal move for the given color.
 */
function makeBestMove(color) {
  if (game.game_over() || game.turn() !== color) return;

  var best = getBestMove(game, color, color === 'b' ? globalSum : -globalSum)[0];
  if (!best) return;

  // Sensebod Offline: the move is played first and scored after, as for the
  // learner's move, so that the sum sees the new position.
  var move = game.move({ from: best.from, to: best.to, promotion: 'q' });
  if (move === null) return;
  sumStack.push(globalSum);
  globalSum = evaluateBoard(game, move, globalSum, 'b');

  board.position(game.fen());
  lastMoves[color] = { from: move.from, to: move.to };
  paintHighlights();
  updateStatus();
}

/*
 * Sensebod Offline: the learner's move, by drag and drop or by two taps.
 * Returns false when the move is not allowed.
 */
function playerMove(source, target) {
  // see if the move is legal
  var move = game.move({
    from: source,
    to: target,
    promotion: 'q' // NOTE: always promote to a queen for example simplicity
  });

  // Illegal move
  if (move === null) return false;

  sumStack.push(globalSum);
  globalSum = evaluateBoard(game, move, globalSum, 'b');

  lastMoves.w = { from: move.from, to: move.to };
  lastMoves.b = null;
  select(null);
  updateStatus();

  if (!game.game_over()) {
    // Make the best move for black. The wait lets the phone draw the
    // learner's move and the "thinking" text first.
    timer = window.setTimeout(function () {
      timer = null;
      makeBestMove('b');
    }, 350);
  }
  return true;
}

/*
 * Resets the game to its initial state.
 */
function reset() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  game.reset();
  globalSum = 0;
  sumStack = [];
  lastMoves = { w: null, b: null };
  selected = null;
  targets = [];
  board.position(game.fen(), false);
  paintHighlights();
  updateStatus();
}

/*
 * Undo: takes back the computer's last move and the learner's last move.
 */
function undoOnce() {
  if (game.undo() === null) return;
  if (sumStack.length) globalSum = sumStack.pop();
}

function undo() {
  if (game.history().length === 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // back to the last position where it was the learner's turn
  undoOnce();
  if (game.turn() === 'b') undoOnce();

  lastMoves = { w: null, b: null };
  selected = null;
  targets = [];
  board.position(game.fen(), false);
  paintHighlights();
  updateStatus();
}

/*
 * The remaining code is adapted from chessboard.js examples #5000 through #5005:
 * https://chessboardjs.com/examples#5000
 */
function onDragStart(source, piece) {
  // do not pick up pieces if the game is over
  if (game.game_over()) return false;

  // the learner plays White, and only on White's turn
  if (game.turn() !== 'w' || piece.search(/^w/) === -1) return false;

  // Sensebod Offline: touching a piece also picks it, and shows where it may go
  wasSelected = selected === source;
  select(source);
}

function onDrop(source, target) {
  // Sensebod Offline: put down where it was picked up = a tap. The first tap
  // picks the piece (the next tap on a marked square moves it), a second tap
  // on the same piece lets it go.
  if (source === target) {
    if (wasSelected) select(null);
    return 'snapback';
  }

  if (!playerMove(source, target)) {
    select(null);
    return 'snapback';
  }
}

function onSnapEnd() {
  board.position(game.fen());
  paintHighlights();
}

/*
 * Sensebod Offline: tap (or click) a marked square to move the picked piece there.
 */
function onSquarePress(evt) {
  if (!selected || game.turn() !== 'w') return;
  var square = $(evt.currentTarget).attr('data-square');
  if (!square || square === selected || !isTarget(square)) return;
  if (playerMove(selected, square)) {
    board.position(game.fen());
    paintHighlights();
  }
}

/*
 * Sensebod Offline: the board is as large as the frame allows, with the
 * status line and the buttons always in view.
 */
function layout() {
  var w = window.innerWidth;
  var h = window.innerHeight;
  if (!(w > 0 && h > 0)) return false;

  var other =
    document.getElementById('status').offsetHeight +
    document.getElementById('controls').offsetHeight +
    document.getElementById('credit').offsetHeight;
  var size = Math.min(w, h - other);
  if (size < 168) size = Math.min(w, 168);
  if (size > 640) size = 640;
  // chessboard.js: 8 equal squares and a 2px border on each side
  size = Math.floor((size - 4) / 8) * 8 + 4;

  var el = document.getElementById('myBoard');
  if (el.style.width !== size + 'px') {
    el.style.width = size + 'px';
    document.getElementById('controls').style.width = Math.max(size, Math.min(w, 276)) + 'px';
    if (board) {
      board.resize();
      paintHighlights();
    }
  }
  return true;
}

function start() {
  if (started) return;
  // A sandboxed frame can be 0 x 0 for a moment while it loads.
  if (!layout()) {
    window.setTimeout(start, 100);
    return;
  }
  started = true;

  board = Chessboard('myBoard', {
    draggable: true,
    position: 'start',
    showNotation: false,
    moveSpeed: 150,
    snapbackSpeed: 60,
    snapSpeed: 30,
    pieceTheme: SensebodChessPieces,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  });
  $board = $('#myBoard');

  // Tap to move. chessboard.js listens on the inner board, so by the time
  // these run it has already refused to drag (empty square or black piece).
  $board.on('mousedown touchstart', '.' + squareClass, onSquarePress);

  // A finger on the board never scrolls the page and never becomes a
  // second, made-up mouse click.
  var boardEl = document.getElementById('myBoard');
  var stop = function (e) { e.preventDefault(); };
  boardEl.addEventListener('touchstart', stop, { passive: false });
  boardEl.addEventListener('touchmove', stop, { passive: false });

  $('#newBtn').on('click', function () {
    var btn = this;
    var playing = game.history().length > 0 && !game.game_over();
    if (playing && !confirmTimer) {
      // no confirm() box in a sandboxed frame: ask for a second tap
      btn.textContent = 'Tap again';
      $(btn).addClass('ask');
      confirmTimer = window.setTimeout(function () {
        confirmTimer = null;
        btn.textContent = 'New game';
        $(btn).removeClass('ask');
      }, 3000);
      return;
    }
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
      btn.textContent = 'New game';
      $(btn).removeClass('ask');
    }
    reset();
  });

  $('#undoBtn').on('click', undo);

  $('#levelBtn').on('click', function () {
    level = (level + 1) % LEVELS.length;
    document.getElementById('levelName').textContent = LEVELS[level].name;
  });

  $(window).on('resize orientationchange', function () {
    layout();
  });

  layout();
  updateStatus();
}

// chessboard.js stops the page from scrolling while a piece is dragged with
// preventDefault() in a touchmove listener on the window. Chrome treats such
// a listener as "passive" (it may not stop anything) unless it is added like
// this.
jQuery.event.special.touchmove = {
  setup: function (data, namespaces, handle) {
    this.addEventListener('touchmove', handle, { passive: false });
  }
};

start();
