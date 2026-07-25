const TEXTS=[
  {id:'about',label:'網站介紹'},
  {id:'wen',label:'文言',file:'文言.md'}, {id:'ji',label:'繫辭',file:'系辭.md'},
  {id:'shuo',label:'說卦',file:'說卦.md'}, {id:'xu',label:'序卦',file:'序卦.md'},
  {id:'za',label:'雜卦',file:'雜卦.md'}, {id:'full',label:'彖象合參',file:'易經_彖_象_文言_序卦.md'},
  {id:'divination',label:'占卜流程',file:'占卜流程.md'}
];
const state={hexagrams:[],selectedId:1,query:'',page:'hexagrams',pending:null,editingId:null,notes:loadNotes(),divinations:loadDivinations(),currentDivinationResult:null,editingDivinationIndex:null};
const $=(selector)=>document.querySelector(selector);
const reader=$('#reader'),list=$('#hexagram-list'),search=$('#search'),count=$('#result-count');

initNavigation(); bindUI();
fetch('/data/iching.json').then(check).then(r=>r.json()).then(data=>{state.hexagrams=data;if(!location.hash)location.hash='text/about';route();}).catch(()=>reader.innerHTML='<p class="empty">資料載入失敗，請確認伺服器已啟動。</p>');

function bindUI(){
  $('#menu-button').onclick=openDrawer; $('#close-menu').onclick=closeDrawer; $('#backdrop').onclick=closeAll;
  $('#notes-button').onclick=openNotes;
  search.oninput=e=>{state.query=e.target.value.trim().toLowerCase();renderHexagramList();};
  addEventListener('hashchange',route); addEventListener('resize',()=>requestAnimationFrame(applyHighlights));
  addEventListener('scroll',hideBubble,{passive:true});
  document.addEventListener('selectionchange',captureSelection);
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.annotation-bubble,#bubble-tooltip'))hideBubble();
  });
  $('#open-annotation').addEventListener('pointerdown',event=>{
    event.preventDefault();
    openAnnotationModal();
  });
  $('#cancel-selection').addEventListener('pointerdown',event=>{
    event.preventDefault();
    cancelPendingSelection();
  });
  $('#close-annotation').onclick=closeAnnotationModal; $('#cancel-annotation').onclick=closeAnnotationModal;
  $('#annotation-form').onsubmit=submitAnnotation;
  
  // 占卜功能綁定
  $('#divination-fab').onclick=openDivinationModal;
  $('#close-divination').onclick=closeDivinationModal;
  $('#cancel-divination').onclick=closeDivinationModal;
  $('#divination-form').onsubmit=startDivination;
  $('#close-divination-result').onclick=closeDivinationResult;
  $('#save-divination').onclick=saveDivinationResult;
  $('#cancel-result').onclick=closeDivinationResult;
  $('#close-edit-divination').onclick=closeEditDivinationModal;
  $('#cancel-edit-divination').onclick=closeEditDivinationModal;
  $('#edit-divination-form').onsubmit=submitEditDivination;
  
  // 筆記面板分頁切換
  document.querySelectorAll('.storage-tab').forEach(tab=>{
    tab.onclick=e=>{
      document.querySelectorAll('.storage-tab').forEach(t=>t.classList.remove('active'));
      e.target.classList.add('active');
      const tabName=e.target.dataset.tab;
      $('#notes-list').hidden=(tabName!=='highlights');
      $('#divinations-list').hidden=(tabName!=='divinations');
      if(tabName==='divinations')renderDivinations();
      else renderNotes();
    };
  });
}

function initNavigation(){
  const entries=[{id:'hexagrams',label:'六十四卦'},...TEXTS];
  $('#primary-nav').innerHTML=entries.map(x=>`<button class="nav-button" data-page="${x.id}" type="button">${x.label}</button>`).join('');
  $('#primary-nav').onclick=e=>{const button=e.target.closest('[data-page]');if(!button)return;location.hash=button.dataset.page==='hexagrams'?`gua/${state.selectedId}`:`text/${button.dataset.page}`;closeDrawer();};
}

