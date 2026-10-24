'use strict';
// Add context study modes without changing the IndexedDB database or its saved keys.
let selectionEnabled=true, selectionTimer=0, activeVocabTab='reading';
const originalRenderText=renderText, originalOpenWord=openWord;
const glossFor=(chapter,index)=>chapter?.sentenceGlosses?.find(g=>g.charStart===sentences[index]?.charStart);

function sentenceAnalysis(source){
  const s=source.trim();const tags=[];
  if(/\b(if|unless|provided that)\b/i.test(s))tags.push('条件与结果');
  if(/\b(although|though|however|whereas|while|but)\b/i.test(s))tags.push('转折或对比');
  if(/\b(because|since|therefore|as a result|due to)\b/i.test(s))tags.push('原因与结果');
  if(/\b(which|who|whose)\b/i.test(s))tags.push('定语从句或补充说明');
  if(/\b(for example|such as|including)\b/i.test(s))tags.push('举例');
  if(/\b(by|in|on|at|after|before)\s+\w+ing\b/i.test(s))tags.push('介词结构');
  if(!tags.length)tags.push('先找主语、动作与宾语');
  if(/\d|\b(percent|million|century|year|date)\b/i.test(s))tags.push('留意数字或时间');
  return '句子分析：'+tags.join('；')+'。';
}
renderText=function(){
  originalRenderText();
  if(current?.type!=='reading')return;
  const article=$('#text');article.classList.add('reading-selectable');
  for(const el of article.querySelectorAll('.word')){
    const span=document.createElement('span');span.className='word reading-word';span.textContent=el.textContent;
    for(const [k,v] of Object.entries(el.dataset))span.dataset[k]=v;
    span.setAttribute('tabindex','0');span.setAttribute('role','button');el.replaceWith(span);
  }
  article.querySelectorAll('.sentence').forEach((node,i)=>{
    const gloss=glossFor(current,i),box=document.createElement('span');box.className='sentence-gloss';
    const zh=gloss?.zh?.trim()||'本句暂无可靠译文，请结合上下文理解。';
    box.innerHTML=`<span class="sentence-meaning">${esc(zh)}</span><small>${esc(sentenceAnalysis(sentences[i].text))}</small>`;
    node.after(box);
  });
  $('#selectionMode').textContent='长按划选词句 · 翻译开启';
};
openWord=function(el){
  originalOpenWord(el);
  if(current?.type==='listening'&&current.transcriptWordReferences){
    selected.key=editedWordKey(current,selected);$('#wordNote').value=notes.wordNotes?.[selected.key]||'';$('#saveWord').textContent=vocab[selected.key]?'✓ 已收藏':'＋ 收藏生词';
  }
  const gloss=glossFor(current,Number(el.dataset.sentence)),out=$('#wordContextMeaning');
  out.hidden=!gloss?.zh;out.textContent=gloss?.zh?'本句含义：'+gloss.zh:'';
};
function selectedSentenceNode(node){
  const element=node?.nodeType===1?node:node?.parentElement;
  return element?.closest?.('#text .sentence')||null;
}
function showSelectionMeaning(){
  if(!selectionEnabled||current?.type!=='reading'||$('#selectionDialog').open||$('#wordDialog').open)return;
  const selection=window.getSelection(),quote=selection?.toString().replace(/\s+/g,' ').trim();
  if(!quote||quote.length>240)return;
  const sentence=selectedSentenceNode(selection.anchorNode)||selectedSentenceNode(selection.focusNode);
  if(!sentence)return;
  const index=Number(sentence.dataset.sentence),gloss=glossFor(current,index);
  const words=(quote.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).slice(0,5);
  const meanings=words.map(w=>{const found=findEntry(w);return found.entry?`${w}：${(found.entry.translation||found.entry.definition||'').split(/[\n；;]/)[0]}`:null}).filter(Boolean);
  $('#selectionQuote').textContent=quote;
  $('#selectionWordMeaning').textContent=meanings.length?meanings.join('；'):'所选内容请结合完整句意理解。';
  $('#selectionSentence').textContent=sentences[index]?.text.trim()||'';
  $('#selectionTranslation').textContent=gloss?.zh||'本句暂无可靠译文。';
  selection.removeAllRanges();$('#selectionDialog').showModal();
}
$('#text').addEventListener('click',event=>{
  if(current?.type==='reading'&&window.getSelection()?.toString().trim())event.stopImmediatePropagation();
},true);
$('#selectionMode').onclick=()=>{selectionEnabled=!selectionEnabled;$('#selectionMode').textContent=selectionEnabled?'长按划选词句 · 翻译开启':'长按划选词句 · 翻译关闭'};
$('#selectionDialog [data-close]').onclick=()=>$('#selectionDialog').close();

