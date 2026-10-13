// Minimal integration host: validates referenced HTML IDs and drives actual app.js.
// It does not claim to render layout or CSS.
const vm=require('node:vm');
const {instrumentPhysics}=require('./physics-harness.cjs');
class Element {
  constructor(){this.attrs={};this.children=[];this.listeners={};this.hidden=false;this.open=false;this.style={setProperty(){}};this.classes=new Set();this.classList={toggle:(k,v)=>{if(v)this.classes.add(k);else this.classes.delete(k);}};this.parentElement={classList:{toggle(){}}};}
  setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.register?.(v,this);}
  appendChild(child){this.children.push(child);}
  addEventListener(k,v){(this.listeners[k]??=[]).push(v);}
  dispatch(k,e={}){for(const listener of this.listeners[k]??[])listener(e);}
  set value(value){this._value=String(value);}
  get value(){return this._value;}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function makeHost({html,app,physics,instantPosition=false}){
  const elements=new Map();
  const create=()=>{const node=new Element();node.register=(id,value)=>elements.set(id,value);return node;};
  for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],create());
  elements.get('tuning-panel').hidden=true;
  const listeners={};
  const document={
    getElementById(id){if(!elements.has(id))throw new Error('Missing DOM ID: '+id);return elements.get(id);},
    createElement:create,createElementNS:create,
    addEventListener(k,v){(listeners[k]??=[]).push(v);}
  };
  let now=0;
  const preference={matches:instantPosition,addEventListener(){}};
  const states=new WeakMap();
  const context=vm.createContext({__testStates:states,testState:session=>states.get(session),document,performance:{now:()=>now},matchMedia:()=>preference,requestAnimationFrame(){}});
  if(physics)vm.runInContext(instrumentPhysics(physics),context,{filename:'physics.js'});
  vm.runInContext(app,context,{filename:'app.js'});
  const run=source=>vm.runInContext(source,context);
  return {elements,run,
    advance(seconds){now+=seconds*1000;run(`frame(${now})`);},
    retrieve(successful=true){for(const fn of listeners.keydown??[])fn({key:successful?'a':'Escape',code:successful?'KeyA':'Escape',preventDefault(){}});},
    key(key,code=key){for(const fn of listeners.keydown??[])fn({key,code,preventDefault(){}});},
    click(id){elements.get(id).dispatch('click');},
    settings(key,value,group){run(`tuningInputs.find(v=>v.key===${JSON.stringify(key)}${group?` && v.values===${group}`:''}).input.value=${JSON.stringify(String(value))};`);run(`tuningInputs.find(v=>v.key===${JSON.stringify(key)}${group?` && v.values===${group}`:''}).input.dispatch('input');`);}
  };
}
module.exports={makeHost};
