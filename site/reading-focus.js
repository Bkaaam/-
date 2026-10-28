'use strict';
// Retire listening UI without migrating or deleting any personal records.
const focusNavigate=navigate,focusOpenReader=openReader,focusRenderReader=renderReader;
const focusRenderText=renderText,focusOpenWord=openWord,focusVocab=renderVocab;
const focusMakeSentences=makeSentences;
makeSentences=function(text){
  if(current?.type==='reading'&&current.sentenceGlosses?.length)return current.sentenceGlosses.map(g=>({charStart:g.charStart,charEnd:g.charEnd,text:text.slice(g.charStart,g.charEnd),start:null,end:null}));
  return focusMakeSentences(text);
};
navigate=async function(next){return focusNavigate(['listening','topics'].includes(next)?'reading':next)};
openReader=async function(id){if(items.find(c=>c.id===id)?.type!=='reading'){toast('逐句精听已移除，原有收藏和记录仍保留');return}return focusOpenReader(id)};
renderReader=function(id){if(items.find(c=>c.id===id)?.type!=='reading')return;const result=focusRenderReader(id);const note=$('#articleSummary small');if(note)note.textContent='自动摘译选取文中部分要点，仅供预习；具体信息、否定、数量和观点归属以英文原文为准。';return result};

function readingTranslation(chapter,index){
  const sentence=sentences[index];if(!chapter||!sentence)return null;
  const source=chapter.text.slice(sentence.charStart,sentence.charEnd).trim();
  const edit=notes.readingTranslations?.[chapter.id]?.[sentence.charStart];
  if(edit?.source===source&&edit.zh?.trim())return{zh:edit.zh,personal:true,contextSource:edit.contextSource};
  const gloss=chapter.sentenceGlosses?.find(g=>g.charStart===sentence.charStart&&g.charEnd===sentence.charEnd);
  return gloss?.zh?.trim()?{...gloss,personal:false}:null;
}
function translationLabel(gloss){return gloss?.personal?'我的修订译文':gloss?.reviewed?'本句已校订 · 参考译文':gloss?.contextSource?'完整连读语句的参考译文 · 机器翻译':'参考译文 · 机器翻译'}
function renderReadingTranslation(content,index){
  const gloss=readingTranslation(current,index);
  content.replaceChildren();
  const label=document.createElement('small');label.className='translation-source';label.textContent=translationLabel(gloss);
  const meaning=document.createElement('p');meaning.className='sentence-meaning';meaning.textContent=gloss?.zh||'本句暂无对应译文。请核对原文后补充。';
  const edit=document.createElement('button');edit.type='button';edit.className='translation-edit';edit.textContent='修订本句译文';edit.onclick=()=>editReadingTranslation(index);
  content.append(label);
  if(gloss?.contextSource){const source=document.createElement('blockquote');source.className='translation-context-original';source.textContent=gloss.contextSource;content.append(source)}
  content.append(meaning,edit);
}
renderText=function(){
  focusRenderText();if(current?.type!=='reading')return;
  $('#text').querySelectorAll('.sentence').forEach((node,index)=>{
    const box=node.nextElementSibling;if(box?.classList.contains('sentence-gloss')){
      const content=box.querySelector('.gloss-content');if(content)renderReadingTranslation(content,index);
      const toggle=box.querySelector('.gloss-toggle');if(toggle){toggle.setAttribute('aria-label','查看本句译文');toggle.setAttribute('aria-expanded','false');toggle.onclick=()=>{content.hidden=!content.hidden;toggle.textContent=content.hidden?'查看本句译文 ▾':'收起译文 ▴';toggle.setAttribute('aria-expanded',String(!content.hidden))};toggle.textContent='查看本句译文 ▾'}
    }
  });
  $('#readerInfo').textContent=`${wordCount(current.text)} words · 点词查词 / 长按划选翻译 · 译文默认隐藏`;
  if(current.sourceCorrections?.length)$('#readerInfo').textContent+=' · '+current.sourceCorrections.join(' ');
  const summary=$('#articleSummary small');if(summary)summary.textContent='自动概述仅供预习；具体信息、否定、数量和观点归属以英文原文为准。';
};
openWord=function(el){
  focusOpenWord(el);if(current?.type!=='reading')return;
  const gloss=readingTranslation(current,Number(el.dataset.sentence));
  $('#wordContextMeaning').hidden=false;
  $('#wordContextMeaning').textContent=gloss?`${translationLabel(gloss)}：${gloss.contextSource?gloss.contextSource+'\n':''}${gloss.zh}`:'本句暂无对应译文。';
  $('#baseWord').textContent=(selected.base!==selected.word?'原形：'+selected.base+' · ':'')+'以上为词典义项，请结合下方完整原句判断词义。';
};
selectedTranslation=function(snapshot){
  if(!snapshot||snapshot.scope!=='chapter'||current?.type!=='reading')return;
  const start=Number.isFinite(snapshot.start)?snapshot.start:sentences[snapshot.index]?.charStart;
  const end=Number.isFinite(snapshot.end)?snapshot.end:start+snapshot.quote.length;
  const matches=sentences.map((s,i)=>({s,i})).filter(({s})=>s.charStart<end&&s.charEnd>start);
  if(!matches.length)return;
  $('#selectionQuote').textContent=snapshot.quote;
  $('#selectionWordMeaning').textContent='以下按原句对照显示，包含所选片段的上下文。词典义项不作为片段译文拼接。';
  $('#selectionSentence').textContent=matches.map(({s})=>s.text.trim()).join('\n\n');
  const output=$('#selectionTranslation');output.replaceChildren();
  for(const {s,i} of matches){
    const row=document.createElement('section');row.className='selection-translation-row';
    const gloss=readingTranslation(current,i),original=document.createElement('p');original.className='selection-original';original.textContent=gloss?.contextSource||s.text.trim();
    const label=document.createElement('small');label.textContent=translationLabel(gloss);
    const translated=document.createElement('p');translated.textContent=gloss?.zh||'本句暂无对应译文。';
    const edit=document.createElement('button');edit.type='button';edit.textContent='修订本句译文';edit.onclick=()=>{$('#selectionDialog').close();editReadingTranslation(i)};
    row.append(original,label,translated,edit);output.append(row);
  }
  if(!$('#selectionDialog').open)$('#selectionDialog').showModal();selectionPill.hidden=true;
};

