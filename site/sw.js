const SHELL='ielts-shell-v4.0';
const FILES=['./','./index.html','./fast.js?v=4.0','./app.js?v=4.0','./topics.js?v=4.0','./upgrade.js?v=4.0','./style.css?v=4.0','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ielts-shell-')&&k!==SHELL).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
 if(u.pathname.endsWith('.bin')||u.pathname.endsWith('config.json'))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(SHELL).then(c=>c.put(e.request,copy)).catch(()=>{})}return r}).catch(async()=>await caches.match(e.request)||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));
});
