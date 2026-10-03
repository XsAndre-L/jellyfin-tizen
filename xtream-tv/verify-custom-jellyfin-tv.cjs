const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, 'jellyfin-tv-custom-build');
const addons = path.join(root, 'www', 'addons');
const html = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const expected = ['tv-layout.js', 'profiles.compat.js', 'enhanced.compat.js', 'media-bar.compat.js'];
let interval;
let cleared = false;
let cssStarted = 0;
let cssClassAdded = false;
const injected = [];
const styles = [];
const observers=[];
const fakeWindow = {ApiClient: {getUrl: value => 'https://jellyfin.xtremestudios.net/' + value},
  addEventListener() {}, cssHasPseudo() {cssStarted++;}};
const fakeDocument = {
  body: {},
  baseURI: 'file:///opt/jellyfin/www/index.html', documentElement: {classList: {add(name) {cssClassAdded = name === 'js-has-pseudo';}}},
  querySelector: () => null,
  createElement(tag) { let media='',writes=0;return {tag, get media(){return media},set media(value){media=value;writes++;},get mediaWrites(){return writes},setAttribute(key, value) {this[key] = value;}}; },
  head: {appendChild(el) {
    if (el.tag === 'script') {injected.push(el); Promise.resolve().then(() => el.onload());}
    else {el.sheet = {}; styles.push(el);}
  }}
};
const context = vm.createContext({window: fakeWindow, document: fakeDocument, location: {hash: '#/home'},
  URL, Promise, Object, String,
  MutationObserver: class {constructor(callback){observers.push(callback)}observe() {}},
  setInterval(callback) {interval = callback; return 42;}, clearInterval(id) {assert.equal(id, 42); cleared = true;}
});
(async () => {
  vm.runInContext(fs.readFileSync(path.join(addons, 'bootstrap.js'), 'utf8'), context);
  interval();
  for (let i=0; i<10; i++) await Promise.resolve();
  assert.equal(cleared, true);
  assert.deepEqual(injected.map(s => s.src), expected.map(n => 'addons/' + n));
  assert.equal(injected[2].plugin, 'Jellyfin Enhanced');
  assert.equal(fakeWindow.XtreamTV.serverUrl('../MediaBarEnhanced/Config'),
    'https://jellyfin.xtremestudios.net/MediaBarEnhanced/Config');
  const modules = JSON.parse(fs.readFileSync(path.join(__dirname, 'tv-customizations', 'enhanced-modules-manifest.json')));
  for (const module of modules) {
    assert.equal(fakeWindow.XtreamTV.assetUrl('https://jellyfin.xtremestudios.net/JellyfinEnhanced/js/' + module.name + '?v=123'),
      'file:///opt/jellyfin/www/addons/enhanced/' + module.name);
  }
  assert.equal(fakeWindow.XtreamTV.assetUrl('https://example.org/unrelated.js'), 'https://example.org/unrelated.js');
  for (const el of styles) assert.ok(fs.existsSync(path.join(root, 'www', el.href)));
  assert.equal(fakeWindow.XtreamTV.loaded.length, 4);
  assert.equal(fakeWindow.XtreamTV.errors.length, 0);
  assert.equal(cssStarted, 1);
  assert.equal(cssClassAdded, true);
  assert.ok(html.indexOf('addons/bonfire-transition.js') < html.indexOf('main.jellyfin.bundle.js'));
  assert.ok(html.includes('addons/polyfills.js'));
  assert.ok(html.includes('addons/bootstrap.js'));
  for (const module of modules) assert.ok(fs.existsSync(path.join(addons, 'enhanced', module.name)));
  for (const name of ['theme.compat.css', 'media-bar.compat.css']) {
    const css = fs.readFileSync(path.join(addons, name), 'utf8');
    assert.ok(!/:has\(/.test(css), name + ' contains unconverted :has selector');
    assert.ok(!/\n\s*&/.test(css), name + ' contains unconverted nesting');
    assert.ok(!/:is\(/.test(css), name + ' contains unconverted :is selector');
    assert.ok(!/url\(["']?\/web\//.test(css), name + ' contains app-origin server URL');
    const postcss=require('./tv-build-deps.cjs').req('postcss');
    const imports=[];postcss.parse(css).walkAtRules('import',r=>imports.push(r.params));
    assert.equal(imports.length,0,name + ' contains a blocking remote import');
    assert.ok(!/:focus-visible\b/.test(css), name + ' contains unsupported focus selectors');
    assert.ok(!/:not\(\[csstools-has-[^\]]+\]:not\(/.test(css), name + ' contains unsupported compound negation');
  }
  const config=fs.readFileSync(path.join(root,'config.xml'),'utf8');
  assert.ok(config.includes('version="0.1.5"'));
  const theme=styles.find(s=>s.id==='xtream-tv-theme');
  const mediaWrites=theme.mediaWrites;
  observers[0]();observers[0]();
  assert.equal(theme.mediaWrites,mediaWrites,'Page mutations must not reset unchanged theme media');
  assert.ok(fs.readFileSync(path.join(addons,'profiles.compat.js'),'utf8').includes('preventScroll: true'));
  assert.ok(config.includes('id="AprZAARz4r.Jellyfin"'));
  const {req}=require('./tv-build-deps.cjs');
  const {JSDOM}=req('jsdom');
  const dom=new JSDOM('<!doctype html><html><body></body></html>', {runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.Intl.DisplayNames=undefined;
  const originalQuery=dom.window.Document.prototype.querySelectorAll;
  dom.window.eval(fs.readFileSync(path.join(addons,'polyfills.js'),'utf8'));
  assert.equal(typeof dom.window.cssHasPseudo,'function');
  assert.equal(new dom.window.Intl.DisplayNames(['en'], {type:'language'}).of('en'), 'English');
  assert.equal(dom.window.Document.prototype.querySelectorAll,originalQuery,'Compatibility must not replace document queries');
  dom.window.__xtreamTVHasRules=JSON.parse(JSON.stringify(fakeWindow.__xtreamTVHasRules));
  dom.window.XtreamTV={};
  dom.window.document.documentElement.className='layout-tv';
  dom.window.document.body.innerHTML='<div id="indexPage" class="homePage"><div class="featurediframe"></div></div><div class="headerTabs sectionTabs"></div><div id="favoritesTab"></div><div id="slides-container" tabindex="0"><button>Play</button><div class="arrow"></div></div><div class="backdrop-container"><div class="video-backdrop-full"></div></div><header class="MuiAppBar-root"><div class="MuiToolbar-root"><div class="MuiStack-root"></div><div class="MuiBox-root"></div></div></header>';
  dom.window.cssHasPseudo(dom.window.document);
  const relation=r=>fakeWindow.__xtreamTVHasRules.find(x=>x.predicates.some(p=>p.relative.includes(r)));
  const routeRule=relation('#indexPage.homePage:not(.hide)');
  assert.ok(dom.window.document.querySelector('.headerTabs').hasAttribute(routeRule.attribute));
  dom.window.document.getElementById('indexPage').classList.add('hide');
  dom.window.XtreamTV.refreshCss();
  assert.ok(!dom.window.document.querySelector('.headerTabs').hasAttribute(routeRule.attribute));
  const childRule=relation('> .MuiStack-root:first-of-type');
  assert.ok(dom.window.document.querySelector('.MuiBox-root').hasAttribute(childRule.attribute));
  const focusRule=relation('button:focus');
  dom.window.document.querySelector('#slides-container button').focus();
  dom.window.XtreamTV.refreshCss();
  // The parent is no longer itself focused; its negated rule needs no marker.
  assert.ok(!dom.window.document.getElementById('slides-container').hasAttribute(focusRule.attribute));
  const writes=dom.window.XtreamTV.cssStats.writes;
  dom.window.XtreamTV.refreshCss();
  assert.equal(dom.window.XtreamTV.cssStats.writes,writes,'Unchanged state must not trigger attribute writes');
  assert.equal(dom.window.document.documentElement.style.zoom,'','Compatibility must never force page zoom');
  // Flush structural changes, then focus alone should inspect only the two
  // focus-dependent relations instead of every home/layout relation.
  await new Promise(r=>setTimeout(r,60));
  const beforeFocus=dom.window.XtreamTV.cssStats.runs;
  dom.window.document.getElementById('slides-container').focus();
  await new Promise(r=>setTimeout(r,60));
  assert.ok(dom.window.XtreamTV.cssStats.runs>beforeFocus);
  assert.ok(dom.window.XtreamTV.cssStats.lastRuleCount<=2,'Focus alone must not scan all relational rules');
  const beforeTransient=dom.window.XtreamTV.cssStats.runs;
  dom.window.document.getElementById('slides-container').classList.add('xtream-tv-navigating');
  await new Promise(r=>setTimeout(r,60));
  assert.equal(dom.window.XtreamTV.cssStats.runs,beforeTransient,'Animation pause class must not trigger relational scans');
  const focusCss=fs.readFileSync(path.join(addons,'tv-focus.css'),'utf8');
  assert.ok(focusCss.includes('box-shadow: 0 0 0 3px rgba(var(--abyss-accent)'));
  assert.ok(!focusCss.includes('.layout-tv [tabindex]:focus'));
  dom.window.close();
  const fontCSS = fs.readFileSync(path.join(addons,'fonts.css'),'utf8');
  assert.ok(!/https?:|@import/.test(fontCSS), 'Font stylesheet must be entirely local');
  for(const match of fontCSS.matchAll(/url\(["']?([^)'"\s]+)/g)) {
    const file=path.join(addons,match[1]);
    assert.ok(fs.existsSync(file), 'Missing bundled font: '+match[1]);
    assert.equal(fs.readFileSync(file).subarray(0,4).toString(),'wOF2');
  }
  console.log(JSON.stringify({passed:true, pluginLoadOrder: expected, enhancedModules: modules.length,
    endpointRouting:true, themeConversion:true, applicationIdentityPreserved:true}));
})().catch(error => {console.error(error.message); process.exitCode=1;});
