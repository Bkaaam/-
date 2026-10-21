'use strict';
// Add context study modes without changing the IndexedDB database or its saved keys.
let selectionEnabled=true, selectionTimer=0, nounEnabled=false, nounRevealed=false, activeVocabTab='reading';
const originalRenderText=renderText, originalOpenWord=openWord, originalRenderReader=renderReader, originalPlaySentence=playSentence;
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
  const gloss=glossFor(current,Number(el.dataset.sentence)),out=$('#wordContextMeaning');
  out.hidden=!gloss?.zh;out.textContent=gloss?.zh?'本句含义：'+gloss.zh:'';
};
renderReader=function(id){
  nounEnabled=false;nounRevealed=false;$('#nounMode').textContent='开启名词听写';$('#nounPanel').hidden=true;
  return originalRenderReader(id);
};
playSentence=function(i){
  if(nounEnabled&&i>=0&&i<sentences.length){nounRevealed=false;setTimeout(renderNounPanel,0)}
  return originalPlaySentence(i);
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
$('#text').addEventListener('mouseup',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(showSelectionMeaning,300)});
$('#text').addEventListener('touchend',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(showSelectionMeaning,420)},{passive:true});
$('#selectionMode').onclick=()=>{selectionEnabled=!selectionEnabled;$('#selectionMode').textContent=selectionEnabled?'长按划选词句 · 翻译开启':'长按划选词句 · 翻译关闭'};
$('#selectionDialog [data-close]').onclick=()=>$('#selectionDialog').close();

function nounsInSentence(index){const s=sentences[index];return(current?.nounSpans||[]).filter(n=>n.charStart>=s.charStart&&n.charEnd<=s.charEnd)}
function annotatedSentence(index,nouns){
  const s=sentences[index],text=current.text;let at=s.charStart,html='';
  for(const n of nouns){html+=esc(text.slice(at,n.charStart));html+=`<mark>${esc(text.slice(n.charStart,n.charEnd))}</mark>`;at=n.charEnd}
  return html+esc(text.slice(at,s.charEnd));
}
function renderNounPanel(){
  const panel=$('#nounPanel');if(!nounEnabled||current?.type!=='listening'){panel.hidden=true;return}
  panel.hidden=false;const nouns=nounsInSentence(sentenceIndex);
  panel.innerHTML=`<div class="noun-card"><h3>第 ${sentenceIndex+1} 句 · 名词听写</h3><p>先听原声，把听到的名词按顺序写下，用空格或逗号隔开。</p><div class="actions"><button id="nounReplay">▶ 重听本句</button><button id="nounNext">下一句 →</button></div>${nouns.length?`<form id="nounForm"><label>本句约 ${nouns.length} 个名词<input id="nounInput" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="听到的名词…"></label><button type="submit">确认并核对</button></form>`:'<p>本句没有筛选出名词，可继续下一句。</p>'}<div id="nounResult" aria-live="polite"></div><p class="summary">名词由词典与句子位置自动筛选，请以录音和原文为准。</p></div>`;
  $('#nounReplay').onclick=()=>originalPlaySentence(sentenceIndex);
  $('#nounNext').onclick=()=>playSentence(Math.min(sentenceIndex+1,sentences.length-1));
  if(nouns.length)$('#nounForm').onsubmit=event=>{
    event.preventDefault();if(nounRevealed)return;nounRevealed=true;
    const answers=$('#nounInput').value.trim().split(/[\s,，;；]+/).filter(Boolean);
    const clean=s=>s.toLowerCase().replace(/[^a-z]/g,'');
    const checks=nouns.map((n,i)=>clean(answers[i]||'')===clean(n.word));
    nouns.forEach((n,i)=>{if(checks[i])return;const key=`noun|${current.id}|${n.charStart}`;vocab[key]={category:'listeningNouns',word:n.word.toLowerCase(),id:current.id,char:n.charStart,title:current.title,sentence:sentences[sentenceIndex].text.trim(),meaning:findEntry(n.word).entry?.translation||'',phonetic:findEntry(n.word).entry?.phonetic||'',note:'名词听写答错；原句见上。'};});
    if(checks.some(x=>!x))scheduleSave();
    $('#nounResult').innerHTML=`<p>${checks.map((ok,i)=>`<span class="noun-check ${ok?'correct':'incorrect'}">${esc(nouns[i].word)} ${ok?'✓ 正确':'✗ 应写为 '+esc(nouns[i].word)}</span>`).join('')}</p><blockquote>${annotatedSentence(sentenceIndex,nouns)}</blockquote>${checks.some(x=>!x)?'<p>答错的名词已加入“听力名词”。</p>':''}`;
  };
}
$('#nounMode').onclick=()=>{nounEnabled=!nounEnabled;nounRevealed=false;$('#nounMode').textContent=nounEnabled?'关闭名词听写':'开启名词听写';if(nounEnabled){practice=true;$('#sentenceMode').classList.add('selected');$('#continuousMode').classList.remove('selected');renderNounPanel();playSentence(sentenceIndex)}else renderNounPanel()};

function vocabCategory(v){if(v.category==='corpus')return'corpus';if(v.category==='listeningNouns')return'nouns';return v.id?.startsWith('reading-')?'reading':'listening'}
renderVocab=function(){
  const groups={reading:[],corpus:[],nouns:[],listening:[]};
  for(const pair of Object.entries(vocab))groups[vocabCategory(pair[1])].push(pair);
  const tabs=[['reading','阅读生词汇'],['corpus','听力语料库'],['nouns','听力名词'],['listening','其他听力生词']];
  $('#special').innerHTML=`<div class="intro"><div class="eyebrow">COLLECT. REVISIT. REMEMBER.</div><h1>我的生词本</h1><p>原有收藏已按来源显示；所有记录仍保存在当前浏览器。</p></div><div class="vocab-tabs">${tabs.map(([id,label])=>`<button data-vocab-tab="${id}" class="${activeVocabTab===id?'selected':''}">${label} <small>${groups[id].length}</small></button>`).join('')}</div><div id="vocabList"></div>`;
  const show=()=>{$$('#special [data-vocab-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.vocabTab===activeVocabTab));$('#vocabList').innerHTML=groups[activeVocabTab].map(([k,v])=>`<div class="vocabentry"><strong>${esc(v.word)}</strong> <span class="phonetic">${esc(v.phonetic?'/'+v.phonetic+'/':'')}</span><small>${esc(v.title||v.id)}</small><p>${esc(v.note||v.meaning||'暂无词义笔记')}</p><blockquote>${esc(v.sentence)}</blockquote><div class="actions"><button data-return="${esc(v.id)}">回到原文 ↗</button><button data-pronounce="${esc(v.word)}">♪ 读音</button><button data-remove="${esc(k)}">移除</button></div></div>`).join('')||'<div class="empty">这个分类还没有收藏。</div>'};
  $$('#special [data-vocab-tab]').forEach(b=>b.onclick=()=>{activeVocabTab=b.dataset.vocabTab;show()});show();
};