function route(){
  state.pending=null;$('#highlight-action').hidden=true;hideBubble();document.querySelectorAll('.annotation-bubble').forEach(x=>x.remove());
  const [kind,value]=location.hash.slice(1).split('/');
  if(kind==='text'&&TEXTS.some(x=>x.id===value)) return renderText(value);
  const id=kind==='gua'?Number(value):1; state.selectedId=state.hexagrams.some(x=>x.id===id)?id:1;
  state.page='hexagrams'; renderNavState();renderHexagramList();renderHexagram();
}

function renderHexagramList(){
  const matches=state.hexagrams.filter(matchesQuery);count.textContent=state.query?`找到 ${matches.length} 卦`:'依文王卦序排列';
  list.innerHTML=matches.map(x=>`<button class="hexagram-button${x.id===state.selectedId?' active':''}" data-id="${x.id}" type="button"><span class="number">${String(x.id).padStart(2,'0')}</span><span>${esc(x.name)}</span><span class="symbol">${esc(x.symbol)}</span></button>`).join('');
  list.onclick=e=>{const b=e.target.closest('[data-id]');if(b){location.hash=`gua/${b.dataset.id}`;closeDrawer();}};
}

function renderHexagram(){
  const x=state.hexagrams.find(item=>item.id===state.selectedId);if(!x)return;setTitle(`${x.name}卦`);
  reader.innerHTML=`<article class="annotatable" data-doc="gua-${x.id}"><header class="hero"><div class="hero-symbol">${esc(x.symbol)}</div><div><h1><span class="sequence">第 ${x.id} 卦</span>${esc(x.name)}</h1><p class="combination">下${esc(x.combination[0])} · 上${esc(x.combination[1])}</p><p class="scripture">${esc(x.scripture)}</p></div></header><h2 class="section-title">卦 詩</h2><p class="poetry main-poetry">${esc(x.poetry)}</p><h2 class="section-title">爻 辭 與 詩 訣</h2><div class="lines">${x.lines.map(renderLine).join('')}</div></article>`;
  applyHighlights();
}

function renderLine(line){
  const visual=line.image?`<img src="${line.image.replace(/^\.\.\/image\//,'/image/')}" alt="${esc(line.name)}圖" loading="lazy">`:'<span class="image-missing">圖片尚未提供</span>';
  const poem=line.poetry?`<p class="poetry line-poetry">${esc(line.poetry)}</p>`:'<p class="no-poetry">此爻無附加詩訣</p>';
  return `<section class="line-card"><div class="line-top"><div class="line-visual">${visual}</div><div><h3 class="line-name">${esc(line.name)}<span class="line-type">${line.type?'陽爻':'陰爻'}</span></h3><p class="line-scripture">${esc(line.scripture)}</p></div></div>${poem}</section>`;
}

async function renderText(id){
  const page=TEXTS.find(x=>x.id===id);state.page=id;renderNavState();setTitle(page.label);reader.innerHTML='<p class="loading">正在展卷……</p>';
  if(id==='about')return renderAbout();
  try{const md=await fetch(`/texts/${encodeURIComponent(page.file)}`).then(check).then(r=>r.text());reader.innerHTML=`<article class="text-page annotatable" data-doc="text-${id}"><header><p class="text-kicker">易 傳 原 文</p><h1>${page.label}</h1></header><div class="prose">${plainMarkdown(md)}</div></article>`;applyHighlights();}
  catch{reader.innerHTML='<p class="empty">此篇文字載入失敗。</p>';}
}

function renderAbout(){
  reader.innerHTML=`<article class="text-page annotatable" data-doc="text-about"><header><p class="text-kicker">使 用 說 明</p><h1>網站介紹</h1></header><div class="about-grid"><section class="feature-card"><h2>六十四卦查閱</h2><p>從左上角目錄開啟六十四卦索引，可依卦名、卦序、卦辭、爻辭或詩訣搜尋。</p></section><section class="feature-card"><h2>易傳獨立閱讀</h2><p>文言、繫辭、說卦、序卦、雜卦與彖象合參皆整理為獨立文字頁。</p></section><section class="feature-card"><h2>本機螢光筆註解</h2><ol class="steps"><li>反白想記錄的內文。</li><li>點擊畫面下方「加入螢光筆註解」。</li><li>在視窗輸入心得後送出。</li><li>長按內文旁的小泡泡可快速查看；雙擊泡泡可重新編輯。</li></ol></section><section class="feature-card"><h2>易經占卜</h2><ol class="steps"><li>點擊螢幕右下方的「占」按鈕。</li><li>輸入你的提問或所求。</li><li>系統將使用古法蓍草演卦生成結果。</li><li>結果會顯示本卦、變爻與之卦。</li><li>可將占卜結果儲存，方便日後查閱。</li></ol></section></div><div class="privacy-note"><strong>隱私說明</strong><br>所有註解和占卜紀錄只存放在目前瀏覽器的 localStorage，不會上傳雲端。清除網站資料、換瀏覽器或換裝置時，資料不會自動保留或同步。</div></article>`;
  applyHighlights();
}

