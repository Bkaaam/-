'use strict';
// Only encrypted responses are persisted. No password, key, or plaintext is stored.
const DATA_CACHE='ielts-data-v6', MEDIA_CACHE='ielts-media-v2', pendingAssets=new Map();
let warmConfig=null, warmCatalog=null, dictionaryTask=null, pronunciationTask=null, openingChapter=0;
async function cachedAsset(path,options={}){
  const url=new URL(path,location.href).href;
  let cache;try{cache=await caches.open(path.includes('media/')||path.includes('media-lite/')||path.includes('pronunciation/')?MEDIA_CACHE:DATA_CACHE);const hit=await cache.match(url);if(hit){const headers=new Headers(hit.headers);headers.set('X-IELTS-Cached','1');return new Response(hit.body,{status:200,headers})}}catch{}
  if(pendingAssets.has(url)){try{return(await pendingAssets.get(url)).clone()}catch(e){if(e.name==='AbortError'&&!options.signal?.aborted)return cachedAsset(path,options);throw e}}
  const task=(async()=>{
    let result;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch(url,{signal:options.signal});if(!response.ok)throw Error('HTTP '+response.status);
        result=response;
        if(options.progress&&response.body){
          const reader=response.body.getReader(),chunks=[];let size=0;
          for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;options.progress(size)}
          result=new Response(new Blob(chunks),{status:200,headers:response.headers});
        }
        break;
      }
      catch(error){if(options.signal?.aborted)throw error;if(attempt)throw error;await new Promise(resolve=>setTimeout(resolve,600))}
    }
    const headers=new Headers(result.headers);headers.set('X-IELTS-Cached','0');
    result=new Response(result.body,{status:200,headers});
    if(cache)try{headers.set('X-IELTS-Cached','1');const stored=new Response(result.clone().body,{status:200,headers});cache.put(url,stored).catch(()=>{})}catch{}
    return result;
  })();pendingAssets.set(url,task);
  try{return(await task).clone()}finally{pendingAssets.delete(url)}
}
async function getConfig(){
  const url=new URL('config.json',location.href).href;
  const refresh=async()=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('配置下载失败');const c=await r.clone().json();if(c.version<3||!c.bootstrap)throw Error('请刷新更新网页');try{await(await caches.open(DATA_CACHE)).put(url,r)}catch{}return c};
  try{const hit=await(await caches.open(DATA_CACHE)).match(url);if(hit){const c=await hit.json();if(c.version>=3&&c.bootstrap){refresh().catch(()=>{});return c}}}catch{}
  return refresh();
}
function primeLibrary(){
  warmConfig=getConfig();warmCatalog=warmConfig.then(c=>cachedAsset(c.bootstrap));
  warmConfig.catch(()=>{});warmCatalog.catch(()=>{});
}
async function readEncryptedJSON(path,k=key){
  const r=await cachedAsset(path);const raw=await decrypt(await r.arrayBuffer(),k);
  const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
async function unlockFast(e){
  e.preventDefault();if($('#unlock').disabled)return;
  const button=$('#unlock'),status=$('#unlockStatus');button.disabled=true;status.textContent='正在验证密码…';
  try{
    if(!crypto.subtle)throw Error('请使用 HTTPS 打开网站');
    if(!warmConfig)primeLibrary();
    const config=await warmConfig;
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode($('#password').value),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:base64bytes(config.salt),iterations:config.iterations,hash:'SHA-256'},material,256);
    const candidate=await crypto.subtle.importKey('raw',bits,'AES-GCM',false,['decrypt']);
    const candidateStreamKey=await crypto.subtle.importKey('raw',bits,'AES-CTR',false,['decrypt']);
    new Uint8Array(bits).fill(0);
    status.textContent='正在打开目录…';
    const r=await warmCatalog;let raw;
    try{raw=await decrypt(await r.clone().arrayBuffer(),candidate)}catch(error){if(error.name==='OperationError')throw Error('密码不正确，请重新输入');throw error}
    const data=JSON.parse(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    key=candidate;streamKey=candidateStreamKey;library=data;library.pronunciation={words:{}};items=data.items;dictionary={};dictionaryTask=pronunciationTask=null;
    $('#password').value='';$('#gate').hidden=true;$('#app').hidden=false;status.textContent='';await navigate('reading');
  }catch(error){status.textContent=error.message||'暂时无法打开，请重试';if(!key){warmConfig=null;warmCatalog=null}}
  finally{button.disabled=false}
}
async function ensureItem(id){
  const c=items.find(c=>c.id===id);if(!c)throw Error('未找到章节');
  const k=key;
  if(!c.text){const full=await readEncryptedJSON(c.asset,k);if(k!==key)throw Error('阅读器已锁定');Object.assign(c,full)}
  Object.assign(dictionary,c.dictionary||{});Object.assign(library.pronunciation.words,c.pronunciationWords||{});return c;
}
async function ensurePronunciation(word){
  if(library?.pronunciation?.words?.[word.toLowerCase()])return;
  if(!library?.pronunciationAsset)return;
  if(!pronunciationTask){const k=key;pronunciationTask=readEncryptedJSON(library.pronunciationAsset,k).then(p=>{if(k===key)library.pronunciation=p}).catch(e=>{pronunciationTask=null;throw e})}
  await pronunciationTask;
}
async function openReader(id){
  const ticket=++openingChapter;stopTopicVoice();toast('正在打开章节…');
  try{await ensureItem(id);if(ticket!==openingChapter||!key)return;await renderReader(id)}catch(e){if(key)toast('章节加载失败，请检查网络后重试')}
}
async function cacheCurrentAudio(){
  if(!current?.audio)return;
  const item=current,button=$('#downloadAudio');button.disabled=true;button.textContent='正在缓存…';
  try{const r=await cachedAsset(item.audio.url);if(r.headers.get('X-IELTS-Cached')!=='1')throw Error('存储不可用');if(current?.id===item.id)button.textContent='已缓存 ✓';toast('本节已保存在此浏览器，下次直接读取本机缓存')}
  catch{toast('缓存失败，请检查网络或存储空间')}
  finally{button.disabled=false}
}
primeLibrary();
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').then(r=>r.update()).catch(()=>{});let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;/* New shell is used on the next navigation; preserve current study. */}})}
