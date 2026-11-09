import {zonedTime} from './reminders.js';

// Read only bounded capture-time fields. GPS and other EXIF fields are ignored.
export function extractPhotoCaptureTime(bytes){
 try{
  let tiff=null;
  if(bytes[0]===0xff&&bytes[1]===0xd8){
   for(let p=2;p+4<=bytes.length;){
    if(bytes[p]!==0xff)break;const marker=bytes[p+1];p+=2;
    if(marker===0xda||marker===0xd9)break;
    if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
    const size=(bytes[p]<<8)|bytes[p+1];if(size<2||p+size>bytes.length)break;
    if(marker===0xe1&&String.fromCharCode(...bytes.subarray(p+2,p+8))==='Exif\0\0'){tiff=bytes.subarray(p+8,p+size);break;}p+=size;
   }
  }else if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){
   const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   for(let p=8;p+12<=bytes.length;){const n=v.getUint32(p);if(n>bytes.length-p-12)break;if(String.fromCharCode(...bytes.subarray(p+4,p+8))==='eXIf'){tiff=bytes.subarray(p+8,p+8+n);break;}p+=n+12;}
  }else if(String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP'){
   const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   for(let p=12;p+8<=bytes.length;){const n=v.getUint32(p+4,true);if(n>bytes.length-p-8)break;if(String.fromCharCode(...bytes.subarray(p,p+4))==='EXIF'){tiff=bytes.subarray(p+8,p+8+n);if(String.fromCharCode(...tiff.subarray(0,6))==='Exif\0\0')tiff=tiff.subarray(6);break;}p+=8+n+(n%2);}
  }
  if(!tiff||tiff.length<8)return null;
  const little=tiff[0]===73&&tiff[1]===73;
  if(!little&&!(tiff[0]===77&&tiff[1]===77))return null;
  const view=new DataView(tiff.buffer,tiff.byteOffset,tiff.byteLength);
  if(view.getUint16(2,little)!==42)return null;
  const range=(p,n)=>Number.isSafeInteger(p)&&p>=0&&n>=0&&p+n<=tiff.length;
  function fields(offset){
   if(!range(offset,2))return new Map();const count=view.getUint16(offset,little);if(count>256||!range(offset+2,count*12))return new Map();const result=new Map();
   for(let i=0;i<count;i++){const p=offset+2+i*12,tag=view.getUint16(p,little),type=view.getUint16(p+2,little),n=view.getUint32(p+4,little);if(type===2&&n>0&&n<=80){const start=n<=4?p+8:view.getUint32(p+8,little);if(range(start,n)){const value=String.fromCharCode(...tiff.subarray(start,start+n)).replace(/\0.*$/s,'').trim();result.set(tag,value);}}else if(tag===0x8769&&type===4&&n===1)result.set(tag,view.getUint32(p+8,little));}return result;
  }
  const main=fields(view.getUint32(4,little)),exif=fields(main.get(0x8769));
  const original=exif.get(0x9003);if(typeof original!=='string')return null;
  const m=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(original);if(!m)return null;
  const localDateTime=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const utcCheck=Date.parse(localDateTime+'Z');if(!Number.isFinite(utcCheck)||new Date(utcCheck).toISOString().slice(0,19)!==localDateTime)return null;
  const value=exif.get(0x9011),offset=typeof value==='string'&&/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(value)&&(!value.startsWith('+14')&&!value.startsWith('-14')||value.endsWith(':00'))?value:null;
  return {source:'EXIF DateTimeOriginal',localDateTime,offset,instant:offset?new Date(Date.parse(localDateTime+offset)).toISOString():null};
 }catch{return null;}
}
export function resolvePhotoCaptureTime(metadata,timezone,at=Date.now()){
 if(!metadata)return null;
 const instant=metadata.offset?metadata.instant:new Date(zonedTime(metadata.localDateTime.slice(0,10),metadata.localDateTime.slice(11,16),timezone)+Number(metadata.localDateTime.slice(17,19))*1000).toISOString();
 const future=Date.parse(instant)>at+5*60000;
 return {...metadata,instant,timezoneAssumed:!metadata.offset,timezone:metadata.offset||timezone,usable:!future,notice:future?'The camera timestamp is in the future. Ask the user for the actual time.':metadata.offset?'Capture time comes from camera metadata. Please verify the camera clock.':`The photo has no timezone. Assumed ${timezone}; please verify the capture time.`};
}
