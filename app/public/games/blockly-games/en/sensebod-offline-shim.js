/*
 * Sensebod Offline: stand-ins for browser storage (Blockly Games version).
 *
 * The game runs in a sandboxed frame with no origin of its own. There, reading
 * localStorage or sessionStorage throws a SecurityError. Blockly Games keeps the
 * learner's solved levels and blocks in them, and it moves between several HTML
 * pages. This file, loaded before every other script on every page, replaces
 * the two stores with a memory that is carried from page to page in
 * window.name (which stays with the frame), so progress lasts until the game
 * is closed. Outside a sandbox it changes nothing.
 * Plain ES5 (Proxy is used when the browser has it: Chrome 49+).
 */
(function () {
  'use strict';

  var MARK = 'sensebod-offline-bg1:';
  var NAMES = ['localStorage', 'sessionStorage'];
  var saved = { localStorage: {}, sessionStorage: {} };
  var has = Object.prototype.hasOwnProperty;

  function works(name) {
    try {
      window[name].getItem('sensebod-offline-test');
      return true;
    } catch (e) {
      return false;
    }
  }
  if (works(NAMES[0]) && works(NAMES[1])) return;

  try {
    var carried = window.name;
    if (typeof carried === 'string' && carried.indexOf(MARK) === 0) {
      var parsed = JSON.parse(carried.slice(MARK.length));
      NAMES.forEach(function (name) {
        var from = parsed && parsed[name];
        if (!from || typeof from !== 'object') return;
        Object.keys(from).forEach(function (key) {
          saved[name][key] = String(from[key]);
        });
      });
    }
  } catch (e) {}

  function persist() {
    try {
      window.name = MARK + JSON.stringify(saved);
    } catch (e) {}
  }

  function makeStore(name) {
    var data = saved[name];
    var api = {
      getItem: function (key) {
        return has.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
        persist();
      },
      removeItem: function (key) {
        delete data[key];
        persist();
      },
      clear: function () {
        Object.keys(data).forEach(function (key) {
          delete data[key];
        });
        persist();
      },
      key: function (index) {
        var keys = Object.keys(data);
        return index < keys.length ? keys[index] : null;
      }
    };

    if (typeof Proxy === 'function') {
      // The game reads and writes with plain properties: localStorage['maze1'] = xml.
      return new Proxy(data, {
        get: function (target, key) {
          if (key === 'length') return Object.keys(target).length;
          if (has.call(api, key)) return api[key];
          return has.call(target, key) ? target[key] : undefined;
        },
        set: function (target, key, value) {
          target[key] = String(value);
          persist();
          return true;
        },
        deleteProperty: function (target, key) {
          delete target[key];
          persist();
          return true;
        },
        has: function (target, key) {
          return key === 'length' || has.call(api, key) || has.call(target, key);
        }
      });
    }

    // No Proxy: the data object itself is the store; it is written out when the page is left.
    Object.keys(api).forEach(function (method) {
      Object.defineProperty(data, method, { value: api[method], enumerable: false });
    });
    return data;
  }

  NAMES.forEach(function (name) {
    try {
      Object.defineProperty(window, name, { value: makeStore(name), configurable: true, writable: true });
    } catch (e) {}
  });

  if (typeof Proxy !== 'function') {
    window.addEventListener('pagehide', persist, false);
    window.addEventListener('unload', persist, false);
    setInterval(persist, 1000);
  }
})();

/*
 * Sensebod Offline: message boxes drawn inside the page.
 *
 * The sandboxed frame may not open the browser's own alert, confirm and prompt
 * boxes: they return at once and nothing is shown. Blockly uses them to type a
 * number into a block on Android, to name a variable and to ask before deleting.
 * SensebodOfflineDialog draws the same three boxes in the page and answers
 * through a callback. window.alert is pointed at it too.
 */
(function () {
  'use strict';

  var queue = [];
  var open = null;

  function style(el, css) {
    el.setAttribute('style', css);
    return el;
  }

  function button(label, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    style(b, 'min-width:110px;min-height:48px;margin:0 0 0 12px;padding:8px 18px;font:20px sans-serif;border-radius:4px;box-shadow:none;' +
      (primary ? 'border:1px solid #4d90fe;background:#4d90fe;color:#fff;' : 'border:1px solid #bbb;background:#eee;color:#000;'));
    return b;
  }

  function next() {
    if (open || !queue.length) return;
    if (!document.body) {
      setTimeout(next, 50);
      return;
    }
    var job = queue.shift();
    var shownAt = Date.now();
    var shade = style(document.createElement('div'),
      'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:rgba(0,0,0,0.35);text-align:center;overflow:auto;');
    var box = style(document.createElement('div'),
      'display:inline-block;margin:60px 12px 12px;padding:18px;max-width:420px;min-width:260px;text-align:left;background:#fff;color:#000;' +
      'border:1px solid #888;border-radius:8px;box-shadow:4px 4px 10px rgba(0,0,0,0.4);font:20px sans-serif;');
    var text = style(document.createElement('div'), 'white-space:pre-wrap;word-wrap:break-word;margin:0 0 16px;');
    text.textContent = job.message;
    box.appendChild(text);
    var input = null;
    if (job.kind === 'prompt') {
      input = style(document.createElement('input'),
        'display:block;box-sizing:border-box;width:100%;min-height:48px;margin:0 0 16px;padding:6px 10px;font:22px sans-serif;border:1px solid #888;border-radius:4px;');
      input.type = 'text';
      input.value = job.value;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      box.appendChild(input);
    }
    var row = style(document.createElement('div'), 'text-align:right;');
    var cancel = job.kind === 'alert' ? null : button('Cancel', false);
    var ok = button('OK', true);
    if (cancel) row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(row);
    shade.appendChild(box);
    document.body.appendChild(shade);
    open = job;

    function close(result) {
      // A tap that opened the box can arrive a second time as a click: do not let it press a button.
      if (Date.now() - shownAt < 400) return;
      if (open !== job) return;
      open = null;
      if (shade.parentNode) shade.parentNode.removeChild(shade);
      try {
        if (job.done) job.done(result);
      } finally {
        next();
      }
    }
    function yes() {
      close(job.kind === 'prompt' ? input.value : true);
    }
    function no() {
      close(job.kind === 'prompt' ? null : job.kind === 'confirm' ? false : undefined);
    }
    ok.addEventListener('click', yes, false);
    if (cancel) cancel.addEventListener('click', no, false);
    shade.addEventListener('keydown', function (e) {
      if (e.keyCode === 13) { e.preventDefault(); yes(); }
      if (e.keyCode === 27) { e.preventDefault(); no(); }
      e.stopPropagation();
    }, false);
    ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'keyup', 'keypress'].forEach(function (type) {
      shade.addEventListener(type, function (e) { e.stopPropagation(); }, false);
    });
    try {
      if (input) { input.focus(); input.select(); } else { ok.focus(); }
    } catch (e) {}
  }

  function ask(kind, message, value, done) {
    message = String(message);
    // The same question asked twice in a row (one tap seen as touchend and click) is asked once.
    if (open && open.kind === kind && open.message === message) return;
    queue.push({ kind: kind, message: message, value: value === undefined || value === null ? '' : String(value), done: done });
    next();
  }

  window.SensebodOfflineDialog = {
    alert: function (message, done) { ask('alert', message, '', done); },
    confirm: function (message, done) { ask('confirm', message, '', done); },
    prompt: function (message, value, done) { ask('prompt', message, value, done); }
  };
  window.alert = function (message) { ask('alert', message, '', null); };
})();
