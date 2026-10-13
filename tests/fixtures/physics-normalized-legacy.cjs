// Historical normalized fixed-kick engine; regression fixture only.
/* DOM-free, deterministic session model. Classic browser script + CommonJS
 * export keep index.html usable directly via file:// without a build/server.
 *
 * const session = MunduPhysics.createSession({ wordCount: 20, config: {
 *   unlock: { initialCount: 3 }
 * }});
 * session.advance(0.1);       // explicit seconds, not a wall clock
 * session.retrieve();         // correct; retrieve(false) simulates a mistake
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
    gravity: Object.freeze({ minSpeed:300/442, maxSpeed:900/442 }),
    kick: Object.freeze({ minLift:1800/442, maxLift:19000/442, fastSeconds:0.2, slowSeconds:3 }),
    unlock: Object.freeze({ initialCount:1, threshold:20900/442 }),
    finish: Object.freeze({ threshold:41800/442 }),
    speed:1, instantPosition:false
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n,low,high) => Math.max(low,Math.min(high,n));
  function configuration(patch={}, previous=DEFAULTS) {
    const config={};
    for (const key of ['bounds','gravity','kick','unlock','finish']) {
      config[key]={...previous[key],...patch[key]};
      for (const value of Object.values(config[key])) {
        if (!Number.isFinite(value)) throw new RangeError('Configuration values must be finite');
      }
    }
    config.speed=patch.speed ?? previous.speed;
    config.instantPosition=patch.instantPosition ?? previous.instantPosition;
    const {bounds:b,gravity:g,kick:k,unlock:u,finish:f}=config;
    if (!(b.responseRate>0 && b.bottom===0 && b.top===100 && b.bottom<u.threshold &&
      u.threshold<f.threshold && f.threshold<b.top && g.minSpeed>0 && g.maxSpeed>=g.minSpeed &&
      k.minLift>=0 && k.maxLift>=k.minLift && k.fastSeconds>=0 && k.slowSeconds>k.fastSeconds &&
      Number.isInteger(u.initialCount) && u.initialCount>=1 && Number.isFinite(config.speed) && config.speed>0 &&
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
  function fallingSpeed(position,config) {
    const {bounds:b,gravity:g,finish:f,speed}=config;
    const fraction=clamp((f.threshold-position)/(f.threshold-b.bottom),0,1);
    return speed*(g.minSpeed+(g.maxSpeed-g.minSpeed)*fraction);
  }
  function fallingDepth(position,dt,config) {
    const {bounds:b,gravity:g,finish:f,speed}=config;
    const minimum=speed*g.minSpeed;
    if (position>f.threshold) {
      const crossingTime=(position-f.threshold)/minimum;
      if (dt<=crossingTime) return position-minimum*dt;
      position=f.threshold; dt-=crossingTime;
    }
    const slope=speed*(g.maxSpeed-g.minSpeed)/(f.threshold-b.bottom);
    const distance=f.threshold-position;
    const next=slope>0?f.threshold-distance*Math.exp(slope*dt)-minimum*Math.expm1(slope*dt)/slope:position-minimum*dt;
    return clamp(next,b.bottom,b.top);
  }
  function retrievalLift(seconds,config) {
    // Response timing remains in checkpoints/feedback, but no longer sets lift.
    return config.kick.maxLift;
  }
  function createSession(options={}) {
    let config=configuration(options.config);
    const vocabulary=options.vocabulary ?? Array.from({length:options.wordCount ?? 10},(_,i)=>['word'+(i+1),'']);
    if (!Array.isArray(vocabulary) || vocabulary.length<1 ||
      (options.wordCount!==undefined && (!Number.isInteger(options.wordCount) || options.wordCount<1))) {
      throw new RangeError('A session needs a positive vocabulary size');
    }
    let state={version:2,config,words:vocabulary.map((entry,i)=>({
      english:Array.isArray(entry)?String(entry[0]):String(entry.english ?? entry),
      spanish:Array.isArray(entry)?String(entry[1] ?? ''):String(entry.spanish ?? ''),
      streak:0,unlocked:i<config.unlock.initialCount,
      initialDepth:config.bounds.bottom,depth:config.bounds.bottom,shown:config.bounds.bottom
    })),time:0,paused:false,complete:false,selectedIndex:0,selectedAt:0,retrievalCount:0,lastRetrieval:null};
    function lowestIndex() {
      let lowest=-1;
      state.words.forEach((word,i)=>{
        if (word.unlocked && (lowest<0 || word.depth<state.words[lowest].depth)) lowest=i;
      });
      return lowest;
    }
    function select() {
      const index=lowestIndex();
      if (index!==state.selectedIndex) { state.selectedIndex=index; state.selectedAt=state.time; }
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
      retrieve(correct=true) {
        if (typeof correct!=='boolean') throw new TypeError('Correct must be a boolean');
        if (state.paused || state.complete) return null;
        const index=select(), word=state.words[index];
        const latency=Math.max(0,state.time-state.selectedAt), previousDepth=word.depth;
        if (correct) {
          word.streak++;
          word.depth=clamp(word.depth+retrievalLift(latency,config),config.bounds.bottom,config.bounds.top);
          if (config.instantPosition) word.shown=word.depth;
        } else word.streak=0;
        const result={index,word:word.english,translation:word.spanish,correct,latency,lift:word.depth-previousDepth};
        state.lastRetrieval=result; state.retrievalCount++;
        state.selectedIndex=-1; // Restart an attempt even if the same word stays lowest.
        Object.assign(result,reconcile());
        return clone(result);
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
        if (saved.version!==2 || !Array.isArray(saved.words) || !saved.words.length ||
          !Number.isFinite(saved.time) || saved.time<0 || !Number.isFinite(saved.selectedAt) || saved.selectedAt<0 || saved.selectedAt>saved.time ||
          !Number.isInteger(saved.selectedIndex) || saved.selectedIndex<0 || saved.selectedIndex>=saved.words.length ||
          !Number.isInteger(saved.retrievalCount) || saved.retrievalCount<0 || typeof saved.paused!=='boolean' || typeof saved.complete!=='boolean' ||
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
  return Object.freeze({DEFAULTS,createSession,restoreSession,fallingSpeed,fallingDepth,retrievalLift,wordProgress,isAboveFinish});
});
