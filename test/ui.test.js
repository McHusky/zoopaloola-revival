'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {initGame,publicGame,MAX_POWER}=require('../game');

function mountUI(){
  class MockElement {
    constructor(id){
      this.id=id;this.handlers={};this.style={};this.dataset={};this.value=id==='playerName'?'Test':'normal';
      this.textContent='';this.classes=new Set();
      this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>{
        const enabled=on===undefined?!this.classes.has(k):on;
        if(enabled)this.classes.add(k);else this.classes.delete(k);
        return enabled;
      }};
    }
    addEventListener(type,fn){this.handlers[type]=fn;}
    setAttribute(){}
    setPointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:960,height:720};}
  }
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,new MockElement(id));
    return elements.get(id);
  };
  const requests=[];
  const fakeFetch=async(url,opts={})=>{
    const payload=opts.body?JSON.parse(opts.body):null;
    requests.push({url,method:opts.method,body:payload});
    if(url==='/api/rooms'){
      return {ok:true,json:async()=>({
        code:'ABC234',token:'tkn',seat:0,local:true,bot:false,seq:0,phase:'playing',
        players:[{name:'A',species:'lion'},{name:'B',species:'hippo'}],game:publicGame(initGame())
      })};
    }
    if(String(url).endsWith('/shoot'))return {ok:true,json:async()=>({ok:true,seq:1})};
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const ctx={
    document:{getElementById:element,querySelectorAll:()=>[],hidden:false},
    window:{},location:{origin:'http://localhost',search:''},
    history:{replaceState(){}},
    localStorage:{setItem(){},getItem(){return null;},removeItem(){}},
    fetch:fakeFetch,requestAnimationFrame(){},
    setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
    URLSearchParams,console
  };
  element('gameCanvas').getContext=()=>({});
  const code=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  vm.runInNewContext(code,ctx,{filename:'public/app.js'});
  return {element,requests};
}

test('browser sends 100%-strength shots within the server limit even when pulled beyond the meter',async()=>{
  const {element,requests}=mountUI();
  await element('localRoom').handlers.click();
  const canvas=element('gameCanvas');
  const pull=async dragDistance=>{
    canvas.handlers.pointerdown({clientX:480,clientY:202,pointerId:1,preventDefault(){}});
    canvas.handlers.pointermove({clientX:480,clientY:202-dragDistance,preventDefault(){}});
    await canvas.handlers.pointerup({clientX:480,clientY:202-dragDistance,preventDefault(){}});
    return requests.filter(x=>String(x.url).endsWith('/shoot')).at(-1).body;
  };
  const half=await pull(65);
  assert.ok(Math.abs(Math.hypot(half.vx,half.vy)-MAX_POWER/2)<1e-4);
  const full=await pull(130);
  assert.ok(Math.abs(Math.hypot(full.vx,full.vy)-MAX_POWER)<1e-4);
  const beyond=await pull(400);
  assert.ok(Math.abs(Math.hypot(beyond.vx,beyond.vy)-MAX_POWER)<1e-4);
  assert.ok(Math.hypot(beyond.vx,beyond.vy)<=MAX_POWER+1e-9);
});
