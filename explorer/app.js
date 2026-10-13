'use strict';
const M=MunduExplorer;
const $=id=>document.getElementById(id);
const canvas=$('cloud'),context=canvas.getContext('2d');
const chart=$('effort-chart'),chartContext=chart.getContext('2d');
const COLORS=['#43e6ed','#ed4ca8','#a59aff','#f6c777'];
const AXIS_NAMES={kick:'Kick',topSpeed:'Top speed',bottomSpeed:'Bottom speed',completion:'Completion'};
let model,visible=[],selectedId=null,hoverId=null,projected=[];
let yaw=-.7,pitch=.38,zoom=1,viewScale=150,drawPending=false;
const pointers=new Map();let gestureStart=null,dragged=false;
const filters=()=>({completion:[60,70,80,90][Number($('threshold').value)],wordCount:$('words').value,
  intervalSeconds:$('interval').value});
const time=value=>{
  if(value===null)return '—';
  const total=Math.round(value*100),minutes=Math.floor(total/6000),seconds=(total%6000)/100;
  return String(minutes).padStart(2,'0')+':'+seconds.toFixed(2).padStart(5,'0');
};
const pct=rate=>rate===null?'—':(rate*100).toFixed(1)+'%';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function dimensions(element,ctx){
  const bounds=element.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
  const width=Math.round(bounds.width*ratio),height=Math.round(bounds.height*ratio);
  if(element.width!==width||element.height!==height){element.width=width;element.height=height;}
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return {width:bounds.width,height:bounds.height};
}
function project(p,width,height){
  const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
  const y=p[1]*Math.cos(pitch)-z*Math.sin(pitch),depth=p[1]*Math.sin(pitch)+z*Math.cos(pitch);
  const scale=viewScale*zoom*5/(5-depth);
  return {x:width*.5+x*scale,y:height*.49-y*scale,depth,scale};
}
function coordinates(config){
  return ['kick','topSpeed','bottomSpeed'].map(key=>{
    const values=model.data.metadata.ranges[key];return -1+2*(config[key]-values[0])/(values.at(-1)-values[0]);
  });
}
function line3(a,b,width,height,color,lineWidth=1){
  const pa=project(a,width,height),pb=project(b,width,height);
  context.strokeStyle=color;context.lineWidth=lineWidth;context.beginPath();context.moveTo(pa.x,pa.y);context.lineTo(pb.x,pb.y);context.stroke();
}
function label3(value,p,width,height,color='#8595af',size=10){
  const q=project(p,width,height);context.fillStyle=color;context.font=`${size}px ui-monospace, monospace`;
  context.textAlign='center';context.fillText(value,q.x,q.y);
}
function colorFor(point,key,domain){
  const value=M.metric(point,key);if(value===null)return '#828da3';
  const fraction=domain[1]===domain[0]?.5:(value-domain[0])/(domain[1]-domain[0]);
  // Low completion is warm; low effort/time is cyan. No ideal-difficulty ranking.
  const t=key==='rate'?fraction:1-fraction;
  const a=[246,161,106],b=[67,230,237];
  return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')})`;
}
function renderCloud(){
  const {width,height}=dimensions(canvas,context);context.clearRect(0,0,width,height);
  if(!model)return;
  // Fit the entire reachable cube and axis-label anchors at the default zoom.
  // Zooming in may intentionally crop it; rotation alone keeps the field in view.
  const anchors=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])anchors.push([x,y,z]);
  anchors.push([.05,-1.38,-1],[-1.2,1.2,-1],[-1.05,-1.38,.55],[-1.16,-1,-1],[-1.12,-1.12,1]);
  let extentX=0,extentY=0;
  for(const p of anchors){
    const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
    const y=p[1]*Math.cos(pitch)-z*Math.sin(pitch),depth=p[1]*Math.sin(pitch)+z*Math.cos(pitch);
    extentX=Math.max(extentX,Math.abs(x*5/(5-depth)));extentY=Math.max(extentY,Math.abs(y*5/(5-depth)));
  }
  viewScale=Math.min((width/2-55)/extentX,(height/2-50)/extentY);
  // Three walls, constant screen space apart; actual axis ticks use linear scales.
  for(let i=0;i<=4;i++){
    const v=-1+i*.5;
    line3([-1,-1,v],[1,-1,v],width,height,'#213045');
    line3([v,-1,-1],[v,-1,1],width,height,'#213045');
    line3([-1,v,-1],[-1,v,1],width,height,'#1c2739');
    line3([-1,-1,v],[-1,1,v],width,height,'#1c2739');
  }
  line3([-1,-1,-1],[1,-1,-1],width,height,'#66788e',1.3);
  line3([-1,-1,-1],[-1,1,-1],width,height,'#66788e',1.3);
  line3([-1,-1,-1],[-1,-1,1],width,height,'#66788e',1.3);
  for(const value of model.data.metadata.ranges.kick){const x=-1+2*(value-15)/40;label3(value+'%', [x,-1.13,-1],width,height);}
  for(const value of model.data.metadata.ranges.topSpeed){const y=-1+2*(value-.1)/.9;label3(value.toFixed(1),[-1.16,y,-1],width,height);}
  for(const value of model.data.metadata.ranges.bottomSpeed){const z=-1+2*(value-.5)/2.5;label3(value.toFixed(1),[-1.12,-1.12,z],width,height);}
  label3('X · KICK (%)',[.05,-1.38,-1],width,height,'#c5d5e6',11);
  label3('Y · TOP SPEED (pp/s)',[-1.2,1.2,-1],width,height,'#c5d5e6',11);
  label3('Z · BOTTOM SPEED (pp/s)',[-1.05,-1.38,.55],width,height,'#c5d5e6',11);
  const metric=$('metric').value,domain=M.metricDomain(visible,metric);
  const selected=visible.find(p=>p.config.id===selectedId);
  if(selected){
    const neighbors=M.neighbors(model,selectedId,filters()).filter(n=>n.tested);
    for(const n of neighbors){const other=visible.find(p=>p.config.id===n.id);if(other)line3(coordinates(selected.config),coordinates(other.config),width,height,'#43e6ed50');}
  }
  projected=visible.map(point=>({...project(coordinates(point.config),width,height),point})).sort((a,b)=>a.depth-b.depth);
  for(const p of projected){
    const point=p.point,radius=p.point.config.id===selectedId?8:6;
    const color=colorFor(point,metric,domain),noValue=M.metric(point,metric)===null;
    context.beginPath();context.arc(p.x,p.y,radius,0,Math.PI*2);
    context.fillStyle=noValue?'#0b1220':color;context.strokeStyle=color;context.lineWidth=1.5;context.fill();context.stroke();
    if(point.unfinished>0&&point.completed>0){context.setLineDash([2,2]);context.strokeStyle='#ed4ca8';context.beginPath();context.arc(p.x,p.y,radius+3,0,Math.PI*2);context.stroke();context.setLineDash([]);}
    if(point.completed===0){context.strokeStyle=noValue?'#a0abc0':'#0b1220';context.beginPath();context.moveTo(p.x-2.5,p.y-2.5);context.lineTo(p.x+2.5,p.y+2.5);context.moveTo(p.x+2.5,p.y-2.5);context.lineTo(p.x-2.5,p.y+2.5);context.stroke();}
    if(point.config.id===selectedId||point.config.id===hoverId){context.strokeStyle=point.config.id===selectedId?'#f5f8ff':'#ccd5e8';context.lineWidth=1.5;context.beginPath();context.arc(p.x,p.y,radius+6,0,Math.PI*2);context.stroke();}
  }
  canvas.dataset.renderedPoints=String(projected.length);
}
function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;renderCloud();});}
function updateLegend(){
  const metric=$('metric').value,domain=M.metricDomain(visible,metric);
  $('legend-title').textContent={rate:'Completion rate · higher →',effort:'Median answers / word · lower ←',time:'Median completion time · lower ←'}[metric];
  const format=value=>metric==='rate'?pct(value):metric==='time'?time(value):value.toFixed(2);
  const hasValues=visible.some(point=>M.metric(point,metric)!==null);
  $('legend-low').textContent=hasValues?format(domain[0]):'—';$('legend-high').textContent=hasValues?format(domain[1]):'—';
  if(!hasValues)$('legend-title').textContent='No completed runs · unavailable';
  document.querySelector('.gradient').style.background=!hasValues?'#828da3':metric==='rate'?'linear-gradient(90deg,#f6a16a,#43e6ed)':'linear-gradient(90deg,#43e6ed,#f6a16a)';
  const f=filters();const sizes=f.wordCount==='all'?6:1,intervals=f.intervalSeconds==='all'?4:1;
  $('aggregation').textContent=`Each point uses ${sizes*intervals} recorded scenario${sizes*intervals===1?'':'s'} (${sizes} vocabulary size${sizes===1?'':'s'} × ${intervals} interval${intervals===1?'':'s'}). Completion rate = completed / selected scenarios, equally weighted. Effort and time = median over completed scenarios only. Unfinished answers are never counted as completion effort. Numeric colors use the visible slice’s range; completion colors stay fixed at 0–100%.`;
}
function refresh(){
  if(!model)return;
  const f=filters();visible=M.points(model,f);
  $('threshold-value').textContent=f.completion+'%';$('threshold').setAttribute('aria-valuetext',f.completion+' percent');
  $('slice-count').textContent=visible.length+' TESTED POINTS';
  if(!visible.some(p=>p.config.id===selectedId))selectedId=visible[0]?.config.id??null;
  $('configuration').replaceChildren(...visible.map(p=>{const option=document.createElement('option');option.value=p.config.id;option.textContent=p.config.id;return option;}));
  $('configuration').value=selectedId??'';hoverId=null;$('tooltip').hidden=true;
  updateLegend();renderDetails();requestDraw();
}
function selectPoint(id){
  const selection=M.selectConfiguration(model,id);if(!selection)return;
  selectedId=id;$('threshold').value=[60,70,80,90].indexOf(selection.config.completion);refresh();
}
function renderDetails(){
  const selection=M.selectConfiguration(model,selectedId);if(!selection)return;
  const c=selection.config,p=visible.find(p=>p.config.id===selectedId);
  $('selected-summary').innerHTML=`<h2 class="selected-id">${escape(c.id)}</h2><div class="parameter-list"><div><span>FIXED KICK</span><b>${c.kick} pp</b></div><div><span>COMPLETION</span><b>${c.completion}%</b></div><div><span>TOP SPEED</span><b>${c.topSpeed} pp/s</b></div><div><span>BOTTOM SPEED</span><b>${c.bottomSpeed} pp/s</b></div></div><div class="summary-stat"><strong>${selection.summary.completed} / ${selection.summary.total}</strong> scenarios completed overall<br><strong>${p.completed} / ${p.total}</strong> in current filters (${pct(p.rate)})<br>Median effort: <strong>${p.effort===null?'unavailable':p.effort.toFixed(2)+' answers / word'}</strong><br>Median time: <strong>${time(p.time)}</strong></div>`;
  const ns=M.neighbors(model,selectedId,filters());
  $('neighbor-count').textContent=ns.filter(n=>n.tested).length+' / '+ns.length+' TESTED';
  $('neighbors').replaceChildren(...ns.map(n=>{
    const element=document.createElement(n.tested?'button':'div');element.className='neighbor'+(n.tested?'':' untested');
    const units=n.axis==='completion'?'%':n.axis==='kick'?' pp':' pp/s';
    element.innerHTML=`<span>${escape(AXIS_NAMES[n.axis])} → ${n.value}${units}<br>${n.tested?escape(n.id):'Untested combination'}</span><b>${n.tested?pct(n.summary.rate):'—'}</b>`;
    if(n.tested)element.addEventListener('click',()=>selectPoint(n.id));return element;
  }));
  $('chart-config').textContent=c.id+' / FULL RECORD';
  $('table-summary').textContent=selection.summary.completed+' COMPLETED · '+selection.summary.unfinished+' UNFINISHED';
  $('results').innerHTML=selection.rows.map(r=>`<tr class="${M.matches(r,filters())?'matching':''}"><td>${r.wordCount}</td><td>${r.intervalSeconds} s</td><td class="${r.status==='Completed'?'completed':'unfinished'}">${r.status==='Completed'?'● COMPLETED':'× UNFINISHED'}</td><td>${r.successfulRetrievals}</td><td>${r.status==='Completed'?(r.successfulRetrievals/r.wordCount).toFixed(2):'—'}</td><td>${time(r.completionTimeSeconds)}</td><td>${time(r.elapsedSeconds)}</td><td>${r.unlockedWords} / ${r.wordCount}</td><td>${r.finalProgress.toFixed(1)}%</td></tr>`).join('');
  renderEffort();
}
function renderEffort(){
  const {width,height}=dimensions(chart,chartContext);chartContext.clearRect(0,0,width,height);if(!model||!selectedId)return;
  const series=M.effortSeries(model,selectedId),values=series.flatMap(s=>s.points.map(p=>p.value)).filter(v=>v!==null);
  const top=Math.max(1,Math.ceil(Math.max(0,...values)*1.15)),left=65,right=width-32,bottom=height-42;
  const x=n=>left+(n-5)/25*(right-left),y=v=>bottom-v/top*(bottom-28);
  chartContext.font='10px ui-monospace, monospace';chartContext.textAlign='right';
  for(let i=0;i<=4;i++){
    const v=top*i/4;chartContext.strokeStyle='#222d40';chartContext.beginPath();chartContext.moveTo(left,y(v));chartContext.lineTo(right,y(v));chartContext.stroke();chartContext.fillStyle='#8e9aaf';chartContext.fillText(v.toFixed(1),left-12,y(v)+3);
  }
  chartContext.textAlign='center';for(const n of [5,10,15,20,25,30])chartContext.fillText(n,x(n),bottom+20);
  chartContext.fillText('VOCABULARY SIZE',width/2,height-5);chartContext.textAlign='left';chartContext.fillText('ANSWERS / WORD',left,14);
  series.forEach((s,i)=>{
    let previous=null;chartContext.strokeStyle=COLORS[i];chartContext.fillStyle=COLORS[i];chartContext.lineWidth=2;
    for(const p of s.points){
      if(p.value===null){previous=null;continue;}
      if(previous){chartContext.beginPath();chartContext.moveTo(x(previous.wordCount),y(previous.value));chartContext.lineTo(x(p.wordCount),y(p.value));chartContext.stroke();}
      chartContext.beginPath();chartContext.arc(x(p.wordCount),y(p.value),3.5,0,Math.PI*2);chartContext.fill();previous=p;
    }
  });
  $('effort-legend').innerHTML=series.map((s,i)=>`<span><i style="background:${COLORS[i]}"></i>Every ${s.intervalSeconds} s</span>`).join('');
  $('effort-unfinished').textContent='Unfinished sizes (no completed effort): '+series.map(s=>`${s.intervalSeconds} s → ${s.points.filter(p=>p.value===null).map(p=>p.wordCount).join(', ')||'none'}`).join(' · ');
  chart.dataset.completedPoints=String(values.length);
}
function hit(clientX,clientY){
  const b=canvas.getBoundingClientRect(),x=clientX-b.left,y=clientY-b.top;
  return [...projected].reverse().find(p=>Math.hypot(p.x-x,p.y-y)<13)?.point??null;
}
function hover(event){
  const point=hit(event.clientX,event.clientY);hoverId=point?.config.id??null;requestDraw();
  const tooltip=$('tooltip');if(!point){tooltip.hidden=true;return;}
  const c=point.config;tooltip.innerHTML=`<b>${escape(c.id)}</b> · completion ${c.completion}%<br>Kick ${c.kick} pp · top ${c.topSpeed} · bottom ${c.bottomSpeed} pp/s<br>${point.completed}/${point.total} completed · ${pct(point.rate)}<br>Median effort: ${point.effort===null?'unavailable':point.effort.toFixed(2)+' / word'}<br>Median time: ${time(point.time)}<br>Click to inspect all 24 scenarios`;
  tooltip.hidden=false;const b=canvas.getBoundingClientRect();tooltip.style.left=Math.max(5,Math.min(event.clientX-b.left+15,b.width-tooltip.offsetWidth-8))+'px';tooltip.style.top=Math.max(5,Math.min(event.clientY-b.top+15,b.height-tooltip.offsetHeight-8))+'px';
}
canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});dragged=false;gestureStart={x:event.clientX,y:event.clientY};$('tooltip').hidden=true;});
canvas.addEventListener('pointermove',event=>{
  const old=pointers.get(event.pointerId);if(!old){hover(event);return;}
  const next={x:event.clientX,y:event.clientY};
  if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)[1];const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(next.x-other.x,next.y-other.y);if(before>0)zoom=Math.max(.55,Math.min(1.65,zoom*after/before));dragged=true;}
  else{yaw+=(next.x-old.x)*.007;pitch=Math.max(-1.15,Math.min(1.15,pitch+(next.y-old.y)*.007));if(Math.hypot(next.x-gestureStart.x,next.y-gestureStart.y)>4)dragged=true;}
  pointers.set(event.pointerId,next);requestDraw();
});
canvas.addEventListener('pointerup',event=>{if(!dragged&&pointers.size===1){const point=hit(event.clientX,event.clientY);if(point)selectPoint(point.config.id);}pointers.delete(event.pointerId);});
canvas.addEventListener('pointercancel',event=>pointers.delete(event.pointerId));
canvas.addEventListener('pointerleave',()=>{if(!pointers.size){hoverId=null;$('tooltip').hidden=true;requestDraw();}});
canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.55,Math.min(1.65,zoom*Math.exp(-event.deltaY*.001)));requestDraw();},{passive:false});
canvas.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key))return;event.preventDefault();
  if(event.key==='ArrowLeft')yaw-=.1;if(event.key==='ArrowRight')yaw+=.1;
  if(event.key==='ArrowUp')pitch=Math.max(-1.15,pitch-.1);if(event.key==='ArrowDown')pitch=Math.min(1.15,pitch+.1);
  if(event.key==='+'||event.key==='=')zoom=Math.min(1.65,zoom*1.1);if(event.key==='-')zoom=Math.max(.55,zoom/1.1);requestDraw();
});
$('reset-view').addEventListener('click',()=>{yaw=-.7;pitch=.38;zoom=1;requestDraw();});
for(const id of ['threshold','words','interval','metric'])$(id).addEventListener(id==='threshold'?'input':'change',refresh);
$('configuration').addEventListener('change',event=>selectPoint(event.target.value));
new ResizeObserver(()=>{requestDraw();renderEffort();}).observe(document.querySelector('.workspace'));
window.addEventListener('resize',()=>{requestDraw();renderEffort();});
async function load(){
  try{
    const response=await fetch('../sweep-results/results.json');if(!response.ok)throw Error(`Data request returned HTTP ${response.status}`);
    model=M.createModel(await response.json());selectedId=model.configs.has('C283')?'C283':null;
    $('sample-count').textContent=model.configs.size;$('run-count').textContent=model.data.results.length.toLocaleString();
    $('metadata').textContent=`${model.data.metadata.stepSeconds.toFixed(6)} s timestep · ${model.data.metadata.maxTimeSeconds/60}-minute limit · seed ${model.data.metadata.seed}`;
    $('load-status').textContent=`${model.configs.size} of ${model.data.metadata.validConfigurations} valid configurations sampled. LEGACY PHYSICS RESULTS — fixed kick with independent falling speeds. These are not measurements of the current shared-linear/hint model.`;
    refresh();
  }catch(error){$('load-status').classList.add('error');$('load-status').textContent=`Unable to load results: ${error.message}. Serve the prototype directory over HTTP; see explorer/README.md.`;}
}
load();
