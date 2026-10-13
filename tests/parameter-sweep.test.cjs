const test=require('node:test'),assert=require('node:assert/strict');
const Sweep=require('../parameter-sweep.cjs');
const Physics=require('../physics.js');
const Simulator=require('../simulator.cjs');
const saved=require('../sweep-results/results.json');
test('legacy valid grid and seeded sample remain reproducible without rerunning it',()=>{
 const valid=Sweep.combinations();assert.equal(valid.length,460);assert.ok(valid.every(c=>c.bottomSpeed>=c.topSpeed));
 const first=Sweep.selectConfigurations(valid);assert.deepEqual(first,Sweep.selectConfigurations(valid));assert.equal(first.length,150);
 assert.equal(new Set(first.map(c=>c.id)).size,150);assert.notDeepEqual(first,valid.slice(0,150));
 for(const [key,values] of Object.entries(Sweep.RANGES))for(const value of values)assert.ok(first.some(c=>c[key]===value));
});
test('obsolete parameter sweep cannot silently run old ranges against the new physics',()=>{
 assert.throws(()=>Sweep.runCase({id:'legacy',kick:55,topSpeed:.1,bottomSpeed:.5,completion:60},5,2,{maxTimeSeconds:1}),/Legacy parameter sweep is incompatible/);
});
test('simulator overrides use the real new model while preserving engine defaults',()=>{
 const defaults=JSON.stringify(Physics.DEFAULTS);
 const result=Simulator.runSimulation({wordCount:2,intervalSeconds:.1,maxTimeSeconds:10,
  physicsConfig:{motion:{kickHeightPercent:55,topFallingSpeed:.5,bottomToTopMultiplier:2}}});
 assert.deepEqual(result.finalState.config.motion,{kickHeightPercent:55,topFallingSpeed:.5,bottomToTopMultiplier:2,gravityReductionPercent:5});
 assert.deepEqual(result.finalState.config.unlock,Physics.DEFAULTS.unlock);assert.equal(result.finalState.model,Physics.MODEL);
 assert.equal(result.status,'Completed');assert.equal(JSON.stringify(Physics.DEFAULTS),defaults);
});
test('historical completed and censored summaries still reflect the saved results',()=>{
 const config=saved.configurations.find(c=>c.id==='C283'),rows=saved.results.filter(r=>r.configurationId===config.id);
 assert.equal(rows.length,24);const summary=Sweep.aggregate(rows);assert.equal(summary.completed,16);
 assert.equal(summary.completedRetrievalsPerWord.min,2);
 assert.equal(Sweep.aggregate(rows.filter(r=>r.status==='Unfinished')).completedRetrievalsPerWord,null);
 assert.ok(Sweep.csv(rows).includes('Unfinished'));
});
test('sampling and schedule CLI reject invalid inputs',()=>{
 assert.equal(Sweep.parseArgs(['--limit','120']).options.maxTimeSeconds,120);
 for(const count of [0,-1,461,1.5])assert.throws(()=>Sweep.selectConfigurations(Sweep.combinations(),count),RangeError);
 assert.throws(()=>Sweep.parseArgs(['--step','0']),RangeError);
});
test('region analysis counts only actual sampled adjacent grid neighbors',()=>{
 const {neighbors}=require('../sweep-analysis.cjs');const c={topSpeed:.1,bottomSpeed:.5,completion:60};
 assert.deepEqual(neighbors([{...c,id:'a',kick:25},{...c,id:'b',kick:35},{...c,id:'c',kick:55},{...c,id:'d',kick:35,completion:70}]),
 [{a:'a',b:'b',axis:'kick'},{a:'b',b:'d',axis:'completion'}]);
});
