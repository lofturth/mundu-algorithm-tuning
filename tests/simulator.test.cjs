const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Physics=require('../physics.js');
const Simulator=require('../simulator.cjs');
const {makeHost}=require('./dom-harness.cjs');
const base=path.join(__dirname,'..');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

// Wrap the actual engine at its import boundary: no fake physics is supplied.
function tracedSimulator(){
 const calls=[];const initialStates=[];
 const physics={...Physics,createSession(options){
   assert.deepEqual(Object.keys(options),['wordCount']);
   const session=Physics.createSession(options);
   initialStates.push(session.getState());
   return new Proxy(session,{get(target,key){
     if(key==='advance')return dt=>{calls.push({type:'advance',dt});return target.advance(dt);};
     if(key==='retrieve')return (...args)=>{
       assert.equal(args.length,0);
       const expectedIndex=target.getLowestIndex();
       const result=target.retrieve();
       if(result)assert.equal(result.index,expectedIndex);
       calls.push({type:'retrieve'});return result;
     };
     if(key==='configure')return ()=>{throw new Error('Simulator must not retune physics');};
     return target[key];
   }});
 }};
 const module={exports:{}};
 const requireEngine=id=>{assert.equal(id,'./physics.js');return physics;};
 vm.runInNewContext(fs.readFileSync(path.join(base,'simulator.cjs'),'utf8'),{module,require:requireEngine,console});
 return {api:module.exports,calls,initialStates};
}

