'use strict';

// SVG coordinates are rendering only; engine positions are percentages.
const TUNE = { width:1200, top:24, bottom:502, reachableTop:60, left:20, right:1180,
  jumpEase:MunduPhysics.DEFAULTS.bounds.responseRate,
  traceMargin:4 };
// Gravity uses percentage points per second, independent of retrieval streak.
const MOTION = { ...MunduPhysics.DEFAULTS.motion };
// A selected word starts a new response clock; active session time excludes pause.
// Store all raw observations; limit only the number of rendered vertices.
const PROGRESS = { sampleSeconds:0.25, historicalVertices:600, rawVertices:1200 };
const TRACE_LABEL = { gap:12 };
// Rendering only: window width is in seconds, never in observation counts.
const SMOOTH = { rawSeconds:0.6, settleSeconds:1.8, maxWindowSeconds:6, maxBlend:1 };
const FINISH = { ...MunduPhysics.DEFAULTS.finish };
// NEW WORDS must remain strictly below completion and above the starting floor.
const UNLOCK = { ...MunduPhysics.DEFAULTS.unlock };
let sessionComplete=false, completionPresented=false;
let session, selectedIndex=0, pendingUnlock=false;
let wordFlashes=[];
const COLOR = { grid:'#202738', muted:'#657087', pink:'#ED4CA8', cyan:'#43E6ED' };
const VOCABULARY = [ ['river','río'], ['light','luz'], ['apple','manzana'],
  ['night','noche'], ['house','casa'], ['water','agua'], ['bread','pan'],
  ['bird','pájaro'], ['dream','sueño'], ['window','ventana'] ];
const NS = 'http://www.w3.org/2000/svg';
const el = id => document.getElementById(id);
const clamp = (n,low,high) => Math.max(low,Math.min(high,n));
const screenY = position => TUNE.bottom-position/100*(TUNE.bottom-TUNE.reachableTop);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let words, observations, progressValue, count, paused=false;
let lastTime=null, lastMeasurement=null;
let activeTime=0, nextSampleTime=PROGRESS.sampleSeconds;
let observationTimes=[];
const nodes=[];

function svgNode(type, attributes, parent) {
  const node=document.createElementNS(NS,type);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  parent.appendChild(node); return node;
}

// Adapter: wall-clock input, rendering effects and raw history stay here.
// The engine owns every gameplay position, threshold decision and response timer.
function physicsConfig() {
  return {bounds:{responseRate:TUNE.jumpEase},
    motion:{...MOTION},unlock:{...UNLOCK},finish:{...FINISH},
    instantPosition:motionPreference.matches};
}
function syncSession() {
  const state=session.getState();
  words=state.words.map((word,i)=>({...word,flash:wordFlashes[i] || 0}));
  activeTime=state.time; paused=state.paused; sessionComplete=state.complete;
  count=state.retrievalCount; selectedIndex=state.selectedIndex;
}
function acceptTransition(result) {
  if (result && result.unlockedIndex!==null && result.unlockedIndex!==undefined) pendingUnlock=true;
  syncSession();
}
function reset() {
  if (el('completion-screen').open) el('completion-screen').close();
  session=MunduPhysics.createSession({vocabulary:VOCABULARY,config:physicsConfig()});
  wordFlashes=VOCABULARY.map(()=>0); pendingUnlock=false; completionPresented=false;
  observations=[0]; observationTimes=[0]; nextSampleTime=PROGRESS.sampleSeconds;
  progressValue=0; lastMeasurement=null;
  for (const node of nodes) { node.aboveFinish=undefined; node.reactivation=0; }
  syncSession();
  lastTime=performance.now(); updateStatus(); render(0); updateReadouts();
}

