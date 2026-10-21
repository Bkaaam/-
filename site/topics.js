'use strict';
const topicVoice=new Audio();let topicVoiceURL=null,topicVoiceVersion=0,topicManifest=null,topicData=null,topicLoadVersion=0,topicSource=null,topicExercise=null;
function stopTopicVoice(){topicVoiceVersion++;topicVoice.pause();if(topicVoiceURL){URL.revokeObjectURL(topicVoiceURL);topicVoiceURL=null}topicVoice.removeAttribute('src')}
function clearTopics(){topicLoadVersion++;topicData=null;topicManifest=null;topicSource=null;topicExercise=null}
function sourceLabel(id){const c=items.find(x=>x.id===id);return c?`剑${c.book} T${c.test} Part ${c.part}`:id}
async function renderTopics(){
  $('#special').hidden=false;
  $('#special').innerHTML='<div class="intro"><h1>话题语料</h1><p>正在读取资料…</p></div>';
  try{
    if(!topicManifest){let response;try{response=await fetch('topics.json',{cache:'no-cache'});if(!response.ok)throw Error('manifest');try{await(await caches.open(DATA_CACHE)).put(new URL('topics.json',location.href),response.clone())}catch{}}catch{response=await cachedAsset('topics.json')}topicManifest=await response.json()}
    $('#special').innerHTML=`<div class="intro"><div class="eyebrow">LISTENING BY TOPIC</div><h1>把同一个话题，听熟。</h1><p>以后可以继续按“话题 + 剑几 / Test / Part”添加，每组单独学习。</p></div>${topicManifest.topics.map(t=>`<button class="topic-collection" data-topic-open="${esc(t.id)}"><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><span>${t.sourceCount} 段原声 · 进入学习 →</span></button>`).join('')}`;
    $$('#special [data-topic-open]').forEach(b=>b.onclick=()=>openTopic(b.dataset.topicOpen));
  }catch{toast('话题目录暂时无法载入，请检查网络后重试')}
}
async function openTopic(id){
  const ticket=++topicLoadVersion,k=key,metadata=topicManifest?.topics.find(t=>t.id===id);if(!metadata)return;
  $('#special').innerHTML='<div class="panel">正在打开语料…</div>';
  try{const data=await readEncryptedJSON(metadata.asset,k);if(ticket!==topicLoadVersion||k!==key||view!=='topics')return;topicData=data;topicSource=data.sources[0]?.id;topicExercise=null;renderTopicStudy()}
  catch{if(k===key)toast('话题资料读取失败，请重试')}
}
function topicEntries(){return(topicData?.entries||[]).filter(e=>e.sourceId===topicSource)}
function renderTopicStudy(){
  if(!topicData)return;stopTopicVoice();
  $('#special').innerHTML=`<div class="intro topic-intro"><button id="topicBack">← 话题目录</button><div class="eyebrow">DAILY LIFE & SOCIAL</div><h1>${esc(topicData.title)}</h1><p>${esc(topicData.description)}</p></div><div class="topic-source-grid">${topicData.sources.map(s=>`<button class="topic-source-card ${s.id===topicSource?'selected':''}" data-source="${esc(s.id)}"><span>${esc(sourceLabel(s.id))}</span>${s.priority?'<b>重点</b>':'<small>补充</small>'}<strong>${esc(s.title)}</strong><small>${esc(s.summary)}</small></button>`).join('')}</div><div class="topic-tabs"><button id="topicLearn" class="selected">语料学习</button><button id="topicDictate">本段听写</button></div><div id="topicMain"></div><p class="summary">${esc(topicData.contentNote||'')}<br>${esc(topicData.voiceNote||'')}</p>`;
  $('#topicBack').onclick=renderTopics;
  $$('#special [data-source]').forEach(b=>b.onclick=()=>{topicSource=b.dataset.source;topicExercise=null;renderTopicStudy()});
  $('#topicLearn').onclick=()=>{stopTopicVoice();$('#topicLearn').classList.add('selected');$('#topicDictate').classList.remove('selected');renderTopicLearn()};
  $('#topicDictate').onclick=()=>{stopTopicVoice();$('#topicDictate').classList.add('selected');$('#topicLearn').classList.remove('selected');startTopicDictation()};
  renderTopicLearn();
}
function renderTopicLearn(){
  const pool=topicEntries(),source=topicData.sources.find(s=>s.id===topicSource);
  $('#topicMain').innerHTML=`<p class="summary">${esc(sourceLabel(topicSource))} · ${pool.length} 个表达与答案词${source?.priority?' · 重点练习':''}</p>${pool.map(e=>`<div class="topic-entry"><div class="topic-entry-head"><div><span class="topic-badge">${e.isAnswer?'填空答案词 · ':''}${esc(e.kind==='phrase'?'常见表达':'重点词汇')}${e.contextReliable?'':' · 原句待核对'}</span><h2>${esc(e.term)}</h2><span class="phonetic">${esc(e.phonetic?'/'+normalizedPhonetic(e.phonetic)+'/':'')}</span></div><button data-topic-voice="${esc(e.id)}">▶ 听词</button></div><p class="topic-meaning">${esc(e.meaning)}</p><blockquote>${esc(e.sentence)}</blockquote><p class="context-meaning">${esc(e.sentenceZh)}</p><p class="topic-tip">为何常考：${esc(e.reason)}</p><div class="actions">${e.originalVoice?`<button data-topic-original="${esc(e.id)}">▶ 听原声语境</button>`:''}<button data-topic-save="${esc(e.id)}">${vocab['corpus|'+e.id]?'✓ 已收藏':'＋ 收藏到听力语料库'}</button><button data-topic-source="${esc(e.sourceId)}">打开完整原文 ↗</button></div></div>`).join('')}`;
  bindTopicActions();
}
function bindTopicActions(){
  $$('#topicMain [data-topic-voice]').forEach(b=>b.onclick=()=>playTopicVoice(topicData.entries.find(e=>e.id===b.dataset.topicVoice),false));
  $$('#topicMain [data-topic-original]').forEach(b=>b.onclick=()=>playTopicVoice(topicData.entries.find(e=>e.id===b.dataset.topicOriginal),true));
  $$('#topicMain [data-topic-save]').forEach(b=>b.onclick=()=>{const e=topicData.entries.find(x=>x.id===b.dataset.topicSave);saveTopicEntry(e);b.textContent='✓ 已收藏'});
  $$('#topicMain [data-topic-source]').forEach(b=>b.onclick=()=>openReader(b.dataset.topicSource));
}
function saveTopicEntry(e){
  if(!e)return;vocab['corpus|'+e.id]={category:'corpus',word:e.term,id:e.sourceId,title:sourceLabel(e.sourceId)+' · '+(topicData?.title||'话题语料'),sentence:e.sentence,meaning:e.meaning,phonetic:e.phonetic||'',note:'为何常考：'+e.reason+'\n原句含义：'+e.sentenceZh};scheduleSave();toast('已收藏到听力语料库');
}
async function playTopicVoice(entry,original=false){
  if(!entry)return;stopSpeech();stopWordAudio();audio.pause();stopTopicVoice();const version=topicVoiceVersion,k=key,path=original?entry.originalVoice:entry.voice;if(!path){if(original){toast('这条原声片段暂未可靠定位，可打开完整原文');return}if(!('speechSynthesis'in window)){toast('此浏览器暂不支持设备词音');return}const u=new SpeechSynthesisUtterance(entry.term);u.lang='en-GB';u.rate=Number($('#topicSpeed')?.value)||1;const voices=speechSynthesis.getVoices().filter(v=>/^en[-_]/i.test(v.lang));u.voice=voices.find(v=>v.lang==='en-GB')||voices[0]||null;speechSynthesis.speak(u);return}
  try{const response=await cachedAsset(path),raw=await decrypt(await response.arrayBuffer(),k);if(version!==topicVoiceVersion||k!==key)return;topicVoiceURL=URL.createObjectURL(new Blob([raw],{type:'audio/mpeg'}));topicVoice.src=topicVoiceURL;topicVoice.playbackRate=Number($('#topicSpeed')?.value)||1;await topicVoice.play()}
  catch{if(k===key)toast('语音暂时无法播放，请重试')}
}
function startTopicDictation(){topicExercise={pool:topicEntries(),index:0,revealed:false};renderTopicQuestion()}
function renderTopicQuestion(){
  const q=topicExercise;if(!q)return;
  const e=q.pool[q.index];if(!e){$('#topicMain').innerHTML='<div class="panel"><h2>本段练习完成</h2><button id="topicRestart">再练一次</button></div>';$('#topicRestart').onclick=startTopicDictation;return}
  q.revealed=false;
  $('#topicMain').innerHTML=`<div class="panel quiz-card"><div class="eyebrow">${esc(sourceLabel(e.sourceId))} · ${q.index+1} / ${q.pool.length}</div><h2>听音并写下词语或短语</h2><p>写完点“确认”就显示答案，不以拼写对错阻止继续。</p><div class="quiz-audio"><button id="topicPlay" class="primary">▶ 听示范词音</button>${e.originalVoice?'<button id="topicOriginal">▶ 听真题原声</button>':''}<select id="topicSpeed" aria-label="播放速度"><option value="0.8">0.8 倍</option><option value="1" selected>原速</option><option value="1.2">1.2 倍</option><option value="1.5">1.5 倍</option></select></div><form id="topicForm"><label for="topicAnswer">你听到了什么？</label><input id="topicAnswer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入听写内容"><button type="submit">确认并显示答案</button></form><div id="topicReveal" hidden><h2>${esc(e.term)} ${e.isAnswer?'<small>填空答案词</small>':''}</h2><p>${esc(e.meaning)}</p><blockquote>${esc(e.sentence)}</blockquote><p class="context-meaning">原句含义：${esc(e.sentenceZh)}</p><p class="topic-tip">为何常考：${esc(e.reason)}</p><div class="actions"><button id="topicSave">${vocab['corpus|'+e.id]?'✓ 已收藏':'＋ 收藏到听力语料库'}</button><button id="topicNext" class="primary">下一条 →</button></div></div></div>`;
  $('#topicPlay').onclick=()=>playTopicVoice(e,false);
  if($('#topicOriginal'))$('#topicOriginal').onclick=()=>playTopicVoice(e,true);
  $('#topicSpeed').onchange=()=>topicVoice.playbackRate=Number($('#topicSpeed').value);
  $('#topicForm').onsubmit=event=>{event.preventDefault();if(q.revealed)return;q.revealed=true;$('#topicReveal').hidden=false;$('#topicAnswer').setAttribute('readonly','')};
  $('#topicSave').onclick=()=>{saveTopicEntry(e);$('#topicSave').textContent='✓ 已收藏'};
  $('#topicNext').onclick=()=>{stopTopicVoice();q.index++;renderTopicQuestion()};
}
