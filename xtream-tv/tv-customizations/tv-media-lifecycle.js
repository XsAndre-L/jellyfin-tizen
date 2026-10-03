/* Bonfire covers the app with an opaque gate. Keep the home DOM intact,
   pause its playback/timers, and restore their previous state on return. */
(function () {
    'use strict';
    var adapter = window.XtreamTV, root = document.documentElement;
    var waiting = [], covered = false, snapshot = null;
    function isCovered() {
        return root.classList.contains('profiles-no-scroll') &&
            !!document.getElementById('profiles-gate-overlay');
    }
    adapter.isProfileCovered = isCovered;
    adapter.waitForProfileGate = function () {
        if (!isCovered()) return Promise.resolve();
        return new Promise(function (resolve) { waiting.push(resolve); });
    };
    adapter.mediaImageUrl = function (value, type) {
        if (type !== 'Backdrop' && type !== 'Logo') return value;
        var url = new URL(value, document.baseURI);
        var dpr = window.devicePixelRatio || 1;
        var width = type === 'Backdrop' ? innerWidth : Math.min(innerWidth * 0.4, 768);
        var height = type === 'Backdrop' ? innerHeight : Math.min(innerHeight * 0.23, 240);
        url.searchParams.set('maxWidth', String(Math.ceil(width * dpr)));
        url.searchParams.set('maxHeight', String(Math.ceil(height * dpr)));
        return url.href;
    };
    function pause(m) {
        if (!m || !m.STATE || !m.STATE.slideshow) return;
        var state = m.STATE.slideshow, timer = state.slideInterval;
        if (!snapshot || snapshot.media !== m) {
            snapshot = {media:m, timer:timer, timerRunning:!!(timer && timer.timerId),
                playing:state.isVideoPlaying, index:state.currentSlideIndex};
        }
        if (timer && timer.timerId) timer.stop();
        if (m.SlideshowManager.youtubeProgressInterval) m.SlideshowManager.stopYouTubeProgressLoop();
        Object.keys(state.videoPlayers || {}).forEach(function (key) {
            var player = state.videoPlayers[key];
            try {
                if (player && typeof player.getPlayerState === 'function' &&
                    player.getPlayerState() === 1) player.pauseVideo();
            } catch (e) { /* An iframe may still be initializing. */ }
        });
        var hero = document.getElementById('slides-container');
        if (hero) Array.from(hero.querySelectorAll('video')).forEach(function (video) {
            if (!video.paused) video.pause();
        });
    }
    adapter.pauseCoveredMedia = function () { if (isCovered()) pause(window.mediaBarEnhanced); };
    function sync() {
        var next = isCovered();
        if (root.classList.contains('xtream-tv-profile-cover') !== next)
            root.classList.toggle('xtream-tv-profile-cover', next);
        if (next) {
            if (!covered || !snapshot) pause(window.mediaBarEnhanced);
        } else if (covered) {
            var previous = snapshot;
            snapshot = null;
            // Releasing the gate does not change the user's Pause setting.
            if (previous) {
                var m = previous.media, state = m.STATE.slideshow;
                if (state.slideInterval === previous.timer &&
                    state.currentSlideIndex === previous.index && !state.isPaused &&
                    /^#\/home(?:\.html)?$/.test(location.hash) && !document.hidden) {
                    if (previous.playing) m.SlideshowManager.resumeActivePlayback();
                    if (previous.timerRunning && previous.timer) previous.timer.start();
                }
                m.VisibilityObserver.updateVisibility();
            }
            waiting.splice(0).forEach(function (resolve) { resolve(); });
        }
        covered = next;
    }
    adapter.refreshBackground = sync;
    // Only opening/closing the gate matters here. Focus classes on tiles
    // must not force layout reads or pause/resume the slideshow repeatedly.
    new MutationObserver(function (changes) {
        if (changes.some(function (change) {
            return change.type === 'childList' || change.target === root || change.target === document.body;
        })) sync();
    }).observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
    document.addEventListener('play', function (event) {
        if (isCovered() && event.target.closest('#slides-container')) event.target.pause();
    }, true);
    sync();
}());
