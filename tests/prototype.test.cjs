const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeHost}=require('./dom-harness.cjs');
const fixtures=require('./legacy-fixtures.json');
const base=path.join(__dirname,'..');
const files={html:fs.readFileSync(path.join(base,'index.html'),'utf8'),app:fs.readFileSync(path.join(base,'app.js'),'utf8'),physics:fs.readFileSync(path.join(base,'physics.js'),'utf8')};
function host(options={}){return makeHost({...files,...options});}
function compare(actual,expected){
 if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
 else if(expected && typeof expected==='object')for(const key of Object.keys(expected))compare(actual[key],expected[key]);
 else assert.equal(actual,expected);
}
const snapshot=h=>JSON.parse(h.run(`JSON.stringify({time:activeTime,paused,complete:sessionComplete,selectedIndex:session.getState().selectedIndex,selectedAt:session.getState().selectedAt,retrievalCount:count,progress:progressValue,words:words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])})`));
for(const fixture of fixtures)test(`prototype/legacy parity: initial=${fixture.options.initialCount}, instant=${fixture.options.instantPosition}`,()=>{
 const h=host({instantPosition:fixture.options.instantPosition});
 h.run(`UNLOCK.initialCount=${fixture.options.initialCount};reset();`);
 compare(snapshot(h),fixture.initial);
 fixture.actions.forEach((action,i)=>{
   if(action.type==='advance')h.advance(action.seconds);
   else if(action.type==='retrieve')h.retrieve(action.correct);
   else h.click('pause');
   compare(snapshot(h),fixture.expected[i]);
   assert.ok(!/NaN|undefined/.test(h.elements.get('trace').attrs.d));
 });
});
test('local scripts load in order; controls, tuning and default settings still work',()=>{
 assert.ok(files.html.indexOf('src="physics.js"')<files.html.indexOf('src="app.js"'));
 const h=host();assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 h.settings('maxSpeed',35,'GRAVITY');assert.equal(h.run('session.getState().config.gravity.maxSpeed'),35);
 h.settings('maxLift',200,'KICK');assert.equal(h.run('session.getState().config.kick.maxLift'),200);
 h.settings('jumpEase',12,'TUNE');assert.equal(h.run('session.getState().config.bounds.responseRate'),12);
 h.settings('initialCount',3,'UNLOCK');assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 h.click('reset');assert.equal(h.run('words.filter(w=>w.unlocked).length'),3);
 h.click('tuning-defaults');h.click('reset');
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 assert.equal(h.run('session.getState().config.gravity.maxSpeed'),30);
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
