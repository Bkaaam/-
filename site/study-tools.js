'use strict';
// All personal edits stay in the existing IndexedDB notes/vocab records.
const studyReader=renderReader, studyNavigate=navigate, studyText=renderText, studyVocab=renderVocab;
const studyTopicLearn=renderTopicLearn, studyTopicQuestion=renderTopicQuestion;
const openedChapter={reading:null,listening:null};
let selectionSnapshot=null, selectionDebounce=0, annotationTarget=null;
const highlightColors={yellow:'黄色',green:'绿色',pink:'粉色',blue:'蓝色'};

function annotationRows(){notes.highlights||=[];return notes.highlights}
function annotationKey(scope,source,anchor){return `${scope}|${source}|${anchor}`}
function annotateBlock(node,scope,source,anchor){
  if(!node||node.dataset.annotated)return;
  node.dataset.annotated='1';node.dataset.annotationKey=annotationKey(scope,source,anchor);
  const actions=document.createElement('span');actions.className='annotation-actions';
  const button=document.createElement('button');button.type='button';button.className='annotation-button';button.textContent='✦ 标记 / 笔记';
  button.onclick=e=>{e.stopPropagation();const sentence=scope==='chapter'?sentences[Number(anchor)]?.text:null;openAnnotation({scope,source,anchor,quote:(sentence||node.innerText||'').trim().slice(0,240)})};
  actions.append(button);node.append(actions);paintAnnotations(node);
}
function paintAnnotations(node){
  const rows=annotationRows().filter(row=>row.key===node.dataset.annotationKey);
  node.classList.toggle('has-annotation',rows.length>0);
  node.style.setProperty('--annotation-color',rows.length?`var(--mark-${rows[rows.length-1].color||'yellow'})`:'transparent');
  node.querySelectorAll(':scope > .annotation-chip').forEach(x=>x.remove());
  for(const row of rows){
    const chip=document.createElement('button');chip.type='button';chip.className='annotation-chip';
    chip.textContent=`✦ ${row.quote?.slice(0,28)||'笔记'}${row.note?' · '+row.note.slice(0,18):''}`;
    chip.onclick=e=>{e.stopPropagation();openAnnotation(row)};node.append(chip);
  }
  if(node.matches('#text .sentence')){
    node.querySelectorAll('.word').forEach(word=>word.classList.remove('marked-word'));
    for(const row of rows){
      const phrase=(row.quote||'').toLowerCase();
      for(const word of node.querySelectorAll('.word')){
        const char=Number(word.dataset.char),exact=Number.isFinite(row.start)&&Number.isFinite(row.end)?char>=row.start&&char<row.end:phrase.includes(word.textContent.toLowerCase());
        if(exact){
          word.classList.add('marked-word');word.style.setProperty('--word-mark',`var(--mark-${row.color||'yellow'})`);
        }
      }
    }
  }
}
function openAnnotation(target){
  annotationTarget={scope:target.scope,source:target.source,anchor:target.anchor,key:annotationKey(target.scope,target.source,target.anchor),quote:target.quote||''};
  const match=annotationRows().find(row=>row.id===target.id);
  $('#annotationQuote').textContent=annotationTarget.quote;
  $('#annotationNote').value=match?.note||'';$('#annotationColor').value=match?.color||'yellow';
  $('#annotationDelete').hidden=!match;$('#annotationDialog').dataset.editId=match?.id||'';
  $('#annotationDialog').showModal();
}
function refreshAnnotation(key){
  for(const node of document.querySelectorAll('[data-annotation-key]'))if(node.dataset.annotationKey===key)paintAnnotations(node);
}
$('#annotationSave').onclick=()=>{
  if(!annotationTarget)return;
  const id=$('#annotationDialog').dataset.editId||`mark-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const record={...annotationTarget,id,color:$('#annotationColor').value,note:$('#annotationNote').value.trim(),updatedAt:new Date().toISOString()};
  const rows=annotationRows(),index=rows.findIndex(x=>x.id===id);
  if(index<0)rows.push(record);else rows[index]=record;
  scheduleSave();refreshAnnotation(record.key);$('#annotationDialog').close();toast('颜色标记与笔记已保存');
};
$('#annotationDelete').onclick=()=>{
  const id=$('#annotationDialog').dataset.editId,key=annotationTarget?.key;
  notes.highlights=annotationRows().filter(row=>row.id!==id);
  scheduleSave();refreshAnnotation(key);$('#annotationDialog').close();toast('标记已删除');
};
$('#annotationDialog [data-close]').onclick=()=>$('#annotationDialog').close();

function decorateReading(){
  const article=$('#text');
  for(const [i,node] of [...article.querySelectorAll('.sentence')].entries()){
    annotateBlock(node,'chapter',current.id,String(i));
    const gloss=node.nextElementSibling;
    if(current.type==='reading'&&gloss?.classList.contains('sentence-gloss')){
      const content=document.createElement('div');content.className='gloss-content';
      while(gloss.firstChild)content.append(gloss.firstChild);
      content.hidden=true;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='gloss-toggle';toggle.textContent='查看本句含义与分析 ▾';
      toggle.onclick=()=>{content.hidden=!content.hidden;toggle.textContent=content.hidden?'查看本句含义与分析 ▾':'收起本句含义与分析 ▴'};
      gloss.append(toggle,content);
    }
  }
}
renderText=function(){studyText();if(current)decorateReading()};
renderReader=function(id){
  selectionPill.hidden=true;selectionSnapshot=null;
  const match=items.find(x=>x.id===id);if(match)openedChapter[match.type]=id;
  const outcome=studyReader(id);
  if(match?.type==='reading')renderSummary(match);
  return outcome;
};
function renderSummary(chapter){
  $('#articleSummary')?.remove();
  const panel=document.createElement('section');panel.id='articleSummary';panel.className='article-summary panel';
  panel.innerHTML=`<div class="eyebrow">PASSAGE OVERVIEW</div><h2>这篇文章讲什么</h2><p>${esc(chapter.summary||'暂无梗概')}</p><small>梗概由原文句子译文自动提取，建议结合原文核对。</small><label>我的文章总结<textarea id="personalSummary" rows="3" placeholder="记录你读完后的理解…">${esc(notes.articleSummaries?.[chapter.id]||'')}</textarea></label><button id="saveSummary">保存我的总结</button>`;
  $('#readingTools').after(panel);
  $('#saveSummary').onclick=()=>{notes.articleSummaries||={};notes.articleSummaries[chapter.id]=$('#personalSummary').value.trim();scheduleSave();toast('文章总结已保存')};
}
navigate=async function(next){
  selectionPill.hidden=true;selectionSnapshot=null;clearTimeout(selectionDebounce);
  if(current?.id)openedChapter[current.type]=current.id;
  await studyNavigate(next);
  const target=openedChapter[next];
  if(target&&['reading','listening'].includes(next))await renderReader(target);
};
$('#back').onclick=async()=>{const type=current?.type||view;openedChapter[type]=null;await studyNavigate(type)};

function decorateSpecial(selector,scope,getSource,getAnchor){
  document.querySelectorAll(selector).forEach((node,i)=>annotateBlock(node,scope,getSource(node,i),getAnchor(node,i)));
}
renderTopicLearn=function(){studyTopicLearn();decorateSpecial('#topicMain .topic-entry','topic',()=>topicSource,(_,i)=>topicEntries()[i]?.id||String(i))};
renderTopicQuestion=function(){studyTopicQuestion();if(topicExercise)decorateSpecial('#topicMain .quiz-card','topic',()=>topicSource,()=>topicExercise.pool[topicExercise.index]?.id||'end')};

function manualEntryForm(){
  const panel=document.createElement('form');panel.id='manualWordForm';panel.className='panel manual-word-form';
  panel.innerHTML='<h2>自行添加生词</h2><label>英文单词或短语<input name="word" required maxlength="100" placeholder="例如 accommodation"></label><label>中文含义<input name="meaning" maxlength="300" placeholder="写下你要记的意思"></label><label>例句 / 来源<input name="sentence" maxlength="800" placeholder="可填写例句，也可以写学习来源"></label><label>我的笔记<textarea name="note" rows="2" maxlength="1000"></textarea></label><button class="primary" type="submit">加入生词本</button>';
  panel.onsubmit=e=>{
    e.preventDefault();const data=new FormData(panel),word=String(data.get('word')||'').trim();if(!word)return;
    const key=`manual|${Date.now()}|${Math.random().toString(36).slice(2,6)}`;
    const entry=findEntry(word).entry;
    vocab[key]={category:'manual',word,id:key,title:'手动添加',sentence:String(data.get('sentence')||'').trim(),meaning:String(data.get('meaning')||'').trim()||entry?.translation||'',phonetic:entry?.phonetic||'',note:String(data.get('note')||'').trim()};
    activeVocabTab='manual';scheduleSave();renderVocab();toast('已加入手动生词');
  };
  return panel;
}
renderVocab=function(){
  studyVocab();
  const special=$('#special'),tabs=special.querySelector('.vocab-tabs');
  if(!tabs)return;
  tabs.querySelectorAll('[data-vocab-tab]').forEach(button=>{button.onclick=()=>{activeVocabTab=button.dataset.vocabTab;renderVocab()}});
  tabs.after(manualEntryForm());
  if(activeVocabTab==='manual'){
    const rows=Object.entries(vocab).filter(([,v])=>v.category==='manual');
    $('#vocabList').innerHTML=rows.map(([k,v])=>`<div class="vocabentry" data-manual="${esc(k)}"><strong>${esc(v.word)}</strong> <span class="phonetic">${esc(v.phonetic?'/'+v.phonetic+'/':'')}</span><small>手动添加</small><p>${esc(v.meaning||'暂无含义')}</p><blockquote>${esc(v.sentence||'暂无例句')}</blockquote><p>${esc(v.note||'')}</p><div class="actions"><button data-pronounce="${esc(v.word)}">♪ 读音</button><button data-remove="${esc(k)}">移除</button></div></div>`).join('')||'<div class="empty">还没有手动添加的生词。</div>';
  }
  decorateSpecial('#vocabList .vocabentry','vocab',()=>activeVocabTab,(node,i)=>node.dataset.manual||Object.entries(vocab).filter(([,v])=>activeVocabTab==='reading'?v.id?.startsWith('reading-'):activeVocabTab==='corpus'?v.category==='corpus':activeVocabTab==='nouns'?v.category==='listeningNouns':v.id?.startsWith('listening-'))[i]?.[0]||String(i));
};

const selectionPill=document.createElement('div');selectionPill.id='selectionActions';selectionPill.hidden=true;
selectionPill.innerHTML='<button id="translateSelection">翻译所选</button><button id="markSelection">彩色标记 / 笔记</button>';
document.body.append(selectionPill);
function captureSelection(){
  const selectedRange=window.getSelection();if(!selectedRange||selectedRange.isCollapsed)return null;
  const quote=selectedRange.toString().replace(/\s+/g,' ').trim();if(!quote||quote.length>500)return null;
  const origin=selectedRange.anchorNode?.nodeType===1?selectedRange.anchorNode:selectedRange.anchorNode?.parentElement;
  const focus=selectedRange.focusNode?.nodeType===1?selectedRange.focusNode:selectedRange.focusNode?.parentElement;
  const node=origin?.closest?.('#text .sentence, #special .topic-entry, #special .quiz-card, #special .vocabentry')||focus?.closest?.('#text .sentence, #special .topic-entry, #special .quiz-card, #special .vocabentry');
  if(!node)return null;
  if(node.closest('#text')){
    const index=Number(node.dataset.sentence),sentence=sentences[index];
    const anchorWord=origin?.closest?.('.word'),focusWord=focus?.closest?.('.word');
    const direct=sentence?.text.indexOf(quote)??-1;
    const start=direct>=0?sentence.charStart+direct:Math.min(Number(anchorWord?.dataset.char),Number(focusWord?.dataset.char));
    const end=direct>=0?start+quote.length:Math.max(Number(anchorWord?.dataset.char)+anchorWord?.textContent.length,Number(focusWord?.dataset.char)+focusWord?.textContent.length);
    return{scope:'chapter',source:current.id,anchor:node.dataset.sentence,quote,index,start:Number.isFinite(start)?start:undefined,end:Number.isFinite(end)?end:undefined};
  }
  const key=node.dataset.annotationKey?.split('|');
  return key?{scope:key[0],source:key[1],anchor:key.slice(2).join('|'),quote}:null;
}
function selectedTranslation(snapshot){
  if(!snapshot||snapshot.scope!=='chapter'||current?.type!=='reading')return;
  const i=snapshot.index,gloss=glossFor(current,i);
  const words=(snapshot.quote.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).slice(0,6);
  const meanings=words.map(word=>{const hit=findEntry(word).entry;return hit?`${word}：${(hit.translation||hit.definition||'').split(/[\n；;]/)[0]}`:''}).filter(Boolean);
  $('#selectionQuote').textContent=snapshot.quote;
  $('#selectionWordMeaning').textContent=meanings.join('；')||'请结合下方整句含义理解所选文字。';
  $('#selectionSentence').textContent=sentences[i]?.text.trim()||'';
  $('#selectionTranslation').textContent=gloss?.zh||'暂无对应译文。';
  if(!$('#selectionDialog').open)$('#selectionDialog').showModal();
  selectionPill.hidden=true;
}
document.addEventListener('selectionchange',()=>{
  clearTimeout(selectionDebounce);
  selectionDebounce=setTimeout(()=>{const snap=captureSelection();if(!snap)return;selectionSnapshot=snap;selectionPill.hidden=false;
    if(snap.scope==='chapter'&&current?.type==='reading'&&selectionEnabled){setTimeout(()=>{if(selectionSnapshot===snap&&!$('#selectionDialog').open)selectedTranslation(snap)},550)}
  },300);
});
$('#translateSelection').onclick=()=>selectedTranslation(selectionSnapshot);
$('#markSelection').onclick=()=>{if(selectionSnapshot){$('#selectionDialog').open&&$('#selectionDialog').close();openAnnotation(selectionSnapshot);selectionPill.hidden=true}};
const markFromTranslation=document.createElement('button');markFromTranslation.textContent='✦ 标记所选并记笔记';markFromTranslation.id='markFromTranslation';
markFromTranslation.onclick=()=>{if(selectionSnapshot){$('#selectionDialog').close();openAnnotation(selectionSnapshot)}};
$('#selectionDialog').append(markFromTranslation);
