/*
 * Sensebod Offline: stand-ins for browser storage.
 *
 * A game runs in a sandboxed frame with no origin of its own. There, reading
 * localStorage, sessionStorage or document.cookie throws a SecurityError and
 * the game would stop before it starts. This file, loaded before every other
 * script, replaces them with a memory that lasts until the game is closed
 * (best scores are forgotten then). Outside a sandbox it changes nothing.
 * Plain ES5: it must run on Chrome 58.
 */
(function () {
  'use strict';

  function memoryStore() {
    var data = {};
    var store = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      },
      clear: function () {
        data = {};
      },
      key: function (index) {
        var keys = Object.keys(data);
        return index < keys.length ? keys[index] : null;
      }
    };
    try {
      Object.defineProperty(store, 'length', {
        get: function () {
          return Object.keys(data).length;
        }
      });
    } catch (e) {}
    return store;
  }

  function works(name) {
    try {
      var real = window[name];
      real.getItem('sensebod-offline-test');
      return true;
    } catch (e) {
      return false;
    }
  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {
    if (works(name)) return;
    try {
      Object.defineProperty(window, name, { value: memoryStore(), configurable: true, writable: true });
    } catch (e) {}
  });

  var cookieWorks = true;
  try {
    void document.cookie;
  } catch (e) {
    cookieWorks = false;
  }
  if (!cookieWorks) {
    var jar = '';
    try {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: function () {
          return jar;
        },
        set: function (value) {
          var pair = String(value).split(';')[0];
          var name = pair.split('=')[0];
          var kept = jar ? jar.split('; ').filter(function (item) { return item.split('=')[0] !== name; }) : [];
          kept.push(pair);
          jar = kept.join('; ');
        }
      });
    } catch (e) {}
  }
})();
