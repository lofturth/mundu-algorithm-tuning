'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const crypto=require('node:crypto');
const Physics=require('./physics.js');
const Simulator=require('./simulator.cjs');
const RANGES=Object.freeze({kick:[15,25,35,45,55],topSpeed:[.1,.3,.5,.7,1],bottomSpeed:[.5,1,1.5,2,3],completion:[60,70,80,90]});
const DEFAULTS=Object.freeze({sampleCount:150,seed:20261012,maxTimeSeconds:3600,stepSeconds:1/60});
function combinations(){
 const configs=[];
 for(const kick of RANGES.kick)for(const topSpeed of RANGES.topSpeed)for(const bottomSpeed of RANGES.bottomSpeed)for(const completion of RANGES.completion){
  if(bottomSpeed<topSpeed)continue;
  configs.push({id:'C'+String(configs.length+1).padStart(3,'0'),kick,topSpeed,bottomSpeed,completion});
 }
 return configs;
}
function selectConfigurations(configs,count=DEFAULTS.sampleCount,seed=DEFAULTS.seed){
 if(!Number.isInteger(count)||count<1||count>configs.length)throw new RangeError('Invalid sample count');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be a uint32');
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const shuffled=[...configs];
 for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
 return shuffled.slice(0,count).sort((a,b)=>a.id.localeCompare(b.id));
}
function physicsConfig(c){
 return {kick:{maxLift:c.kick},gravity:{minSpeed:c.topSpeed,maxSpeed:c.bottomSpeed},finish:{threshold:c.completion}};
}
function runCase(c,wordCount,intervalSeconds,options={}){
 if(Physics.MODEL)throw new Error('Legacy parameter sweep is incompatible with the current shared-linear physics model. Existing saved results remain historical; no sweep was run.');
 const result=Simulator.runSimulation({wordCount,intervalSeconds,stepSeconds:options.stepSeconds??DEFAULTS.stepSeconds,
  maxTimeSeconds:options.maxTimeSeconds??DEFAULTS.maxTimeSeconds,physicsConfig:physicsConfig(c)});
 const session=Physics.restoreSession(result.finalState);
 return {configurationId:c.id,kick:c.kick,topSpeed:c.topSpeed,bottomSpeed:c.bottomSpeed,completion:c.completion,
  wordCount,intervalSeconds,successfulRetrievals:result.successfulRetrievals,
  completionTimeSeconds:result.completionTimeSeconds,elapsedSeconds:result.elapsedSeconds,status:result.status,
  stopReason:result.stopReason,unlockedWords:result.finalState.words.filter(w=>w.unlocked).length,
  finalProgress:session.getProgress()};
}
function aggregate(rows){
 const completed=rows.filter(r=>r.status==='Completed');
 const values=completed.map(r=>r.successfulRetrievals/r.wordCount).sort((a,b)=>a-b);
 return {runs:rows.length,completed:completed.length,completionRate:rows.length?completed.length/rows.length:0,
  completedRetrievalsPerWord:values.length?{min:values[0],median:values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2,max:values.at(-1)}:null};
}
function summarize(configs,rows){
 return {overall:aggregate(rows),byScenario:Simulator.EXPERIMENTS.wordCounts.flatMap(wordCount=>Simulator.EXPERIMENTS.intervals.map(intervalSeconds=>
  ({wordCount,intervalSeconds,...aggregate(rows.filter(r=>r.wordCount===wordCount&&r.intervalSeconds===intervalSeconds))}))),
  byConfiguration:configs.map(c=>{const group=rows.filter(r=>r.configurationId===c.id);return {...c,...aggregate(group),
   byWordCount:Simulator.EXPERIMENTS.wordCounts.map(wordCount=>({wordCount,...aggregate(group.filter(r=>r.wordCount===wordCount))})),
   byInterval:Simulator.EXPERIMENTS.intervals.map(intervalSeconds=>({intervalSeconds,...aggregate(group.filter(r=>r.intervalSeconds===intervalSeconds))}))};})};
}
function benchmark(configs,options={}){
 // Includes slow/fast gravity and low/high finish margins, with both dataset extremes.
 const probes=[{kick:15,topSpeed:1,bottomSpeed:3,completion:90},{kick:55,topSpeed:.1,bottomSpeed:.5,completion:60},
  configs[0],configs[Math.floor(configs.length/2)]];
 const start=performance.now(),results=[];
 for(const c of probes)for(const [n,t] of [[5,2],[30,15]])results.push(runCase({...c,id:'benchmark'},n,t,options));
 const seconds=(performance.now()-start)/1000;
 return {probeRuns:results.length,wallSeconds:seconds,estimatedSweepSeconds:seconds/results.length*configs.length*24,
  note:'Rough serial estimate; probe completion mix and active-word counts affect runtime.',results};
}
function csv(rows){
 const keys=Object.keys(rows[0]??{});
 return [keys.join(','),...rows.map(r=>keys.map(k=>r[k]===null?'':r[k]).join(','))].join('\n')+'\n';
}
function report(data){
 const s=data.summary,m=data.metadata;
 const lines=['# Mündu parameter-space sweep','',
  `${m.sampleCount} of ${m.validConfigurations} valid configurations; ${data.results.length} runs. Seed ${m.seed}.`,
  `Limit ${m.maxTimeSeconds} simulated seconds/run; timestep ${m.stepSeconds} seconds (60 Hz by default).`,
  `NEW WORDS = ${m.engineDefaults.unlock.threshold}%; initial active words = ${m.engineDefaults.unlock.initialCount}.`,
  'Ranges: kick 15/25/35/45/55 pp; top speed 0.1/0.3/0.5/0.7/1.0 pp/s; bottom speed 0.5/1/1.5/2/3 pp/s; completion 60/70/80/90%.',
  'Only bottom >= top is admitted. Full seeded Fisher–Yates shuffle followed by sampling without replacement; no physics-based ranking.',
  `Actual sweep runtime: ${m.wallSeconds.toFixed(2)} seconds. ${s.overall.completed}/${s.overall.runs} runs completed (${(100*s.overall.completionRate).toFixed(1)}%).`,'',
  '## Completion by vocabulary size and retrieval interval','',
  '| Words | 2 s | 5 s | 10 s | 15 s |','|---:|---:|---:|---:|---:|'];
 for(const n of Simulator.EXPERIMENTS.wordCounts)lines.push(`| ${n} | `+Simulator.EXPERIMENTS.intervals.map(t=>{
  const r=s.byScenario.find(r=>r.wordCount===n&&r.intervalSeconds===t);return `${r.completed}/${r.runs} (${(100*r.completionRate).toFixed(1)}%)`;
 }).join(' | ')+' |');
 lines.push('','## Every sampled configuration','',
  'Retrieval effort is shown only for completed runs. Unfinished runs are censored at the time limit; their retrieval totals are not completion effort. Full per-run results are in results.csv/results.json.',
  '', '| ID | Kick | Top | Bottom | Finish | Completed / 24 | Retrievals/word min–median–max | Completed by interval (2/5/10/15 s) |',
  '|---|---:|---:|---:|---:|---:|---|---|');
 for(const c of s.byConfiguration){const e=c.completedRetrievalsPerWord;lines.push(`| ${c.id} | ${c.kick} | ${c.topSpeed} | ${c.bottomSpeed} | ${c.completion}% | ${c.completed}/24 | ${e?[e.min,e.median,e.max].map(v=>v.toFixed(2)).join(' / '):'—'} | ${c.byInterval.map(r=>r.completed+'/6').join(' / ')} |`);}
 return lines.join('\n')+'\n';
}
function parseArgs(args){
 const options={...DEFAULTS,out:path.join(__dirname,'sweep-results')};let mode='run';
 for(let i=0;i<args.length;i++){
  if(args[i]==='--benchmark'){mode='benchmark';continue;}
  const keys={'--samples':'sampleCount','--seed':'seed','--limit':'maxTimeSeconds','--step':'stepSeconds','--out':'out'};
  const key=keys[args[i]];if(!key||args[i+1]===undefined)throw Error('Unknown or missing argument: '+args[i]);
  options[key]=key==='out'?path.resolve(args[++i]):Number(args[++i]);
 }
 for(const k of ['maxTimeSeconds','stepSeconds'])if(!Number.isFinite(options[k])||options[k]<=0)throw RangeError(k+' must be positive');
 return {options,mode};
}
function main(args){
 const {options,mode}=parseArgs(args),valid=combinations(),configs=selectConfigurations(valid,options.sampleCount,options.seed);
 if(mode==='benchmark'){console.log(JSON.stringify(benchmark(configs,options),null,2));return;}
 const results=[],start=performance.now();
 for(const [i,c] of configs.entries()){
  for(const n of Simulator.EXPERIMENTS.wordCounts)for(const t of Simulator.EXPERIMENTS.intervals)results.push(runCase(c,n,t,options));
  if((i+1)%10===0||i+1===configs.length)console.log(`${i+1}/${configs.length} configurations; ${results.length} runs; ${((performance.now()-start)/1000).toFixed(1)} s`);
 }
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'physics.js'))).digest('hex');
 const data={metadata:{...options,validConfigurations:valid.length,ranges:RANGES,wordCounts:Simulator.EXPERIMENTS.wordCounts,
  intervals:Simulator.EXPERIMENTS.intervals,engineDefaults:Physics.DEFAULTS,physicsSha256:hash,wallSeconds:(performance.now()-start)/1000},
  configurations:configs.map(c=>({...c,effectivePhysics:Physics.createSession({wordCount:1,config:physicsConfig(c)}).getState().config})),
  results,summary:summarize(configs,results)};
 fs.mkdirSync(options.out,{recursive:true});
 fs.writeFileSync(path.join(options.out,'results.json'),JSON.stringify(data,null,2)+'\n');
 fs.writeFileSync(path.join(options.out,'results.csv'),csv(results));
 fs.writeFileSync(path.join(options.out,'summary.md'),report(data));
 console.log(`Saved ${results.length} runs in ${options.out}`);
}
if(require.main===module)main(process.argv.slice(2));
module.exports={RANGES,DEFAULTS,combinations,selectConfigurations,physicsConfig,runCase,aggregate,summarize,benchmark,csv,report,parseArgs};
