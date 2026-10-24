'use strict';
const originalListeningScripts=new Map();
function originalListeningScript(chapter){
  if(!originalListeningScripts.has(chapter.id)){
    const rows=chapter.timing?.sentences?.length?chapter.timing.sentences:makeSentences(chapter.text);
    originalListeningScripts.set(chapter.id,{text:chapter.text,timing:chapter.timing||{},glosses:chapter.sentenceGlosses||[],rows:rows.map(s=>({...s,text:chapter.text.slice(s.charStart,s.charEnd)}))});
  }
  return originalListeningScripts.get(chapter.id);
}
function matchingTranscriptWords(oldText,newText){
  const tokenize=text=>[...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)].map(m=>({word:m[0].toLowerCase().replace(/’/g,"'"),index:m.index,length:m[0].length}));
  const a=tokenize(oldText),b=tokenize(newText),matches=[];
  // Keep only unchanged word occurrences; new words never inherit invented word timestamps.
  if(a.length*b.length>150000)return matches;
  const table=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i][j]=a[i].word===b[j].word?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
  for(let i=0,j=0;i<a.length&&j<b.length;){if(a[i].word===b[j].word){matches.push({old:a[i],next:b[j]});i++;j++}else if(table[i+1][j]>=table[i][j+1])i++;else j++}
  return matches;
}
function rebuildListeningScript(base,segments){
  let text='';const rows=[],words=[],glosses=[],wordReferences={};
  segments.forEach((segment,index)=>{
    if(index)text+='\n\n';const offset=text.length,value=segment.text.trim(),original=base.rows[index];
    text+=value;const timed=Number.isFinite(segment.start)&&Number.isFinite(segment.end)&&segment.start>=0&&segment.end>segment.start;
    const adjusted=!original||segment.start!==original.start||segment.end!==original.end,playable=timed&&(original?.playable!==false||adjusted);
    rows.push({charStart:offset,charEnd:text.length,start:timed?segment.start:null,end:timed?segment.end:null,playable,approximate:!!original?.approximate&&!adjusted});
    if(!original)return;
    const originalWords=new Map((base.timing.words||[]).filter(w=>w.charStart>=original.charStart&&w.charStart<original.charEnd).map(w=>[w.charStart-original.charStart,w]));
    for(const match of matchingTranscriptWords(original.text,value)){
      wordReferences[offset+match.next.index]=original.charStart+match.old.index;
      const old=originalWords.get(match.old.index);
      if(!old||!playable||old.start<segment.start||old.end>segment.end)continue;
      words.push({...old,charStart:offset+match.next.index,charEnd:offset+match.next.index+match.next.length});
    }
    if(original.text.trim()===value){const gloss=base.glosses.find(g=>g.charStart===original.charStart);if(gloss)glosses.push({...gloss,charStart:offset,charEnd:text.length})}
  });
  return{text,timing:{...base.timing,sentences:rows,words,coverage:words.length/Math.max(1,(text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).length)},sentenceGlosses:glosses,transcriptWordReferences:wordReferences};
}
function applyListeningScript(chapter){
  if(chapter.type!=='listening'||!chapter.text)return;
  const base=originalListeningScript(chapter),edit=notes.transcriptEdits?.[chapter.id];
  if(edit?.updatedAt&&chapter._transcriptVersion===edit.updatedAt)return;
  if(edit?.segments?.length){const built=rebuildListeningScript(base,edit.segments);Object.assign(chapter,built)}
  else{chapter.text=base.text;chapter.timing=base.timing;chapter.sentenceGlosses=base.glosses;delete chapter.transcriptWordReferences}
  chapter._transcriptVersion=edit?.updatedAt||null;
}
function preserveScriptNotes(chapter,oldRows,newRows){
  for(const mark of notes.highlights||[]){
    if(mark.scope!=='chapter'||mark.source!==chapter.id)continue;
    const index=Number(mark.anchor),row=newRows[index];if(!row)continue;
    const quote=mark.quote||'',previous=oldRows[index];let preferred=0;
    if(previous&&Number.isFinite(mark.start)){
      const relative=mark.start-previous.charStart,match=matchingTranscriptWords(previous.text,row.text).find(m=>relative>=m.old.index&&relative<m.old.index+m.old.length);
      preferred=match?match.next.index+relative-match.old.index:relative;
    }
    let at=-1,distance=Infinity;
    if(quote)for(let found=row.text.indexOf(quote);found>=0;found=row.text.indexOf(quote,found+1)){
      const delta=Math.abs(found-preferred);if(delta<distance){at=found;distance=delta}
    }
    if(!mark.whole){mark.start=at>=0?row.charStart+at:null;mark.end=at>=0?row.charStart+at+quote.length:null}
  }
}
function editedWordKey(chapter,selected){
  if(!chapter.transcriptWordReferences)return selected.key;
  const original=chapter.transcriptWordReferences[selected.char];
  if(Number.isFinite(original))return chapter.id+'|'+original;
  const row=chapter.timing.sentences[selected.sentenceIndex],prefix=chapter.text.slice(row.charStart,selected.char);
  const occurrence=(prefix.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).filter(w=>w.toLowerCase()===selected.word).length;
  return`${chapter.id}|edited|${selected.sentenceIndex}|${selected.word}|${occurrence}`;
}
function renderTranscriptEditorButton(chapter){
  let button=$('#editTranscript');
  if(!button){button=document.createElement('button');button.id='editTranscript';button.textContent='编辑原文';$('#listeningTools .modebar').append(button)}
  button.onclick=()=>openTranscriptEditor(chapter);
}
let editingTranscriptId=null,draftSaveTimer=0,transcriptSaving=false;
function validateTranscriptSegments(segments,duration=Infinity){
  for(let i=0;i<segments.length;i++){
    const s=segments[i],prefix=`第 ${i+1} 句：`;
    if(!s.text.trim())return{index:i,field:'text',message:prefix+'文字为空，请填写后保存。'};
    if(s.text.length>16000)return{index:i,field:'text',message:prefix+'内容过长，请缩短到 16000 字符以内。'};
    if(s.start===null&&s.end===null)continue;
    if(!Number.isFinite(s.start)||s.start<0)return{index:i,field:'start',message:prefix+'开始时间须为大于或等于 0 的秒数。'};
    if(!Number.isFinite(s.end)||s.end<=s.start)return{index:i,field:'end',message:prefix+'结束时间须晚于开始时间；也可同时留空。'};
    if(s.end>duration+0.5)return{index:i,field:'end',message:prefix+'结束时间超过了本段录音长度。'};
  }
  return null;
}
function transcriptStatus(message,state='info',problem=null){
  const status=$('#transcriptSaveStatus');status.textContent=message;status.dataset.state=state;status.setAttribute('aria-live',state==='error'?'assertive':'polite');
  for(const row of document.querySelectorAll('#transcriptRows .transcript-row')){row.removeAttribute('data-invalid');row.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'))}
  if(problem){
    const row=document.querySelectorAll('#transcriptRows .transcript-row')[problem.index];if(!row)return;
    row.dataset.invalid='1';const input=problem.field==='text'?row.querySelector('textarea'):row.querySelector(`[data-time=${problem.field}]`);
    if(problem.field!=='text')row.querySelector('details').open=true;
    input?.setAttribute('aria-invalid','true');row.scrollIntoView({block:'center',behavior:'smooth'});input?.focus({preventScroll:true});
  }
}
function transcriptEditorSegments(){return[...document.querySelectorAll('#transcriptRows .transcript-row')].map(row=>{
  const parse=field=>{const input=row.querySelector(`[data-time=${field}]`);return input.validity.badInput?NaN:input.value===''?null:Number(input.value)};
  return{text:row.querySelector('textarea').value,start:parse('start'),end:parse('end')};
})}
function storeTranscriptDraft(){
  if(!editingTranscriptId)return;notes.transcriptDrafts||={};notes.transcriptDrafts[editingTranscriptId]={segments:transcriptEditorSegments(),updatedAt:new Date().toISOString()};scheduleSave();
}
function flushTranscriptEditor(){
  clearTimeout(draftSaveTimer);if(editingTranscriptId)storeTranscriptDraft();editingTranscriptId=null;$('#transcriptEditor')?.remove();
}
function openTranscriptEditor(chapter){
  audio.pause();const base=originalListeningScript(chapter);
  let dialog=$('#transcriptEditor');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='transcriptEditor';dialog.innerHTML='<div class="dialoghead"><h2>编辑听力原文</h2><button id="closeTranscript" aria-label="关闭编辑">×</button></div><p class="summary">每个文本框对应原来的一句，可直接纠正或补充文字。原声不变；需要时可展开调整该句的开始和结束秒数。改动仅保存在本浏览器，随学习记录一起备份。</p><form id="transcriptForm" novalidate><div id="transcriptRows"></div><div class="transcript-editor-actions"><p id="transcriptSaveStatus" role="status" aria-live="polite"></p><button type="button" id="exportTranscriptDraft" hidden>导出草稿备份</button><button type="button" id="cancelTranscript">保留草稿并关闭</button><button type="submit" id="saveTranscript" class="primary">保存修改</button></div></form>';document.body.append(dialog)}
  editingTranscriptId=chapter.id;
  const draft=notes.transcriptDrafts?.[chapter.id],edit=notes.transcriptEdits?.[chapter.id];
  const segments=draft?.segments||edit?.segments||base.rows.map(s=>({text:s.text.trim(),start:s.start,end:s.end}));
  $('#transcriptRows').innerHTML=segments.map((s,i)=>`<section class="transcript-row"><label>第 ${i+1} 句<textarea rows="3" required maxlength="16000" spellcheck="false" autocapitalize="none">${esc(s.text)}</textarea></label><details><summary>调整本句原声时间</summary><div class="transcript-times"><label>开始（秒）<input data-time="start" type="number" inputmode="decimal" min="0" step="any" value="${Number.isFinite(s.start)?s.start:''}"></label><label>结束（秒）<input data-time="end" type="number" inputmode="decimal" min="0" step="any" value="${Number.isFinite(s.end)?s.end:''}"></label></div></details></section>`).join('');
  transcriptStatus(draft?'已恢复上次编辑草稿。':'');$('#exportTranscriptDraft').hidden=true;
  $('#exportTranscriptDraft').onclick=()=>{storeTranscriptDraft();exportState()};
  const close=()=>{if(transcriptSaving)return;clearTimeout(draftSaveTimer);storeTranscriptDraft();dialog.close();editingTranscriptId=null};
  $('#closeTranscript').onclick=$('#cancelTranscript').onclick=close;
  dialog.oncancel=e=>{e.preventDefault();close()};
  $('#transcriptForm').oninput=()=>{if(transcriptSaving)return;clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(()=>{storeTranscriptDraft();transcriptStatus('草稿已暂存，点击“保存修改”完成保存。')},500)};
  $('#transcriptForm').onsubmit=async event=>{
    event.preventDefault();if(transcriptSaving)return;clearTimeout(draftSaveTimer);const segments=transcriptEditorSegments(),duration=chapter.audio?.duration||Infinity;
    const problem=validateTranscriptSegments(segments,duration);
    if(problem){storeTranscriptDraft();transcriptStatus(problem.message,'error',problem);return}
    transcriptSaving=true;const button=$('#saveTranscript');button.disabled=true;button.textContent='正在保存…';
    const editingControls=[...document.querySelectorAll('#transcriptRows input,#transcriptRows textarea,#closeTranscript,#cancelTranscript')];editingControls.forEach(el=>el.disabled=true);
    transcriptStatus('正在保存修改，请稍候…','saving');
    const previous=notes.transcriptEdits?.[chapter.id],oldRows=sentences.map(s=>({...s})),oldMarks=JSON.parse(JSON.stringify(notes.highlights||[]));let committed=false;
    try{
      await new Promise(resolve=>setTimeout(resolve,0));
      notes.transcriptEdits||={};notes.transcriptEdits[chapter.id]={version:1,segments,updatedAt:new Date().toISOString()};
      const built=rebuildListeningScript(base,segments),newRows=built.timing.sentences.map(s=>({...s,text:built.text.slice(s.charStart,s.charEnd)}));
      preserveScriptNotes(chapter,oldRows,newRows);storeTranscriptDraft();clearTimeout(saveTimer);delete notes.transcriptDrafts[chapter.id];await saveState({requireStorage:true,timeoutMs:10000});committed=true;
      if(current?.id===chapter.id){
        Object.assign(chapter,built);chapter._transcriptVersion=notes.transcriptEdits[chapter.id].updatedAt;sentences=newRows;alignedWords=chapter.timing.words;
        renderText();highlightSentence(Math.min(sentenceIndex,sentences.length-1));
      }
      dialog.close();editingTranscriptId=null;toast('听力原文已保存，生词与笔记保留。');
    }catch(error){
      if(!committed){if(previous)notes.transcriptEdits[chapter.id]=previous;else delete notes.transcriptEdits[chapter.id];notes.highlights=oldMarks;storeTranscriptDraft()}
      const reason=error.name==='QuotaExceededError'?'本机可用存储不足。':error.name==='TimeoutError'?'本机保存超时。':error.name==='StorageUnavailableError'?'当前浏览器未提供可用的本地存储。':'';
      transcriptStatus(committed?'修改已保存，请关闭编辑窗口查看。':reason+'保存未完成，输入内容仍保留，可重试或导出草稿备份。',committed?'success':'error');$('#exportTranscriptDraft').hidden=committed;
    }
    finally{transcriptSaving=false;button.disabled=false;button.textContent='保存修改';editingControls.forEach(el=>el.disabled=false)}
  };
  dialog.showModal();
}
