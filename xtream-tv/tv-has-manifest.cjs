const {req}=require('./tv-build-deps.cjs');
const parse=req('postcss-selector-parser');
const records=new Map();let next=0;
function withoutGuards(selector){
 selector.walkPseudos(p=>{if(p.value===':not'&&p.toString().includes('does-not-exist'))p.remove();});
 selector.walkClasses(c=>{if(c.value==='js-has-pseudo'){const next=c.parent.nodes[c.parent.nodes.indexOf(c)+1];if(next?.type==='combinator')next.remove();c.remove();}});
}
function context(rule,attribute){
 const tree=parse().astSync(rule.selector);let found;
 tree.walkAttributes(a=>{if(!found&&a.attribute===attribute)found=a;});
 if(!found)throw new Error('Missing encoded selector');
 let compound=found;while(compound.parent.type!=='selector'||compound.parent.parent.type!=='root')compound=compound.parent;
 const selector=compound.parent.clone();const at=compound.parent.nodes.indexOf(compound);
 for(let i=selector.nodes.length-1;i>at;i--)selector.nodes[i].remove();
 selector.nodes[at].remove();withoutGuards(selector);
 const text=selector.toString().trim();return text||'*';
}
function compile(selector,contextSelector){
 const tree=parse().astSync(selector);const predicates=[];
 tree.walkPseudos(p=>{
  if(p.value!==':has')return;
  const rel=p.nodes.map(n=>n.toString().trim());
  if(rel.some(r=>r.includes(':has(')))throw new Error('Unexpected nested TV relation');
  const marker='data-xtream-tv-rel-'+next++;
  let parent=p;while(parent.parent.type!=='selector'||parent.parent.parent.type!=='root')parent=parent.parent;
  const candidate=parent.parent.clone();const at=parent.parent.nodes.indexOf(parent);
  for(let i=candidate.nodes.length-1;i>at;i--)candidate.nodes[i].remove();
  candidate.nodes[at].remove();
  const base=candidate.toString().trim()||contextSelector;
  predicates.push({candidate:base,relative:rel,attribute:marker});
  p.replaceWith(parse.attribute({attribute:marker}));
 });
 return {query:tree.toString().trim(),predicates};
}
module.exports={
 collect(root){
  root.walkRules(rule=>{
   if(!rule.selector?.includes('csstools-has-'))return;
   parse(tree=>tree.walkAttributes(a=>{
    if(!a.attribute.startsWith('csstools-has-'))return;
    const decoded=a.attribute.slice(13).split('-').map(v=>String.fromCharCode(parseInt(v,36))).join('');
    const base=decoded.startsWith(':has(')?context(rule,a.attribute):'*';
    const key=a.attribute+'|'+base;
    if(records.has(key))return;
    const item=compile(decoded,base);
    // A bare :has() is inside a surrounding :not(); match only its subject.
    if(decoded.startsWith(':has('))item.query=base+'['+item.predicates[0].attribute+']';
    records.set(key,{attribute:a.attribute,...item});
   })).processSync(rule.selector);
  });
 },
 values(){return [...records.values()];}
};