function migrateManualToListening(){
  const migrated=[];
  for(const [id,entry] of Object.entries(vocab)){
    if(entry.manualMigrationVersion===1)continue;
    if(entry.category!=='manual'&&!id.startsWith('manual|')&&!entry.id?.startsWith('manual|'))continue;
    entry.previousNotebook??=entry.notebook||entry.category||'manual';
    entry.category='corpus';entry.notebook='corpus';entry.manualMigrationVersion=1;migrated.push(id);
  }
  const ids=new Set(migrated);
  for(const row of notes.highlights||[]){
    if(row.scope==='vocab'&&ids.has(row.anchor)){
      row.legacySource||=row.source;row.source='corpus';row.key=`vocab|corpus|${row.anchor}`;
    }
  }
  if(migrated.length){notes.migrations||={};notes.migrations.manualToListeningV1={at:new Date().toISOString(),keys:migrated};scheduleSave()}
  return migrated.length;
}
function vocabCategory(v){
  if(v.notebook==='reading'||v.notebook==='corpus')return v.notebook;
  if(v.category==='manual')return'corpus';
  return v.category==='corpus'||v.category==='listeningNouns'||v.id?.startsWith('listening-')?'corpus':'reading';
}
renderVocab=function(){
  migrateManualToListening();
  if(!['reading','corpus'].includes(activeVocabTab))activeVocabTab=activeVocabTab==='manual'?'reading':'corpus';
  const groups={reading:[],corpus:[]};
  for(const pair of Object.entries(vocab))groups[vocabCategory(pair[1])].push(pair);
  const tabs=[['reading','阅读生词汇'],['corpus','听力语料库']];
  $('#special').innerHTML=`<div class="intro"><div class="eyebrow">COLLECT. REVISIT. REMEMBER.</div><h1>我的生词本</h1><p>现有收藏全部保留；手动添加会存入当前选中的词库。</p></div><div class="vocab-tabs">${tabs.map(([id,label])=>`<button data-vocab-tab="${id}" class="${activeVocabTab===id?'selected':''}">${label} <small>${groups[id].length}</small></button>`).join('')}</div><div id="vocabList"></div>`;
  $('#vocabList').innerHTML=groups[activeVocabTab].map(([k,v])=>`<div class="vocabentry" data-vocab-key="${esc(k)}"><strong>${esc(v.word)}</strong> <span class="phonetic">${esc(v.phonetic?'/'+v.phonetic+'/':'')}</span><small>${esc(v.title||'手动添加')}</small><p>${esc(v.meaning||'暂无词义')}</p>${v.note?`<p>${esc(v.note)}</p>`:''}<blockquote>${esc(v.sentence||'')}</blockquote><div class="actions">${items.some(c=>c.id===v.id)?`<button data-return="${esc(v.id)}">回到原文 ↗</button>`:''}<button data-pronounce="${esc(v.word)}">♪ 读音</button><button data-remove="${esc(k)}">移除</button></div></div>`).join('')||'<div class="empty">这个词库还没有收藏，可以在下方自行添加。</div>';
};
