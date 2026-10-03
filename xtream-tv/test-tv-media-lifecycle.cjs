const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {req}=require('./tv-build-deps.cjs');
const {JSDOM}=req('jsdom');
const flush=()=>new Promise(r=>setTimeout(r,45));
(async()=>{
 const dom=new JSDOM('<!doctype html><html><body><main id="reactRoot"></main><div id="slides-container"></div></body></html>',{url:'https://tv.invalid/#/home',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;w.XtreamTV={};
 let starts=0,stops=0,resumes=0,visibleChecks=0;
 const timer={timerId:7,stop(){stops++;this.timerId=null;},start(){starts++;this.timerId=7;}};
 const s={slideInterval:timer,isPaused:false,isVideoPlaying:true,currentSlideIndex:2,videoPlayers:{}};
 w.mediaBarEnhanced={STATE:{slideshow:s},SlideshowManager:{resumeActivePlayback(){resumes++;},stopYouTubeProgressLoop(){}},VisibilityObserver:{updateVisibility(){visibleChecks++;}}};
 w.eval(fs.readFileSync(path.join(__dirname,'tv-customizations/tv-media-lifecycle.js'),'utf8'));
 function open(){const gate=d.createElement('div');gate.id='profiles-gate-overlay';d.body.appendChild(gate);d.documentElement.classList.add('profiles-no-scroll');}
 function close(){d.getElementById('profiles-gate-overlay').remove();d.documentElement.classList.remove('profiles-no-scroll');}
 open();await flush();
 assert.ok(w.XtreamTV.isProfileCovered());assert.equal(timer.timerId,null);assert.equal(s.isPaused,false,'Gate pause must preserve user Pause preference');
 assert.ok(d.documentElement.classList.contains('xtream-tv-profile-cover'));
 let released=false;w.XtreamTV.waitForProfileGate().then(()=>released=true);await flush();assert.equal(released,false);
 d.getElementById('reactRoot').classList.add('is-focused');await flush();assert.equal(stops,1,'Focus changes must not repeatedly pause playback');
 close();await flush();assert.equal(released,true);assert.equal(timer.timerId,7);assert.equal(resumes,1);assert.equal(starts,1);assert.equal(visibleChecks,1);
 assert.ok(!d.documentElement.classList.contains('xtream-tv-profile-cover'));
 s.isPaused=true;s.isVideoPlaying=false;timer.timerId=null;open();await flush();close();await flush();
 assert.equal(s.isPaused,true);assert.equal(starts,1,'Manual pause must remain paused after leaving Bonfire');assert.equal(resumes,1);
 s.isPaused=false;timer.timerId=7;open();await flush();s.slideInterval={timerId:null};close();await flush();assert.equal(starts,1,'An old timer must not restart after profile data resets');
 const backdrop=new URL(w.XtreamTV.mediaImageUrl('https://server.invalid/Items/test/Images/Backdrop/0?tag=x&quality=60','Backdrop'));
 assert.equal(backdrop.searchParams.get('maxWidth'),'1024');assert.equal(backdrop.searchParams.get('maxHeight'),'768');assert.equal(backdrop.searchParams.get('tag'),'x');assert.equal(backdrop.searchParams.get('quality'),'60');
 const logo=new URL(w.XtreamTV.mediaImageUrl('https://server.invalid/Items/test/Images/Logo?quality=40','Logo'));assert.equal(logo.searchParams.get('maxWidth'),'410');
 assert.equal(w.XtreamTV.mediaImageUrl('unchanged','Primary'),'unchanged');
 dom.window.close();console.log(JSON.stringify({passed:true,automaticPauseResume:true,preservesManualPause:true,blocksOldTimerAfterReset:true,imageResolutionMatchesViewport:true}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
