'use strict';
// Keys and decrypted data stay in memory. Only encrypted chunks enter Cache Storage.
function stopTopicVoice(){}
function clearTopics(){}
let streamManifestTask=null,activeStream=null,streamKey=null;
const streamMetadata=new Map();
const streamSessions=new Map();
const failedStreamTracks=new Set(),originalAudioRecovery=new Set();
let activePlayback=null,audioStartTimer=0;
function isMiBrowser(){return /MiuiBrowser|MiBrowser|XiaoMi|Mint Browser/i.test(navigator.userAgent||'')}
function wantsCompatibleAudio(id){return failedStreamTracks.has(id)||notes.audioPlayback==='compatible'||(notes.audioPlayback!=='stream'&&isMiBrowser())}
function renderPlaybackOptions(chapter){
  let panel=$('#playbackOptions');
  if(!panel){panel=document.createElement('div');panel.id='playbackOptions';panel.className='playback-options';panel.innerHTML='<label>播放方式 <select id="audioPlayback"><option value="auto">自动适配浏览器</option><option value="compatible">兼容播放（小米推荐）</option><option value="stream">边听边缓存</option></select></label><p id="playbackStatus" role="status"></p><button id="retryListening" hidden>重新加载音频</button>';$('#listeningTools').append(panel)}
  $('#audioPlayback').value=notes.audioPlayback||'auto';
  $('#audioPlayback').onchange=()=>{saveProgress();notes.audioPlayback=$('#audioPlayback').value;failedStreamTracks.delete(chapter.id);originalAudioRecovery.delete(chapter.id);scheduleSave();renderReader(chapter.id)};
  $('#retryListening').hidden=true;
  $('#retryListening').onclick=()=>{failedStreamTracks.add(chapter.id);renderReader(chapter.id)};
  $('#playbackStatus').textContent=wantsCompatibleAudio(chapter.id)?'兼容模式：录音下载解密完成后播放，下载一次可重复听。':'正在准备原声；流式加载失败时会自动切换兼容播放。';
  $('#systemAudio').open=isMiBrowser()||notes.audioPlayback==='compatible';
}
async function compatibleAudioSource(chapter,signal){
  const encryptionKey=key,url=new URL(chapter.audio.url,location.href).href;
  const memory=decodedListeningBlobs.get(url);if(memory?.key===key)return URL.createObjectURL(memory.blob);
  const progress=n=>{if(current?.id===chapter.id)$('#trackTitle').textContent=`兼容播放 · 下载 ${Math.min(100,Math.round(n/(chapter.audio.bytes+28)*100))}%`};
  let cache;try{cache=await caches.open(MEDIA_CACHE)}catch{}
  const decode=async bytes=>{
    const raw=await decrypt(bytes,encryptionKey);
    if(signal.aborted||key!==encryptionKey)throw new DOMException('Aborted','AbortError');
    const blob=new Blob([raw],{type:'audio/mpeg'});decodedListeningBlobs.set(url,{key:encryptionKey,blob});if(decodedListeningBlobs.size>3)decodedListeningBlobs.delete(decodedListeningBlobs.keys().next().value);return URL.createObjectURL(blob);
  };
  if(cache){const hit=await cache.match(url);if(hit)try{return await decode(await hit.arrayBuffer())}catch(error){if(signal.aborted)throw error;await cache.delete(url)}}
  // Three bounded range requests resume existing chunks; the final GCM tag authenticates the full MP3.
  try{const meta=await streamDescription(chapter.audio.url);if(meta){
    const bytes=await resumableRecording(meta,signal,progress);const source=await decode(bytes);
    if(cache)cache.put(url,new Response(bytes)).catch(()=>{});return source;
  }}catch(error){if(signal.aborted)throw error}
  for(let attempt=0;attempt<2;attempt++)try{
    const response=await cachedAsset(chapter.audio.url,{signal,progress});
    const source=await decode(await response.arrayBuffer());return source;
  }catch(error){if(signal.aborted||attempt===1)throw error;if(cache)await cache.delete(url)}
}
function recordPlayback(chapter,source,mode){
  activePlayback={id:chapter.id,path:chapter.audio.url,source,mode};
  return source;
}
function watchAudioStart(){
  clearTimeout(audioStartTimer);
  if(activePlayback?.mode!=='stream')return;
  const source=activePlayback.source;
  audioStartTimer=setTimeout(()=>{if(activePlayback?.source===source&&audio.readyState<1)handleListeningFailure()},14000);
}
function handleListeningFailure(){
  const playback=activePlayback;
  if(!playback||current?.id!==playback.id||audio.getAttribute('src')!==playback.source)return;
  clearTimeout(audioStartTimer);saveProgress();activePlayback=null;
  if(playback.mode==='stream'){
    failedStreamTracks.add(playback.id);toast('正在自动切换兼容播放…');renderReader(playback.id);return;
  }
  if(current.audioFast?.url===playback.path&&current.audioOriginal?.url!==playback.path&&!originalAudioRecovery.has(playback.id)){
    originalAudioRecovery.add(playback.id);failedStreamTracks.add(playback.id);toast('正在尝试原音质兼容播放…');renderReader(playback.id);return;
  }
  $('#play').disabled=true;$('#trackTitle').textContent='录音暂未能播放';
  if($('#playbackStatus'))$('#playbackStatus').textContent='请点击重新加载，也可以展开底部系统播放器重试。';
  if($('#retryListening'))$('#retryListening').hidden=false;
}
function listeningLoadFailed(id,version){
  if(current?.id!==id||version!==requestVersion)return;
  $('#trackTitle').textContent='录音加载未完成';
  if($('#playbackStatus'))$('#playbackStatus').textContent='请保持页面打开并重试；已保存的生词和进度不受影响。';
  if($('#retryListening'))$('#retryListening').hidden=false;
}
function fitAudioPanel(){
  const player=$('#player');if(player&&!player.hidden)document.documentElement.style.setProperty('--audio-panel-height',player.offsetHeight+'px');
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(fitAudioPanel).observe($('#player'));
window.addEventListener('resize',fitAudioPanel);
$('#systemAudio').addEventListener('toggle',fitAudioPanel);
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
  if(wantsCompatibleAudio(chapter.id))return recordPlayback(chapter,await compatibleAudioSource(chapter,signal),'compatible');
  let meta;try{meta=await streamDescription(chapter.audio.url)}catch(error){if(signal.aborted)throw error}
  if(meta){
    const worker=await audioWorker();
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(worker){
      const id=crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
      const session={id,meta,key:streamKey};streamSessions.set(id,session);activeStream=session;
      $('#downloadAudio').textContent='准备边听边缓存';
      return recordPlayback(chapter,new URL('__audio_stream__/'+id+'.mp3',location.href).href,'stream');
    }
    return recordPlayback(chapter,await compatibleAudioSource(chapter,signal),'compatible');
  }
  return recordPlayback(chapter,await compatibleAudioSource(chapter,signal),'compatible');
}
function beginStreamDownload(){
  clearTimeout(audioStartTimer);$('#downloadAudio').disabled=false;
  if($('#playbackStatus'))$('#playbackStatus').textContent=activePlayback?.mode==='stream'?'已就绪 · 边听边缓存':originalAudioRecovery.has(current?.id)?'已就绪 · 原音质兼容播放':'已就绪 · 兼容播放，可反复收听';
  if(activePlayback?.mode==='compatible')$('#downloadAudio').textContent='已缓存 ✓';
  if(activeStream&&navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({type:'audio-cache',id:activeStream.id,meta:activeStream.meta});
    $('#downloadAudio').textContent='边听边缓存…';
  }
}
function stopStreamDownload(){
  clearTimeout(audioStartTimer);activePlayback=null;
  if(activeStream)navigator.serviceWorker?.controller?.postMessage({type:'audio-cache-stop',id:activeStream.id});
  activeStream=null;streamSessions.clear();
}
async function cacheListeningAudio(){
  if(!current?.audio)return;
  if(activeStream){beginStreamDownload();return}
  const chapter=current,button=$('#downloadAudio');button.disabled=true;button.textContent='正在缓存…';
  try{const source=await compatibleAudioSource(chapter,loadController?.signal||new AbortController().signal);URL.revokeObjectURL(source);if(current?.id===chapter.id)button.textContent='已缓存 ✓'}
  catch(error){if(error.name!=='AbortError')toast('缓存未完成，已下载片段保留，点击可续传')}
  finally{button.disabled=false}
}
