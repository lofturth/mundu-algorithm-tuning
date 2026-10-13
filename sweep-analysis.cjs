'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Sweep=require('./parameter-sweep.cjs');
const Simulator=require('./simulator.cjs');
function neighbors(configs){
 const edges=[];
 for(let i=0;i<configs.length;i++)for(let j=i+1;j<configs.length;j++){
  const a=configs[i],b=configs[j],changed=Object.keys(Sweep.RANGES).filter(k=>a[k]!==b[k]);
  if(changed.length!==1)continue;
  const axis=changed[0],values=Sweep.RANGES[axis];
  if(Math.abs(values.indexOf(a[axis])-values.indexOf(b[axis]))===1)edges.push({a:a.id,b:b.id,axis});
 }
 return edges;
}
function analyze(data){
 const configs=data.summary.byConfiguration,map=new Map(configs.map(c=>[c.id,c]));
 const edges=neighbors(configs).map(e=>({...e,aCompleted:map.get(e.a).completed,bCompleted:map.get(e.b).completed,
  change:map.get(e.b).completed-map.get(e.a).completed}));
 const marginals=Object.fromEntries(Object.entries(Sweep.RANGES).map(([axis,values])=>[axis,values.map(value=>({value,
  configurations:configs.filter(c=>c[axis]===value).length,...Sweep.aggregate(data.results.filter(r=>r[axis]===value))}))]));
 return {marginals,adjacentPairs:edges.length,edges,
  scenarioBoundaries:data.summary.byScenario.map(s=>({...s,
   configurationsPassingNecessaryTopMargin:configs.filter(c=>(s.wordCount-1)*s.intervalSeconds*c.topSpeed<100-c.completion).length})),
  sampleCounts:Object.fromEntries(Object.entries(marginals).map(([axis,rows])=>[axis,rows.map(r=>({value:r.value,count:r.configurations}))]))};
}
function detailReport(data){
 const lines=['# Complete results by physics configuration','',
  `Cells: completed = mm:ss.ss / successful retrievals; unfinished = U / retrievals / unlocked words / final progress%. Every U reached the ${data.metadata.maxTimeSeconds}-second limit.`,
  'Positions and completion thresholds are percentages; kicks are percentage points; falling speeds are percentage points/second.',''];
 for(const c of data.summary.byConfiguration){
  lines.push(`## ${c.id}: kick ${c.kick}, top ${c.topSpeed}, bottom ${c.bottomSpeed}, completion ${c.completion}%`,'',
   '| Words | Every 2 s | Every 5 s | Every 10 s | Every 15 s |','|---:|---|---|---|---|');
  for(const n of Simulator.EXPERIMENTS.wordCounts){
   lines.push(`| ${n} | `+Simulator.EXPERIMENTS.intervals.map(t=>{
    const r=data.results.find(r=>r.configurationId===c.id&&r.wordCount===n&&r.intervalSeconds===t);
    return r.status==='Completed'?`${Simulator.formatTime(r.completionTimeSeconds)} / ${r.successfulRetrievals}`:
      `U / ${r.successfulRetrievals} / ${r.unlockedWords} / ${r.finalProgress.toFixed(2)}%`;
   }).join(' | ')+' |');
  }
  lines.push('');
 }
 return lines.join('\n');
}
if(require.main===module){
 const dir=path.resolve(process.argv[2]??path.join(__dirname,'sweep-results'));
 const data=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'));
 fs.writeFileSync(path.join(dir,'analysis.json'),JSON.stringify(analyze(data),null,2)+'\n');
 fs.writeFileSync(path.join(dir,'configuration-details.md'),detailReport(data));
 console.log('Saved neighbor analysis and complete configuration tables.');
}
module.exports={neighbors,analyze,detailReport};
