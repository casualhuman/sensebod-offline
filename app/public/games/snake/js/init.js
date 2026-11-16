/*
JavaScript Snake: start-up for Sensebod Offline.

Rewritten on 2026-11-16 from the project's js/init.js (see
SENSEBOD-OFFLINE-CHANGES.txt). It creates the board, and wires the on-screen
buttons and swipes to the board's own simulateKeyPress(), so touch and the
keyboard go through the same code. Plain ES5: it must run on Chrome 58.
*/
(function boot() {
  "use strict";

  // Sensebod Offline: a sandboxed frame can be 0 x 0 for a moment while it loads. The board is sized
  // once from the frame, so wait until the frame has a size (otherwise no row is built and nothing moves).
  if (!(window.innerWidth > 0 && window.innerHeight > 0)) {
    setTimeout(boot, 50);
    return;
  }

  var KEY_LEFT = 37;
  var KEY_UP = 38;
  var KEY_RIGHT = 39;
  var KEY_DOWN = 40;
  var KEY_PAUSE = 32; // space

  // Room kept free at the bottom of the frame for the on-screen buttons, so
  // the board ends above them.
  var gamepad = document.getElementById("snake-gamepad");
  var bottomOffset = 0;
  if (gamepad) {
    bottomOffset = Math.round(
      window.innerHeight - gamepad.getBoundingClientRect().top
    );
  }
  if (!(bottomOffset > 0) || bottomOffset > 200) {
    bottomOffset = 120; // two rows of 52px buttons, a 6px gap, 10px below
  }

  var board = new SNAKE.Board({
    boardContainer: "game-area",
    fullScreen: true,
    bottomOffset: bottomOffset,
    premoveOnPause: false,
    dialogControls: document.getElementById("snake-dialog-controls")
  });

  function press(keyNum) {
    board.simulateKeyPress(keyNum);
  }

  // ---- buttons: act when the finger goes down, not when it lifts ----

  function wireButton(btn) {
    var keyNum = parseInt(btn.getAttribute("data-key"), 10);
    btn.addEventListener(
      "touchstart",
      function (evt) {
        evt.preventDefault(); // also stops the mouse events that would follow
        press(keyNum);
      },
      { passive: false }
    );
    btn.addEventListener(
      "mousedown",
      function (evt) {
        evt.preventDefault(); // keep the keyboard focus on the board
        press(keyNum);
      },
      false
    );
  }

  var buttons = document.querySelectorAll("#snake-gamepad button, #snake-pause");
  for (var i = 0; i < buttons.length; i++) {
    wireButton(buttons[i]);
  }

  // The "Resume" button inside the pause dialog (made in js/snake.js).
  document.addEventListener(
    "click",
    function (evt) {
      var target = evt.target;
      if (target && target.closest && target.closest(".snake-resume-button")) {
        press(KEY_PAUSE);
      }
    },
    false
  );

  // ---- swipes anywhere outside the buttons and dialogs ----

  var SWIPE_MIN = 24; // px a finger must travel before it counts as a turn
  var NOT_FOR_SWIPE =
    "button, select, option, label, .snake-gamepad, .snake-dos-overlay, " +
    ".snake-welcome-dialog, .snake-try-again-dialog, .snake-win-dialog, " +
    ".snake-pause-screen";
  var startX = null;
  var startY = null;

  function endSwipe() {
    startX = null;
    startY = null;
  }

  document.addEventListener(
    "touchstart",
    function (evt) {
      var target = evt.target;
      if (
        evt.touches.length !== 1 ||
        (target && target.closest && target.closest(NOT_FOR_SWIPE))
      ) {
        endSwipe();
        return;
      }
      startX = evt.touches[0].clientX;
      startY = evt.touches[0].clientY;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    function (evt) {
      if (startX === null || !evt.touches.length) {
        return;
      }
      if (evt.cancelable) {
        evt.preventDefault(); // the page must not move under the finger
      }
      var touch = evt.touches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      var ax = Math.abs(dx);
      var ay = Math.abs(dy);
      if (ax < SWIPE_MIN && ay < SWIPE_MIN) {
        return;
      }
      if (ax > ay) {
        press(dx > 0 ? KEY_RIGHT : KEY_LEFT);
      } else {
        press(dy > 0 ? KEY_DOWN : KEY_UP);
      }
      // start again from here: one long stroke can make several turns
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: false }
  );

  document.addEventListener("touchend", endSwipe, false);
  document.addEventListener("touchcancel", endSwipe, false);

  // no long-press menu during play
  document.addEventListener(
    "contextmenu",
    function (evt) {
      evt.preventDefault();
    },
    false
  );
})();
