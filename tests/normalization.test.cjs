const test=require('node:test');
const assert=require('node:assert/strict');
// Historical normalization regression; the current model intentionally differs.
const Current=require('./fixtures/physics-normalized-legacy.cjs');
const Previous=require('./fixtures/physics-before-normalization.cjs');
const schedules=require('./legacy-fixtures.json');
const position=y=>(502-y)*100/442;
const amount=n=>n*100/442;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function compareSessions(current,previous){
 const a=current.getState(),b=previous.getState();
 for(const key of ['paused','complete','selectedIndex','retrievalCount'])assert.equal(a[key],b[key],key);
 near(a.time,b.time);near(a.selectedAt,b.selectedAt);near(current.getProgress(),previous.getProgress());
 a.words.forEach((word,i)=>{
   const old=b.words[i];
   for(const key of ['initialDepth','depth','shown'])near(word[key],position(old[key]));
   for(const key of ['english','spanish','streak','unlocked'])assert.equal(word[key],old[key],key);
 });
 if(b.lastRetrieval){
   for(const key of ['index','correct','unlockedIndex','completedNow'])assert.equal(a.lastRetrieval[key],b.lastRetrieval[key],key);
   near(a.lastRetrieval.latency,b.lastRetrieval.latency);near(a.lastRetrieval.lift,amount(b.lastRetrieval.lift));
 }
}
test('all normalized defaults are the exact affine conversion of previous defaults',()=>{
 const a=Current.DEFAULTS,b=Previous.DEFAULTS;
 assert.equal(a.bounds.bottom,0);assert.equal(a.bounds.top,100);
 near(a.gravity.minSpeed,amount(b.gravity.minSpeed));near(a.gravity.maxSpeed,amount(b.gravity.maxSpeed));
 near(a.kick.maxLift,amount(b.kick.maxLift));near(a.kick.minLift,amount(b.kick.minLift));
 near(a.unlock.threshold,position(b.unlock.threshold));near(a.finish.threshold,position(b.finish.threshold));
 assert.equal(a.bounds.responseRate,b.bounds.responseRate);
 assert.equal(a.unlock.initialCount,b.unlock.initialCount);
 assert.equal(a.speed,b.speed);assert.equal(a.instantPosition,b.instantPosition);
});
for(const fixture of schedules)test(`old-engine regression: initial=${fixture.options.initialCount}, instant=${fixture.options.instantPosition}`,()=>{
 const config={unlock:{initialCount:fixture.options.initialCount},instantPosition:fixture.options.instantPosition};
 const a=Current.createSession({wordCount:10,config}),b=Previous.createSession({wordCount:10,config});
 compareSessions(a,b);
 for(const action of fixture.actions){
   for(const s of [a,b]){
     if(action.type==='advance')s.advance(action.seconds);
     else if(action.type==='retrieve')s.retrieve(action.correct);
     else s.setPaused(action.type==='pause');
   }
   compareSessions(a,b);
 }
});
test('five-word two-second schedule preserves the diagnosed repeating pattern through 120 seconds',()=>{
 const a=Current.createSession({wordCount:5}),b=Previous.createSession({wordCount:5});
 let elapsed=0;
 for(let answer=1;answer<=60;answer++){
   const deadline=answer*2;
   while(elapsed<deadline){
     const remaining=deadline-elapsed,dt=Math.min(1/60,remaining);
     for(const s of [a,b])s.advance(dt);
     elapsed+=dt;if(remaining<=1/60)elapsed=deadline;
     compareSessions(a,b);
   }
   a.retrieve();b.retrieve();compareSessions(a,b);
 }
 assert.equal(a.isComplete(),false);assert.equal(a.getState().retrievalCount,60);
});
test('analytic falling integration remains equivalent across positions and durations',()=>{
 const a=Current.createSession().getState().config,b=Previous.createSession().getState().config;
 for(const y of [60,63,80,84,100,250,293,500,502]){
   near(Current.fallingSpeed(position(y),a),amount(Previous.fallingSpeed(y,b)));
   for(const dt of [0,1/60,.2,1,10,100])near(Current.fallingDepth(position(y),dt,a),position(Previous.fallingDepth(y,dt,b)));
 }
});
test('strict contact and both-position completion conditions remain equivalent',()=>{
 for(const y of [60,83,84,85,292,293,294,502])for(const shown of [60,84,293,502]){
   const word={unlocked:true,depth:y,shown,initialDepth:502};
   const converted={...word,depth:position(y),shown:position(shown),initialDepth:0};
   assert.equal(Current.isAboveFinish(converted,Current.DEFAULTS.finish.threshold),Previous.isAboveFinish(word,84));
   near(Current.wordProgress(converted,Current.DEFAULTS.finish.threshold),Previous.wordProgress(word,84));
 }
});

test('a completing session preserves exact answer count and completion update',()=>{
 const a=Current.createSession({wordCount:5}),b=Previous.createSession({wordCount:5});
 for(let answer=0;answer<100 && !b.isComplete();answer++){
   for(let frame=0;frame<6;frame++){
     a.advance(1/60);b.advance(1/60);compareSessions(a,b);
   }
   a.retrieve();b.retrieve();compareSessions(a,b);
 }
 assert.ok(a.isComplete() && b.isComplete());
 assert.equal(a.getProgress(),100);assert.equal(a.getState().retrievalCount,b.getState().retrievalCount);
});