// Retrieval changes only word state; progress observes the resulting movement.
function retrieve(skipped=false) {
  if (paused || sessionComplete) return;
  advanceTo(performance.now());
  if (paused || sessionComplete) return;
  recordObservation();
  const result=skipped?session.skip():session.retrieve();
  if (!result) return;
  if (!skipped) wordFlashes[result.index]=1;
  lastMeasurement=result;
  acceptTransition(result);
  progressValue=overallProgress(); recordObservation();
  updateReadouts(); render(0); checkCompletion();
}

function recordObservation() {
  observations.push(progressValue);
  observationTimes.push(activeTime);
}

function wordProgress(word) {
  return MunduPhysics.wordProgress(word,FINISH.threshold);
}
function overallProgress() { return session.getProgress(); }

function advanceProgress(dt) {
  progressValue=overallProgress();
  // Sample actual observed positions, never invent intermediate states after
  // a slow frame. The live endpoint is updated on every frame independently.
  if (activeTime>=nextSampleTime) {
    recordObservation(); nextSampleTime=activeTime+PROGRESS.sampleSeconds;
  }
}

// Completion is a state check, independent of progress rendering.
function checkCompletion() {
  if (!sessionComplete || completionPresented) return;
  completionPresented=true;
  progressValue=overallProgress(); recordObservation();
  paused=true; updateStatus();
  const seconds=Math.floor(activeTime);
  el('completion-time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  el('completion-count').textContent=String(count);
  el('completion-word-count').textContent=String(words.length);
  setTuningOpen(false);
  el('completion-screen').showModal();
}

// Binary lookup keeps archived observations out of each frame's visible scan.
function firstAfter(time) {
  let low=0, high=observationTimes.length;
  while (low<high) {
    const mid=(low+high)>>>1;
    if (observationTimes[mid]<=time) low=mid+1; else high=mid;
  }
  return low;
}

// Cache the time integral of the raw piecewise-linear signal. Duplicate times
// (instant jumps) have zero duration, so rapid answers cannot bias the average
// merely by contributing more samples. Raw observations are never changed.
let integralSource=null, integralAreas=[];
function updateIntegral() {
  if (integralSource!==observations) {
    integralSource=observations; integralAreas=[0];
  }
  for (let i=integralAreas.length;i<observations.length;i++) {
    integralAreas.push(integralAreas[i-1]+(observationTimes[i]-observationTimes[i-1])*
      (observations[i-1]+observations[i])/2);
  }
}

function signalIntegral(time) {
  const t=clamp(time,0,activeTime);
  const i=Math.max(0,firstAfter(t)-1);
  const nextTime=i+1<observations.length?observationTimes[i+1]:activeTime;
  const nextValue=i+1<observations.length?observations[i+1]:progressValue;
  const duration=nextTime-observationTimes[i];
  const elapsed=t-observationTimes[i];
  const value=duration>0?observations[i]+(nextValue-observations[i])*elapsed/duration:observations[i];
  return integralAreas[i]+elapsed*(observations[i]+value)/2;
}

function rawProgressAt(time) {
  const i=Math.max(0,firstAfter(time)-1);
  const nextTime=i+1<observations.length?observationTimes[i+1]:activeTime;
  const nextValue=i+1<observations.length?observations[i+1]:progressValue;
  const duration=nextTime-observationTimes[i];
  return duration>0?observations[i]+(nextValue-observations[i])*
    (time-observationTimes[i])/duration:observations[i];
}

function smoothedProgress(time,raw) {
  if (time===0 || time===activeTime || activeTime===0) return raw;
  const age=activeTime-time;
  if (age<=SMOOTH.rawSeconds) return raw;
  const fraction=clamp((age-SMOOTH.rawSeconds)/SMOOTH.settleSeconds,0,1);
  const strength=fraction*fraction*(3-2*fraction);
  const halfWindow=SMOOTH.maxWindowSeconds*strength/2;
  const left=Math.max(0,time-halfWindow), right=Math.min(activeTime,time+halfWindow);
  if (right-left<1e-7) return raw;
  const average=(signalIntegral(right)-signalIntegral(left))/(right-left);
  return raw+(average-raw)*strength*SMOOTH.maxBlend;
}

function plottedHistory() {
  updateIntegral();
  if (activeTime===0) return [[0,progressValue]];
  const points=[[0,observations[0]]];
  const rawStart=Math.max(0,activeTime-SMOOTH.rawSeconds-SMOOTH.settleSeconds);
  // Draw the entire older journey with a fixed vertex budget, without deleting
  // any stored data. Time-weighted smoothing queries use the cached integral.
  const vertices=Math.min(PROGRESS.historicalVertices,Math.max(2,Math.ceil(rawStart/PROGRESS.sampleSeconds)));
  for (let i=1;i<=vertices;i++) {
    const time=rawStart*i/vertices;
    points.push([time,smoothedProgress(time,rawProgressAt(time))]);
  }
  const start=firstAfter(rawStart);
  const length=observations.length-start;
  const bucketSize=Math.max(1,Math.ceil(length/(PROGRESS.rawVertices/4)));
  // Keep first/last and extrema in very dense raw history. Values and times
  // remain exact; the newest endpoint is always included separately.
  for (let begin=start;begin<observations.length;begin+=bucketSize) {
    const end=Math.min(observations.length,begin+bucketSize);
    let low=begin,high=begin;
    for (let i=begin+1;i<end;i++) {
      if (observations[i]<observations[low]) low=i;
      if (observations[i]>observations[high]) high=i;
    }
    const indices=[...new Set([begin,low,high,end-1])].sort((a,b)=>a-b);
    for (const i of indices) points.push([observationTimes[i],smoothedProgress(observationTimes[i],observations[i])]);
  }
  points.push([activeTime,progressValue]);
  return points;
}

function buildSvg() {
  svgNode('line',{id:'unlock-line',x1:TUNE.left,y1:screenY(UNLOCK.threshold),x2:TUNE.right,y2:screenY(UNLOCK.threshold),
    stroke:'#8b7aa8','stroke-width':1,'stroke-dasharray':'3 8',opacity:0.65},el('labels'));
  const unlockLabel=svgNode('text',{id:'unlock-label',x:TUNE.left+3,y:screenY(UNLOCK.threshold)-7,
    fill:'#8b7aa8','font-size':8},el('labels'));
  unlockLabel.textContent='NEW WORDS';
  svgNode('line',{id:'completion-line',x1:TUNE.left,y1:screenY(FINISH.threshold),x2:TUNE.right,y2:screenY(FINISH.threshold),
    stroke:COLOR.muted,'stroke-width':1,'stroke-dasharray':'5 7',opacity:0.65},el('labels'));
  const thresholdLabel=svgNode('text',{id:'completion-label',x:TUNE.left+3,y:screenY(FINISH.threshold)-7,fill:COLOR.muted,'font-size':8},el('labels'));
  thresholdLabel.textContent='COMPLETION';
  for (let i=0;i<=4;i++) {
    const y=TUNE.top+i*(TUNE.bottom-TUNE.top)/4;
    svgNode('line',{x1:TUNE.left,y1:y,x2:TUNE.right,y2:y,stroke:COLOR.grid,'stroke-width':1},el('grid'));
    const text=svgNode('text',{x:1190,y:y+3,fill:COLOR.muted,'font-size':8,'text-anchor':'end'},el('grid'));
    text.textContent=100-i*25;
  }
  const slot=(TUNE.right-TUNE.left)/VOCABULARY.length;
  VOCABULARY.forEach((pair,i) => {
    const x=TUNE.left+i*slot+5, width=slot-10;
    const guide=svgNode('line',{x1:x+width/2,y1:TUNE.top,x2:x+width/2,y2:TUNE.bottom,stroke:COLOR.grid,'stroke-width':0.6,'stroke-dasharray':'2 8'},el('grid'));
    const bar=svgNode('rect',{x,y:TUNE.top,width,height:0,fill:'url(#bar-fill)'},el('bars'));
    const edge=svgNode('line',{x1:x,y1:0,x2:x+width,y2:0,stroke:COLOR.pink,'stroke-width':1.3},el('bars'));
    const label=svgNode('text',{x:x+width/2,y:0,fill:'#e3e8ef','font-size':14,'text-anchor':'middle'},el('labels'));
    label.textContent=pair[0];
    const streak=svgNode('text',{x:x+width/2,y:0,fill:COLOR.muted,'font-size':8,'text-anchor':'middle'},el('labels'));
    const index=svgNode('text',{x:x+width/2,y:540,fill:COLOR.muted,'font-size':8,'text-anchor':'middle'},el('grid'));
    index.textContent=String(i+1).padStart(2,'0');
    nodes.push({bar,edge,label,streak,guide,index});
  });
}

// Use the same conservative position as completion: both the simulation and
// the animated bar must be clear of the line. Touching it is active again.
function wordAboveFinish(word) {
  return MunduPhysics.isAboveFinish(word,FINISH.threshold);
}

function render(dt) {
  const unlocked=pendingUnlock; pendingUnlock=false;
  words.forEach((word,i) => {
    const node=nodes[i];
    const {bar,edge,label,streak,guide,index}=node, y=screenY(word.shown);
    for (const element of [bar,edge,label,streak,guide,index]) {
      element.setAttribute('visibility',word.unlocked?'visible':'hidden');
    }
    const above=wordAboveFinish(word);
    if (node.aboveFinish===true && !above) node.reactivation=0.28;
    else node.reactivation=Math.max(0,(node.reactivation || 0)-dt);
    node.aboveFinish=above;
    for (const element of [bar,edge,label,streak]) {
      element.classList.toggle('word-faded',above);
      element.classList.toggle('word-reactivated',!above && node.reactivation>0);
    }
    bar.setAttribute('height',y-TUNE.top);
    edge.setAttribute('y1',y); edge.setAttribute('y2',y);
    edge.setAttribute('stroke-width',1.3+word.flash*1.5);
    label.setAttribute('y',y-12);
    label.setAttribute('fill',word.flash>0.2 || node.reactivation>0?COLOR.pink:'#e3e8ef');
    streak.setAttribute('y',y+16); streak.textContent=Math.round(Math.min(word.depth,word.shown))+'%';
    streak.setAttribute('font-size',15);
    streak.setAttribute('font-weight',700);
    streak.setAttribute('fill',COLOR.pink);
    streak.setAttribute('stroke','#0A0D19');
    streak.setAttribute('stroke-width',4);
    streak.setAttribute('paint-order','stroke');
  });
  progressValue=overallProgress();
  if (unlocked) recordObservation();
  el('score').textContent=progressValue.toFixed(1);
  const points=plottedHistory().map(([time,value]) => [
    TUNE.left+(activeTime>0?time/activeTime:0)*(TUNE.right-TUNE.left),
    TUNE.bottom-TUNE.traceMargin-value/100*(TUNE.bottom-TUNE.top-2*TUNE.traceMargin)]);
  el('trace').setAttribute('d',points.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+','+y.toFixed(2)).join(' '));
  const head=points[points.length-1];
  el('trace-percentage').setAttribute('x',TUNE.right+TRACE_LABEL.gap);
  el('trace-percentage').setAttribute('y',head[1]);
  el('trace-percentage').textContent=progressValue.toFixed(1)+'%';
  const target=words[selectedIndex]; el('target-word').textContent=target.english;
  el('target-streak').textContent='STREAK '+String(target.streak).padStart(2,'0');
  const hinted=session.getState().hintVisible;
  el('target-hint').hidden=!hinted;
  el('target-hint').textContent=hinted?'HINT → '+target.spanish+' / HALF KICK':'';
  checkCompletion();
}

