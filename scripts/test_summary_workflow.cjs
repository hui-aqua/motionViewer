const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const context = vm.createContext({ArrayBuffer, Uint8Array, DataView, TextDecoder, console, Request, Response, Headers, File, FormData, URL, crypto:webcrypto});
vm.runInContext(fs.readFileSync('dashboard/decoder.js','utf8'), context);
const worker = fs.readFileSync('backend/worker/index.js','utf8').replace(/^import .*;\r?\n/gm,'');
context.devices = JSON.parse(fs.readFileSync('dashboard/devices.json','utf8'));
vm.runInContext(worker.replace('export default', 'globalThis.worker ='), context);
const fixture = fs.readFileSync('../CoreS3_MotionLogger/test/fixtures/summary_v4_sample.bin');
const prefix = fixture.subarray(0,448);
function buffer(bytes) { return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength); }
const canonical = bytes => context.decodeBinary(buffer(bytes),{allRecords:true}).points.map(p => ({
 utc_end_ms:Number(p.t),mono_end_ms:p.monoEndMs,record_seq:p.recordId,sample_count:p.sampleCount,
 missed_samples:p.missedSamples,status:p.status,temp_centi_c:p.temperature*100,battery_mv:p.batteryVoltage*1000,
 acc_mag_max:p.accMagPeak*32768/8,gyro_mag_max:p.gyroMagPeak*32768/1000,
 ...Object.fromEntries(['acc','gyro'].flatMap(sensor => ['mean','std','min','max'].flatMap(stat => [...'xyz'].map(axis => {
  const key=(sensor==='acc'?'a':'g')+axis+(stat==='mean'?'':stat[0].toUpperCase()+stat.slice(1));
  return [sensor+'_'+stat+'_'+axis,p[key]*32768/(sensor==='acc'?8:1000)];
 }))))
}));
const rawFixture=fs.readFileSync('../CoreS3_MotionLogger/test/fixtures/raw_v3_sample.bin');
function rawGoldenRows() {
 const rows=[];let run=0,newRun=true;
 assert.equal(parseInt(context.motionCrc32(buffer(rawFixture.subarray(0,508))),16),rawFixture.readUInt32LE(508));
 for(let offset=512;offset+4096<=rawFixture.length;offset+=4096){
  const block=rawFixture.subarray(offset,offset+4096);
  const crc=context.motionCrc32(buffer(Buffer.concat([block.subarray(0,60),block.subarray(64)])));
  if(block.toString('ascii',0,4)!=='CS3B'||parseInt(crc,16)!==block.readUInt32LE(60)){newRun=true;continue;}
  if(rows.length&&(newRun||(block.readUInt16LE(48)&1)))++run;
  newRun=false;
  for(let slot=0;slot<block.readUInt16LE(46);++slot){
   const row={sample_index:Number(block.readBigUInt64LE(16))+slot,run_id:run};
   ['ax','ay','az','gx','gy','gz'].forEach((axis,i)=>{
    const count=block.readInt16LE(64+slot*12+i*2);row[axis]=count;
    row[axis+(i<3?'_g':'_dps')]=count*(i<3?8:1000)/32768;
   });rows.push(row);
  }
 }
 assert.equal(rows.length,689);return rows;
}
if(process.argv.includes('--dump-raw-fixture')){console.log(JSON.stringify(rawGoldenRows()));process.exit(0);}
if(process.argv.includes('--dump-fixture')) { console.log(JSON.stringify(canonical(prefix))); process.exit(0); }
const objects=new Map();let puts=0;
const env={DEVICE_API_KEY:'test',UPLOADS:{
 async get(key){const object=objects.get(key);return object?{...object,body:object.bytes}:null;},
 async put(key,bytes,options){puts++;objects.set(key,{key,size:bytes.byteLength,bytes,uploaded:new Date(),customMetadata:options.customMetadata});},
 async list(){return {objects:[...objects.values()],truncated:false};}
}};
async function upload(bytes,changes={}) {
 const form=new FormData();
 const fields={device_id:'CS3_01',timestamp:'2026-11-16T00:00:00Z',sampling_frequency:'1',summary_hz:'1',measurement_type:'motion_summary',file_format:'cs3_summary_v4',date:'2026-11-16',crc32:context.motionCrc32(buffer(bytes)),size_bytes:String(bytes.length),...changes};
 for(const [key,value] of Object.entries(fields))form.append(key,value);
 form.append('file',new File([bytes],'CS3_01_SUMMARY_20261116.bin'));
 const result=await context.worker.fetch(new Request('https://local/api/v1/upload',{method:'POST',headers:{Authorization:'Bearer test'},body:form}),env);
 return {status:result.status,body:await result.json()};
}
(async()=>{
 assert.equal(context.motionCrc32(buffer(Buffer.from('123456789'))),'cbf43926');
 assert.equal(context.motionCrc16(Buffer.from('123456789')),0x29b1);
 assert.equal((await upload(prefix)).body.status,'STORED');
 assert.equal((await upload(prefix)).body.status,'ALREADY_EXISTS');assert.equal(puts,1);
 assert.equal((await upload(fixture)).status,422);
 assert.equal((await upload(rawFixture)).status,422);rawGoldenRows();
 for(const offset of [0,124,148,206,220]){const bad=Buffer.from(prefix);bad[offset]^=1;assert.equal((await upload(bad)).status,422);}
 for(const format of ['cs3_summary_v1','cs3_summary_v2','cs3_summary_v3','binary'])assert.equal((await upload(prefix,{file_format:format})).status,422);
 assert.equal((await upload(prefix.subarray(0,128))).status,422);
 assert.equal((await upload(prefix,{crc32:'00000000'})).status,422);
 const listing=await context.worker.fetch(new Request('https://local/api/v1/files?device=CS3_01'),env);assert.equal((await listing.json()).files.length,1);
 const key=[...objects.keys()][0];const response=await context.worker.fetch(new Request('https://local/api/v1/files/content?key='+encodeURIComponent(key)),env);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),prefix);
 const daily=Buffer.alloc(128+86400*80);prefix.copy(daily,0,0,128);
 for(let seq=0;seq<86400;++seq){const offset=128+seq*80;prefix.copy(daily,offset,128,208);daily.writeUInt32LE(seq,offset+12);daily.writeUInt16LE(context.motionCrc16(daily.subarray(offset,offset+78)),offset+78);}
 const day=await upload(daily);assert.equal(day.status,200);assert.equal(day.body.record_count,86400);
 console.log('PASS Worker v4 CRCs, sequences, prefix sizes, dedup ACK, downloads and legacy rejection');
})().catch(error=>{console.error(error);process.exitCode=1;});
