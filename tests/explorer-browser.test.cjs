const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const data=require('../sweep-results/results.json');
async function host(){
 const elements=new Map(),frames=[];
 const drawing=[];
 const ctx=new Proxy({},{get(target,key){if(key in target)return target[key];return (...args)=>drawing.push([key,...args]);},set(target,key,value){target[key]=value;return true;}});
 class Element{
  constructor(id=''){this.id=id;this.value='';this.style={};this.dataset={};this.hidden=false;this.listeners={};this.classList={add(){}};this.width=0;this.height=0;this.attrs={};this.offsetWidth=240;this.offsetHeight=130;}
  getBoundingClientRect(){return {left:0,top:0,width:900,height:this.id==='effort-chart'?280:570};}
  getContext(){return ctx;}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(key,listener){(this.listeners[key]??=[]).push(listener);}
  setPointerCapture(){}
  replaceChildren(...children){this.children=children;}
  dispatch(key,event={}){for(const fn of this.listeners[key]??[])fn(event);}
 }
 const dir=path.join(__dirname,'../explorer');
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],new Element(match[1]));
 for(const [key,value] of Object.entries({threshold:'2',words:'all',interval:'all',metric:'rate'}))elements.get(key).value=value;
 const gradient=new Element(),workspace=new Element();
 const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:()=>new Element(),querySelector:selector=>selector==='.gradient'?gradient:workspace},
  fetch:async()=>({ok:true,json:async()=>structuredClone(data)}),devicePixelRatio:1,
  requestAnimationFrame:fn=>frames.push(fn),window:{addEventListener(){}},ResizeObserver:class{observe(){}}});
 vm.runInContext(fs.readFileSync(path.join(dir,'model.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(dir,'app.js'),'utf8').replace(/load\(\);\s*$/,'var ready=load();'),context);
 await vm.runInContext('ready',context);
 const flush=()=>{while(frames.length)frames.shift()();};flush();
 return {elements,drawing,run:code=>vm.runInContext(code,context),flush};
}
test('actual browser script fetches saved data and renders cloud, table, and effort chart',async()=>{
 const h=await host();assert.equal(h.elements.get('cloud').dataset.renderedPoints,'46');
 assert.equal(h.elements.get('effort-chart').dataset.completedPoints,'16');
 assert.equal((h.elements.get('results').innerHTML.match(/<tr /g)||[]).length,24);
 assert.ok(h.drawing.some(row=>row[0]==='arc'));
 assert.ok(h.elements.get('load-status').textContent.includes('150 of 460'));
});
test('pointer hover/click, dragging, wheel zoom, and reset work in the actual UI script',async()=>{
 const h=await host(),cloud=h.elements.get('cloud');
 const point=h.run('projected.find(p=>p.point.config.id!==selectedId)');
 cloud.dispatch('pointermove',{clientX:point.x,clientY:point.y});h.flush();
 assert.equal(h.elements.get('tooltip').hidden,false);
 const hit=h.run('hoverId');assert.ok(hit);
 cloud.dispatch('pointerdown',{pointerId:1,clientX:point.x,clientY:point.y});
 cloud.dispatch('pointerup',{pointerId:1,clientX:point.x,clientY:point.y});h.flush();
 assert.equal(h.run('selectedId'),hit);
 const yaw=h.run('yaw');cloud.dispatch('pointerdown',{pointerId:1,clientX:100,clientY:100});
 cloud.dispatch('pointermove',{pointerId:1,clientX:180,clientY:120});
 cloud.dispatch('pointerup',{pointerId:1,clientX:180,clientY:120});h.flush();assert.notEqual(h.run('yaw'),yaw);
 cloud.dispatch('wheel',{deltaY:-100,preventDefault(){}});h.flush();assert.ok(h.run('zoom')>1);
 cloud.dispatch('keydown',{key:'ArrowLeft',preventDefault(){}});h.flush();
 h.elements.get('reset-view').dispatch('click');h.flush();assert.equal(h.run('zoom'),1);assert.equal(h.run('yaw'),-.7);
});
test('filters update immediately and sampled neighbor selection can change completion slice',async()=>{
 const h=await host();h.elements.get('words').value='30';h.elements.get('words').dispatch('change');
 h.elements.get('interval').value='15';h.elements.get('interval').dispatch('change');
 h.elements.get('metric').value='effort';h.elements.get('metric').dispatch('change');h.flush();
 assert.ok(h.elements.get('selected-summary').innerHTML.includes('unavailable'));
 assert.equal(h.elements.get('legend-low').textContent,'—');assert.equal(h.elements.get('legend-high').textContent,'—');
 assert.equal(h.run('visible.every(p=>p.total===1 && p.completed===0 && p.effort===null)'),true);
 h.elements.get('threshold').value='0';h.elements.get('threshold').dispatch('input');h.flush();
 assert.equal(h.elements.get('cloud').dataset.renderedPoints,'35');assert.equal(h.elements.get('threshold-value').textContent,'60%');
 h.run("selectPoint('C283')");h.flush();
 const button=h.elements.get('neighbors').children.find(n=>n.innerHTML.includes('C282'));
 button.dispatch('click');h.flush();assert.equal(h.run('selectedId'),'C282');assert.equal(h.elements.get('threshold-value').textContent,'70%');
});
