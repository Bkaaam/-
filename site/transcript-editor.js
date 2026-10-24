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
    const quote=mark.quote||'',at=row.text.indexOf(quote);
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
let editingTranscriptId=null,draftSaveTimer=0;
function transcriptEditorSegments(){return[...document.querySelectorAll('#transcriptRows .transcript-row')].map(row=>({text:row.querySelector('textarea').value,start:row.querySelector('[data-time=start]').value===''?null:Number(row.querySelector('[data-time=start]').value),end:row.querySelector('[data-time=end]').value===''?null:Number(row.querySelector('[data-time=end]').value)}))}
function storeTranscriptDraft(){
  if(!editingTranscriptId)return;notes.transcriptDrafts||={};notes.transcriptDrafts[editingTranscriptId]={segments:transcriptEditorSegments(),updatedAt:new Date().toISOString()};scheduleSave();
}
function flushTranscriptEditor(){
  clearTimeout(draftSaveTimer);if(editingTranscriptId)storeTranscriptDraft();editingTranscriptId=null;$('#transcriptEditor')?.remove();
}
function openTranscriptEditor(chapter){
  audio.pause();const base=originalListeningScript(chapter);
  let dialog=$('#transcriptEditor');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='transcriptEditor';dialog.innerHTML='<div class="dialoghead"><h2>编辑听力原文</h2><button id="closeTranscript" aria-label="关闭编辑">×</button></div><p class="summary">每个文本框对应原来的一句，可直接纠正或补充文字。原声不变；需要时可展开调整该句的开始和结束秒数。改动仅保存在本浏览器，随学习记录一起备份。</p><form id="transcriptForm"><div id="transcriptRows"></div><p id="transcriptSaveStatus" role="status"></p><div class="transcript-editor-actions"><button type="button" id="cancelTranscript">保留草稿并关闭</button><button type="submit" id="saveTranscript" class="primary">保存修改</button></div></form>';document.body.append(dialog)}
  editingTranscriptId=chapter.id;
  const draft=notes.transcriptDrafts?.[chapter.id],edit=notes.transcriptEdits?.[chapter.id];
  const segments=draft?.segments||edit?.segments||base.rows.map(s=>({text:s.text.trim(),start:s.start,end:s.end}));
  $('#transcriptRows').innerHTML=segments.map((s,i)=>`<section class="transcript-row"><label>第 ${i+1} 句<textarea rows="3" required maxlength="16000" spellcheck="false" autocapitalize="none">${esc(s.text)}</textarea></label><details><summary>调整本句原声时间</summary><div class="transcript-times"><label>开始（秒）<input data-time="start" type="number" min="0" step="0.01" value="${Number.isFinite(s.start)?s.start:''}"></label><label>结束（秒）<input data-time="end" type="number" min="0" step="0.01" value="${Number.isFinite(s.end)?s.end:''}"></label></div></details></section>`).join('');
  $('#transcriptSaveStatus').textContent=draft?'已恢复上次编辑草稿。':'';
  const close=()=>{clearTimeout(draftSaveTimer);storeTranscriptDraft();dialog.close();editingTranscriptId=null};
  $('#closeTranscript').onclick=$('#cancelTranscript').onclick=close;
  dialog.oncancel=e=>{e.preventDefault();close()};
  $('#transcriptForm').oninput=()=>{clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(()=>{storeTranscriptDraft();$('#transcriptSaveStatus').textContent='草稿已保存到本机。'},500)};
  $('#transcriptForm').onsubmit=async event=>{
    event.preventDefault();clearTimeout(draftSaveTimer);const segments=transcriptEditorSegments(),duration=chapter.audio?.duration||Infinity;
    if(segments.some(s=>!s.text.trim()||s.text.length>16000||((s.start!==null||s.end!==null)&&(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>duration+0.5)))){$('#transcriptSaveStatus').textContent='请填写文字，并检查时间：结束须晚于开始，且不超过本段录音。';return}
    const button=$('#saveTranscript');button.disabled=true;
    const previous=notes.transcriptEdits?.[chapter.id],oldRows=sentences.map(s=>({...s})),oldMarks=JSON.parse(JSON.stringify(notes.highlights||[]));let committed=false;
    try{
      notes.transcriptEdits||={};notes.transcriptEdits[chapter.id]={version:1,segments,updatedAt:new Date().toISOString()};
      const built=rebuildListeningScript(base,segments),newRows=built.timing.sentences.map(s=>({...s,text:built.text.slice(s.charStart,s.charEnd)}));
      preserveScriptNotes(chapter,oldRows,newRows);storeTranscriptDraft();delete notes.transcriptDrafts[chapter.id];await saveState();committed=true;
      if(current?.id===chapter.id){
        Object.assign(chapter,built);chapter._transcriptVersion=notes.transcriptEdits[chapter.id].updatedAt;sentences=newRows;alignedWords=chapter.timing.words;
        renderText();highlightSentence(Math.min(sentenceIndex,sentences.length-1));
      }
      dialog.close();editingTranscriptId=null;toast('听力原文已保存，生词与笔记保留。');
    }catch{if(!committed){if(previous)notes.transcriptEdits[chapter.id]=previous;else delete notes.transcriptEdits[chapter.id];notes.highlights=oldMarks;storeTranscriptDraft()}$('#transcriptSaveStatus').textContent=committed?'修改已保存，请关闭编辑窗口查看。':'保存未完成，草稿仍保留，请重试或导出学习记录。'}
    finally{button.disabled=false}
  };
  dialog.showModal();
}
