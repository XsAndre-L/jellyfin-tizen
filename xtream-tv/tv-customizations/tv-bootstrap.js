/* Adapter for the server's browser extensions inside the packaged Tizen client. */
(function () {
    'use strict';
    var adapter = window.XtreamTV = {
        version: '0.1.5',
        loaded: [],
        errors: [],
        serverUrl: function (value) {
            var relative = String(value).replace(/^(?:\.\.\/)+/, '/');
            var api = window.ApiClient;
            if (api && typeof api.getUrl === 'function') {
                return api.getUrl(relative.replace(/^\//, ''));
            }
            return 'https://jellyfin.xtremestudios.net/' + relative.replace(/^\//, '');
        },
        assetUrl: function (value) {
            var url;
            try { url = new URL(value, document.baseURI); } catch (e) { return value; }
            var module = window.__xtreamTVModules[url.pathname];
            return module ? new URL('addons/enhanced/' + module, document.baseURI).href : value;
        }
    };

    function addCss(name, id) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = id;
        link.href = 'addons/' + name;
        link.onerror = function () { adapter.errors.push('stylesheet:' + name); };
        document.head.appendChild(link);
        return link;
    }

    addCss('fonts.css', 'xtream-tv-fonts');
    var theme = addCss('theme.compat.css', 'xtream-tv-theme');
    var mediaCss = addCss('media-bar.compat.css', 'xtream-tv-media-bar');
    addCss('tv-focus.css', 'xtream-tv-focus');
    var layoutCss = addCss('tv-layout.css', 'xtream-tv-layout');
    var updateTheme = function () {
        var dashboard = /^#\/?(?:dashboard|configurationpage|useredit|metadata)(?:[/?]|$)/i.test(location.hash);
        var nextMedia = dashboard ? 'not all' : 'all';
        if (theme.media !== nextMedia) theme.media = nextMedia;
        var input = document.querySelector('#loginPage #txtManualName');
        var label = document.querySelector('#loginPage label[for="txtManualName"]');
        if (input && input.getAttribute('label') !== 'User / Email') input.setAttribute('label', 'User / Email');
        if (label && label.textContent !== 'User / Email') label.textContent = 'User / Email';
    };
    window.addEventListener('hashchange', updateTheme);
    new MutationObserver(updateTheme).observe(document.documentElement, { childList: true, subtree: true });
    updateTheme();
    var cssCompatibilityStarted = false;
    var startCssCompatibility = function () {
        if (cssCompatibilityStarted || !theme.sheet || !mediaCss.sheet || typeof window.cssHasPseudo !== 'function') return;
        cssCompatibilityStarted = true;
        document.documentElement.classList.add('js-has-pseudo');
        window.cssHasPseudo(document, { forcePolyfill: true });
    };
    theme.onload = startCssCompatibility;
    mediaCss.onload = startCssCompatibility;
    startCssCompatibility();
    var layoutStarted = false;
    var startLayout = function () {
        if (layoutStarted || !layoutCss.sheet || !document.body) return;
        layoutStarted = true;
        load('tv-layout.js');
    };
    layoutCss.onload = startLayout;
    startLayout();

    function load(name, extra) {
        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = 'addons/' + name;
            script.async = false;
            if (extra) Object.keys(extra).forEach(function (key) { script.setAttribute(key, extra[key]); });
            script.onload = function () { adapter.loaded.push(name); resolve(); };
            script.onerror = function () { adapter.errors.push('script:' + name); resolve(); };
            document.head.appendChild(script);
        });
    }

    var timer = setInterval(function () {
        if (!window.ApiClient || typeof window.ApiClient.getUrl !== 'function') return;
        clearInterval(timer);
        load('profiles.compat.js')
            .then(function () { return load('enhanced.compat.js', {
                plugin: 'Jellyfin Enhanced', version: '12.8.0.0-639254153080000000', dev: 'false'
            }); })
            .then(function () { return load('media-bar.compat.js'); })
            .then(function () { if (adapter.refreshBackground) adapter.refreshBackground(); });
    }, 200);
}());
