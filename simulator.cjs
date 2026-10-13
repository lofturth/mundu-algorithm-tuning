'use strict';
const Physics = require('./physics.js');

const EXPERIMENTS = Object.freeze({
  wordCounts:Object.freeze([5,10,15,20,25,30]),
  intervals:Object.freeze([2,5,10,15]),
  stepSeconds:1/60,
  maxTimeSeconds:3600
});

// The shared engine uses positions/lifts in percent, speeds in percentage
// points per second; scheduling needs no coordinate conversion.
// Fixed 60 Hz model updates preserve settling, selected-word response timing,
// unlocking and completion checks between answers. The first answer is due
// after one full interval. The original grid uses untouched physics defaults;
// the separate parameter explorer may supply an explicit physicsConfig patch.
function runSimulation({wordCount,intervalSeconds,
  stepSeconds=EXPERIMENTS.stepSeconds,maxTimeSeconds=EXPERIMENTS.maxTimeSeconds,physicsConfig}={}) {
  if (!Number.isInteger(wordCount) || wordCount<1) throw new RangeError('wordCount must be a positive integer');
  for (const [key,value] of Object.entries({intervalSeconds,stepSeconds,maxTimeSeconds})) {
    if (!Number.isFinite(value) || value<=0) throw new RangeError(key+' must be finite and positive');
  }
  const session=Physics.createSession(physicsConfig===undefined?{wordCount}:{wordCount,config:physicsConfig});
  let elapsed=0,answerNumber=1;
  while (!session.isComplete() && elapsed<maxTimeSeconds) {
    const deadline=Math.min(answerNumber*intervalSeconds,maxTimeSeconds);
    // Deadline stepping avoids accumulating answer-schedule drift, while each
    // model update is still an ordinary call to the real engine's advance().
    while (!session.isComplete() && elapsed<deadline) {
      const remaining=deadline-elapsed;
      const dt=Math.min(stepSeconds,remaining);
      session.advance(dt);
      elapsed+=dt;
      if (remaining<=stepSeconds) elapsed=deadline;
    }
    if (session.isComplete()) break;
    if (answerNumber*intervalSeconds<=maxTimeSeconds) {
      session.retrieve(); // The engine itself selects the lowest active word.
      answerNumber++;
    } else break;
  }
  const state=session.getState();
  return {
    wordCount,intervalSeconds,successfulRetrievals:state.retrievalCount,
    completionTimeSeconds:state.complete?state.time:null,
    elapsedSeconds:state.time,status:state.complete?'Completed':'Unfinished',
    stopReason:state.complete?'completed':'time-limit',stepSeconds,maxTimeSeconds,
    finalState:state
  };
}
function runExperiments() {
  return EXPERIMENTS.wordCounts.flatMap(wordCount=>EXPERIMENTS.intervals.map(intervalSeconds=>
    runSimulation({wordCount,intervalSeconds})));
}
function formatTime(seconds) {
  if (seconds===null) return '—';
  const centiseconds=Math.round(seconds*100);
  const minutes=Math.floor(centiseconds/6000);
  const remainder=(centiseconds%6000)/100;
  return String(minutes).padStart(2,'0')+':'+remainder.toFixed(2).padStart(5,'0');
}
function table(headers,rows) {
  const values=rows.map(row=>row.map(String));
  const widths=headers.map((header,i)=>Math.max(header.length,...values.map(row=>row[i].length)));
  const line=row=>row.map((cell,i)=>String(cell).padEnd(widths[i])).join('  ');
  return [line(headers),widths.map(width=>'-'.repeat(width)).join('  '),...values.map(line)].join('\n');
}
function formatReport(results) {
  const lines=[
    'Mündu deterministic simulations — default physics',
    `Update step: ${EXPERIMENTS.stepSeconds.toFixed(8)} s (60 Hz); limit: ${formatTime(EXPERIMENTS.maxTimeSeconds)} simulated time.`,
    'Completion time is measured at the first update where the real engine reports completion.',
    'An unfinished run has no completion time; elapsed time is the simulation limit.',
    '',
    table(['Words','Interval (s)','Successes','Completion','Elapsed','Status'],results.map(result=>[
      result.wordCount,result.intervalSeconds,result.successfulRetrievals,formatTime(result.completionTimeSeconds),
      formatTime(result.elapsedSeconds),result.status])),
    '',
    'SUMMARY BY RETRIEVAL INTERVAL'
  ];
  for (const intervalSeconds of EXPERIMENTS.intervals) {
    const group=results.filter(result=>result.intervalSeconds===intervalSeconds);
    lines.push('',`Every ${intervalSeconds} seconds — ${group.filter(result=>result.status==='Completed').length}/${group.length} completed`,
      table(['Words','Successes','Completion','Status'],group.map(result=>[
        result.wordCount,result.successfulRetrievals,formatTime(result.completionTimeSeconds),result.status])));
  }
  return lines.join('\n');
}
if (require.main===module) console.log(formatReport(runExperiments()));
module.exports={EXPERIMENTS,runSimulation,runExperiments,formatReport,formatTime};