let readingEditTarget=null;
const translationDialog=document.createElement('dialog');translationDialog.id='readingTranslationEditor';
translationDialog.innerHTML='<div class="dialoghead"><h2>修订本句译文</h2><button type="button" id="closeReadingTranslation" aria-label="关闭">×</button></div><blockquote id="translationOriginal"></blockquote><p class="summary">保留原文的否定、条件、语气、数量和观点归属。修订只保存在本浏览器，包含在学习记录备份中。</p><label>中文译文<textarea id="translationChinese" rows="7" maxlength="12000"></textarea></label><p id="readingTranslationStatus" role="status"></p><div class="actions"><button type="button" id="saveReadingTranslation" class="primary">保存修订</button></div>';
document.body.append(translationDialog);
function editReadingTranslation(index){
  const s=sentences[index];if(!s||current?.type!=='reading')return;
  readingEditTarget={id:current.id,index,start:s.charStart,source:s.text.trim()};
  const gloss=readingTranslation(current,index);
  readingEditTarget.contextSource=gloss?.contextSource;
  $('#translationOriginal').textContent=gloss?.contextSource||readingEditTarget.source;
  $('#translationChinese').value=readingTranslation(current,index)?.zh||'';
  $('#readingTranslationStatus').textContent='';translationDialog.showModal();
}
$('#closeReadingTranslation').onclick=()=>{if(!$('#saveReadingTranslation').disabled)translationDialog.close()};
$('#saveReadingTranslation').onclick=async()=>{
  const target=readingEditTarget,zh=$('#translationChinese').value.trim(),status=$('#readingTranslationStatus'),button=$('#saveReadingTranslation');
  if(!target||button.disabled)return;if(!zh){status.textContent='请填写译文后保存。';return}
  notes.readingTranslations||={};notes.readingTranslations[target.id]||={};
  const old=notes.readingTranslations[target.id][target.start];
  notes.readingTranslations[target.id][target.start]={source:target.source,zh,contextSource:target.contextSource,updatedAt:new Date().toISOString()};
  clearTimeout(saveTimer);button.disabled=true;status.textContent='正在保存…';
  try{await saveState({requireStorage:true,timeoutMs:10000});translationDialog.close();
    if(current?.id===target.id){const box=$(`#text .sentence[data-sentence="${target.index}"]`)?.nextElementSibling;const content=box?.querySelector('.gloss-content');if(content)renderReadingTranslation(content,target.index)}
    toast('本句修订已保存，备份中会一并保留');
  }catch{if(old)notes.readingTranslations[target.id][target.start]=old;else delete notes.readingTranslations[target.id][target.start];status.textContent='保存失败，输入仍在。请检查浏览器存储空间后重试。'}
  finally{button.disabled=false}
};
renderVocab=function(){focusVocab();$('#special').querySelectorAll('[data-return]').forEach(button=>{if(items.find(c=>c.id===button.dataset.return)?.type!=='reading')button.remove()})};

