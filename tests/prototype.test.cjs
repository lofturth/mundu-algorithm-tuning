const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeHost}=require('./dom-harness.cjs');
const fixtures=require('./legacy-fixtures.json');
const Physics=require('../physics.js');
const base=path.join(__dirname,'..');
const files={html:fs.readFileSync(path.join(base,'index.html'),'utf8'),app:fs.readFileSync(path.join(base,'app.js'),'utf8'),physics:fs.readFileSync(path.join(base,'physics.js'),'utf8')};
function host(options={}){return makeHost({...files,...options});}
function compare(actual,expected){
 if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
 else if(expected && typeof expected==='object')for(const key of Object.keys(expected))compare(actual[key],expected[key]);
 else assert.equal(actual,expected);
}
const snapshot=h=>JSON.parse(h.run(`JSON.stringify({time:activeTime,paused,complete:sessionComplete,selectedIndex:session.getState().selectedIndex,selectedAt:session.getState().selectedAt,retrievalCount:count,progress:progressValue,words:words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])})`));
for(const fixture of fixtures)test(`prototype/engine parity: initial=${fixture.options.initialCount}, instant=${fixture.options.instantPosition}`,()=>{
 const h=host({instantPosition:fixture.options.instantPosition});
 h.run(`UNLOCK.initialCount=${fixture.options.initialCount};reset();`);
 const engine=Physics.createSession({wordCount:10,config:{unlock:{initialCount:fixture.options.initialCount},instantPosition:fixture.options.instantPosition}});
 const expected=()=>{const s=engine.getState();return {
   time:s.time,paused:s.paused,complete:s.complete,selectedIndex:s.selectedIndex,
   selectedAt:s.selectedAt,retrievalCount:s.retrievalCount,progress:engine.getProgress(),
   words:s.words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])
 };};
 compare(snapshot(h),expected());
 fixture.actions.forEach(action=>{
   if(action.type==='advance'){h.advance(action.seconds);engine.advance(action.seconds);}
   else if(action.type==='retrieve'){h.retrieve(action.correct);action.correct?engine.retrieve():engine.skip();}
   else {h.click('pause');engine.setPaused(action.type==='pause');}
   compare(snapshot(h),expected());
   assert.ok(!/NaN|undefined/.test(h.elements.get('trace').attrs.d));
 });
});
test('local scripts load in order; controls, tuning and default settings still work',()=>{
 assert.ok(files.html.indexOf('src="physics.js"')<files.html.indexOf('src="app.js"'));
 const h=host();assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 h.settings('topFallingSpeed',1,'MOTION');assert.equal(h.run('session.getState().config.motion.topFallingSpeed'),1);
 h.settings('kickStrengthPercent',30,'MOTION');assert.equal(h.run('session.getState().config.motion.kickStrengthPercent'),30);
 assert.equal(h.run("tuningInputs.find(v=>v.key==='bottomToTopMultiplier').input.value"),'10');
 h.settings('bottomToTopMultiplier',2,'MOTION');assert.equal(h.run('session.getState().config.motion.bottomToTopMultiplier'),2);
 h.settings('jumpEase',12,'TUNE');assert.equal(h.run('session.getState().config.bounds.responseRate'),12);
 h.settings('initialCount',3,'UNLOCK');assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 h.click('reset');assert.equal(h.run('words.filter(w=>w.unlocked).length'),3);
 h.click('tuning-defaults');h.click('reset');
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 assert.equal(h.run('session.getState().config.motion.topFallingSpeed'),1);
 assert.equal(h.run('session.getState().config.motion.kickStrengthPercent'),50);
 assert.equal(h.run("tuningInputs.some(v=>v.key==='baseKick'||v.key==='baseFallingSpeed')"),false);
});
test('progress keeps full history, raw endpoint, percentages and visual-only smoothing',()=>{
 const h=host();h.advance(.1);h.retrieve();h.advance(.15);
 assert.ok(h.run('progressValue')>0);
 const lifted=h.run('progressValue');h.advance(20);assert.ok(h.run('progressValue')<lifted);
 h.click('reset');for(let i=0;i<2400;i++)h.advance(.25);
 assert.equal(h.run('activeTime'),600);assert.equal(h.run('observationTimes[0]'),0);
 assert.ok(h.run('observations.length')>=2401);
 const original=h.run('JSON.stringify([observations,observationTimes])');h.run('plottedHistory()');
 assert.equal(h.run('JSON.stringify([observations,observationTimes])'),original);
 assert.equal(h.elements.get('trace-percentage').textContent,h.run("progressValue.toFixed(1)+'%'"));
 assert.ok(h.run('nodes[0].streak.textContent.endsWith("%")'));
 h.click('pause');const saved=h.run('JSON.stringify(session.getState())');h.advance(50);h.retrieve();
 assert.equal(h.run('JSON.stringify(session.getState())'),saved);
});
test('completion ghosting, modal stats, review and replay remain functional',()=>{
 const h=host();for(let i=0;i<300 && !h.run('sessionComplete');i++){h.advance(.1);h.retrieve();}
 h.advance(1);assert.ok(h.run('sessionComplete && paused'));
 assert.ok(h.run('nodes.every(n=>n.aboveFinish)'));
 assert.equal(h.elements.get('trace-percentage').textContent,'100.0%');
 assert.ok(h.elements.get('completion-screen').open);
 assert.equal(h.elements.get('completion-count').textContent,String(h.run('count')));
 assert.equal(h.elements.get('completion-word-count').textContent,'10');
 h.click('completion-review');assert.ok(!h.elements.get('completion-screen').open);
 const saved=h.run('JSON.stringify(session.getState())');h.advance(100);h.retrieve(false);
 assert.equal(h.run('JSON.stringify(session.getState())'),saved);
 h.click('completion-again');assert.ok(h.run('!paused && !sessionComplete'));
 assert.equal(h.run('observations.length'),1);assert.equal(h.run('progressValue'),0);
});

