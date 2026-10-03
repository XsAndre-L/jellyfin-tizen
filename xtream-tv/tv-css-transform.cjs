const {req}=require('./tv-build-deps.cjs');
const selectorParser=req('postcss-selector-parser');
// Applied only to the packaged TV copy; upstream/server CSS stays unchanged.
module.exports={
 before(root){
  root.walkRules(rule=>{if(rule.selector)rule.selector=rule.selector.replace(/:focus-visible\b/g,':focus');});
  root.walkDecls(d=>{
   if(d.prop==='font-size'&&d.value==='revert')d.value='inherit';
   if(d.prop==='overflow'&&d.value==='clip')d.value='hidden';
   if(d.prop==='font-size'&&d.value==='xxx-large')d.value='3em';
   if(d.prop==='max-height'&&d.value==='stretch'){d.value='100%';d.cloneAfter({value:'-webkit-fill-available'});}
  });
 },
 after(root){
  root.walkRules(rule=>{
   if(!rule.selector||!rule.selector.includes('csstools-has-'))return;
   // The bundled adapter always supplies these attributes. A descendant
   // guard would otherwise make selectors beginning with html impossible.
   rule.selector=rule.selector.replace(/\.js-has-pseudo\s+/g,'');
   // :not(:has(...)) acquires a specificity guard inside :not(). Chromium
   // 76 rejects that compound negation, dropping the entire rule. The guard
   // names cannot occur in this app, so remove them only inside negation.
   rule.selector=selectorParser(tree=>tree.walkPseudos(p=>{
    if(p.value!==':not'||!p.nodes)return;
    for(const s of p.nodes){
     if(!s.nodes.some(n=>n.type==='attribute'&&n.attribute.startsWith('csstools-has-')))continue;
     for(const n of [...s.nodes])if(n.type==='pseudo'&&n.value===':not'&&n.toString().includes('does-not-exist'))n.remove();
    }
   })).processSync(rule.selector);
  });
 }
};
