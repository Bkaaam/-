'use strict';
const topicVoice=new Audio();let topicVoiceURL=null,topicVoiceVersion=0,topicData=null,topicManifest=null,topicLoadVersion=0;
let topicFilter={query:'',kind:'all',category:'all',repeated:false,unlearned:false},quiz=null;
function stopTopicVoice(){topicVoiceVersion++;topicVoice.pause();if(topicVoiceURL){URL.revokeObjectURL(topicVoiceURL);topicVoiceURL=null}topicVoice.removeAttribute('src')}
function clearTopics(){topicLoadVersion++;topicData=null;topicManifest=null;quiz=null;topicFilter={query:'',kind:'all',category:'all',repeated:false,unlearned:false}}
function sourceLabel(id){const c=items.find(c=>c.id===id);return c?`剑${c.book} T${c.test} Part ${c.part}`:id}
function topicMastered(e){return !!notes.topicMastery?.[e.id]}
async function renderTopics(){
  const ticket=++topicLoadVersion;$('#breadcrumb').textContent='TOPIC STUDIO';location.hash='topics';
  $('#special').innerHTML='<div class="intro"><div class="eyebrow">LISTEN. NOTICE. USE.</div><h1>把听过的，变成会用的。</h1><p>按话题整理的词汇、表达与原声练习。</p></div><div id="topicHome" class="panel">正在打开话题…</div>';
  try{
    if(!topicManifest){let r;try{r=await fetch('topics.json',{cache:'no-cache'});if(!r.ok)throw Error('manifest');try{await(await caches.open(DATA_CACHE)).put(new URL('topics.json',location.href),r.clone())}catch{}}catch{r=await cachedAsset('topics.json')}topicManifest=await r.json()}
    if(ticket!==topicLoadVersion||view!=='topics'||!key)return;
    $('#topicHome').innerHTML=topicManifest.topics.map(t=>`<button class="topic-collection" data-topic-open="${esc(t.id)}"><span class="eyebrow">LISTENING COLLECTION 01</span><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><span>打开专题 →</span></button>`).join('')+'<p class="summary">以后继续按“话题名称 + 剑几 / Test / Part”添加材料，每个话题独立保存学习进度。</p>';
    $('#topicHome').onclick=e=>{const b=e.target.closest('[data-topic-open]');if(b)openTopic(b.dataset.topicOpen)};
  }catch{$('#topicHome').innerHTML='<p>专题目录暂时无法加载，请检查网络。</p><button id="retryTopics">重试</button>';$('#retryTopics').onclick=renderTopics}
}
async function openTopic(id){
  const ticket=++topicLoadVersion;const k=key;const metadata=topicManifest?.topics.find(t=>t.id===id);if(!metadata)return;
  toast('正在打开专题…');
  try{const data=await readEncryptedJSON(metadata.asset,k);if(ticket!==topicLoadVersion||k!==key||view!=='topics')return;topicData=data;quiz=null;renderTopicStudy();window.scrollTo(0,0)}
  catch{if(k===key)toast('专题加载失败，请重试')}
}
function filteredEntries(){return(topicData?.entries||[]).filter(e=>(topicFilter.kind==='all'||e.kind===topicFilter.kind)&&(topicFilter.category==='all'||e.category===topicFilter.category)&&(!topicFilter.repeated||e.documentCount>1)&&(!topicFilter.unlearned||!topicMastered(e))&&(!topicFilter.query||[e.term,e.meaning,e.tip].some(v=>v.toLowerCase().includes(topicFilter.query.toLowerCase())))).sort((a,b)=>b.documentCount-a.documentCount||b.occurrences-a.occurrences)}
function renderTopicStudy(){
  if(!topicData)return;const t=topicData,mastered=t.entries.filter(topicMastered).length;
  $('#special').innerHTML=`<div class="intro topic-intro"><button id="topicBack">← 全部话题</button><div class="eyebrow">DAILY LIFE & SOCIAL CONNECTIONS</div><h1>${esc(t.title)}</h1><p>${esc(t.description)}</p></div><div class="topic-stats"><div><b>${t.sourceIds.length}</b><span>原始语料</span></div><div><b>${t.entries.length}</b><span>词汇与表达</span></div><div><b id="topicMasteredCount">${mastered}</b><span>已掌握</span></div></div>
  <div class="topic-tabs"><button id="topicStudy" class="selected">词汇与表达</button><button id="topicQuiz">听音练习</button><button id="topicSkills">听力考点</button></div>
  <section id="topicStudyPanel"><div class="topic-filters"><input id="topicSearch" type="search" placeholder="搜索词汇、含义或考点" aria-label="搜索专题词汇" value="${esc(topicFilter.query)}"><select id="topicKind" aria-label="词条类型"><option value="all">全部词条</option><option value="word">重点词汇</option><option value="phrase">常见表达</option></select><select id="topicCategory" aria-label="场景分类"><option value="all">全部场景</option>${[...new Set(t.entries.map(e=>e.category))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><label><input type="checkbox" id="topicRepeated" ${topicFilter.repeated?'checked':''}> 多篇重复</label><label><input type="checkbox" id="topicUnlearned" ${topicFilter.unlearned?'checked':''}> 仅未掌握</label></div><p id="topicCount" class="summary"></p><div id="topicEntries"></div></section>
  <section id="topicQuizPanel" hidden></section><section id="topicSkillsPanel" hidden>${t.skills.map(s=>`<div class="panel"><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p><div class="actions">${s.sourceIds.map(id=>`<button data-topic-source="${esc(id)}">${esc(sourceLabel(id))} ↗</button>`).join('')}</div></div>`).join('')}</section>
  <details class="panel topic-sources"><summary>本专题的 9 份材料</summary>${t.sources.map(s=>`<div class="topic-source"><button data-topic-source="${esc(s.id)}">${esc(sourceLabel(s.id))} ↗</button><strong>${esc(s.title)}</strong><p>${esc(s.summary)}</p></div>`).join('')}</details><p class="summary">${esc(t.frequencyNote.replace('documentCount 为','篇数指'))}<br>${esc(t.voiceNote)}<br>${esc(t.contentNote)}</p>`;
  $('#topicKind').value=topicFilter.kind;$('#topicCategory').value=topicFilter.category;
  $('#topicBack').onclick=()=>{stopTopicVoice();renderTopics()};
  for(const [id,name]of [['topicStudy','Study'],['topicQuiz','Quiz'],['topicSkills','Skills']])$('#'+id).onclick=()=>{stopTopicVoice();for(const panel of ['Study','Quiz','Skills']){$('#topic'+panel+'Panel').hidden=panel!==name;$('#topic'+panel).classList.toggle('selected',panel===name)}if(name==='Quiz')startTopicQuiz()};
  $('#topicSearch').oninput=e=>{topicFilter.query=e.target.value;renderTopicEntries()};$('#topicKind').onchange=e=>{topicFilter.kind=e.target.value;renderTopicEntries()};$('#topicCategory').onchange=e=>{topicFilter.category=e.target.value;renderTopicEntries()};$('#topicRepeated').onchange=e=>{topicFilter.repeated=e.target.checked;renderTopicEntries()};$('#topicUnlearned').onchange=e=>{topicFilter.unlearned=e.target.checked;renderTopicEntries()};
  $('#special').addEventListener('click',topicClick);
  renderTopicEntries();
}
function renderTopicEntries(){
  const list=filteredEntries();$('#topicCount').textContent=`显示 ${list.length} 项 · ${topicData.entries.filter(e=>e.documentCount>1).length} 项在本组多篇重复 · 频次仅限这 9 篇`;
  $('#topicEntries').innerHTML=list.map(e=>`<div class="topic-entry ${topicMastered(e)?'mastered':''}" id="${esc(e.id)}"><div class="topic-entry-head"><div><span class="topic-badge">${e.kind==='word'?'词汇':'表达'} · ${esc(e.category)}</span><h2>${esc(e.term)}</h2>${e.phonetic?`<div class="phonetic">/${esc(normalizedPhonetic(e.phonetic))}/</div>`:''}</div><button data-topic-voice="${esc(e.id)}" aria-label="播放 ${esc(e.term)} 示范读音">▶ 示范</button></div><p class="topic-meaning">${esc(e.meaning)}</p><p class="topic-tip">${esc(e.tip)}</p><div class="topic-entry-footer"><span>${e.documentCount>1?`本组 ${e.documentCount} 篇重复`:'单篇考点'} · 共 ${e.occurrences} 次</span><button data-topic-master="${esc(e.id)}" aria-pressed="${topicMastered(e)}">${topicMastered(e)?'✓ 已掌握':'标记掌握'}</button></div><details><summary>原文语境与来源${e.originalVoice?' · 可听原声':''}</summary>${e.evidence.map(ev=>`<div class="topic-evidence"><button data-topic-source="${esc(ev.id)}" data-topic-char="${ev.charStart}">${esc(sourceLabel(ev.id))} ↗</button><blockquote>${esc(ev.context)}</blockquote>${e.originalVoice&&e.originalEvidenceId===ev.id?`<button data-topic-original="${esc(e.id)}">▶ 语境原声片段</button>`:''}</div>`).join('')}</details></div>`).join('')||'<div class="empty">没有符合条件的词条，试试调整筛选。</div>';
}
async function topicClick(event){
 const b=event.target.closest('button');if(!b||!topicData)return;
 const id=b.dataset.topicVoice||b.dataset.topicOriginal||b.dataset.topicMaster;
 const entry=topicData.entries.find(e=>e.id===id);
 if(b.dataset.topicVoice&&entry)playTopicVoice(entry,false);
 if(b.dataset.topicOriginal&&entry)playTopicVoice(entry,true);
 if(b.dataset.topicMaster&&entry){notes.topicMastery||={};notes.topicMastery[id]=!notes.topicMastery[id];scheduleSave();$('#topicMasteredCount').textContent=topicData.entries.filter(topicMastered).length;renderTopicEntries()}
 if(b.dataset.topicSource){const char=Number(b.dataset.topicChar);await openReader(b.dataset.topicSource);if(Number.isFinite(char)){const word=$(`#text [data-char="${char}"]`);word?.scrollIntoView({block:'center',behavior:'smooth'})}}
}
async function playTopicVoice(entry,original=false){
 stopSpeech();stopWordAudio();audio.pause();stopTopicVoice();const version=topicVoiceVersion,k=key;const path=original?entry.originalVoice:entry.voice;if(!path)return;
 try{const r=await cachedAsset(path),raw=await decrypt(await r.arrayBuffer(),k);if(version!==topicVoiceVersion||k!==key)return;topicVoiceURL=URL.createObjectURL(new Blob([raw],{type:'audio/mpeg'}));topicVoice.src=topicVoiceURL;topicVoice.playbackRate=Number($('#quizSpeed')?.value)||.9;await topicVoice.play()}
 catch{if(k===key)toast('语音暂时无法播放，请重试')}
}
function startTopicQuiz(){
 const pool=filteredEntries();if(!pool.length){$('#topicQuizPanel').innerHTML='<div class="empty">当前筛选没有词条，请回词汇页调整筛选。</div>';return}
 quiz={pool:pool.slice().sort(()=>Math.random()-.5),index:0,correct:0,answered:0,checked:false};renderQuizCard();
}
function normalizeAnswer(s){return s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim()}
function renderQuizCard(){
 const e=quiz.pool[quiz.index];quiz.checked=false;
 $('#topicQuizPanel').innerHTML=`<div class="panel quiz-card"><div class="eyebrow">LISTEN FIRST. THEN RECALL.</div><p class="summary">第 ${quiz.index+1} / ${quiz.pool.length} 项 · 已答 ${quiz.answered} 项 · 听写正确 ${quiz.correct} 项</p><h2>先听，再写出你听到的。</h2><p>练习使用词汇页当前的筛选；答案在提交后显示。</p><div class="quiz-audio"><button id="quizPlay" class="primary">▶ 听词条示范</button>${e.originalVoice?'<button id="quizOriginal">▶ 听语境原声</button>':''}<select id="quizSpeed" aria-label="练习语速"><option value="0.75">0.75 倍</option><option value="0.9" selected>0.9 倍</option><option value="1">原速</option></select></div><form id="quizForm"><label for="quizAnswer">你听到的词或表达</label><input id="quizAnswer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="用英文输入…"><button type="submit">核对 / 看答案</button></form><div id="quizFeedback" role="status"></div><div id="quizReveal" hidden><h2>${esc(e.term)}</h2><p>${esc(e.meaning)}</p><p class="topic-tip">${esc(e.tip)}</p><p class="summary">${esc(sourceLabel(e.evidence[0].id))} · ${esc(e.category)}</p><div class="actions"><button id="quizMaster">${topicMastered(e)?'✓ 已掌握':'标记掌握'}</button><button id="quizNext" class="primary">${quiz.index+1<quiz.pool.length?'下一个 →':'完成本轮'}</button></div></div></div>`;
 $('#quizPlay').onclick=()=>playTopicVoice(e);if($('#quizOriginal'))$('#quizOriginal').onclick=()=>playTopicVoice(e,true);
 $('#quizSpeed').onchange=()=>topicVoice.playbackRate=Number($('#quizSpeed').value);
 $('#quizForm').onsubmit=event=>{event.preventDefault();if(quiz.checked)return;quiz.checked=true;quiz.answered++;const answer=normalizeAnswer($('#quizAnswer').value),correct=answer===normalizeAnswer(e.term);if(correct)quiz.correct++;$('#quizFeedback').textContent=correct?'✓ 听写正确':answer?'再听一次，对照答案留意连读和词尾。':'答案已显示，试着跟读一遍。';$('#quizReveal').hidden=false};
 $('#quizMaster').onclick=()=>{notes.topicMastery||={};notes.topicMastery[e.id]=!notes.topicMastery[e.id];scheduleSave();$('#quizMaster').textContent=topicMastered(e)?'✓ 已掌握':'标记掌握';$('#topicMasteredCount').textContent=topicData.entries.filter(topicMastered).length};
 $('#quizNext').onclick=()=>{stopTopicVoice();if(++quiz.index<quiz.pool.length)renderQuizCard();else{$('#topicQuizPanel').innerHTML=`<div class="panel quiz-card"><h2>这一轮，听得更清楚了。</h2><p>练习 ${quiz.answered} 项，听写正确 ${quiz.correct} 项。掌握标记已保存在此浏览器。</p><button id="quizRestart" class="primary">再练一轮</button></div>`;$('#quizRestart').onclick=startTopicQuiz}};
}
