(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MunduExplorer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const AXES=['kick','topSpeed','bottomSpeed','completion'];
  function createModel(data){
    if(!data?.metadata?.ranges||!Array.isArray(data.configurations)||!Array.isArray(data.results))throw Error('Invalid sweep data');
    const configs=new Map(data.configurations.map(c=>[c.id,c]));
    const rows=new Map([...configs.keys()].map(id=>[id,[]]));
    for(const row of data.results){
      if(!rows.has(row.configurationId))throw Error('Unknown configuration in results');
      rows.get(row.configurationId).push(row);
    }
    return {data,configs,rows};
  }
  function matches(row,filters){
    return (filters.wordCount==='all'||row.wordCount===Number(filters.wordCount))&&
      (filters.intervalSeconds==='all'||row.intervalSeconds===Number(filters.intervalSeconds));
  }
  function median(values){
    if(!values.length)return null;
    const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
  }
  function aggregate(rows){
    const completed=rows.filter(r=>r.status==='Completed');
    return {total:rows.length,completed:completed.length,unfinished:rows.length-completed.length,
      rate:rows.length?completed.length/rows.length:null,
      effort:median(completed.map(r=>r.successfulRetrievals/r.wordCount)),
      time:median(completed.map(r=>r.completionTimeSeconds))};
  }
  function selectConfiguration(model,id){
    const config=model.configs.get(id);
    return config?{config,rows:[...model.rows.get(id)].sort((a,b)=>a.wordCount-b.wordCount||a.intervalSeconds-b.intervalSeconds),
      summary:aggregate(model.rows.get(id))}:null;
  }
  function points(model,filters){
    return [...model.configs.values()].filter(c=>c.completion===Number(filters.completion)).map(config=>{
      const scenarios=model.rows.get(config.id).filter(r=>matches(r,filters));
      return {config,scenarios,...aggregate(scenarios)};
    });
  }
  function metric(point,key){return key==='rate'?point.rate:key==='effort'?point.effort:point.time;}
  function metricDomain(points,key){
    if(key==='rate')return [0,1];
    const values=points.map(p=>metric(p,key)).filter(v=>v!==null);
    return values.length?[Math.min(...values),Math.max(...values)]:[0,1];
  }
  function neighbors(model,id,filters){
    const center=model.configs.get(id);if(!center)return [];
    const output=[];
    for(const axis of AXES){
      const values=model.data.metadata.ranges[axis],index=values.indexOf(center[axis]);
      for(const offset of [-1,1]){
        if(index+offset<0||index+offset>=values.length)continue;
        const candidate={...center,[axis]:values[index+offset]};
        if(candidate.bottomSpeed<candidate.topSpeed)continue;
        const found=[...model.configs.values()].find(c=>AXES.every(k=>c[k]===candidate[k]));
        output.push({axis,value:candidate[axis],tested:!!found,id:found?.id??null,parameters:AXES.map(k=>candidate[k]),
          summary:found?aggregate(model.rows.get(found.id).filter(r=>matches(r,filters))):null});
      }
    }
    return output;
  }
  function effortSeries(model,id){
    const selection=selectConfiguration(model,id);if(!selection)return [];
    return model.data.metadata.intervals.map(intervalSeconds=>({intervalSeconds,
      points:model.data.metadata.wordCounts.map(wordCount=>{
        const row=selection.rows.find(r=>r.wordCount===wordCount&&r.intervalSeconds===intervalSeconds);
        return {wordCount,value:row?.status==='Completed'?row.successfulRetrievals/wordCount:null,status:row?.status??'Missing'};
      })}));
  }
  return {AXES,createModel,matches,median,aggregate,selectConfiguration,points,metric,metricDomain,neighbors,effortSeries};
});
