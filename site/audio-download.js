'use strict';
const decodedListeningBlobs=new Map();
async function resumableRecording(meta,signal,onProgress=()=>{},parallel=3){
  const url=new URL(meta.url,location.href).href,parts=Array(meta.chunks).fill(null);
  const chunkKey=i=>url+'?chunk='+i,tagKey=url+'?gcm-tag=1';
  let cache;try{cache=await caches.open('ielts-audio-chunks-v2')}catch{}
  let loaded=0,tag=null,whole=null;
  const expected=i=>Math.min(meta.chunkSize,meta.bytes-i*meta.chunkSize);
  const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(cache){
    for(let first=0;first<meta.chunks;first+=12){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      await Promise.all(Array.from({length:Math.min(12,meta.chunks-first)},async(_,n)=>{
        const i=first+n;try{const hit=await cache.match(chunkKey(i));if(!hit)return;const bytes=new Uint8Array(await hit.arrayBuffer());
          if(bytes.length===expected(i)&&await digest(bytes)===meta.hashes[i]){parts[i]=bytes;loaded+=bytes.length}else await cache.delete(chunkKey(i));
        }catch{}
      }));
    }
    try{const hit=await cache.match(tagKey);if(hit){const bytes=new Uint8Array(await hit.arrayBuffer());if(bytes.length===16)tag=bytes}}catch{}
  }
  onProgress(loaded,meta.bytes);
  const tasks=[];
  for(let i=0;i<meta.chunks;){
    if(parts[i]){i++;continue}
    const start=i;while(i<meta.chunks&&!parts[i]&&i-start<4)i++;
    tasks.push({first:start,last:i-1});
  }
  if(!tag&&!tasks.some(t=>t.last===meta.chunks-1))tasks.push({tagOnly:true});
  async function download(task){
    const begin=task.tagOnly?meta.bytes+12:12+task.first*meta.chunkSize;
    const includesTag=task.tagOnly||task.last===meta.chunks-1;
    const end=includesTag?meta.bytes+27:12+Math.min(meta.bytes,(task.last+1)*meta.chunkSize)-1;
    for(let attempt=0;attempt<3;attempt++){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,35000);
      try{
        const response=await fetch(url,{headers:{Range:`bytes=${begin}-${end}`},signal:controller.signal});
        if(!response.ok)throw Error('Audio HTTP '+response.status);
        const data=new Uint8Array(await response.arrayBuffer());
        if(response.status===200){if(data.length!==meta.bytes+28)throw Error('Incomplete recording');whole=data;onProgress(meta.bytes,meta.bytes);return}
        if(response.status!==206||data.length!==end-begin+1)throw Error('Incomplete audio range');
        if(!task.tagOnly){
          for(let i=task.first;i<=task.last;i++){
            const offset=12+i*meta.chunkSize-begin,bytes=data.slice(offset,offset+expected(i));
            if(await digest(bytes)!==meta.hashes[i])throw Error('Audio integrity check failed');
            if(!parts[i])loaded+=bytes.length;parts[i]=bytes;
            if(cache)try{await cache.put(chunkKey(i),new Response(bytes))}catch{}
          }
        }
        if(includesTag){tag=data.slice(meta.bytes+12-begin);if(tag.length!==16)throw Error('Incomplete audio tag');if(cache)try{await cache.put(tagKey,new Response(tag))}catch{}}
        onProgress(loaded,meta.bytes);return;
      }catch(error){if(signal.aborted||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)))}
      finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
    }
  }
  // Probe once so a server ignoring Range never triggers several full downloads.
  if(tasks.length)await download(tasks.shift());
  if(!whole){let cursor=0;const workers=Array.from({length:Math.min(parallel,tasks.length)},async()=>{while(cursor<tasks.length&&!whole)await download(tasks[cursor++])});
    const outcomes=await Promise.allSettled(workers);const failed=outcomes.find(r=>r.status==='rejected');if(failed&&!whole)throw failed.reason;
  }
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(whole)return whole;
  if(parts.some(p=>!p)||!tag)throw Error('Recording download incomplete');
  const sealed=new Uint8Array(meta.bytes+28);sealed.set(meta.iv);
  parts.forEach((p,i)=>sealed.set(p,12+i*meta.chunkSize));sealed.set(tag,meta.bytes+12);return sealed;
}
