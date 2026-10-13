/* DOM-free, deterministic session model. Classic browser script + CommonJS
 * export keep index.html usable directly via file:// without a build/server.
 *
 * const session = MunduPhysics.createSession({ wordCount: 20, config: {
 *   unlock: { initialCount: 3 }
 * }});
 * session.advance(0.1);       // explicit seconds, not a wall clock
 * session.retrieve();         // successful; session.skip() advances without a kick
 * const saved = session.getState(); // detached, JSON-serializable checkpoint
 * const resumed = MunduPhysics.restoreSession(saved);
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MunduPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Positions and lifts are percentages (0 = bottom, 100 = top).
  // Falling speeds are positive magnitudes in percentage points per second.
  const DEFAULTS = Object.freeze({
    bounds: Object.freeze({ top:100, bottom:0, responseRate:15 }),
    motion: Object.freeze({ topFallingSpeed:1, kickStrengthPercent:50, bottomToTopMultiplier:10 }),
    unlock: Object.freeze({ initialCount:1, threshold:50 }),
    finish: Object.freeze({ threshold:90 }),
    instantPosition:false
  });
  const MODEL='field-falling-time-percent-v5';
  const RETRIEVAL=Object.freeze({ hintSeconds:2, hintedMultiplier:0.5 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n,low,high) => Math.max(low,Math.min(high,n));
  function configuration(patch={}, previous=DEFAULTS) {
    const config={};
    const groups=['bounds','motion','unlock','finish'];
    for(const key of Object.keys(patch))if(!groups.includes(key)&&key!=='instantPosition')throw new RangeError('Unknown configuration field: '+key);
    for (const key of groups) {
      for(const field of Object.keys(patch[key]??{}))if(!(field in previous[key]))throw new RangeError('Unknown configuration field: '+key+'.'+field);
      config[key]={...previous[key],...patch[key]};
      for (const value of Object.values(config[key])) {
        if (!Number.isFinite(value)) throw new RangeError('Configuration values must be finite');
      }
    }
    config.instantPosition=patch.instantPosition ?? previous.instantPosition;
    const {bounds:b,motion:m,unlock:u,finish:f}=config;
    if (!(b.responseRate>0 && b.bottom===0 && b.top===100 && b.bottom<u.threshold &&
      u.threshold<f.threshold && f.threshold<b.top && m.topFallingSpeed>0 && m.kickStrengthPercent>0 && Number.isFinite(m.topFallingSpeed*m.bottomToTopMultiplier) && m.bottomToTopMultiplier>=1 &&
      Number.isInteger(u.initialCount) && u.initialCount>=1 &&
      typeof config.instantPosition==='boolean')) throw new RangeError('Invalid physics configuration');
    return config;
  }
  function isAboveFinish(word,threshold) {
    return word.unlocked && Math.min(word.depth,word.shown)>threshold;
  }
  function wordProgress(word,threshold) {
    if (!word.unlocked) return 0;
    const distance=Math.max(0,threshold-word.initialDepth);
    const traveled=clamp(Math.min(word.depth,word.shown)-word.initialDepth,0,distance);
    return distance>0?traveled/distance:1;
  }
  function scalingFactor(position,config) {
    const h=clamp(position/100,0,1);
    const R=config.motion.bottomToTopMultiplier;
    return R-(R-1)*h;
  }
  // x is percentage height; a is points/second and b is 1/second.
  // v(x) = a - b*x. The tau coordinate is measured in seconds.
  function fallingCoefficients(config) {
    const {topFallingSpeed,bottomToTopMultiplier:R}=config.motion;
    return {a:topFallingSpeed*R,b:topFallingSpeed*(R-1)/100};
  }
  function fallingSpeed(position,config) {
    return config.motion.topFallingSpeed*scalingFactor(position,config);
  }
  function timeCoordinate(position,config) {
    const x=clamp(position,0,100),{a,b}=fallingCoefficients(config);
    if(b===0)return x/a;
    if(x===100)return Math.log1p(config.motion.bottomToTopMultiplier-1)/b;
    const q=b*x/a;
    // log1p avoids cancellation as R approaches one; the q=0 limit
    // also handles underflow at negligible heights/slopes.
    return q===0?x/a:(x/a)*(-Math.log1p(-q)/q);
  }
  function positionAtTime(seconds,config) {
    const {a,b}=fallingCoefficients(config),ceiling=timeCoordinate(100,config);
    if(seconds<=0)return 0;
    if(seconds>=ceiling)return 100;
    const z=b*seconds;
    const x=z===0?a*seconds:a*seconds*(-Math.expm1(-z)/z);
    return clamp(x,0,100);
  }
  function reverseFallingTime(position,seconds,config) {
    const x=clamp(position,0,100);
    return seconds===0?x:positionAtTime(timeCoordinate(x,config)+seconds,config);
  }
  function fieldFallTime(config) { return timeCoordinate(100,config); }
  function baselineKickTime(config) { return fieldFallTime(config)*config.motion.kickStrengthPercent/100; }
  function fullKick(position,config) {
    return reverseFallingTime(position,baselineKickTime(config),config)-clamp(position,0,100);
  }
  function derivedMotion(config) {
    return {baseFallingSpeed:fallingCoefficients(config).a,baseKick:fullKick(0,config),fieldFallTime:fieldFallTime(config),baselineKickTime:baselineKickTime(config)};
  }
  function fallingDepth(position,dt,config) {
    const x=clamp(position,0,100);
    return dt===0?x:positionAtTime(timeCoordinate(x,config)-dt,config);
  }
  function retrievalMultiplier(latency,hintVisible=false) {
    return hintVisible?RETRIEVAL.hintedMultiplier:2-clamp(latency,0,RETRIEVAL.hintSeconds)/2;
  }
  function retrievalLift(position,config,hintVisible=false,latency=0) {
    const kickTime=baselineKickTime(config)*retrievalMultiplier(latency,hintVisible);
    return reverseFallingTime(position,kickTime,config)-clamp(position,0,100);
  }
  function createSession(options={}) {
    let config=configuration(options.config);
    const vocabulary=options.vocabulary ?? Array.from({length:options.wordCount ?? 10},(_,i)=>['word'+(i+1),'']);
    if (!Array.isArray(vocabulary) || vocabulary.length<1 ||
      (options.wordCount!==undefined && (!Number.isInteger(options.wordCount) || options.wordCount<1))) {
      throw new RangeError('A session needs a positive vocabulary size');
    }
    let state={version:7,model:MODEL,config,words:vocabulary.map((entry,i)=>({
      english:Array.isArray(entry)?String(entry[0]):String(entry.english ?? entry),
      spanish:Array.isArray(entry)?String(entry[1] ?? ''):String(entry.spanish ?? ''),
      streak:0,unlocked:i<config.unlock.initialCount,
      initialDepth:config.bounds.bottom,depth:config.bounds.bottom,shown:config.bounds.bottom
    })),time:0,paused:false,complete:false,selectedIndex:0,selectedAt:0,hintVisible:false,skippedIndex:-1,retrievalCount:0,skipCount:0,lastRetrieval:null};
    function lowestIndex() {
      let lowest=-1;
      state.words.forEach((word,i)=>{
        if (i!==state.skippedIndex && word.unlocked && (lowest<0 || word.depth<state.words[lowest].depth)) lowest=i;
      });
      // With only one active word, skipping restarts that same prompt.
      if(lowest<0)lowest=state.words.findIndex(word=>word.unlocked);
      return lowest;
    }
    function select() {
      const index=lowestIndex();
      if (index!==state.selectedIndex) { state.selectedIndex=index; state.selectedAt=state.time; state.hintVisible=false; }
      return index;
    }
    function reconcile() {
      let unlockedIndex=null, completedNow=false;
      if (!state.paused && !state.complete) {
        const active=state.words.filter(word=>word.unlocked);
        if (active.every(word=>Math.min(word.depth,word.shown)>config.unlock.threshold)) {
          const index=state.words.findIndex(word=>!word.unlocked);
          if (index>=0) {
            const word=state.words[index];
            word.unlocked=true; word.depth=config.bounds.bottom; word.shown=config.bounds.bottom; word.streak=0;
            unlockedIndex=index;
          }
        }
      }
      select();
      // Absorb floating-point clock conversion noise at the exact deadline.
      // This is sub-nanosecond precision tolerance, not a gameplay grace period.
      const clockPrecision=128*Number.EPSILON*Math.max(1,state.time,state.selectedAt);
      if(!state.paused&&!state.complete&&state.time-state.selectedAt+clockPrecision>=RETRIEVAL.hintSeconds)state.hintVisible=true;
      // Existing completion can also be detected when paused/tuning changes.
      if (!state.complete && state.words.every(word=>isAboveFinish(word,config.finish.threshold))) {
        state.complete=true; state.paused=true; completedNow=true;
      }
      return {unlockedIndex,completedNow};
    }
    function getProgress() {
      const value=clamp(100*state.words.reduce((sum,word)=>sum+wordProgress(word,config.finish.threshold),0)/state.words.length,0,100);
      return value===100 && !state.words.every(word=>isAboveFinish(word,config.finish.threshold))?100-1e-10:value;
    }
    const api={
      advance(dt) {
        if (!Number.isFinite(dt) || dt<0) throw new RangeError('Duration must be finite and nonnegative');
        if (state.paused || state.complete) return {unlockedIndex:null,completedNow:false};
        for (const word of state.words) {
          if (!word.unlocked) continue;
          word.depth=fallingDepth(word.depth,dt,config);
          // A numerical response position, not a browser animation: threshold
          // checks historically wait for this position as well as logical depth.
          word.shown=config.instantPosition?word.depth:word.shown+(word.depth-word.shown)*(1-Math.exp(-config.bounds.responseRate*dt));
        }
        state.time+=dt;
        return reconcile();
      },
      retrieve() {
        if(arguments.length)throw new TypeError('retrieve() is successful only; use skip() to skip');
        if (state.paused || state.complete) return null;
        const index=select(),word=state.words[index],previousDepth=word.depth;
        const latency=Math.max(0,state.time-state.selectedAt),hintVisible=state.hintVisible;
        const fullLift=fullKick(previousDepth,config);
        word.streak++;
        word.depth=clamp(previousDepth+retrievalLift(previousDepth,config,hintVisible,latency),config.bounds.bottom,config.bounds.top);
        if(config.instantPosition)word.shown=word.depth;
        const result={kind:'retrieval',index,word:word.english,translation:word.spanish,latency,hintVisible,
          multiplier:retrievalMultiplier(latency,hintVisible),kickTime:baselineKickTime(config)*retrievalMultiplier(latency,hintVisible),fullLift,lift:word.depth-previousDepth};
        state.lastRetrieval=result;state.retrievalCount++;
        state.skippedIndex=-1;state.selectedIndex=-1;
        Object.assign(result,reconcile());return clone(result);
      },
      skip() {
        if(state.paused||state.complete)return null;
        const index=select(),word=state.words[index];
        const result={kind:'skip',index,word:word.english,translation:word.spanish,
          latency:Math.max(0,state.time-state.selectedAt),hintVisible:state.hintVisible,multiplier:0,kickTime:0,lift:0};
        state.lastRetrieval=result;state.skipCount++;
        // Skip this word for the next prompt; all words continue falling.
        state.skippedIndex=index;state.selectedIndex=-1;
        Object.assign(result,reconcile());return clone(result);
      },
      getState() { return clone({...state,config}); },
      getProgress,
      getLowestIndex:lowestIndex,
      isComplete() { return state.complete; },
      setPaused(value) {
        if (typeof value!=='boolean') throw new TypeError('Paused must be a boolean');
        if (!state.complete) state.paused=value;
      },
      configure(patch, {recheckCompletion=false}={}) {
        config=configuration(patch,config); state.config=config;
        if (recheckCompletion) state.complete=false;
        return reconcile();
      },
      restore(snapshot) {
        const saved=clone(snapshot);
        if (saved.version!==7 || saved.model!==MODEL || !Array.isArray(saved.words) || !saved.words.length ||
          !Number.isFinite(saved.time) || saved.time<0 || !Number.isFinite(saved.selectedAt) || saved.selectedAt<0 || saved.selectedAt>saved.time ||
          !Number.isInteger(saved.selectedIndex) || saved.selectedIndex<0 || saved.selectedIndex>=saved.words.length ||
          typeof saved.hintVisible!=='boolean' || !Number.isInteger(saved.skippedIndex) || saved.skippedIndex< -1 || saved.skippedIndex>=saved.words.length ||
          !Number.isInteger(saved.skipCount) || saved.skipCount<0 || !Number.isInteger(saved.retrievalCount) || saved.retrievalCount<0 || typeof saved.paused!=='boolean' || typeof saved.complete!=='boolean' ||
          !saved.words.some(word=>word.unlocked) || saved.words.some(word=>
            !Number.isFinite(word.depth) || !Number.isFinite(word.shown) || !Number.isFinite(word.initialDepth) ||
            typeof word.unlocked!=='boolean' || !Number.isInteger(word.streak) || word.streak<0)) throw new RangeError('Invalid session checkpoint');
        config=configuration(saved.config); state=saved; state.config=config;
        return api;
      }
    };
    return api;
  }
  function restoreSession(snapshot) {
    return createSession({wordCount:1}).restore(snapshot);
  }
  return Object.freeze({MODEL,DEFAULTS,RETRIEVAL,createSession,restoreSession,derivedMotion,fieldFallTime,baselineKickTime,timeCoordinate,positionAtTime,reverseFallingTime,scalingFactor,fullKick,fallingSpeed,fallingDepth,retrievalMultiplier,retrievalLift,wordProgress,isAboveFinish});
});
