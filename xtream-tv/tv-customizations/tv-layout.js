(function () {
    'use strict';
    var root = document.documentElement;
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-10000px;display:flex;flex-direction:column;row-gap:1px;';
    probe.appendChild(document.createElement('div'));
    probe.appendChild(document.createElement('div'));
    document.body.appendChild(probe);
    var missingFlexGap = probe.scrollHeight !== 1;
    probe.remove();
    root.classList.toggle('xtream-tv-no-flex-gap', missingFlexGap);
    var navigationTimer;
    window.addEventListener('keydown', function (e) {
        if (!/^Arrow(?:Left|Right|Up|Down)$/.test(e.key || '') && [37,38,39,40].indexOf(e.keyCode) < 0) return;
        if (window.XtreamTV.isProfileCovered()) return;
        var hero = document.getElementById('slides-container');
        if (!hero) return;
        hero.classList.add('xtream-tv-navigating');
        clearTimeout(navigationTimer);
        navigationTimer = setTimeout(function () {hero.classList.remove('xtream-tv-navigating');}, 250);
    }, true);
    var scheduled = false;
    var selector = (window.__xtreamTVGapSelectors || []).join(',');
    function setVariable(el, key, value) {
        if (el.style.getPropertyValue(key) !== value) el.style.setProperty(key, value);
    }
    function refresh() {
        scheduled = false;
        var w = innerWidth, h = innerHeight;
        var preview = Math.min(w * (w <= 900 ? 0.5 : w <= 1200 ? 0.48 : 0.44), w <= 900 ? 420 : w <= 1200 ? 520 : 680, h * 0.44 * 16 / 9);
        var modal = Math.min(w * 0.8, h * 0.8 * 16 / 9, 1280);
        setVariable(root, '--xtream-preview-width', preview + 'px');
        setVariable(root, '--xtream-preview-height', preview * 9 / 16 + 'px');
        setVariable(root, '--xtream-modal-width', modal + 'px');
        setVariable(root, '--xtream-modal-height', modal * 9 / 16 + 'px');
        if (!missingFlexGap || !selector) return;
        Array.from(document.querySelectorAll(selector)).forEach(function (el) {
            var s = getComputedStyle(el);
            var flex = s.display === 'flex' || s.display === 'inline-flex';
            var x = parseFloat(s.columnGap) || 0, y = parseFloat(s.rowGap) || 0;
            var column = s.flexDirection.indexOf('column') === 0;
            var wrap = s.flexWrap === 'wrap' && !column;
            el.classList.toggle('xtream-tv-gap-row', flex && !column && !wrap && x > 0);
            el.classList.toggle('xtream-tv-gap-column', flex && column && y > 0);
            el.classList.toggle('xtream-tv-gap-wrap', flex && wrap && (x > 0 || y > 0));
            if (flex) {
                setVariable(el, '--xtream-gap-x', x + 'px');
                setVariable(el, '--xtream-gap-y', y + 'px');
            }
        });
    }
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(refresh, 100);
    }
    window.addEventListener('resize', schedule);
    var transient = /^(?:is-focused|is-tv-focused|is-container-focused|focused|xtream-tv-navigating|xtream-tv-gap-(?:row|column|wrap))$/;
    function layoutClasses(value) {return String(value || '').split(/\s+/).filter(function (c) {return c && !transient.test(c);}).sort().join(' ');}
    new MutationObserver(function (changes) {
        if (changes.some(function (change) {
            return change.type === 'childList' ||
                layoutClasses(change.oldValue) !== layoutClasses(change.target.getAttribute('class'));
        })) schedule();
    }).observe(document.body, {childList:true, subtree:true, attributes:true, attributeOldValue:true, attributeFilter:['class']});
    window.XtreamTV.refreshLayout = refresh;
    refresh();
}());
