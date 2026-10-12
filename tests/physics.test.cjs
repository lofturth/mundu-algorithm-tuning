const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../physics.js');
const fixtures=require('./legacy-fixtures.json');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const projection=session=>{const s=session.getState();return {
  time:s.time,paused:s.paused,complete:s.complete,selectedIndex:s.selectedIndex,
  selectedAt:s.selectedAt,retrievalCount:s.retrievalCount,progress:session.getProgress(),
  words:s.words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])
};};
function compare(actual,expected,path='state') {
  if(typeof expected==='number')return near(actual,expected);
  if(expected && typeof expected==='object'){
    for(const key of Object.keys(expected))compare(actual[key],expected[key],path+'.'+key);
  }else assert.equal(actual,expected,path);
}
for(const fixture of fixtures)test(`pre-refactor parity: ${fixture.options.initialCount} initial, instant=${fixture.options.instantPosition}`,()=>{
  const s=P.createSession({wordCount:10,config:{unlock:{initialCount:fixture.options.initialCount},instantPosition:fixture.options.instantPosition}});
  compare(projection(s),fixture.initial);
  fixture.actions.forEach((action,i)=>{
    if(action.type==='advance')s.advance(action.seconds);
    else if(action.type==='retrieve')s.retrieve(action.correct);
    else s.setPaused(action.type==='pause');
    compare(projection(s),fixture.expected[i],'action '+i);
  });
});
test('arbitrary vocabulary sizes, one-word default and configurable three-word start',()=>{
  for(const size of [1,2,10,31]){
    const s=P.createSession({wordCount:size,config:{unlock:{initialCount:3}}});
    assert.equal(s.getState().words.length,size);
    assert.equal(s.getState().words.filter(w=>w.unlocked).length,Math.min(size,3));
    assert.ok(s.getState().words.every(w=>w.depth===502 && w.shown===502));
    assert.equal(s.getProgress(),0);
  }
  assert.equal(P.createSession().getState().words.filter(w=>w.unlocked).length,1);
});
test('linear position gravity, slow drift above finish, exact elapsed integration',()=>{
  const c=P.createSession().getState().config;
  near(P.fallingSpeed(84,c),3);near(P.fallingSpeed(293,c),16.5);near(P.fallingSpeed(502,c),30);
  near(P.fallingDepth(60,1,c),63);
  let depth=80;for(let i=0;i<600;i++)depth=P.fallingDepth(depth,1/60,c);
  near(depth,P.fallingDepth(80,10,c));
  near(P.fallingDepth(500,100,c),502);
});
test('timed retrievals are strong when quick, small when slow, and bounded',()=>{
  const quick=P.createSession();quick.advance(.1);const a=quick.retrieve();near(a.latency,.1);near(a.lift,190);
  const slow=P.createSession();slow.advance(4);const b=slow.retrieve();near(b.latency,4);near(b.lift,18);
  assert.ok(P.fallingSpeed(quick.getState().words[0].depth,quick.getState().config)<30);
  const single=P.createSession({wordCount:1,config:{instantPosition:true}});
  single.retrieve();single.retrieve();single.retrieve();
  assert.equal(single.getState().words[0].depth,60);
});
test('lowest selection is deterministic, ignores locks, and restarts response timers',()=>{
  const s=P.createSession({wordCount:5,config:{unlock:{initialCount:3}}});
  assert.equal(s.getLowestIndex(),0);s.retrieve();assert.equal(s.getLowestIndex(),1);
  s.advance(.1);near(s.retrieve().latency,.1);assert.equal(s.getLowestIndex(),2);
  const one=P.createSession();one.advance(4);one.retrieve();one.advance(.1);
  near(one.retrieve().latency,.1);
});
test('locked positions do not fall; streak does not affect gravity',()=>{
  const s=P.createSession({wordCount:4,config:{unlock:{initialCount:3}}});
  const snapshot=s.getState();snapshot.words[0].depth=250;snapshot.words[0].shown=250;
  snapshot.words[1].depth=250;snapshot.words[1].shown=250;snapshot.words[1].streak=20;
  s.restore(snapshot);s.advance(1);
  near(s.getState().words[0].depth,s.getState().words[1].depth);
  assert.equal(s.getState().words[3].depth,502);
});
test('strict NEW WORDS contact, single ordered unlock, no progress dilution or relocking',()=>{
  const s=P.createSession({wordCount:10,config:{unlock:{initialCount:3}}});
  let snapshot=s.getState();snapshot.words.slice(0,3).forEach(w=>{w.depth=293;w.shown=293;});
  s.restore(snapshot);assert.equal(s.advance(0).unlockedIndex,null);
  near(s.getProgress(),15);
  snapshot=s.getState();snapshot.words.slice(0,3).forEach(w=>{w.depth=292;w.shown=292;});s.restore(snapshot);
  const before=s.getProgress();assert.equal(s.advance(0).unlockedIndex,3);near(s.getProgress(),before);
  assert.equal(s.advance(0).unlockedIndex,null);
  snapshot=s.getState();snapshot.words[0].depth=502;snapshot.words[0].shown=502;s.restore(snapshot);s.advance(1);
  assert.equal(s.getState().words.filter(w=>w.unlocked).length,4);
});
test('unlock/completion wait for both logical and response positions',()=>{
  const s=P.createSession({wordCount:2});const checkpoint=s.getState();
  checkpoint.words[0].depth=60;checkpoint.words[0].shown=350;s.restore(checkpoint);
  assert.equal(s.advance(0).unlockedIndex,null);assert.equal(s.isComplete(),false);
  s.advance(.2);assert.equal(s.getState().words.filter(w=>w.unlocked).length,2);
});
test('completion requires full dataset, reaches 100%, and freezes time/inputs',()=>{
  const s=P.createSession({wordCount:10,config:{instantPosition:true}});
  for(let i=0;i<100 && !s.isComplete();i++){s.advance(.1);s.retrieve();}
  assert.ok(s.isComplete());assert.equal(s.getProgress(),100);
  assert.ok(s.getState().words.every(w=>P.isAboveFinish(w,84)));
  const saved=s.getState();s.advance(60);assert.equal(s.retrieve(),null);s.setPaused(false);
  assert.deepEqual(s.getState(),saved);
});
test('pause freezes timers and inputs; mistake resets streak without a kick',()=>{
  const s=P.createSession();s.advance(.1);s.setPaused(true);const saved=s.getState();
  s.advance(50);s.retrieve();assert.deepEqual(s.getState(),saved);
  s.setPaused(false);s.advance(.1);near(s.retrieve().latency,.2);
  const before=s.getState().words[0].depth;const wrong=s.retrieve(false);
  near(wrong.lift,0);assert.equal(s.getState().words[0].depth,before);assert.equal(s.getState().words[0].streak,0);
});
test('JSON checkpoints include all timing/config state and reproduce future runs',()=>{
  const a=P.createSession({wordCount:14});
  for(let i=0;i<12;i++){a.advance(.13);a.retrieve(i%5!==0);}
  const b=P.restoreSession(JSON.parse(JSON.stringify(a.getState())));
  for(let i=0;i<50;i++){for(const s of [a,b]){s.advance(.17);s.retrieve(i%7!==0);}}
  assert.deepEqual(a.getState(),b.getState());
  const detached=a.getState();detached.words[0].depth=-999;detached.config.gravity.minSpeed=999;
  assert.notEqual(a.getState().words[0].depth,-999);assert.equal(a.getState().config.gravity.minSpeed,3);
});
test('rejects invalid durations/configuration and supports live tuning',()=>{
  const s=P.createSession();for(const dt of [-1,NaN,Infinity])assert.throws(()=>s.advance(dt),RangeError);
  assert.throws(()=>s.configure({gravity:{maxSpeed:1}}),RangeError);
  assert.throws(()=>P.createSession({wordCount:0}),RangeError);
  s.configure({gravity:{maxSpeed:20}});assert.equal(s.getState().config.gravity.maxSpeed,20);
  assert.equal(s.getState().words.filter(w=>w.unlocked).length,1);
  s.configure({unlock:{initialCount:3}});assert.equal(s.getState().words.filter(w=>w.unlocked).length,1);
});
