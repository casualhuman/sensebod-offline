/*
 * Sensebod Offline: chess piece pictures.
 *
 * These twelve pictures were drawn by hand for Sensebod Offline (simple SVG
 * shapes written in this file). They replace the "wikipedia" PNG pieces that
 * the Chess AI project and chessboard.js ship, because no licence for those
 * PNG files is stated in either repository.
 *
 * These drawings are given under the same MIT licence as the game (see the
 * LICENSE file).
 *
 * Plain ES5: it must run on Chrome 58. No file is fetched: every picture is a
 * data: address built here.
 */
var SensebodChessPieces = (function () {
  'use strict';

  // Each shape is drawn on a 45 x 45 grid. F = fill colour, S = line colour,
  // D = colour of the small details (eye, cut, bands).
  var shapes = {
    P:
      '<path d="M22.5 9a5.5 5.5 0 0 1 3.4 9.8c3.6 2.2 5.6 6.6 5.6 12.2h-18c0-5.600 2-10 5.600-12.200A5.500 5.500 0 0 1 22.500 9z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<rect x="10.500" y="31" width="24" height="7" rx="2" fill="F" stroke="S" stroke-width="1.6"/>',
    R:
      '<path d="M11 7h5v4h4V7h5v4h4V7h5v9l-3 3v11h-18V19l-3-3z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M14 19h17" stroke="D" stroke-width="1.400" stroke-linecap="round"/>' +
      '<rect x="9.500" y="30" width="26" height="8" rx="2" fill="F" stroke="S" stroke-width="1.6"/>',
    N:
      '<path d="M13 32c0-8 6-9 6-14l-6 3.500-3.500-3.500c2-6 5.500-10.500 11-11.500l1-3.500 3 3.500c7.500 2.500 10.500 10 10.500 25.500z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="18.500" cy="13" r="1.500" fill="D"/>' +
      '<path d="M29 12c2.500 4 3 9 3 15" stroke="D" stroke-width="1.400" fill="none" stroke-linecap="round"/>' +
      '<rect x="9.500" y="31" width="27" height="7" rx="2" fill="F" stroke="S" stroke-width="1.6"/>',
    B:
      '<circle cx="22.500" cy="6.500" r="2.600" fill="F" stroke="S" stroke-width="1.6"/>' +
      '<path d="M22.500 9c7 5.500 9 13.500 3.500 20l1.500 3h-10l1.500-3c-5.500-6.500-3.500-14.500 3.500-20z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M22.500 15v8M18.500 19h8" stroke="D" stroke-width="1.600" stroke-linecap="round"/>' +
      '<rect x="10.500" y="31" width="24" height="7" rx="2" fill="F" stroke="S" stroke-width="1.6"/>',
    Q:
      '<path d="M8.500 13l5.500 18h17l5.500-18-7.500 9-6.500-13-6.500 13z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="8.500" cy="11.500" r="2.500" fill="F" stroke="S" stroke-width="1.500"/>' +
      '<circle cx="22.500" cy="7" r="2.500" fill="F" stroke="S" stroke-width="1.500"/>' +
      '<circle cx="36.500" cy="11.500" r="2.500" fill="F" stroke="S" stroke-width="1.500"/>' +
      '<path d="M15 27h15" stroke="D" stroke-width="1.400" stroke-linecap="round"/>' +
      '<rect x="10.500" y="31" width="24" height="7" rx="2" fill="F" stroke="S" stroke-width="1.6"/>',
    K:
      '<path d="M22.500 2.500v9M18.500 6h8" stroke="S" stroke-width="3.200" stroke-linecap="round"/>' +
      '<path d="M22.500 3v8M19 6h7" stroke="F" stroke-width="1" stroke-linecap="round"/>' +
      '<path d="M22.500 12c3 0 5 2 5 4.500 2.500-2.500 9-2 9 4 0 4.500-4.500 6.500-5.500 10.500h-17c-1-4-5.500-6-5.500-10.500 0-6 6.500-6.500 9-4 0-2.500 2-4.500 5-4.500z" fill="F" stroke="S" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M22.500 17v10" stroke="D" stroke-width="1.400" stroke-linecap="round"/>' +
      '<rect x="10.500" y="31" width="24" height="7" rx="2" fill="F" stroke="S" stroke-width="1.6"/>'
  };

  var colours = {
    w: { F: '#ffffff', S: '#1a1a1a', D: '#1a1a1a' },
    b: { F: '#2b2b2b', S: '#000000', D: '#f2f2f2' }
  };

  var cache = {};

  function build(piece) {
    var c = colours[piece.charAt(0)];
    var body = shapes[piece.charAt(1)]
      .replace(/"F"/g, '"' + c.F + '"')
      .replace(/"S"/g, '"' + c.S + '"')
      .replace(/"D"/g, '"' + c.D + '"');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" width="90" height="90">' + body + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // piece is a chessboard.js piece code: 'wK', 'bP', ...
  return function (piece) {
    if (!cache[piece]) cache[piece] = build(piece);
    return cache[piece];
  };
})();