test('experiment grid remains unchanged; a short five-word run is deterministic',()=>{
 assert.deepEqual([...Simulator.EXPERIMENTS.wordCounts],[5,10,15,20,25,30]);
 assert.deepEqual([...Simulator.EXPERIMENTS.intervals],[2,5,10,15]);
 assert.equal(Simulator.EXPERIMENTS.stepSeconds,1/60);
 assert.equal(Simulator.EXPERIMENTS.maxTimeSeconds,3600);
 const options={wordCount:5,intervalSeconds:2,maxTimeSeconds:120};
 const first=Simulator.runSimulation(options);
 assert.deepEqual(first,Simulator.runSimulation(options));
 assert.equal(first.finalState.words.length,5);
 assert.equal(first.successfulRetrievals,60);
 assert.equal(first.status,'Unfinished');near(first.elapsedSeconds,120);
 assert.ok(first.finalState.words.filter(w=>w.unlocked).length>=1);
 assert.equal(first.finalState.model,Physics.MODEL);
 for(const size of Simulator.EXPERIMENTS.wordCounts){
   const r=Simulator.runSimulation({wordCount:size,intervalSeconds:2,maxTimeSeconds:1});
   assert.equal(r.finalState.words.length,size);
   assert.deepEqual(r.finalState.config,Physics.createSession().getState().config);
 }
});
test('uses real physics, untouched defaults, lowest-word selection and small updates',()=>{
 const {api,calls,initialStates}=tracedSimulator();
 const result=api.runSimulation({wordCount:10,intervalSeconds:2,maxTimeSeconds:20});
 assert.deepEqual(initialStates[0].config,Physics.createSession().getState().config);
 assert.equal(initialStates[0].words.filter(w=>w.unlocked).length,1);
 assert.equal(calls.filter(c=>c.type==='retrieve').length,10);
 assert.ok(calls.filter(c=>c.type==='advance').every(c=>c.dt>0 && c.dt<=1/60));
 near(calls.slice(0,calls.findIndex(c=>c.type==='retrieve')).reduce((sum,c)=>sum+c.dt,0),2);
 assert.equal(result.finalState.config.motion.topFallingSpeed,1);
});
test('completion is detected between answers and prevents extra retrievals',()=>{
 const result=Simulator.runSimulation({wordCount:5,intervalSeconds:.1,maxTimeSeconds:30});
 assert.equal(result.status,'Completed');assert.equal(result.stopReason,'completed');
 assert.ok(result.completionTimeSeconds>0 && result.completionTimeSeconds<30);
 assert.equal(result.elapsedSeconds,result.completionTimeSeconds);
 assert.ok(result.finalState.words.every(w=>Physics.isAboveFinish(w,Physics.DEFAULTS.finish.threshold)));
 assert.ok(result.finalState.complete && result.finalState.paused);
 const replay=Physics.restoreSession(result.finalState);const saved=replay.getState();
 replay.advance(10);assert.equal(replay.retrieve(),null);assert.deepEqual(replay.getState(),saved);
});
test('unfinished limits are explicit; partial intervals and boundary answers are counted correctly',()=>{
 const none=Simulator.runSimulation({wordCount:10,intervalSeconds:5,maxTimeSeconds:3});
 assert.equal(none.status,'Unfinished');assert.equal(none.successfulRetrievals,0);
 assert.equal(none.completionTimeSeconds,null);near(none.elapsedSeconds,3);
 const partial=Simulator.runSimulation({wordCount:10,intervalSeconds:2,maxTimeSeconds:5.5});
 assert.equal(partial.successfulRetrievals,2);near(partial.elapsedSeconds,5.5);
 const boundary=Simulator.runSimulation({wordCount:10,intervalSeconds:2,maxTimeSeconds:6});
 assert.equal(boundary.successfulRetrievals,3);near(boundary.elapsedSeconds,6);
});
test('time advancement and inputs agree with the actual playable prototype',()=>{
 const {api,calls}=tracedSimulator();
 const result=api.runSimulation({wordCount:10,intervalSeconds:2,maxTimeSeconds:30});
 const h=makeHost({html:fs.readFileSync(path.join(base,'index.html'),'utf8'),
   physics:fs.readFileSync(path.join(base,'physics.js'),'utf8'),app:fs.readFileSync(path.join(base,'app.js'),'utf8')});
 for(const call of calls){if(call.type==='advance')h.advance(call.dt);else h.retrieve();}
 const state=JSON.parse(h.run('JSON.stringify(session.getState())'));
 near(state.time,result.finalState.time);
 assert.equal(state.retrievalCount,result.successfulRetrievals);
 assert.equal(state.complete,result.finalState.complete);
 assert.equal(state.selectedIndex,result.finalState.selectedIndex);
 near(state.selectedAt,result.finalState.selectedAt);
 state.words.forEach((word,i)=>{
   const expected=result.finalState.words[i];
   near(word.depth,expected.depth);near(word.shown,expected.shown);
   assert.equal(word.unlocked,expected.unlocked);assert.equal(word.streak,expected.streak);
 });
});
test('report includes main table and all four interval summaries',()=>{
 // Formatting coverage uses supplied records, not a rerun of the full grid.
 const results=Simulator.EXPERIMENTS.wordCounts.flatMap(wordCount=>Simulator.EXPERIMENTS.intervals.map(intervalSeconds=>({
   wordCount,intervalSeconds,successfulRetrievals:3600/intervalSeconds,
   completionTimeSeconds:null,elapsedSeconds:3600,status:'Unfinished'
 })));
 const text=Simulator.formatReport(results);
 assert.match(text,/SUMMARY BY RETRIEVAL INTERVAL/);
 for(const interval of [2,5,10,15])assert.ok(text.includes(`Every ${interval} seconds — ${results.filter(r=>r.intervalSeconds===interval && r.status==='Completed').length}/6 completed`));
 assert.match(text,/Unfinished/);assert.match(text,/60:00.00/);
});
test('rejects invalid sizes, schedules and limits',()=>{
 for(const wordCount of [0,-1,1.5])assert.throws(()=>Simulator.runSimulation({wordCount,intervalSeconds:2}),RangeError);
 for(const intervalSeconds of [0,-1,NaN,Infinity])assert.throws(()=>Simulator.runSimulation({wordCount:5,intervalSeconds}),RangeError);
 assert.throws(()=>Simulator.runSimulation({wordCount:5,intervalSeconds:2,stepSeconds:0}),RangeError);
 assert.throws(()=>Simulator.runSimulation({wordCount:5,intervalSeconds:2,maxTimeSeconds:0}),RangeError);
});

test('simulator overrides and restored final state retain gravity reduction and active counts',()=>{
 const options={wordCount:8,intervalSeconds:2,maxTimeSeconds:12,physicsConfig:{motion:{gravityReductionPercent:5,kickHeightPercent:60},unlock:{initialCount:3}}};
 const a=Simulator.runSimulation(options),b=Simulator.runSimulation(options);assert.deepEqual(a,b);
 const state=a.finalState;assert.equal(state.config.motion.gravityReductionPercent,5);assert.equal(state.config.motion.kickHeightPercent,60);
 assert.equal(state.unlockedWordCount,state.words.filter(w=>w.unlocked).length);
 near(state.gravityMultiplier,.95**(state.unlockedWordCount-1));
 assert.deepEqual(Physics.restoreSession(state).getState(),state);
});