renderSettings=function(){
  $('#special').innerHTML='<div class="intro"><div class="eyebrow">YOUR READING ROOM</div><h1>阅读与数据设置</h1></div><div class="panel"><h3>阅读设置</h3><label class="settingrow">正文字号<input id="fontSetting" type="range" min="16" max="34" step="1"></label><label class="settingrow">行距<select id="lineSetting"><option value="1.65">紧凑</option><option value="1.95">舒适</option><option value="2.25">宽松</option></select></label><label class="settingrow">点击单词后自动读音<input id="autoPronounce" type="checkbox"></label></div><div class="panel"><h3>所有学习数据</h3><p>阅读收藏、听力语料库、笔记、标记、进度和个人译文继续保存在原来的浏览器数据库。逐句精听已移除；以往听力编辑记录和草稿仍随备份保留。</p><div class="actions"><button id="exportState">导出全部学习记录</button><button id="restoreState">恢复学习记录</button><input id="restoreFile" type="file" accept=".json" hidden><button id="persistent">申请持久保存</button></div><p>数据保存在当前浏览器，不会随 GitHub 自动同步。换手机、换浏览器或清理网站数据前，请先导出备份。</p></div><div class="panel"><h3>译文使用说明</h3><p>全部阅读配有预置机器参考译文，打开文章后无需访问在线翻译服务。原文与译文逐句对应，默认折叠；划选跨句时展示各句完整对照。机器翻译仍可能误解专名、指代或长句，不能视作人工校译。</p><p>可使用“修订本句译文”保存自己的校订。自动段落概述也只是参考。单词弹窗中的词典释义列举常见义项，并不声称每个义项都适用于本文。</p></div><div class="panel"><h3>手机使用</h3><p>在小米浏览器或 Edge 打开本站，可从菜单添加到桌面。长按正文拖动选择柄，再点“翻译所选”或“彩色标记 / 笔记”。译文、段落概述均可点击展开。</p></div>';
  $('#fontSetting').value=notes.font||21;$('#fontSetting').oninput=e=>setFont(Number(e.target.value));
  $('#lineSetting').value=String(notes.lineHeight||1.95);$('#lineSetting').onchange=e=>{notes.lineHeight=Number(e.target.value);document.documentElement.style.setProperty('--lineheight',notes.lineHeight);scheduleSave()};
  $('#autoPronounce').checked=!!notes.autoPronounce;$('#autoPronounce').onchange=e=>{notes.autoPronounce=e.target.checked;scheduleSave()};
  $('#exportState').onclick=exportState;$('#restoreState').onclick=()=>$('#restoreFile').click();$('#restoreFile').onchange=restoreState;
  $('#persistent').onclick=async()=>toast(await navigator.storage?.persist?.()?'浏览器已允许持久保存':'请定期导出备份，浏览器未授予持久保存');
};
