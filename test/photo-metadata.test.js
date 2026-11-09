import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPhotoCaptureTime,resolvePhotoCaptureTime} from '../worker/photo-metadata.js';
import {initialState} from '../worker/domain.js';
import {structuredCareTool} from '../worker/care-agent.js';
function tiff({date='2026:11:09 07:00:12',offset='-05:00',little=true}={}){
 const b=new Uint8Array(128),v=new DataView(b.buffer);b[0]=b[1]=little?73:77;v.setUint16(2,42,little);v.setUint32(4,8,little);v.setUint16(8,1,little);v.setUint16(10,0x8769,little);v.setUint16(12,4,little);v.setUint32(14,1,little);v.setUint32(18,32,little);
 const n=offset==null?1:2;v.setUint16(32,n,little);const field=(p,tag,value,start)=>{v.setUint16(p,tag,little);v.setUint16(p+2,2,little);v.setUint32(p+4,value.length+1,little);v.setUint32(p+8,start,little);b.set(new TextEncoder().encode(value+'\0'),start);};field(34,0x9003,date,80);if(offset!=null)field(46,0x9011,offset,104);return b;
}
function jpeg(meta){const n=meta.length+8;return Uint8Array.from([255,216,255,225,n>>8,n&255,69,120,105,102,0,0,...meta,255,217]);}
test('JPEG, PNG and WebP original camera times preserve explicit offsets and seconds',()=>{
 for(const little of [true,false]){const m=extractPhotoCaptureTime(jpeg(tiff({little})));assert.equal(m.instant,'2026-11-09T12:00:12.000Z');assert.equal(m.offset,'-05:00');}
 const raw=tiff(),png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,raw.length,101,88,73,102,...raw,0,0,0,0]);assert.equal(extractPhotoCaptureTime(png).instant,'2026-11-09T12:00:12.000Z');
 const webp=Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80,69,88,73,70,raw.length,0,0,0,...raw]);assert.equal(extractPhotoCaptureTime(webp).instant,'2026-11-09T12:00:12.000Z');
});
test('missing, damaged and invalid metadata never supplies an invented capture time',()=>{
 assert.equal(extractPhotoCaptureTime(Uint8Array.from([255,216,255,217])),null);assert.equal(extractPhotoCaptureTime(jpeg(tiff({date:'2026:02:31 07:00:00'}))),null);
 for(let i=0;i<140;i++)assert.doesNotThrow(()=>extractPhotoCaptureTime(jpeg(tiff()).slice(0,i)));
 const broken=tiff();new DataView(broken.buffer).setUint32(18,0xfffffffe,true);assert.equal(extractPhotoCaptureTime(jpeg(broken)),null);
});
test('no-offset camera times expose a timezone assumption; future camera clocks are unusable',()=>{
 const m=extractPhotoCaptureTime(jpeg(tiff({offset:null})));assert.equal(m.instant,null);const c=resolvePhotoCaptureTime(m,'America/New_York',Date.parse('2026-11-09T15:00:00Z'));assert.equal(c.instant,'2026-11-09T12:00:12.000Z');assert.equal(c.timezoneAssumed,true);assert.match(c.notice,/Assumed America\/New_York/);assert.equal(resolvePhotoCaptureTime(m,'America/New_York',Date.parse('2026-11-08T15:00:00Z')).usable,false);
});
test('photo capture time resolves through an opaque timeRef with a review caveat, and explicit user times can override it',async()=>{
 const s=initialState({real:true}),capture=resolvePhotoCaptureTime(extractPhotoCaptureTime(jpeg(tiff())),'America/New_York',Date.parse('2026-11-09T15:00:00Z'));
 const c={photoData:{type:'bag',volumeMl:420,captureTime:capture},photoId:'photo',resolvedTimes:{},reviewTimeRefs:{},originalPendingIds:new Set()};
 const r=await structuredCareTool(s,'photo',{name:'resolve_care_time',arguments:{strategy:'photo_capture'}},c);assert.equal(r.observation.time,'2026-11-09T12:00:12.000Z');assert.match(r.observation.assumption,/camera clock/);
 const user=await structuredCareTool(s,'This was actually 8am',{name:'resolve_care_time',arguments:{strategy:'explicit_clock',clock:'08:00',date:'2026-11-09'}},c);assert.equal(user.observation.time,'2026-11-09T13:00:00.000Z');
 c.photoData.captureTime=null;await assert.rejects(structuredCareTool(s,'photo',{name:'resolve_care_time',arguments:{strategy:'photo_capture'}},c),/No usable/);
});

test('a timezone change re-resolves a camera clock without an offset rather than reusing an earlier assumption',()=>{
 const m=extractPhotoCaptureTime(jpeg(tiff({offset:null}))),at=Date.parse('2026-11-09T20:00:00Z');const east=resolvePhotoCaptureTime(m,'America/New_York',at);assert.equal(east.instant,'2026-11-09T12:00:12.000Z');const west=resolvePhotoCaptureTime(east,'America/Los_Angeles',at);assert.equal(west.instant,'2026-11-09T15:00:12.000Z');assert.match(west.notice,/America\/Los_Angeles/);
});