test('normalized positions render at the unchanged SVG coordinates and Tune uses percentages',()=>{
 const h=host();
 assert.equal(h.run('words[0].depth'),0);
 assert.equal(h.run('nodes[0].edge.attrs.y1'),502);
 compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 compare(Number(h.elements.get('completion-line').attrs.y1),104.2);
 compare(h.run('screenY(100)'),60);
 h.advance(2);h.retrieve();h.advance(.2);
 compare(h.run('nodes[0].edge.attrs.y1'),h.run('502-words[0].shown*442/100'));
 assert.ok(h.elements.get('feedback').textContent.includes('pp'));
 h.settings('threshold',50,'UNLOCK');compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 h.settings('threshold',96,'FINISH');compare(Number(h.elements.get('completion-line').attrs.y1),77.68);
 h.settings('threshold',99,'UNLOCK');assert.equal(h.run('UNLOCK.threshold'),50);
 h.click('tuning-defaults');
 compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 compare(Number(h.elements.get('completion-line').attrs.y1),104.2);
});

test('hint display, Escape skip, successful counters, and removal of mistakes',()=>{
 const h=host();h.settings('kickStrengthPercent',1,'MOTION'); // isolate prompt timing from unlocking
 h.advance(1.9);assert.equal(h.elements.get('target-hint').hidden,true);
 h.advance(.1);assert.equal(h.elements.get('target-hint').hidden,false);
 assert.ok(h.elements.get('target-hint').textContent.includes('río'));
 h.retrieve();assert.equal(h.run('lastMeasurement.multiplier'),.5);
 assert.equal(h.elements.get('target-hint').hidden,true);
 const count=h.run('count'),depth=h.run('words[0].depth');
 h.key('Backspace');assert.equal(h.run('count'),count);assert.equal(h.run('words[0].depth'),depth);
 h.key('Escape');assert.equal(h.run('count'),count);assert.equal(h.run('session.getState().skipCount'),1);
 assert.equal(h.run('words[0].depth'),depth);assert.equal(h.elements.get('target-hint').hidden,true);
 assert.ok(h.elements.get('feedback').textContent.includes('skipped / no kick'));
 assert.ok(h.elements.get('prompt').textContent.includes('ESC = SKIP'));
 h.advance(1.9);h.click('pause');h.advance(10);assert.equal(h.elements.get('target-hint').hidden,true);
 h.click('pause');h.advance(.1);assert.equal(h.elements.get('target-hint').hidden,false);
 h.click('reset');assert.equal(h.run('session.getState().skipCount'),0);assert.equal(h.elements.get('target-hint').hidden,true);
});


test('prototype applies engine retrieval-time multipliers and reports the unaided bonus',()=>{
 const h=host();h.settings('kickStrengthPercent',1,'MOTION');
 for(const [seconds,multiplier] of [[0,2],[.5,1.75],[1,1.5],[1.5,1.25],[2,.5],[10,.5]]){
  h.click('reset');h.advance(seconds);h.retrieve();
  compare(h.run('lastMeasurement.multiplier'),multiplier);
  compare(h.run('lastMeasurement.kickTime'),h.run('MunduPhysics.fieldFallTime(session.getState().config)')*multiplier/100);
  compare(h.run('MunduPhysics.timeCoordinate(words[0].depth,session.getState().config)'),h.run('lastMeasurement.kickTime'));
  assert.ok(h.elements.get('feedback').textContent.includes(seconds<2?multiplier.toFixed(2)+'× kick':'half kick'));
 }
});


test('word percentages use field height, matching Tune and the fade threshold',()=>{
 const h=host();h.settings('threshold',95,'FINISH');
 for(const [depth,shown,label,faded] of [[90.25,90.25,'90%',false],[94.05,94.05,'94%',false],[95,95,'95%',false],[95.01,95.01,'95%',true],[100,94,'94%',false]]){
  h.run(`{const saved=session.getState();saved.words[0].depth=${depth};saved.words[0].shown=${shown};session.restore(saved);syncSession();render(0);}`);
  assert.equal(h.run('nodes[0].streak.textContent'),label);
  assert.equal(h.run('nodes[0].aboveFinish'),faded);
 }
 h.click('reset');assert.equal(h.run('nodes[0].streak.textContent'),'0%');
});

test('Tune exposes % of field, supports above 100%, and keeps strength on speed changes',()=>{
 const h=host();assert.equal(h.run("tuningInputs.some(v=>v.key==='kickCompensationSeconds')"),false);
 assert.equal(h.run("tuningInputs.find(v=>v.key==='kickStrengthPercent').input.value"),'50');
 h.settings('kickStrengthPercent',150,'MOTION');
 const initial=h.run('MunduPhysics.baselineKickTime(session.getState().config)');
 h.settings('topFallingSpeed',2,'MOTION');
 assert.equal(h.run('session.getState().config.motion.kickStrengthPercent'),150);
 compare(h.run('MunduPhysics.baselineKickTime(session.getState().config)'),initial/2);
 h.settings('bottomToTopMultiplier',3,'MOTION');
 assert.equal(h.run('session.getState().config.motion.kickStrengthPercent'),150);
 compare(h.run('MunduPhysics.baselineKickTime(session.getState().config)'),h.run('MunduPhysics.fieldFallTime(session.getState().config)')*1.5);
 h.click('tuning-defaults');h.click('reset');
 assert.equal(h.run('session.getState().config.motion.kickStrengthPercent'),50);
});
