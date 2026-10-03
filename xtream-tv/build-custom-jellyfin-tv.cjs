const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const {req,project} = require('./tv-build-deps.cjs');
const babel = req('@babel/core');
const parser = req('@babel/parser');
const traverse = req('@babel/traverse').default;
const t = req('@babel/types');
const postcss = req('postcss');
const selectorParser = req('postcss-selector-parser');
const presetEnv = req('postcss-preset-env');
const esbuild = req('esbuild');
const acorn = req('acorn');
const tvCss = require('./tv-css-transform.cjs');
const hasManifest = require('./tv-has-manifest.cjs');
const sourceRoot = path.join(__dirname, 'tv-customizations');
const stage = path.join(__dirname, 'jellyfin-tv-custom-build');
const base = path.join(project,'.buildResult');
const moduleManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'enhanced-modules-manifest.json')));
const report = { version: '0.1.5', target: 'Samsung Tizen 6 / Chromium 76', modules: moduleManifest.length,
  js: [], css: [], warnings: [], urlFixes: [] };

function visitFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? visitFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

async function compileCss(input, name, resourceBase) {
  let css = input.replace(/(\d+(?:\.\d+)?)(?:d|s|l)(v[wh])/g, '$1$2');
  if (resourceBase) css = css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi, (whole, quote, value) => {
    if (/^(?:data:|https?:|#)/i.test(value)) return whole;
    return `url("${new URL(value, resourceBase).href}")`;
  });
  // The complex :is groups here describe controls inside the Media Bar and
  // root TV layout. Expand within those known containers; the generic preset
  // otherwise leaves these selectors unsupported on Chromium 76.
  const parsed = postcss.parse(css);
  parsed.walkAtRules('import', r => r.remove());
  tvCss.before(parsed);
  parsed.walkRules(rule => {
    if (!rule.selector.includes(':is(')) return;
    rule.selector = selectorParser(root => {
      for (let rounds = 0; rounds < 100; rounds++) {
        let found;
        root.walkPseudos(p => {
          if (!found && p.value === ':is' && p.nodes && p.nodes.some(s => s.nodes.some(n => n.type === 'combinator')))
            found = p;
        });
        if (!found) break;
        const selector = found.parent;
        const container = selector.parent;
        const index = selector.nodes.indexOf(found);
        const before = selector.nodes.slice(0, index);
        const after = selector.nodes.slice(index + 1);
        let split = -1;
        for (let i=0; i<before.length; i++) if (before[i].type === 'combinator') split = i;
        for (const alternative of found.nodes) {
          const replacement = selector.clone();
          replacement.removeAll();
          [...before.slice(0, split + 1), ...alternative.nodes, ...before.slice(split + 1), ...after]
            .forEach(node => replacement.append(node.clone()));
          container.insertBefore(selector, replacement);
        }
        selector.remove();
      }
    }).processSync(rule.selector);
  });
  css = parsed.toString();
  const result = await postcss([presetEnv({ browsers: ['chrome 76'], stage: 1, preserve: false,
    features: {'nesting-rules': true, 'has-pseudo-class': true, 'is-pseudo-class': true} })])
    .process(css, {from: undefined});
  tvCss.after(result.root);
  hasManifest.collect(result.root);
  report.css.push({ name, inputBytes: input.length, outputBytes: result.root.toString().length });
  report.warnings.push(...result.warnings().map(w => `${name}: ${w.text}`));
  return result.root.toString();
}

async function compileJs(input, name) {
  const ast = parser.parse(input, {sourceType: 'unambiguous'});
  const cssNodes = [];
  traverse(ast, {
    ObjectMethod(p) {
      if(name!=='media-bar.js')return;
      const covered=t.logicalExpression('&&',t.memberExpression(t.memberExpression(t.identifier('window'),t.identifier('XtreamTV')),t.identifier('isProfileCovered')),
        t.callExpression(t.memberExpression(t.memberExpression(t.identifier('window'),t.identifier('XtreamTV')),t.identifier('isProfileCovered')),[]));
      if(p.node.key.name==='updateVisibility') {
        p.node.body.body.unshift(t.ifStatement(covered,t.blockStatement([
          t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.identifier('window'),t.identifier('XtreamTV')),t.identifier('pauseCoveredMedia')),[])),t.returnStatement()])));
      } else if(['updateCurrentSlide','upgradeSlideImageQuality','preloadAdjacentSlides','resumeActivePlayback'].includes(p.node.key.name)) {
        p.node.body.body.unshift(t.ifStatement(covered,t.returnStatement()));
      }
    },
    ClassMethod(p) {
      if(name==='media-bar.js' && p.node.key.name==='start' && p.findParent(x=>x.isClassDeclaration()&&x.node.id.name==='SlideTimer'))
        p.node.body.body.unshift(parser.parse('if (window.XtreamTV.isProfileCovered && window.XtreamTV.isProfileCovered()) return this;',{allowReturnOutsideFunction:true}).program.body[0]);
    },
    ReturnStatement(p) {
      if(name!=='media-bar.js'||!p.node.argument)return;
      const fn=p.getFunctionParent();
      if(fn?.isObjectMethod()&&fn.node.key.name==='buildImageUrl') {
        p.node.argument=t.callExpression(t.memberExpression(t.memberExpression(t.identifier('window'),t.identifier('XtreamTV')),t.identifier('mediaImageUrl')),[p.node.argument,t.identifier('imageType')]);
        p.skip();
      }
    },
    VariableDeclarator(p) {
      if (p.node.id.name === 'BONFIRE_STYLES' && t.isStringLiteral(p.node.init)) cssNodes.push(p.node.init);
      if(name==='media-bar.js' && p.node.id.name==='slidesInit') {
        p.node.init.body.body.unshift(parser.parse('if (window.XtreamTV.waitForProfileGate) await window.XtreamTV.waitForProfileGate();',{allowAwaitOutsideFunction:true}).program.body[0]);
      }
    },
    AssignmentExpression(p) {
      if (t.isMemberExpression(p.node.left) && p.node.left.property.name === 'src'
          && t.isCallExpression(p.node.right) && t.isMemberExpression(p.node.right.callee)
          && t.isIdentifier(p.node.right.callee.object, {name: 'ApiClient'})
          && p.node.right.callee.property.name === 'getUrl') {
        p.node.right = t.callExpression(t.memberExpression(t.memberExpression(t.identifier('window'),
          t.identifier('XtreamTV')), t.identifier('assetUrl')), [p.node.right]);
        report.urlFixes.push(`${name}: script asset routing`);
      }
    },
    CallExpression(p) {
      const fn=p.getFunctionParent();
      if(name==='media-bar.js'&&t.isMemberExpression(p.node.callee)&&['play','playVideo'].includes(p.node.callee.property.name)) {
        const original=t.cloneNode(p.node,true), isVideo=p.node.callee.property.name==='play';
        const condition=parser.parseExpression('window.XtreamTV.isProfileCovered && window.XtreamTV.isProfileCovered()');
        p.replaceWith(t.conditionalExpression(condition,isVideo?t.callExpression(t.memberExpression(t.identifier('Promise'),t.identifier('resolve')),[]):t.unaryExpression('void',t.numericLiteral(0)),original));
        p.skip();return;
      }
      if(name==='profiles.js' && t.isMemberExpression(p.node.callee) && p.node.callee.property.name==='focus'
        && fn?.parentPath.isObjectProperty() && fn.parentPath.node.key.name==='_focusVisibly') {
        p.node.arguments=[t.objectExpression([t.objectProperty(t.identifier('preventScroll'),t.booleanLiteral(true))])];
      }
      if(name==='media-bar.js' && t.isMemberExpression(p.node.callee) && p.node.callee.property.name==='scrollIntoView'
        && t.isObjectExpression(p.node.arguments[0])) {
        for(const property of p.node.arguments[0].properties) if(property.key.name==='behavior'&&t.isStringLiteral(property.value,{value:'smooth'}))
          property.value.value='auto';
      }
      if (t.isIdentifier(p.node.callee, {name: 'fetch'}) && t.isStringLiteral(p.node.arguments[0])
          && /^(?:\.\.\/|\/)(?:MediaBarEnhanced|JellyfinEnhanced|plugins\/profiles)\//.test(p.node.arguments[0].value)) {
        p.node.arguments[0] = t.callExpression(t.memberExpression(t.memberExpression(t.identifier('window'),
          t.identifier('XtreamTV')), t.identifier('serverUrl')), [p.node.arguments[0]]);
        report.urlFixes.push(`${name}: relative API request`);
      }
    }
  });
  for (const node of cssNodes) node.value = await compileCss(node.value, `${name}: Bonfire styles`);
  const result = babel.transformFromAstSync(ast, input, {
    configFile: false, babelrc: false, comments: false, compact: false,
    presets: [[req.resolve('@babel/preset-env'), {targets: {chrome: '76'}, bugfixes: true, modules: false}]]
  });
  const code = esbuild.transformSync(result.code, {target: 'es2019', loader: 'js', legalComments: 'none'}).code;
  acorn.parse(code, {ecmaVersion: 2019, sourceType: 'script'});
  report.js.push({name, inputBytes: input.length, outputBytes: code.length, es2019Syntax: true});
  return code;
}