function plainMarkdown(md){
  const clean=md
    .replaceAll('&nbsp;',' ')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi,'')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/?[a-z][^>]*>/gi,'')
    .replace(/&lt;\/?(?:span|br|details|summary)[^&]*?&gt;/gi,'');
  return clean.split(/\r?\n/).map(raw=>{
    const line=raw.trim();if(!line)return '';
    const h=line.match(/^(#{1,4})\s+(.+)$/);if(h){const level=Math.min(h[1].length+1,3);return `<h${level}>${inline(h[2])}</h${level}>`;}
    return `<p>${inline(line.replace(/^[-*]\s+/,''))}</p>`;
  }).join('');
}
function inline(text){return esc(text).replace(/\*\*(.+?)\*\*/g,'<strong class="label">$1</strong>').replace(/`(.+?)`/g,'<span class="label">$1</span>');}

function captureSelection(){
  const selection=getSelection(),root=$('.annotatable');
  if(!root||!selection||selection.isCollapsed||!selection.rangeCount){
    if($('#annotation-modal').hidden){state.pending=null;$('#highlight-action').hidden=true;}
    return;
  }
  const range=selection.getRangeAt(0);if(!root.contains(range.commonAncestorContainer))return;
  const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
  const text=selection.toString().trim();if(!text)return;
  state.pending={doc:root.dataset.doc,start:before.toString().length,end:before.toString().length+selection.toString().length,text,createdAt:Date.now()};
  $('#highlight-action').hidden=false;
}

function cancelPendingSelection(){
  state.pending=null;getSelection()?.removeAllRanges();$('#highlight-action').hidden=true;
}

function openAnnotationModal(note){
  const target=note||state.notes.find(n=>n.id===state.editingId);if(!target&&!state.pending)return;
  state.editingId=note?.id||null;const source=note||state.pending;
  $('#annotation-title').textContent=note?'編輯註解':'新增註解';$('#selected-quote').textContent=source.text;
  $('#annotation-text').value=note?.comment||'';$('#annotation-modal').hidden=false;$('#highlight-action').hidden=true;
  setTimeout(()=>$('#annotation-text').focus(),0);
}
function closeAnnotationModal(){
  $('#annotation-modal').hidden=true;state.editingId=null;
  if(state.pending)$('#highlight-action').hidden=false;
}
function submitAnnotation(event){
  event.preventDefault();const comment=$('#annotation-text').value.trim();if(!comment)return;
  if(state.editingId){const note=state.notes.find(n=>n.id===state.editingId);if(note)note.comment=comment;}
  else if(state.pending){state.notes.push({...state.pending,comment,id:crypto.randomUUID?.()||String(Date.now())});}
  saveNotes();getSelection()?.removeAllRanges();state.pending=null;state.editingId=null;$('#annotation-modal').hidden=true;$('#highlight-action').hidden=true;
  applyHighlights();if(!$('#notes-panel').hidden)renderNotes();toast('註解已保存在此裝置');navigator.vibrate?.(35);
}

function applyHighlights(){
  document.querySelectorAll('.annotation-bubble').forEach(x=>x.remove());
  const root=$('.annotatable');if(!root)return;
  const entries=state.notes.filter(n=>n.doc===root.dataset.doc).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end)})).filter(x=>x.range);
  if(CSS.highlights&&window.Highlight){CSS.highlights.delete('user-notes');if(entries.length)CSS.highlights.set('user-notes',new Highlight(...entries.map(x=>x.range)));}
  requestAnimationFrame(()=>renderBubbles(entries));
}
function renderBubbles(entries){
  entries.forEach(({note,range},index)=>{const rect=[...range.getClientRects()].at(-1)||range.getBoundingClientRect();if(!rect.width&&!rect.height)return;
    const bubble=document.createElement('button');bubble.className='annotation-bubble';bubble.type='button';bubble.textContent=index+1;bubble.setAttribute('aria-label',`註解：${note.comment||note.text}`);
    bubble.style.left=`${Math.min(innerWidth-32,rect.right+scrollX)}px`;bubble.style.top=`${rect.bottom+scrollY}px`;bubble.dataset.note=note.id;document.body.appendChild(bubble);bindBubble(bubble,note);
  });
}
function bindBubble(bubble,note){
  let timer;
  bubble.addEventListener('pointerdown',e=>{e.preventDefault();timer=setTimeout(()=>showBubble(note),550);});
  ['pointerup','pointercancel','pointerleave'].forEach(type=>bubble.addEventListener(type,()=>clearTimeout(timer)));
  bubble.addEventListener('dblclick',e=>{e.preventDefault();hideBubble();openAnnotationModal(note);});
}
function showBubble(note){const tip=$('#bubble-tooltip');tip.innerHTML=`<strong>${esc(notePageName(note.doc))}</strong>${esc(note.comment||'尚未填寫註解')}`;tip.hidden=false;clearTimeout(showBubble.timer);showBubble.timer=setTimeout(hideBubble,5000);navigator.vibrate?.(25);}
function hideBubble(){$('#bubble-tooltip').hidden=true;}
function rangeFromOffsets(root,start,end){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,pos=0,sNode,eNode,sOffset,eOffset;
  while((node=walker.nextNode())){const next=pos+node.data.length;if(sNode==null&&start>=pos&&start<=next){sNode=node;sOffset=start-pos;}if(end>=pos&&end<=next){eNode=node;eOffset=end-pos;break;}pos=next;}
  if(!sNode||!eNode)return null;const range=document.createRange();range.setStart(sNode,sOffset);range.setEnd(eNode,eOffset);return range;
}

