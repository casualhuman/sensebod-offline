/*
 * Sensebod Offline: the "Sound: on / off" button for Dino Runner.
 * index.js reads window.sensebodSoundOff before it plays a sound.
 * Plain ES5: it must run on Chrome 58.
 */
(function () {
  'use strict';

  var button = document.getElementById('sensebod-sound');
  if (!button) return;

  window.sensebodSoundOff = false;

  // The game listens for mouse presses on the whole document (desktop) and
  // would make the dino jump: keep presses on the button to the button.
  function keep(e) {
    e.stopPropagation();
  }
  ['mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(function (name) {
    button.addEventListener(name, keep);
  });

  button.addEventListener('click', function () {
    window.sensebodSoundOff = !window.sensebodSoundOff;
    button.textContent = window.sensebodSoundOff ? 'Sound: off' : 'Sound: on';
    // Do not keep the keyboard focus: Space must go on jumping, not press this.
    button.blur();
  });
})();