(async () => {
  if (fs.existsSync(stage)) {
    const resolved = path.resolve(stage);
    if (!resolved.startsWith(path.resolve(__dirname) + path.sep) || path.basename(resolved) !== 'jellyfin-tv-custom-build')
      throw new Error('Unsafe staging path');
    fs.rmSync(resolved, {recursive: true});
  }
  fs.cpSync(base, stage, {recursive: true});
  for (const oldSigningFile of ['author-signature.xml', 'signature1.xml', 'Jellyfin.wgt', '.manifest.tmp']) {
    const file = path.join(stage, oldSigningFile);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  for (const bad of ['.git', '.github', '.fallow', 'node_modules']) {
    if (fs.existsSync(path.join(stage, bad))) throw new Error('Unexpected base build entry: ' + bad);
  }
  const addons = path.join(stage, 'www', 'addons');
  fs.mkdirSync(addons, {recursive: true});
  const fontRoot = path.join(sourceRoot, 'fonts');
  const fonts = JSON.parse(fs.readFileSync(path.join(fontRoot, 'manifest.json')));
  fs.mkdirSync(path.join(addons, 'fonts'), {recursive:true});
  for (const font of fonts) fs.copyFileSync(path.join(fontRoot,font.name),path.join(addons,'fonts',font.name));
  fs.copyFileSync(path.join(fontRoot,'fonts.css'),path.join(addons,'fonts.css'));

  const abyss = fs.readFileSync(path.join(sourceRoot, 'abyss.css'), 'utf8');
  const guard = fs.readFileSync(path.join(sourceRoot, 'media-bar-guard.css'), 'utf8');
  const overrides = fs.readFileSync(path.join(sourceRoot, 'jellyfin.theme.css'), 'utf8')
    .replace(/@import\s+url\("\.\/(?:abyss|media-bar-guard)\.css[^\"]*"\);/g, '');
  fs.writeFileSync(path.join(addons, 'theme.compat.css'), await compileCss((abyss + '\n' + guard + '\n' + overrides).replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/material-icons@1\.13\.12\/iconfont\/material-icons-round\.woff2/g, 'fonts/material-icons-round.woff2'), 'theme.compat.css'));
  fs.writeFileSync(path.join(addons, 'media-bar.compat.css'), await compileCss(
    fs.readFileSync(path.join(sourceRoot, 'media-bar.css'), 'utf8'), 'media-bar.compat.css',
    'https://jellyfin.xtremestudios.net/MediaBarEnhanced/Resources/mediaBarEnhanced.css'));
  fs.copyFileSync(path.join(sourceRoot, 'tv-focus.css'),path.join(addons,'tv-focus.css'));
  fs.copyFileSync(path.join(sourceRoot,'tv-layout.css'),path.join(addons,'tv-layout.css'));
  fs.writeFileSync(path.join(addons,'tv-layout.js'),await compileJs(fs.readFileSync(path.join(sourceRoot,'tv-media-lifecycle.js'),'utf8')+'\n'+fs.readFileSync(path.join(sourceRoot,'tv-layout.js'),'utf8'),'tv-layout.js'));
  const gapSelectors = new Set();
  for(const name of ['theme.compat.css','media-bar.compat.css'])postcss.parse(fs.readFileSync(path.join(addons,name),'utf8'))
    .walkDecls(/^(?:gap|row-gap|column-gap)$/, d => {if(d.parent.selector)gapSelectors.add(d.parent.selector)});

  for (const name of ['profiles', 'enhanced', 'media-bar']) {
    fs.writeFileSync(path.join(addons, `${name}.compat.js`), await compileJs(
      fs.readFileSync(path.join(sourceRoot, name + '.js'), 'utf8'), name + '.js'));
  }
  for (let i = 0; i < moduleManifest.length; i++) {
    const entry = moduleManifest[i];
    const dest = path.join(addons, 'enhanced', entry.name);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, await compileJs(fs.readFileSync(path.join(sourceRoot, 'enhanced-modules', entry.name), 'utf8'), entry.name));
    if (i % 40 === 0) console.log(`Compiled plugin modules: ${i + 1}/${moduleManifest.length}`);
  }

  const moduleMap = Object.fromEntries(moduleManifest.map(e => ['/JellyfinEnhanced/js/' + e.name, e.name]));
  const entry = path.join(sourceRoot, 'polyfills-entry.cjs');
  const polyfillReq = createRequire(path.join(__dirname, 'tv-polyfill-deps', 'package.json'));
  fs.writeFileSync(entry, `require(${JSON.stringify(req.resolve('core-js/stable'))});\n`
    + `require(${JSON.stringify(polyfillReq.resolve('@formatjs/intl-displaynames/polyfill.js'))});\n`
    + `require(${JSON.stringify(polyfillReq.resolve('@formatjs/intl-displaynames/locale-data/en.js'))});\n`
    + fs.readFileSync(path.join(sourceRoot,'tv-has-runtime.js'),'utf8'));
  await esbuild.build({entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', target: 'es2019',
    outfile: path.join(addons, 'polyfills.js'), legalComments: 'none', minify: true});
  fs.writeFileSync(path.join(addons, 'bootstrap.js'), 'window.__xtreamTVHasRules=' + JSON.stringify(hasManifest.values()) + ';\nwindow.__xtreamTVGapSelectors=' + JSON.stringify([...gapSelectors]) + ';\nwindow.__xtreamTVModules=' + JSON.stringify(moduleMap) + ';\n'
    + await compileJs(fs.readFileSync(path.join(sourceRoot, 'tv-bootstrap.js'), 'utf8'), 'tv-bootstrap.js'));
  fs.copyFileSync(path.join(sourceRoot, 'inline-browser-1.js'), path.join(addons, 'bonfire-transition.js'));
  const htmlPath = path.join(stage, 'www', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace('<head>', '<head><script src="addons/bonfire-transition.js"></script>');
  html = html.replace('</head>', '<script src="addons/polyfills.js" defer></script><script src="addons/bootstrap.js" defer></script></head>');
  fs.writeFileSync(htmlPath, html);
  const configPath = path.join(stage, 'config.xml');
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('version="0.1.0"', 'version="0.1.5"'));

  const baseFiles = visitFiles(path.join(base, 'www'));
  for (const file of baseFiles) {
    const relative = path.relative(base, file);
    if (relative === path.join('www', 'index.html')) continue;
    if (!fs.readFileSync(file).equals(fs.readFileSync(path.join(stage, relative)))) throw new Error('Core web file changed: ' + relative);
  }
  for (const file of visitFiles(stage)) {
    if (/(?:\.p12|\.pwd|\.pri)$/i.test(file)) throw new Error('Private signing file in stage');
  }
  report.stage = stage;
  report.coreFilesVerified = baseFiles.length - 1;
  report.files = visitFiles(stage).length;
  report.assets = visitFiles(addons).map(file => ({name: path.relative(addons, file), bytes: fs.statSync(file).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
  fs.writeFileSync(path.join(__dirname, 'jellyfin-tv-custom-build-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({stage, version: report.version, files: report.files, js: report.js.length,
    css: report.css.length, coreFilesVerified: report.coreFilesVerified, warnings: report.warnings.length, urlFixes: report.urlFixes.length}));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