function openNotes(){
  renderNotes();
  // 預設顯示 highlights 分頁
  document.querySelectorAll('.storage-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('[data-tab="highlights"]').classList.add('active');
  $('#notes-list').hidden=false;
  $('#divinations-list').hidden=true;
  $('#notes-panel').hidden=false;
  $('#backdrop').hidden=false;
}
function renderNotes(){
  const box=$('#notes-list');box.innerHTML=state.notes.length?state.notes.slice().reverse().map(n=>`<article class="note-item"><div class="note-meta"><span>${notePageName(n.doc)}</span><span class="note-actions"><button class="edit-note" data-edit="${n.id}" type="button">編輯</button><button class="delete-note" data-delete="${n.id}" type="button">刪除</button></span></div><p class="note-text">「${esc(n.text)}」</p><p class="note-comment">${esc(n.comment||'尚未填寫註解')}</p></article>`).join(''):'<p class="empty">尚未加入螢光筆標記。</p>';
  box.onclick=e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit){const note=state.notes.find(n=>n.id===edit.dataset.edit);if(note)openAnnotationModal(note);}if(del){state.notes=state.notes.filter(n=>n.id!==del.dataset.delete);saveNotes();renderNotes();applyHighlights();}};
}
function notePageName(doc){if(doc.startsWith('gua-')){const x=state.hexagrams.find(g=>g.id===Number(doc.slice(4)));return x?`${x.name}卦`:'六十四卦';}return TEXTS.find(x=>`text-${x.id}`===doc)?.label||'原文';}
function loadNotes(){try{return (JSON.parse(localStorage.getItem('iching-highlights-v1'))||[]).map((n,i)=>({...n,id:n.id||`legacy-${i}-${n.createdAt||0}`,comment:n.comment||''}));}catch{return [];}}
function saveNotes(){localStorage.setItem('iching-highlights-v1',JSON.stringify(state.notes));}

