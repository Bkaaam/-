'use strict';
// Keys and decrypted data stay in memory. Only encrypted chunks enter Cache Storage.
function stopTopicVoice(){}
function clearTopics(){}
let streamManifestTask=null,activeStream=null,streamKey=null;
const streamMetadata=new Map();
const streamSessions=new Map();
async function streamManifest(){
  if(!streamManifestTask)streamManifestTask=cachedAsset('audio-streams-v2.json').then(r=>r.json()).catch(e=>{streamManifestTask=null;throw e});
  return streamManifestTask;
}
if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  const message=event.data||{};
  if(message.type==='audio-session'){
    const session=streamSessions.get(message.id);
    event.ports[0]?.postMessage(session&&streamKey===session.key&&key?session:null);return;
  }
  if(message.type==='audio-cache-progress'&&activeStream?.id===message.id){
    const button=$('#downloadAudio');
    button.disabled=false;
    button.textContent=message.done?'已缓存 ✓':message.failed?'继续缓存':`边听边缓存 ${Math.round(message.loaded/message.total*100)}%`;
    if(message.failed)toast('下载暂时中断，已缓存部分保留，点击继续缓存即可');
  }
});
async function audioWorker(){
  if(!('serviceWorker'in navigator))return null;
  await navigator.serviceWorker.ready;
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration?.active?.scriptURL.endsWith('/sw.js'))return null;
  if(!navigator.serviceWorker.controller){
    await new Promise(resolve=>{const timer=setTimeout(resolve,2500);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true})});
  }
  const worker=navigator.serviceWorker.controller;if(!worker)return null;
  const channel=new MessageChannel();
  return await new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(null),1800);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.streamVersion===2?worker:null)};
    worker.postMessage({type:'audio-capability'},[channel.port2]);
  });
}
async function pageAudioChunk(meta,index,signal){
  const url=new URL(meta.url,location.href),cacheURL=url.href+'?chunk='+index;
  let cache;try{cache=await caches.open('ielts-audio-chunks-v2');const hit=await cache.match(cacheURL);if(hit)return new Uint8Array(await hit.arrayBuffer())}catch{}
  const begin=12+index*meta.chunkSize,end=12+Math.min(meta.bytes,(index+1)*meta.chunkSize)-1;
  let bytes;
  for(let attempt=0;attempt<3;attempt++)try{
    const response=await fetch(url,{headers:{Range:`bytes=${begin}-${end}`},signal});if(!response.ok)throw Error('Audio '+response.status);
    bytes=new Uint8Array(await response.arrayBuffer());if(response.status===200)bytes=bytes.slice(begin,end+1);
    if(bytes.length!==end-begin+1)throw Error('Incomplete audio');break;
  }catch(error){if(signal?.aborted||attempt===2)throw error}
  if(cache)try{await cache.put(cacheURL,new Response(bytes))}catch{}
  return bytes;
}
async function streamDescription(path){
  const descriptor=(await streamManifest())[path];if(!descriptor)return null;
  if(!streamMetadata.has(path))streamMetadata.set(path,readEncryptedJSON(descriptor.asset).catch(e=>{streamMetadata.delete(path);throw e}));
  return streamMetadata.get(path);
}
async function decodeAudioChunk(meta,index,bytes){
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==meta.hashes[index])throw Error('Audio integrity check failed');
  const counter=new Uint8Array(16);counter.set(meta.iv);new DataView(counter.buffer).setUint32(12,2+index*meta.chunkSize/16);
  return crypto.subtle.decrypt({name:'AES-CTR',counter,length:32},streamKey,bytes);
}
async function listeningSource(chapter,signal){
  const meta=await streamDescription(chapter.audio.url);
  if(meta){
    const worker=await audioWorker();
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(worker){
      const id=crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
      const session={id,meta,key:streamKey};streamSessions.set(id,session);activeStream=session;
      $('#downloadAudio').textContent='准备边听边缓存';
      return new URL('__audio_stream__/'+id+'.mp3',location.href).href;
    }
    // Older browsers still work; decrypt the same chunks into a local Blob.
    const chunks=[];
    for(let i=0;i<meta.chunks;i++){
      const raw=await pageAudioChunk(meta,i,signal);
      chunks.push(await decodeAudioChunk(meta,i,raw));$('#trackTitle').textContent=`原声下载 ${Math.round((i+1)/meta.chunks*100)}%`;
    }
    return URL.createObjectURL(new Blob(chunks,{type:'audio/mpeg'}));
  }
  const response=await cachedAsset(chapter.audio.url,{signal,progress:n=>{$('#trackTitle').textContent=`原声下载 ${Math.min(100,Math.round(n/(chapter.audio.bytes+28)*100))}%`}});
  return URL.createObjectURL(new Blob([await decrypt(await response.arrayBuffer())],{type:chapter.audio.mime||'audio/mpeg'}));
}
function beginStreamDownload(){
  if(activeStream&&navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({type:'audio-cache',id:activeStream.id,meta:activeStream.meta});
    $('#downloadAudio').textContent='边听边缓存…';
  }
}
function stopStreamDownload(){
  if(activeStream)navigator.serviceWorker?.controller?.postMessage({type:'audio-cache-stop',id:activeStream.id});
  activeStream=null;streamSessions.clear();
}
async function cacheListeningAudio(){
  if(!current?.audio)return;
  if(activeStream){beginStreamDownload();return}
  const button=$('#downloadAudio');button.disabled=true;button.textContent='正在缓存…';
  try{
    const meta=await streamDescription(current.audio.url);
    if(meta){for(let i=0;i<meta.chunks;i++){await pageAudioChunk(meta,i);button.textContent=`正在缓存 ${Math.round((i+1)/meta.chunks*100)}%`}}
    else{const response=await cachedAsset(current.audio.url);await(await caches.open(MEDIA_CACHE)).put(new URL(current.audio.url,location.href),response.clone())}
    button.textContent='已缓存 ✓';
  }
  catch{toast('缓存未完成，请检查网络和存储空间')}
  finally{button.disabled=false}
}
