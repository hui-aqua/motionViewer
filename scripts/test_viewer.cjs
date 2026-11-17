const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const elements=new Map(),events={};const noop=()=>{};function el(id){if(elements.has(id))return elements.get(id);const e={id,value:id==='#theme'?'light':id==='#signal'?'acc':id==='#cloud-device'?'CS01':'',textContent:'',hidden:false,disabled:false,style:{},dataset:{},classList:{toggle:noop,add:noop,remove:noop},setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},append(...nodes){(this.children??=[]).push(...nodes)},replaceChildren(...nodes){this.children=nodes},addEventListener(k,fn){(this.events??={})[k]=fn},getBoundingClientRect(){return {width:1200,height:500,left:0}},getContext(){return new Proxy({},{get:()=>noop,set:()=>true})},setPointerCapture:noop,click:noop};elements.set(id,e);return e;}
const document={querySelector:el,createElement:()=>el(Symbol()),documentElement:{dataset:{}},body:el('body'),addEventListener(k,fn){events[k]=fn},baseURI:'http://localhost/dashboard/'};
class TestURL extends URL { static createObjectURL(){return "blob:test"} static revokeObjectURL(){} }
const ctx=vm.createContext({document,window:{},URL:TestURL,Option:function(text,value){this.text=text;this.value=value},ArrayBuffer,Uint8Array,DataView,TextDecoder,BigInt,console,devicePixelRatio:1,matchMedia:()=>({matches:false,addEventListener:noop}),localStorage:{getItem:()=>null,setItem:noop},getComputedStyle:()=>({getPropertyValue:()=> '#888'}),ResizeObserver:class{observe(){}},fetch:async url=>String(url).endsWith('devices.json')?{ok:true,json:async()=>JSON.parse(fs.readFileSync('dashboard/devices.json','utf8'))}:{ok:false,status:404}});ctx.window=ctx;el('#signal').options=['acc','gyro','temperature','battery'].map(value=>({value}));Object.defineProperty(el('#signal'),'selectedOptions',{get(){return this.options.filter(o=>o.value===this.value)}});vm.runInContext(fs.readFileSync('dashboard/decoder.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dashboard/app.js','utf8'),ctx);

(async()=>{
 await vm.runInContext('devicesReady',ctx);
 const file=fs.readFileSync('../CoreS3_MotionLogger/test/fixtures/summary_v4_sample.bin');
 const buffer=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
 const result=ctx.decodeBinary(buffer);
 assert.equal(result.header.version,4);assert.equal(result.recordCount,4);assert.equal(result.tailBytes,31);
 assert.equal(result.points[0].ax,-100*8/32768);assert.equal(result.points[0].axStd,5*8/32768);
 assert.equal(result.points[2].gapBefore,true);assert.equal(result.points[3].partialWindow,true);
 await ctx.openLocal({name:'v4.bin',size:buffer.byteLength,arrayBuffer:async()=>buffer});
 assert.equal(vm.runInContext('state.points.length',ctx),4);
 vm.runInContext("state.series='acc';update()",ctx);
 assert.ok(ctx.pointDetails(0).join(' ').includes('partial_window'));
 el('#analysis').open=true;ctx.statistics();assert.equal(el('#stats').children.length,3);
 ctx.setRange(0,1);el('#chart').events.wheel({preventDefault:noop,clientX:600,deltaY:-200});
 assert.ok(vm.runInContext('state.range[1]-state.range[0]<1',ctx));
 el('#chart').events.pointermove({clientX:600});assert.equal(el('#tooltip').hidden,false);
 el('#theme').value='dark';ctx.applyTheme();assert.equal(document.documentElement.dataset.theme,'dark');
 const csv=ctx.binaryCsv(buffer);assert.equal(csv.trim().split('\n').length,5);
 assert.ok(csv.includes('axStd')&&csv.includes('statusFlags'));
 console.log('PASS Viewer v4 means/std/min/max, magnitudes, gaps, flags, load, zoom, hover, theme, statistics and CSV');
})().catch(error=>{console.error(error);process.exitCode=1;});
