/*
 * Clumsy Bird (https://github.com/ellisonleao/clumsy-bird), GPL-3.0.
 * Modified for Sensebod Offline on 2026-11-16: see SENSEBOD-OFFLINE-CHANGES.txt.
 */
var game = {
    data: {
        score : 0,
        steps: 0,
        start: false,
        newHiScore: false,
        muted: false
    },

    // Sensebod Offline: set to false to leave the background music out
    // (the music file is 1.4 MB and takes much memory once decoded).
    music: true,

    // Sensebod Offline: names of the sounds that finished loading.
    soundReady: {},
    themeAsked: false,

    resources: [
            // images
        {name: "bg", type:"image", src: "data/img/bg.png"},
        {name: "clumsy", type:"image", src: "data/img/clumsy.png"},
        {name: "pipe", type:"image", src: "data/img/pipe.png"},
        {name: "logo", type:"image", src: "data/img/logo.png"},
        {name: "ground", type:"image", src: "data/img/ground.png"},
        {name: "gameover", type:"image", src: "data/img/gameover.png"},
        {name: "gameoverbg", type:"image", src: "data/img/gameoverbg.png"},
        {name: "hit", type:"image", src: "data/img/hit.png"},
        {name: "getready", type:"image", src: "data/img/getready.png"},
        {name: "new", type:"image", src: "data/img/new.png"}
    ],

    // Sensebod Offline: sounds are no longer in the list above. They load in
    // the background, so a sound that cannot load never stops the game.
    sounds: [
        {name: "hit", type: "audio", src: "data/sfx/"},
        {name: "lose", type: "audio", src: "data/sfx/"},
        {name: "wing", type: "audio", src: "data/sfx/"}
    ],
    theme: {name: "theme", type: "audio", src: "data/bgm/"},

    "onload": function() {
        if (!me.video.init(900, 600, {
            wrapper: "screen",
            scale : "auto",
            scaleMethod: "fit"
        })) {
            alert("Your browser does not support HTML5 canvas.");
            return;
        }
        game.setupSound();
        me.loader.preload(game.resources, this.loaded.bind(this));
    },

    // Sensebod Offline: everything about sound is guarded, the game must
    // start and play with no sound at all.
    "setupSound": function() {
        var i;
        var rawPlay = me.audio.play;

        // a sound that fails to load is skipped instead of stopping the game
        me.sys.stopOnAudioError = false;

        // play only what is loaded: the engine would otherwise keep every
        // request and play them all together when the file arrives
        me.audio.play = function (name) {
            if (game.soundReady[name] !== true) {
                return undefined;
            }
            try {
                return rawPlay.apply(me.audio, arguments);
            } catch (e) {
                return undefined;
            }
        };

        try {
            me.audio.init("mp3");
        } catch (e) {}

        for (i = 0; i < game.sounds.length; i++) {
            game.loadSound(game.sounds[i]);
        }

        var button = document.getElementById("sound-toggle");
        if (button) {
            button.addEventListener("click", function (event) {
                event.preventDefault();
                game.toggleMute();
                button.blur();
            }, false);
        }
        game.showMuted();
    },

    "loadSound": function(res) {
        try {
            // The music is streamed through an <audio> element (second argument true): decoded whole by
            // Web Audio it took about 43 MB of memory, too much for a 1 GB phone. Short sounds are decoded.
            me.audio.load(res, res.name === "theme", function () {
                game.soundReady[res.name] = true;
                if (res.name === "theme") {
                    game.startTheme(false);
                }
            }, function () {
                // the engine switched all sound off after repeated failures
                game.data.muted = true;
                game.showMuted();
            });
        } catch (e) {}
    },

    // Called when a round starts (always after a tap or a key press).
    "wantTheme": function() {
        if (!game.music) {
            return;
        }
        if (!game.themeAsked) {
            game.themeAsked = true;
            game.loadSound(game.theme);
            return;
        }
        game.startTheme(true);
    },

    "startTheme": function(roundStarting) {
        if (!game.music || game.soundReady.theme !== true || game.data.muted) {
            return;
        }
        if (!roundStarting && !me.state.isCurrent(me.state.PLAY)) {
            return;
        }
        try {
            me.audio.stop("theme");
            me.audio.play("theme", true);
        } catch (e) {}
    },

    "toggleMute": function() {
        game.data.muted = !game.data.muted;
        try {
            if (game.data.muted) {
                me.audio.disable();
            } else {
                me.audio.enable();
            }
        } catch (e) {}
        game.showMuted();
    },

    "showMuted": function() {
        var button = document.getElementById("sound-toggle");
        if (button) {
            button.textContent = game.data.muted ? "Sound: off" : "Sound: on";
        }
    },

    "loaded": function() {
        me.state.set(me.state.MENU, new game.TitleScreen());
        me.state.set(me.state.PLAY, new game.PlayScreen());
        me.state.set(me.state.GAME_OVER, new game.GameOverScreen());

        me.input.bindKey(me.input.KEY.SPACE, "fly", true);
        me.input.bindKey(me.input.KEY.M, "mute", true);
        me.input.bindPointer(me.input.KEY.SPACE);

        me.pool.register("clumsy", game.BirdEntity);
        me.pool.register("pipe", game.PipeEntity, true);
        me.pool.register("hit", game.HitEntity, true);
        me.pool.register("ground", game.Ground, true);

        me.state.change(me.state.MENU);
    }
};
