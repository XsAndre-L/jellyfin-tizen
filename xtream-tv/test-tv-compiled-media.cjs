const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const {req}=require('./tv-build-deps.cjs'),babel=req('@babel/core'),parser=req('@babel/parser'),traverse=req('@babel/traverse').default,t=req('@babel/types');
const code=fs.readFileSync(path.join(__dirname,'jellyfin-tv-custom-build/www/addons/media-bar.compat.js'),'utf8');
const ast=parser.parse(code),methods={},context={window:{XtreamTV:{isProfileCovered:()=>true,pauseCoveredMedia(){}}},Promise};let timerSource;
traverse(ast,{ObjectMethod(p){if(['updateVisibility','updateCurrentSlide','preloadAdjacentSlides','resumeActivePlayback','upgradeSlideImageQuality','buildImageUrl'].includes(p.node.key.name))methods[p.node.key.name]=t.cloneNode(p.node,true);},ClassDeclaration(p){if(p.node.id.name==='SlideTimer')timerSource=babel.transformFromAstSync(t.file(t.program([t.cloneNode(p.node,true)])),null,{babelrc:false,configFile:false}).code;}});
(async()=>{
 for(const name of ['updateVisibility','updateCurrentSlide','preloadAdjacentSlides','resumeActivePlayback','upgradeSlideImageQuality']){
  assert.ok(methods[name],name+' missing');
  const obj=t.objectExpression([methods[name]]),source=babel.transformFromAstSync(t.file(t.program([t.expressionStatement(obj)])),null,{babelrc:false,configFile:false}).code;
  const value=vm.runInNewContext(source,context);await value[name]();
 }
 let intervals=0;context.setInterval=()=>++intervals;context.clearInterval=()=>{};
 vm.runInNewContext(timerSource+';new SlideTimer(function(){},1000).start();',context);assert.equal(intervals,0,'A covered slideshow must never start an interval');
 const imageSource=babel.transformFromAstSync(t.file(t.program([t.expressionStatement(t.objectExpression([methods.buildImageUrl]))])),null,{babelrc:false,configFile:false}).code;
 context.window.XtreamTV.mediaImageUrl=(url,type)=>url+'&maxWidth='+(type==='Backdrop'?1920:768);
 const creator=vm.runInNewContext(imageSource,context);
 assert.ok(creator.buildImageUrl({Id:'example',BackdropImageTags:['tag']},'Backdrop',0,'https://server.invalid',60).endsWith('&maxWidth=1920'));
 assert.ok(creator.buildImageUrl({Id:'example',ImageTags:{}},'Logo',undefined,'https://server.invalid',40).endsWith('&maxWidth=768'));
 console.log(JSON.stringify({passed:true,coveredMethodsGuarded:true,timersCannotRestartBehindGate:true,taggedAndFallbackImageUrlsSized:true}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
