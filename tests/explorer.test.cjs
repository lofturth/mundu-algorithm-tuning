const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../explorer/model.js');
const data=require('../sweep-results/results.json');
const model=M.createModel(data);
const all={completion:80,wordCount:'all',intervalSeconds:'all'};
test('saved sweep loads with all 150 configurations and 3600 recorded scenarios',()=>{
 assert.equal(model.configs.size,150);assert.equal(data.results.length,3600);
 for(const rows of model.rows.values())assert.equal(rows.length,24);
 assert.throws(()=>M.createModel({}),/Invalid sweep data/);
});
test('threshold and scenario filters expose exactly the selected recorded subset',()=>{
 for(const completion of [60,70,80,90]){
  const points=M.points(model,{...all,completion});
  assert.equal(points.length,data.configurations.filter(c=>c.completion===completion).length);
  assert.ok(points.every(p=>p.config.completion===completion&&p.total===24));
 }
 const one=M.points(model,{...all,wordCount:'10',intervalSeconds:'5'}).find(p=>p.config.id==='C283');
 assert.equal(one.total,1);assert.equal(one.completed,1);assert.equal(one.effort,2.4);
 assert.equal(one.time,data.results.find(r=>r.configurationId==='C283'&&r.wordCount===10&&r.intervalSeconds===5).completionTimeSeconds);
 assert.ok(M.points(model,{...all,wordCount:'10'}).every(p=>p.total===4));
 assert.ok(M.points(model,{...all,intervalSeconds:'5'}).every(p=>p.total===6));
});
test('aggregation equally weights scenarios and censors unfinished effort/time',()=>{
 const rows=[{status:'Completed',wordCount:5,successfulRetrievals:10,completionTimeSeconds:20},
 {status:'Completed',wordCount:10,successfulRetrievals:40,completionTimeSeconds:80},
 {status:'Unfinished',wordCount:5,successfulRetrievals:1800,completionTimeSeconds:null}];
 assert.deepEqual(M.aggregate(rows),{total:3,completed:2,unfinished:1,rate:2/3,effort:3,time:50});
 assert.deepEqual(M.aggregate([rows[2]]),{total:1,completed:0,unfinished:1,rate:0,effort:null,time:null});
 assert.equal(M.aggregate([]).rate,null);
 const p=M.points(model,all).find(p=>p.config.id==='C283');
 assert.equal(p.completed,16);assert.equal(p.unfinished,8);assert.equal(p.rate,16/24);
 assert.equal(M.metric(p,'effort'),p.effort);assert.deepEqual(M.metricDomain([p],'rate'),[0,1]);
});
test('selection always includes the full sorted 24-scenario record',()=>{
 const selected=M.selectConfiguration(model,'C094');assert.equal(selected.config.kick,25);
 assert.equal(selected.rows.length,24);assert.equal(selected.summary.completed,14);
 assert.deepEqual(selected.rows.slice(0,4).map(r=>r.intervalSeconds),[2,5,10,15]);
 assert.equal(M.selectConfiguration(model,'does-not-exist'),null);
});
test('neighborhood distinguishes tested adjacent combinations from valid untested ones',()=>{
 const neighbors=M.neighbors(model,'C283',all);
 assert.ok(neighbors.some(n=>n.tested&&n.id==='C191'));
 assert.ok(neighbors.some(n=>!n.tested&&n.summary===null&&n.id===null));
 for(const n of neighbors){
  const center=model.configs.get('C283');
  assert.equal(M.AXES.filter((key,i)=>center[key]!==n.parameters[i]).length,1);
  assert.ok(n.parameters[2]>=n.parameters[1]);
  if(n.tested)assert.equal(n.summary.total,24);
 }
 const filtered=M.neighbors(model,'C283',{...all,wordCount:'5',intervalSeconds:'2'});
 assert.ok(filtered.filter(n=>n.tested).every(n=>n.summary.total===1));
});
test('effort lines preserve unfinished gaps instead of connecting completion effort',()=>{
 const series=M.effortSeries(model,'C283');assert.equal(series.length,4);
 const ten=series.find(s=>s.intervalSeconds===10);
 assert.deepEqual(ten.points.map(p=>p.value),[2.8,3,65/15,null,null,null]);
 const fifteen=series.find(s=>s.intervalSeconds===15);
 assert.deepEqual(fifteen.points.map(p=>p.value),[3,null,null,null,null,null]);
 assert.equal(M.effortSeries(model,'missing').length,0);
});
test('browser entry loads local modules and saved data without importing simulation code',()=>{
 const dir=path.join(__dirname,'../explorer');const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 const app=fs.readFileSync(path.join(dir,'app.js'),'utf8');
 assert.ok(html.indexOf('src="model.js"')<html.indexOf('src="app.js"'));
 assert.ok(app.includes("fetch('../sweep-results/results.json')"));
 assert.ok(!html.includes('physics.js')&&!html.includes('simulator.cjs'));
 assert.ok(!app.includes('runSimulation')&&!app.includes('runExperiments'));
});