function openDrawer(){$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#menu-button').setAttribute('aria-expanded','true');$('#backdrop').hidden=false;}
function closeDrawer(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#menu-button').setAttribute('aria-expanded','false');if($('#notes-panel').hidden)$('#backdrop').hidden=true;}
function closeAll(){closeDrawer();$('#notes-panel').hidden=true;$('#backdrop').hidden=true;}
function renderNavState(){$$('.nav-button');document.querySelectorAll('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));$('#hexagram-tools').hidden=state.page!=='hexagrams';}
function setTitle(label){$('#page-label').textContent=label;document.title=`${label} · 周易讀本`;scrollTo({top:0,behavior:'smooth'});}
function matchesQuery(x){if(!state.query)return true;return [x.id,x.name,x.scripture,x.poetry,...x.lines.flatMap(y=>[y.name,y.scripture,y.poetry])].join(' ').toLowerCase().includes(state.query);}
function check(response){if(!response.ok)throw new Error(response.status);return response;}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800);}
function esc(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function $$(selector){return document.querySelectorAll(selector);}

// ===== 占卜功能 =====
function openDivinationModal(){
  $('#divination-question').value='';
  $('#divination-modal').hidden=false;
  $('#backdrop').hidden=false;
  setTimeout(()=>$('#divination-question').focus(),0);
}
function closeDivinationModal(){
  $('#divination-modal').hidden=true;
  if($('#notes-panel').hidden)$('#backdrop').hidden=true;
}
function closeDivinationResult(){
  $('#divination-result-modal').hidden=true;
  if($('#notes-panel').hidden)$('#backdrop').hidden=true;
}

function startDivination(event){
  event.preventDefault();
  const question=$('#divination-question').value.trim();
  if(!question)return;
  
  $('#divination-modal').hidden=true;
  $('#divination-result-modal').hidden=false;
  $('#divination-animation').hidden=false;
  $('#divination-result-content').hidden=true;
  
  // 生成占卜結果
  const result=generateDivination();
  state.currentDivinationResult={question,result,timestamp:Date.now()};
  
  // 動畫展示
  animateDivination(result);
}

function generateDivination(){
  // 生成六爻，每爻三變
  const lines=[];
  for(let i=0;i<6;i++){
    const lineValue=generateLine();
    lines.push(lineValue);
  }
  
  // 變爻是6和9的位置
  const changingLines=lines.map((v,i)=>(v===6||v===9)?i:null).filter(i=>i!==null);
  
  // 之卦的推導：6變9，9變6，7和8保持不變
  const resultLines=lines.map(v=>{
    if(v===6)return 9;   // 老陰變老陽
    if(v===9)return 6;   // 老陽變老陰
    return v;             // 7和8不變
  });
  
  return {
    lines:lines,
    originalHexagram:getHexagramFromLines(lines),
    changingLines:changingLines,
    resultHexagram:getHexagramFromLines(resultLines)
  };
}

function generateLine(){
  // 蓍草法計算一爻
  // 蓍草50根，起算49根
  // 一爻三變，每變的結果累積，根據蓍草規則，結果分布為：
  // 6（老陰） : 7（少陽） : 8（少陰） : 9（老陽） = 1 : 3 : 3 : 1
  const rand=Math.random();
  if(rand<0.125)return 6;    // 12.5% 老陰（變爻）
  if(rand<0.5)return 7;      // 37.5% 少陽（不變爻）
  if(rand<0.875)return 8;    // 37.5% 少陰（不變爻）
  return 9;                  // 12.5% 老陽（變爻）
}

function getHexagramFromLines(lines){
  // 根據六爻生成卦象
  // 爻值：7/9=陽(1), 6/8=陰(0)
  // array[0]=初爻, array[5]=上爻，直接比對 h.array 字串
  const arrayStr=lines.map(v=>(v===7||v===9)?1:0);
  return state.hexagrams.find(h=>h.array.every((v,i)=>v===arrayStr[i]))||state.hexagrams[0];
}

function animateDivination(result){
  const container=$('#divination-animation');
  const lineElements=$$('.line-animation');
  let animationComplete=0;
  
  // 動畫依次顯示六爻（從上到下對應從下到上的第6到第1爻）
  lineElements.forEach((lineEl,displayIndex)=>{
    setTimeout(()=>{
      const actualLineIndex=5-displayIndex;  // 轉換顯示順序到實際爻的索引
      const lineValue=result.lines[actualLineIndex];
      const isChanging=result.changingLines.includes(actualLineIndex);
      lineEl.innerHTML=getLineSymbol(lineValue,isChanging);
      lineEl.classList.add('animate');
      animationComplete++;
      
      if(animationComplete===6){
        // 所有爻都顯示後，1秒後顯示結果
        setTimeout(()=>showDivinationResult(result),1000);
      }
    },displayIndex*300);
  });
}

function getLineSymbol(lineValue,isChanging=false){
  // 6=老陰(變), 7=少陽(不變), 8=少陰(不變), 9=老陽(變)
  const isYang=(lineValue===7||lineValue===9);
  const colorClass=isChanging?'changing':'normal';
  
  if(isYang){
    return `<div class="line-symbol yang ${colorClass}"></div>`;
  }else{
    return `<div class="line-symbol yin ${colorClass}"><div class="yin-left"></div><div class="yin-right"></div></div>`;
  }
}

function showDivinationResult(result){
  $('#divination-animation').hidden=true;
  $('#divination-result-content').hidden=false;
  
  const originalHex=result.originalHexagram;
  const resultHex=result.resultHexagram;
  const numChanging=result.changingLines.length;
  
  // 顯示 "A之B" 格式
  $('#result-main-display').innerHTML=`
    <div style="display:flex;gap:16px;align-items:center">
      <div style="flex:1">
        <strong style="font-size:1.1em">${originalHex.name}卦</strong><br>
        <span style="color:#666;font-size:0.9rem">第 ${originalHex.id} 卦</span><br>
        <span style="font-size:1.5em;margin:4px 0">${esc(originalHex.symbol)}</span>
      </div>
      <div style="font-size:1.2em;color:#999">之</div>
      <div style="flex:1">
        <strong style="font-size:1.1em">${resultHex.name}卦</strong><br>
        <span style="color:#666;font-size:0.9rem">第 ${resultHex.id} 卦</span><br>
        <span style="font-size:1.5em;margin:4px 0">${esc(resultHex.symbol)}</span>
      </div>
    </div>
  `;
  
  // 根據變爻數量顯示爻辭或說明
  let changingLinesDisplay='';
  let lineDisplay='';
  let explanation='';
  
  if(numChanging>0){
    const changingText=result.changingLines.map(idx=>`第 ${idx+1} 爻`).join('、');
    changingLinesDisplay=`<div style="margin-bottom:12px"><strong>變爻</strong>：${changingText}</div>`;
  }
  
  if(numChanging===0){
    explanation='<em>沒有變爻，以本卦卦辭為準。</em>';
  }else if(numChanging===1||numChanging===2){
    // 1-2個變爻：顯示爻辭
    lineDisplay=result.changingLines.map(idx=>{
      const line=originalHex.lines[idx];
      return `<div style="margin-bottom:8px"><strong>${originalHex.name} ${esc(line.name)}</strong> — ${esc(line.scripture)}</div>`;
    }).join('');
    explanation=`<em>${numChanging===1?'單爻變化，專注此爻辭。':'兩爻交變，參考這兩爻的爻辭與之卦。'}</em>`;
  }else{
    // 3個以上變爻：顯示卦辭
    explanation='<em>多爻交變，以本卦、之卦的卦辭為主。</em>';
    lineDisplay=`
      <div style="margin-bottom:12px">
        <strong>本卦卦辭</strong><br>
        <span style="color:#666">${esc(originalHex.scripture)}</span>
      </div>
    `;
  }
  
  $('#result-changing-lines').innerHTML=changingLinesDisplay+lineDisplay;
  $('#result-explanation').innerHTML=explanation;
  
  // 顯示之卦的完整信息
  $('#result-hexagram').innerHTML=`
    <strong>之卦（${resultHex.name}卦）卦辭</strong><br>
    <span style="color:#666">${esc(resultHex.scripture)}</span>
  `;
}

function saveDivinationResult(){
  if(!state.currentDivinationResult)return;
  state.divinations.push(state.currentDivinationResult);
  saveDivinations();
  toast('占卜結果已儲存');
  closeDivinationResult();
}

function loadDivinations(){
  try{
    return JSON.parse(localStorage.getItem('iching-divinations-v1'))||[];
  }catch{
    return [];
  }
}

function saveDivinations(){
  localStorage.setItem('iching-divinations-v1',JSON.stringify(state.divinations));
}

function openEditDivinationModal(index){
  const divination=state.divinations[index];
  if(!divination)return;
  state.editingDivinationIndex=index;
  $('#edit-divination-question').value=divination.question;
  $('#edit-divination-modal').hidden=false;
  $('#backdrop').hidden=false;
  setTimeout(()=>$('#edit-divination-question').focus(),0);
}

function closeEditDivinationModal(){
  $('#edit-divination-modal').hidden=true;
  state.editingDivinationIndex=null;
  if($('#notes-panel').hidden)$('#backdrop').hidden=true;
}

function submitEditDivination(event){
  event.preventDefault();
  const question=$('#edit-divination-question').value.trim();
  if(!question)return;
  
  if(state.editingDivinationIndex!==null){
    state.divinations[state.editingDivinationIndex].question=question;
    saveDivinations();
    renderDivinations();
    toast('占卜紀錄已更新');
  }
  
  closeEditDivinationModal();
}

function renderDivinations(){
  const box=$('#divinations-list');
  box.innerHTML=state.divinations.length?state.divinations.slice().reverse().map((d,reverseIdx)=>{
    const actualIdx=state.divinations.length-1-reverseIdx;
    const original=state.hexagrams.find(h=>h.id===d.result.originalHexagram.id)||{name:'未知',symbol:'？',id:0,lines:[]};
    const result=state.hexagrams.find(h=>h.id===d.result.resultHexagram.id)||{name:'未知',symbol:'？',id:0};
    const n=d.result.changingLines.length;

    // 之卦行
    const gongzhi=n>0
      ?`<span class="div-hexagram-label">${esc(original.symbol)} ${esc(original.name)} 之 ${esc(result.name)} ${esc(result.symbol)}</span>`
      :`<span class="div-hexagram-label">${esc(original.symbol)} ${esc(original.name)}（無變爻）</span>`;

    // 變爻行
    let changingInfo='';
    if(n>0){
      const yaoNums=d.result.changingLines.map(i=>`第${i+1}爻`).join('、');
      changingInfo=`<div class="div-changing">變爻：${yaoNums}</div>`;
    }

    // 爻辭或卦辭（依變爻數）
    let yaoText='';
    if(n===0){
      yaoText=`<div class="div-yao-text">卦辭：${esc(original.scripture||'')}</div>`;
    }else if(n===1||n===2){
      yaoText=d.result.changingLines.map(idx=>{
        const line=original.lines&&original.lines[idx];
        return line?`<div class="div-yao-text"><span class="div-yao-name">${esc(line.name)}</span>：${esc(line.scripture)}</div>`:'';
      }).join('');
    }else{
      yaoText=`<div class="div-yao-text">本卦：${esc(original.scripture||'')}　之卦：${esc(result.scripture||'')}</div>`;
    }

    return `<article class="note-item divination-item">
      <div class="note-meta">
        <span class="divination-date">${new Date(d.timestamp).toLocaleString('zh-Hant')}</span>
        <span class="note-actions">
          <button class="edit-note" data-edit-divination="${actualIdx}" type="button">編輯</button>
          <button class="delete-note" data-delete-divination="${d.timestamp}" type="button">刪除</button>
        </span>
      </div>
      <p class="note-text">「${esc(d.question)}」</p>
      <div class="divination-result">${gongzhi}${changingInfo}${yaoText}</div>
    </article>`;
  }).join(''):'<p class="empty">尚未進行占卜。</p>';
  
  box.onclick=e=>{
    const edit=e.target.closest('[data-edit-divination]');
    const del=e.target.closest('[data-delete-divination]');
    if(edit){
      const idx=parseInt(edit.dataset.editDivination);
      openEditDivinationModal(idx);
    }
    if(del){
      const timestamp=parseInt(del.dataset.deleteDivination);
      state.divinations=state.divinations.filter(d=>d.timestamp!==timestamp);
      saveDivinations();
      renderDivinations();
    }
  };
}
