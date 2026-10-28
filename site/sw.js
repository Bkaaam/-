const SHELL='ielts-shell-v4.9';
const FILES=['./','./index.html','./fast.js?v=4.9','./app.js?v=4.9','./audio-download.js?v=4.9','./stream-player.js?v=4.9','./upgrade.js?v=4.9','./transcript-editor.js?v=4.9','./study-tools.js?v=4.9','./reading-focus.js?v=4.9','./style.css?v=4.9','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
const CHUNK_CACHE='ielts-audio-chunks-v2',chunkTasks=new Map(),downloads=new Map();
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ielts-shell-')&&k!==SHELL).map(k=>caches.delete(k))))]))});
async function cipherChunk(meta,index){
  const url=new URL(meta.url,self.registration.scope),cacheURL=url.href+'?chunk='+index;
  if(url.origin!==location.origin||!(/\/(media|media-lite)\//.test(url.pathname)))throw Error('Invalid audio');
  let cache;try{cache=await caches.open(CHUNK_CACHE);const hit=await cache.match(cacheURL);if(hit)return new Uint8Array(await hit.arrayBuffer())}catch{}
  // A tiny first request starts playback; later requests batch 8 chunks to reduce latency.
  const first=index===0?0:1+Math.floor((index-1)/8)*8,last=index===0?0:Math.min(meta.chunks-1,first+7);
  const batchKey=url.href+'?batch='+first,unit=meta.chunkSize;
  const extract=bytes=>bytes.slice((index-first)*unit,Math.min(bytes.length,(index-first+1)*unit));
  if(chunkTasks.has(batchKey))return extract(await chunkTasks.get(batchKey));
  const task=(async()=>{
    const begin=12+first*unit,end=12+Math.min(meta.bytes,(last+1)*unit)-1;
    let bytes;
    try{const old=await(await caches.open('ielts-media-v2')).match(url.href);if(old)bytes=new Uint8Array(await old.arrayBuffer()).slice(begin,end+1)}catch{}
    for(let attempt=0;attempt<3;attempt++){
      if(bytes)break;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try{
        const response=await fetch(url.href,{headers:{Range:`bytes=${begin}-${end}`},signal:controller.signal});
        if(!response.ok)throw Error('HTTP '+response.status);
        bytes=new Uint8Array(await response.arrayBuffer());
        if(response.status===200)bytes=bytes.slice(begin,end+1);
        if(bytes.length!==end-begin+1){bytes=null;throw Error('Incomplete audio chunk')}
        break;
      }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)))}
      finally{clearTimeout(timer)}
    }
    if(cache)try{await Promise.all(Array.from({length:last-first+1},(_,n)=>cache.put(url.href+'?chunk='+(first+n),new Response(bytes.slice(n*unit,Math.min(bytes.length,(n+1)*unit)),{headers:{'Content-Type':'application/octet-stream'}}))))}catch{}
    return bytes;
  })();chunkTasks.set(batchKey,task);
  try{return extract(await task)}finally{chunkTasks.delete(batchKey)}
}
async function audioSession(event,id){
  const client=await self.clients.get(event.clientId);if(!client)throw Error('Locked');
  const channel=new MessageChannel();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Locked')),4000);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.key?resolve(e.data):reject(Error('Locked'))};
    client.postMessage({type:'audio-session',id},[channel.port2]);
  });
}
async function streamAudio(event,id){
  let session;try{session=await audioSession(event,id)}catch{return new Response('Unlock reader again',{status:403})}
  const {meta,key}=session,size=meta.bytes,range=event.request.headers.get('range');
  let start=0,end=size-1;
  if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    if(!m[1])start=Math.max(0,size-Number(m[2]));
    else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]))}
    if(start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  }
  let index=Math.floor(start/meta.chunkSize),cancelled=false;
  const body=new ReadableStream({
    async pull(controller){
      try{
        const encrypted=await cipherChunk(meta,index);
        if(cancelled)return;
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encrypted))].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(digest!==meta.hashes[index])throw Error('Audio integrity check failed');
        const counter=new Uint8Array(16);counter.set(meta.iv);new DataView(counter.buffer).setUint32(12,2+index*meta.chunkSize/16);
        const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-CTR',counter,length:32},key,encrypted));
        const base=index*meta.chunkSize;
        controller.enqueue(raw.slice(Math.max(0,start-base),Math.min(raw.length,end-base+1)));
        index++;
        if(index*meta.chunkSize>end)controller.close();
      }catch(error){if(!cancelled)controller.error(error)}
    },cancel(){cancelled=true}
  });
  const headers={'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store'};
  if(range)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  return new Response(body,{status:range?206:200,headers});
}
async function cacheTrack(message,client){
  if(downloads.has(message.id))return;
  const job={stopped:false};downloads.set(message.id,job);
  const meta=message.meta;let index=0,loaded=0,failed=false;
  const notify=done=>client?.postMessage({type:'audio-cache-progress',id:message.id,loaded,total:meta.chunks,done,failed});
  async function worker(){
    while(!job.stopped&&index<meta.chunks){const next=index++;try{await cipherChunk(meta,next);const cache=await caches.open(CHUNK_CACHE);if(!await cache.match(new URL(meta.url,self.registration.scope).href+'?chunk='+next))throw Error('Storage unavailable');loaded++;if(loaded%4===0)notify(false)}catch{failed=true;job.stopped=true}}
  }
  try{await Promise.all([worker(),worker()]);if(!job.stopped||failed)notify(loaded===meta.chunks)}finally{downloads.delete(message.id)}
}
self.addEventListener('message',event=>{
  const message=event.data||{};
  if(message.type==='audio-capability')event.ports[0]?.postMessage({streamVersion:2});
  if(message.type==='audio-cache')event.waitUntil(cacheTrack(message,event.source));
  if(message.type==='audio-cache-stop'){const job=downloads.get(message.id);if(job)job.stopped=true}
});
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);if(u.origin!==location.origin||event.request.method!=='GET')return;
  const match=/\/__audio_stream__\/([^/]+)\.mp3$/.exec(u.pathname);
  if(match){event.respondWith(streamAudio(event,match[1]));return}
  if(u.pathname.endsWith('.bin')||u.pathname.endsWith('config.json')||u.pathname.endsWith('audio-streams-v2.json'))return;
  event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(SHELL).then(c=>c.put(event.request,copy)).catch(()=>{})}return r}).catch(async()=>await caches.match(event.request)||(event.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));
});
