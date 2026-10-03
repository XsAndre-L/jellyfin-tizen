/* Evaluate the packaged relational rules against their indexed subjects.
   Never walk every element, change zoom, or rewrite unchanged attributes. */
window.cssHasPseudo = function (doc) {
    var rules = window.__xtreamTVHasRules || [];
    var scheduled = false, anchors = 0, pendingAll = false, pendingFocus = false;
    var focusRules = [], classNames = {}, allClassChanges = false;
    rules.forEach(function (rule) {
        var selectors = [rule.query];
        rule.predicates.forEach(function (p) {selectors.push(p.candidate);selectors=selectors.concat(p.relative);});
        var text = selectors.join(' ');
        if (/:focus\b|:focus-within\b/.test(text)) focusRules.push(rule);
        if (/\[class\b|\\/.test(text)) allClassChanges = true;
        var match, re=/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
        while ((match = re.exec(text))) classNames[match[1]] = true;
    });
    var stats = {runs:0, lastMs:0, maxMs:0, writes:0, lastRuleCount:0};
    function toggle(el, attr, yes) {
        if (el.hasAttribute(attr) === yes) return;
        if (yes) el.setAttribute(attr, ''); else el.removeAttribute(attr);
        stats.writes++;
    }
    function relative(el, selector) {
        if (/^[+~]/.test(selector)) {
            if (!el.parentElement) return false;
            var anchor = el.getAttribute('data-xtream-tv-anchor');
            if (!anchor) {anchor=String(++anchors);el.setAttribute('data-xtream-tv-anchor',anchor);}
            return !!el.parentElement.querySelector(':scope > [data-xtream-tv-anchor="'+anchor+'"] '+selector);
        }
        return !!el.querySelector(':scope '+selector);
    }
    function refresh(selectedRules) {
        if (!Array.isArray(selectedRules)) selectedRules=rules;
        var start=performance.now();
        selectedRules.forEach(function (rule) {
            rule.predicates.forEach(function (p) {
                var candidates=Array.from(doc.querySelectorAll(p.candidate));
                (p.nodes || []).forEach(function (el) {if (candidates.indexOf(el)<0) toggle(el,p.attribute,false);});
                candidates.forEach(function (el) {toggle(el,p.attribute,p.relative.some(function (s) {return relative(el,s);}));});
                p.nodes=candidates;
            });
            var matched=Array.from(doc.querySelectorAll(rule.query));
            (rule.nodes || []).forEach(function (el) {if(matched.indexOf(el)<0)toggle(el,rule.attribute,false);});
            matched.forEach(function (el) {toggle(el,rule.attribute,true);});
            rule.nodes=matched;
        });
        stats.runs++;stats.lastRuleCount=selectedRules.length;stats.lastMs=performance.now()-start;stats.maxMs=Math.max(stats.maxMs,stats.lastMs);
    }
    function schedule(focusOnly) {
        if(focusOnly===true)pendingFocus=true;else pendingAll=true;
        if(scheduled)return;scheduled=true;
        requestAnimationFrame(function(){
            scheduled=false;var selected=pendingAll?rules:pendingFocus?focusRules:[];
            pendingAll=false;pendingFocus=false;refresh(selected);
        });
    }
    function relevantClassChange(change) {
        if (allClassChanges) return true;
        var before=String(change.oldValue || '').split(/\s+/),after=String(change.target.getAttribute('class') || '').split(/\s+/);
        return before.concat(after).some(function(c){return classNames[c] && (before.indexOf(c)<0 || after.indexOf(c)<0);});
    }
    new MutationObserver(function(changes){
        if(changes.some(function(change){return change.type!=='attributes' || change.attributeName!=='class' || relevantClassChange(change);}))schedule();
    }).observe(doc,{childList:true,subtree:true,attributes:true,attributeOldValue:true,
        attributeFilter:['class','id','hidden','disabled','checked','selected','data-theme','aria-hidden']});
    ['focus','blur'].forEach(function(name){doc.addEventListener(name,function(){schedule(true);},true);});
    ['input','change'].forEach(function(name){doc.addEventListener(name,function(){schedule();},true);});
    if(window.XtreamTV){window.XtreamTV.cssStats=stats;window.XtreamTV.refreshCss=refresh;}
    refresh();
};