function updateReadouts() {
  el('count').textContent=String(count).padStart(3,'0');
  el('score').textContent=progressValue.toFixed(1);
  el('feedback').textContent=lastMeasurement ? `${lastMeasurement.word} → ${lastMeasurement.translation} / ${lastMeasurement.kind==='retrieval'?(lastMeasurement.hintVisible?'hinted / half kick':'unhinted / '+lastMeasurement.multiplier.toFixed(2)+'× kick')+' / ↑'+lastMeasurement.lift.toFixed(1)+' pp':'skipped / no kick'}` : 'Ten words. One key. Keep them afloat.';
}

function updateStatus() {
  el('status').textContent=sessionComplete?'COMPLETE':paused?'PAUSED':'LIVE';
  el('pause').disabled=sessionComplete;
  el('status').parentElement.classList.toggle('paused',paused);
  el('pause').innerHTML=paused?'RESUME <span>▶</span>':'PAUSE <span>Ⅱ</span>';
  el('pause').setAttribute('aria-pressed',String(paused));
  el('prompt').textContent=sessionComplete?'ALL WORDS CLEAR / RESET TO RESTART':paused?'SESSION PAUSED / RESUME TO RETRIEVE':'LETTER = RETRIEVE / ESC = SKIP';
}

// Physical letter keys accept all layouts; modifier shortcuts retain browser behavior.
document.addEventListener('keydown',event => {
  if (event.ctrlKey||event.metaKey||event.altKey||event.isComposing) return;
  if (event.key==='Escape') {
    event.preventDefault();
    retrieve(true);return;
  }
  if (event.target?.matches('input, select, textarea')) return;
  if (/^Key[A-Z]$/.test(event.code) || /^\p{L}$/u.test(event.key)) {
    event.preventDefault(); retrieve();
  }
});
el('pause').addEventListener('click',() => {
  if (sessionComplete) return;
  if (!paused) { advanceTo(performance.now()); render(0); }
  session.setPaused(!paused); syncSession(); lastTime=performance.now(); updateStatus();
});
el('reset').addEventListener('click',reset);
motionPreference.addEventListener?.('change',() => {
  acceptTransition(session.configure({instantPosition:motionPreference.matches}));
});
document.addEventListener('visibilitychange',() => { lastTime=performance.now(); });
function advanceTo(time) {
  const nextTime=lastTime===null?time:Math.max(time,lastTime);
  const dt=lastTime===null?0:(nextTime-lastTime)/1000; lastTime=nextTime;
  if (!paused) {
    wordFlashes=wordFlashes.map(flash=>Math.max(0,flash-dt*2.8));
    acceptTransition(session.advance(dt));
    advanceProgress(dt); render(dt);
  }
}
function frame(time) {
  advanceTo(time);
  requestAnimationFrame(frame);
}
// Live tuning stays separate from session state. Reload restores these defaults.
const SETTINGS = [
  {name:'WORD PHYSICS',values:TUNE,fields:[
    ['jumpEase','Lift animation speed','Higher = faster bar animation',1,40,1]]},
  {name:'PROGRESSIVE WORDS',values:UNLOCK,fields:[
    ['initialCount','Starting words','Applied on the next session Reset',1,10,1],
    ['threshold','NEW WORDS position (%)','0% = bottom; must stay below completion',100/442,44000/442,0.1]]},
  {name:'SHARED LINEAR PHYSICS',values:MOTION,fields:[
    ['topFallingSpeed','Top falling speed','At top; percentage points / second',0.01,15,0.01],
    ['bottomToTopMultiplier','Bottom-to-top multiplier','Bottom ÷ top for falling and kicks; 3 = three times',1,1000,0.1],
    ['kickStrengthPercent','Kick strength (% of field)','% of field falling time reversed by a 1× kick',0.1,200,0.1]]},
  {name:'HISTORICAL SMOOTHING',values:SMOOTH,fields:[
    ['rawSeconds','Raw bleeding edge','Seconds of completely unsmoothed activity',0.1,3,0.1],
    ['settleSeconds','Time to become smooth','Seconds after leaving the raw edge',0.1,5,0.1],
    ['maxWindowSeconds','Oldest averaging window','Seconds; larger = calmer history',0,15,0.5],
    ['maxBlend','Historical smoothing strength','0 = raw; 1 = fully smoothed tail',0,1,0.05]]},
  {name:'COMPLETION LINE',values:FINISH,fields:[
    ['threshold','Completion position (%)','Higher percentage = higher / harder to reach',25200/442,44100/442,0.1]]}
];
const tuningInputs=[];
function refreshTuning(recheckCompletion=false) {
  el('unlock-line').setAttribute('y1',screenY(UNLOCK.threshold));
  el('unlock-line').setAttribute('y2',screenY(UNLOCK.threshold));
  el('unlock-label').setAttribute('y',screenY(UNLOCK.threshold)-7);
  el('completion-line').setAttribute('y1',screenY(FINISH.threshold));
  el('completion-line').setAttribute('y2',screenY(FINISH.threshold));
  el('completion-label').setAttribute('y',screenY(FINISH.threshold)-7);
  if (recheckCompletion) completionPresented=false;
  acceptTransition(session.configure(physicsConfig(),{recheckCompletion}));
  updateStatus(); render(0);
}
function setTuningOpen(open) {
  el('tuning-panel').hidden=!open;
  el('tune').setAttribute('aria-expanded',String(open));
}
function buildTuning() {
  for (const group of SETTINGS) {
    const fieldset=document.createElement('fieldset');
    const legend=document.createElement('legend'); legend.textContent=group.name;
    fieldset.appendChild(legend);
    for (const [key,title,description,min,max,step] of group.fields) {
      const row=document.createElement('label'); row.className='tuning-row';
      const caption=document.createElement('span');
      const name=document.createElement('span'); name.textContent=title;
      const note=document.createElement('small'); note.textContent=description;
      caption.appendChild(name); caption.appendChild(note);
      const input=document.createElement('input');
      input.type='number'; input.min=min; input.max=max; input.step=step;
      input.value=Number(group.values[key].toFixed(6)); input.title=key;
      const original=group.values[key];
      const commit=() => {
        const value=Number(input.value);
        if (input.value.trim()==='' || !Number.isFinite(value) || value<min || value>max || (step===1 && !Number.isInteger(value))) return false;
        if (key==='threshold' && ((group.values===UNLOCK && value>=FINISH.threshold) || (group.values===FINISH && value<=UNLOCK.threshold))) return false;
        if (!paused) advanceTo(performance.now());
        group.values[key]=value; refreshTuning(group.values===FINISH); return true;
      };
      input.addEventListener('input',commit);
      input.addEventListener('change',() => { if (!commit()) input.value=Number(group.values[key].toFixed(6)); });
      row.appendChild(caption); row.appendChild(input); fieldset.appendChild(row);
      tuningInputs.push({input,values:group.values,key,original});
    }
    el('tuning-fields').appendChild(fieldset);
  }
  el('tune').addEventListener('click',() => setTuningOpen(el('tuning-panel').hidden));
  el('tuning-close').addEventListener('click',() => { setTuningOpen(false); el('tune').focus(); });
  el('tuning-defaults').addEventListener('click',() => {
    for (const {input,values,key,original} of tuningInputs) { values[key]=original; input.value=Number(values[key].toFixed(6)); }
    refreshTuning(true);
  });
}
function buildCompletionScreen() {
  el('completion-again').addEventListener('click',reset);
  el('completion-review').addEventListener('click',() => {
    el('completion-screen').close(); el('reset').focus();
  });
}
buildSvg(); reset(); buildTuning(); buildCompletionScreen(); requestAnimationFrame(frame);
