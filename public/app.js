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

// 初始化認證系統（在其他 UI 初始化前進行）
if(typeof authManager !== 'undefined'){
  authManager.init().then(()=>{
    // 初始化完成後更新 UI
    setTimeout(()=>updateAuthUI?.(), 100);
  }).catch(err=>console.warn('認證初始化失敗:', err));
}

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
      
      // 隱藏所有內容區域
      ['divinations-content','highlights-content','favorites-content','notifications-content','settings-content'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.hidden=(id.replace('-content','')!==tabName);
      });
      
      // 根據分頁類型加載內容
      if(tabName==='divinations')renderDivinations();
      else if(tabName==='highlights')renderNotes();
      else if(tabName==='favorites')loadFavoritesList();
      else if(tabName==='notifications')loadNotificationsList();
      else if(tabName==='settings')initializeSettings();
    };
  });
  
  // 用戶菜單綁定
  if($('#login-button')){
    $('#login-button').onclick=async ()=>{
      if(typeof authManager !== 'undefined'){
        try{
          // 啟動 OAuth 流程
          const result=await authManager.startLogin('/');
          // 顯示帳號選擇界面
          showLoginModal();
        }catch(err){
          console.error('登入啟動失敗:', err);
          alert('登入失敗，請重試');
        }
      }
    };
  }
  
  // 登入模態框處理
  if($('#close-login')){
    $('#close-login').onclick=()=>{
      $('#login-modal').hidden=true;
      $('#backdrop').hidden=true;
    };
  }
  
  if($('#user-menu-toggle')){
    $('#user-menu-toggle').onclick=()=>{
      const dropdown=$('#user-menu-dropdown');
      dropdown.hidden=!dropdown.hidden;
    };
  }
  
  // 暱稱編輯功能
  if($('#edit-nickname-btn')){
    $('#edit-nickname-btn').onclick=(e)=>{
      e.stopPropagation();
      const form=$('#nickname-edit-form');
      const input=$('#nickname-input');
      const user=authManager.getCurrentUser();
      form.style.display='block';
      input.value=user?.displayName||'';
      setTimeout(()=>input.focus(),0);
    };
  }
  
  if($('#cancel-nickname-btn')){
    $('#cancel-nickname-btn').onclick=(e)=>{
      e.stopPropagation();
      $('#nickname-edit-form').style.display='none';
    };
  }
  
  if($('#save-nickname-btn')){
    $('#save-nickname-btn').onclick=async (e)=>{
      e.stopPropagation();
      const input=$('#nickname-input');
      const newNickname=input.value.trim();
      
      if(!newNickname){
        alert('暱稱不能為空');
        return;
      }
      
      try{
        // 更新本地用戶信息
        if(authManager.getCurrentUser){
          const user=authManager.getCurrentUser();
          if(user){
            user.displayName=newNickname;
            // 保存到 localStorage
            localStorage.setItem('user',JSON.stringify(user));
            
            // 更新 UI
            $('#user-nickname').textContent=newNickname;
            $('#nickname-edit-form').style.display='none';
            toast('暱稱已更新');
            
            // 如果有 API 可用，也發送到後端
            if(typeof api !== 'undefined' && api.updateProfile){
              await api.updateProfile?.({displayName:newNickname});
            }
          }
        }
      }catch(err){
        console.error('更新暱稱失敗:', err);
        alert('更新暱稱失敗');
      }
    };
  }
  
  if($('#logout-button')){
    $('#logout-button').onclick=()=>{
      if(typeof authManager !== 'undefined'){
        authManager.logout();
        updateAuthUI();
      }
    };
  }
  
  // 點擊背景時關閉用戶菜單
  document.addEventListener('click',e=>{
    if(!e.target.closest('#user-menu')){
      closeUserMenu();
    }
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
  reader.innerHTML=`<article class="text-page annotatable" data-doc="text-about"><header><p class="text-kicker">使 用 說 明</p><h1>網站介紹</h1></header><div class="about-grid"><section class="feature-card"><h2>六十四卦查閱</h2><p>從左上角目錄開啟六十四卦索引，可依卦名、卦序、卦辭、爻辭或詩訣搜尋。</p></section><section class="feature-card"><h2>易傳獨立閱讀</h2><p>文言、繫辭、說卦、序卦、雜卦與彖象合參皆整理為獨立文字頁。</p></section><section class="feature-card"><h2>本機螢光筆註解</h2><ol class="steps"><li>反白想記錄的內文。</li><li>點擊畫面下方「加入螢光筆註解」。</li><li>在視窗選擇「私人」或「公開」，輸入心得後送出。</li><li>私人註解只會存在您的裝置，公開註解會與其他使用者分享。</li><li>長按內文旁的小泡泡可快速查看；雙擊泡泡可重新編輯。</li></ol></section><section class="feature-card"><h2>社群功能</h2><ol class="steps"><li>當您設定註解為「公開」時，其他登入使用者可以看到您的匿名註解。</li><li>相同位置的公開註解會自動聚合成小氣泡，您可點擊查看。</li><li>您可以按讚、倒讚或收藏他人的公開註解。</li><li>投票結果（按讚/倒讚）會決定註解的排序與可見性。</li></ol></section><section class="feature-card"><h2>易經占卜</h2><ol class="steps"><li>點擊螢幕右下方的「占」按鈕。</li><li>輸入你的提問或所求。</li><li>系統將使用古法蓍草演卦生成結果。</li><li>結果會顯示本卦、變爻與之卦。</li><li>可將占卜結果儲存，方便日後查閱。</li></ol></section></div><div class="privacy-note"><strong>隱私說明</strong><br><strong>私人註解：</strong>只存放在目前瀏覽器的 localStorage，不會上傳到伺服器。清除網站資料、換瀏覽器或換裝置時，資料不會自動保留。<br><br><strong>公開註解：</strong>儲存在伺服器上與其他使用者分享。您的姓名不會顯示；系統會根據用戶ID與文章生成一致的「匿名使用者 XXXX」代碼。投票與收藏記錄僅記錄投票狀態，不涉及個人隱私。</div></article>`;
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
  $('#annotation-text').value=note?.comment||'';
  // 設置可見性值
  const visibilityValue=note?.visibility||'private';
  document.querySelectorAll('input[name="visibility"]').forEach(r=>r.checked=(r.value===visibilityValue));
  $('#annotation-modal').hidden=false;$('#highlight-action').hidden=true;
  setTimeout(()=>$('#annotation-text').focus(),0);
}
function closeAnnotationModal(){
  $('#annotation-modal').hidden=true;state.editingId=null;
  if(state.pending)$('#highlight-action').hidden=false;
}
async function submitAnnotation(event){
  event.preventDefault();const comment=$('#annotation-text').value.trim();if(!comment)return;
  const visibility=document.querySelector('input[name="visibility"]:checked')?.value||'private';
  
  if(state.editingId){
    const note=state.notes.find(n=>n.id===state.editingId);
    if(note){
      note.comment=comment;
      note.visibility=visibility;
      // 如果改為 public，嘗試同步到 API
      if(visibility==='public'&&typeof api!=='undefined'&&authManager.isLoggedIn){
        try{
          await api.updateNote(note.id,{content:comment,visibility:'public'});
        }catch(err){
          console.warn('無法同步公開註記到伺服器:',err);
        }
      }
    }
  }
  else if(state.pending){
    const newNote={...state.pending,comment,visibility,id:crypto.randomUUID?.()||String(Date.now())};
    state.notes.push(newNote);
    // 如果是 public 註記且已登入，發送到 API
    if(visibility==='public'&&typeof api!=='undefined'&&authManager.isLoggedIn){
      try{
        const result=await api.createNote({
          articleType:state.page==='hexagrams'?'iching':'md',
          articleId:state.pending.doc,
          paragraphAnchor:state.pending.start?.toString()||'0',
          anchorOffsetStart:state.pending.start||0,
          anchorOffsetEnd:state.pending.end||0,
          content:comment,
          visibility:'public'
        });
        newNote.serverId=result.note?.id;
      }catch(err){
        console.warn('無法保存公開註記到伺服器:',err);
      }
    }
  }
  saveNotes();getSelection()?.removeAllRanges();state.pending=null;state.editingId=null;$('#annotation-modal').hidden=true;$('#highlight-action').hidden=true;
  applyHighlights();if(!$('#notes-panel').hidden)renderNotes();toast('註解已保存在此裝置');navigator.vibrate?.(35);
}

function applyHighlights(){
  document.querySelectorAll('.annotation-bubble').forEach(x=>x.remove());
  const root=$('.annotatable');if(!root)return;
  
  // 加載私人註記
  const privateEntries=state.notes.filter(n=>n.doc===root.dataset.doc).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end),type:'private',clusterId:null})).filter(x=>x.range);
  
  // 先渲染私人氣泡
  requestAnimationFrame(()=>renderBubbles(privateEntries));
  
  // 加載公開註記（異步）
  if(typeof api!=='undefined'&&root.dataset.doc.startsWith('gua-')){
    const articleId=root.dataset.doc.replace('gua-','');
    loadPublicNotesForPage(articleId);
  }
  
  // 設置私人註記高亮
  if(CSS.highlights&&window.Highlight){
    CSS.highlights.delete('user-notes');
    CSS.highlights.delete('public-notes');
    if(privateEntries.length)CSS.highlights.set('user-notes',new Highlight(...privateEntries.map(x=>x.range)));
  }
}

async function loadPublicNotesForPage(articleId){
  try{
    // 讀取用戶設置的閾值
    let thresholdPercent=60;// 默認值
    try{
      const settings=await api.getUserSettings();
      if(settings&&settings.settings){
        thresholdPercent=settings.settings.noteVisibilityThresholdPercent||60;
      }
    }catch(err){
      console.warn('無法讀取閾值設定，使用默認值');
    }
    
    // 從伺服器加載公開註記，應用用戶設置的閾值
    const response=await fetch(`/api/notes?articleId=gua-${articleId}&paragraphAnchor=0&thresholdPercent=${thresholdPercent}`);
    if(!response.ok)return;
    
    const data=await response.json();
    if(!data.notes||!data.notes.length)return;
    
    const root=$('.annotatable');if(!root||root.dataset.doc!==`gua-${articleId}`)return;
    
    // 儲存公開註記到全局狀態供討論串使用
    if(!window.publicNotesByArticle)window.publicNotesByArticle={};
    window.publicNotesByArticle[articleId]=data.notes;
    
    // 將公開註記轉換為 entries 格式並計算 cluster
    const publicEntries=data.notes.map(note=>({
      note:{...note,visibility:'public',id:note.id,doc:`gua-${articleId}`,start:note.anchor_offset_start,end:note.anchor_offset_end,comment:note.content},
      range:rangeFromOffsets(root,note.anchor_offset_start,note.anchor_offset_end),
      type:'public',
      clusterId:Math.floor(note.anchor_offset_start/5)
    })).filter(x=>x.range);
    
    if(!publicEntries.length)return;
    
    // 設置公開註記高亮
    if(CSS.highlights&&window.Highlight){
      CSS.highlights.set('public-notes',new Highlight(...publicEntries.map(x=>x.range)));
    }
    
    // 與私人註記一起渲染所有氣泡
    const privateEntries=state.notes.filter(n=>n.doc===root.dataset.doc).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end),type:'private',clusterId:null})).filter(x=>x.range);
    renderBubbles([...privateEntries,...publicEntries]);
    
    // 訂閱 Realtime 更新
    if(typeof realtimeClient !== 'undefined' && realtimeClient.isEnabled){
      const subscriptionId=realtimeClient.subscribeToNotes(articleId,0,(update)=>{
        if(update.event==='INSERT'||update.event==='UPDATE'||update.event==='DELETE'){
          console.log('✓ Realtime 更新:',update.event);
          // 重新加載註記
          loadPublicNotesForPage(articleId);
        }
      });
      
      // 記錄訂閱以便稍後清理
      if(!window.realtimeSubscriptions)window.realtimeSubscriptions=[];
      window.realtimeSubscriptions.push(subscriptionId);
    }
  }catch(err){
    console.warn('無法加載公開註記:',err);
  }
}

// 當閾值設定改變時重新加載註記
function handleThresholdChange(){
  const root=$('.annotatable');
  if(root){
    const articleId=root.dataset.doc?.split('-')[1];
    if(articleId){
      loadPublicNotesForPage(articleId);
    }
  }
}

function renderBubbles(entries){
  // 清除現有的所有氣泡
  document.querySelectorAll('.annotation-bubble').forEach(b => b.remove());
  
  // 分離私人和公開註記
  const privateEntries=entries.filter(e=>e.type==='private');
  const publicEntries=entries.filter(e=>e.type==='public');
  
  // 渲染私人氣泡（不聚合，直接顯示）
  privateEntries.forEach(({note,range},idx)=>{
    const rect=[...range.getClientRects()].at(-1)||range.getBoundingClientRect();
    if(!rect.width&&!rect.height)return;
    
    const bubble=document.createElement('button');
    bubble.className='annotation-bubble annotation-bubble-private';
    bubble.type='button';
    bubble.textContent=idx+1;
    bubble.dataset.note=note.id;
    bubble.dataset.type='private';
    bubble.style.left=`${Math.min(innerWidth-32,rect.right+scrollX)}px`;
    bubble.style.top=`${rect.bottom+scrollY}px`;
    bubble.setAttribute('aria-label',`註解：${note.comment||note.text}`);
    document.body.appendChild(bubble);
    bindBubble(bubble,note);
  });
  
  // 聚合公開註記 - 按 cluster 分組
  if(publicEntries.length>0){
    const clusterMap=new Map();
    publicEntries.forEach(entry=>{
      if(!entry.clusterId)entry.clusterId=Math.floor(entry.note.start/5);
      if(!clusterMap.has(entry.clusterId))clusterMap.set(entry.clusterId,[]);
      clusterMap.get(entry.clusterId).push(entry);
    });
    
    // 為每個 cluster 創建氣泡
    clusterMap.forEach((cluster,clusterId)=>{
      if(cluster.length===0)return;
      
      // 取第一個條目的位置作為氣泡位置
      const firstEntry=cluster[0];
      const rect=[...firstEntry.range.getClientRects()].at(-1)||firstEntry.range.getBoundingClientRect();
      if(!rect.width&&!rect.height)return;
      
      // 創建聚合氣泡
      const bubble=document.createElement('button');
      bubble.className='annotation-bubble annotation-bubble-public';
      bubble.type='button';
      
      // 氣泡顯示註記數量或"聚合"標誌
      bubble.textContent=cluster.length>=2?'A':cluster[0].note.id.charAt(0).toUpperCase();
      bubble.dataset.cluster=clusterId;
      bubble.dataset.type='public-cluster';
      bubble.dataset.notesCount=cluster.length;
      bubble.dataset.notes=JSON.stringify(cluster.map(e=>e.note));
      
      bubble.style.left=`${Math.min(innerWidth-32,rect.right+scrollX+35)}px`;
      bubble.style.top=`${rect.bottom+scrollY}px`;
      bubble.setAttribute('aria-label',`${cluster.length}條討論 - 最高分：${Math.max(...cluster.map(e=>e.note.score||0))}`);
      
      document.body.appendChild(bubble);
      
      // 綁定聚合氣泡事件
      bindClusterBubble(bubble,cluster);
    });
  }
}

function bindClusterBubble(bubble,cluster){
  bubble.addEventListener('dblclick',e=>{
    e.preventDefault();
    openThreadModal(cluster);
  });
}

function bindBubble(bubble,note){
  let timer;
  bubble.addEventListener('pointerdown',e=>{e.preventDefault();timer=setTimeout(()=>showBubble(note),550);});
  ['pointerup','pointercancel','pointerleave'].forEach(type=>bubble.addEventListener(type,()=>clearTimeout(timer)));
  bubble.addEventListener('dblclick',e=>{e.preventDefault();hideBubble();openAnnotationModal(note);});
}

function openThreadModal(cluster){
  if(!authManager.isLoggedIn){
    toast('請先登入');
    return;
  }
  
  window.threadData={cluster,currentIndex:0,sortBy:'newest'};
  const modal=$('#thread-modal');
  const backdrop=$('#backdrop');
  
  renderThreadContent(cluster[0].note);
  modal.hidden=false;
  backdrop.hidden=false;
  
  // 添加排序選項到 thread-content 頂部
  const contentDiv=$('#thread-content');
  if(!contentDiv.querySelector('.thread-sort-options')){
    const sortHTML=`
      <div class="thread-sort-options" style="padding:12px;border-bottom:1px solid #ddd;background:#f9f9f9;display:flex;gap:8px;align-items:center">
        <span style="font-size:0.85rem;color:#999">排序：</span>
        <button class="thread-sort-btn" data-sort="newest" style="padding:4px 12px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:0.85rem;border-color:#963b2e;color:#963b2e">最新</button>
        <button class="thread-sort-btn" data-sort="hot" style="padding:4px 12px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:0.85rem">熱門</button>
      </div>
    `;
    contentDiv.insertAdjacentHTML('beforebegin',sortHTML);
    
    // 綁定排序按鈕事件
    const sortBtns=modal.querySelectorAll('.thread-sort-btn');
    sortBtns.forEach(btn=>{
      btn.onclick=()=>{
        const sortType=btn.dataset.sort;
        window.threadData.sortBy=sortType;
        
        // 更新按鈕樣式
        sortBtns.forEach(b=>b.style.borderColor=b.style.color='#ddd');
        btn.style.borderColor=btn.style.color='#963b2e';
        
        // 重新排序並重新渲染
        if(sortType==='hot'){
          cluster.sort((a,b)=>(b.note.score||0)-(a.note.score||0));
        }else{
          cluster.sort((a,b)=>new Date(b.note.created_at)-new Date(a.note.created_at));
        }
        
        window.threadData.currentIndex=0;
        renderThreadContent(cluster[0].note);
      };
    });
  }
  
  // 綁定事件
  $('#thread-prev').onclick=()=>{
    if(window.threadData.currentIndex>0){
      window.threadData.currentIndex--;
      renderThreadContent(cluster[window.threadData.currentIndex].note);
    }
  };
  
  $('#thread-next').onclick=()=>{
    if(window.threadData.currentIndex<cluster.length-1){
      window.threadData.currentIndex++;
      renderThreadContent(cluster[window.threadData.currentIndex].note);
    }
  };
  
  $('#close-thread').onclick=()=>closeThreadModal();
  
  $('#thread-reply-submit').onclick=async()=>{
    const text=$('#thread-reply-text').value.trim();
    if(!text){toast('請輸入回覆內容');return;}
    
    if(!api.sessionToken){
      toast('請先登入');
      return;
    }
    
    try{
      const currentNote=cluster[window.threadData.currentIndex].note;
      const response=await fetch('/api/notes/'+currentNote.id+'/replies',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.sessionToken},
        body:JSON.stringify({content:text})
      });
      
      if(!response.ok)throw new Error(await response.text());
      const result=await response.json();
      
      if(!currentNote.replies)currentNote.replies=[];
      if(result.reply){
        currentNote.replies.push(result.reply);
      }
      
      $('#thread-reply-text').value='';
      renderThreadContent(currentNote);
      toast('回覆成功');
    }catch(err){
      console.error('回覆失敗:',err);
      toast('回覆失敗');
    }
  };
  
  $('#thread-reply-cancel').onclick=()=>$('#thread-reply-text').value='';
}

function renderThreadContent(note){
  const container=$('#thread-content');
  const counter=$('#thread-counter');
  const {cluster,currentIndex}=window.threadData||{};
  
  if(!cluster)return;
  counter.textContent=`${currentIndex+1}/${cluster.length}`;
  
  // 主註記
  const mainHTML=`
    <div class="thread-note" style="padding:12px;border-bottom:1px solid #ddd">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong style="color:#333">${esc(note.public_alias||'匿名使用者')}</strong>
          <span style="color:#999;font-size:0.85rem"> · ${new Date(note.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <div style="display:flex;gap:4px;font-size:0.9rem">
          <button class="thread-vote" data-note-id="${note.id}" data-vote="up" style="background:none;border:none;cursor:pointer">👍 ${note.upvote_count||0}</button>
          <button class="thread-vote" data-note-id="${note.id}" data-vote="down" style="background:none;border:none;cursor:pointer">👎 ${note.downvote_count||0}</button>
          <button class="thread-favorite" data-note-id="${note.id}" style="background:none;border:none;cursor:pointer">⭐ ${note.favorite_count||0}</button>
        </div>
      </div>
      <p style="color:#333;line-height:1.5;margin:8px 0">${esc(note.content)}</p>
    </div>
  `;
  
  // 回覆列表
  const repliesHTML=(note.replies||[]).map((r,i)=>`
    <div style="padding:12px;padding-left:32px;border-bottom:1px solid #eee;background:#fafafa">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong style="color:#555">${esc(r.public_alias||'匿名使用者')}</strong>
          <span style="color:#999;font-size:0.85rem"> · ${new Date(r.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <div style="display:flex;gap:4px;font-size:0.9rem">
          <button class="thread-vote" data-note-id="${r.id}" data-vote="up" style="background:none;border:none;cursor:pointer">👍 ${r.upvote_count||0}</button>
          <button class="thread-vote" data-note-id="${r.id}" data-vote="down" style="background:none;border:none;cursor:pointer">👎 ${r.downvote_count||0}</button>
        </div>
      </div>
      <p style="color:#666;line-height:1.5;margin:8px 0">${esc(r.content)}</p>
    </div>
  `).join('');
  
  container.innerHTML=mainHTML+repliesHTML;
  
  // 綁定投票事件
  container.querySelectorAll('.thread-vote').forEach(btn=>{
    btn.onclick=async(e)=>{
      e.preventDefault();
      if(!api.sessionToken){
        toast('請先登入');
        return;
      }
      
      const noteId=btn.dataset.noteId;
      const voteType=btn.dataset.vote;
      
      try{
        const response=await fetch('/api/notes/'+noteId+'/vote',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.sessionToken},
          body:JSON.stringify({voteType:voteType})
        });
        
        if(!response.ok)throw new Error(await response.text());
        const result=await response.json();
        
        // 更新 note 對象的投票計數
        Object.assign(note, result.note);
        renderThreadContent(note);
        
        // 訂閱此註記的 Realtime 投票更新，讓其他用戶看到新投票
        if(typeof realtimeClient !== 'undefined'){
          const subId = `votes:${noteId}`;
          realtimeClient.subscribeToVotes(noteId, (update)=>{
            if(update.data){
              note.upvote_count = update.data.upvote_count;
              note.downvote_count = update.data.downvote_count;
              note.favorite_count = update.data.favorite_count;
              renderThreadContent(note);
            }
          });
        }
        
        toast(voteType==='up'?'已按讚':'已倒讚');
      }catch(err){
        console.error('投票失敗:',err);
        toast('投票失敗');
      }
    };
  });
  
  // 綁定收藏事件
  container.querySelectorAll('.thread-favorite').forEach(btn=>{
    btn.onclick=async(e)=>{
      e.preventDefault();
      if(!api.sessionToken){
        toast('請先登入');
        return;
      }
      
      const noteId=btn.dataset.noteId;
      
      try{
        const response=await fetch('/api/notes/'+noteId+'/favorite',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.sessionToken}
        });
        
        if(!response.ok)throw new Error(await response.text());
        const result=await response.json();
        
        // 更新 note 對象的收藏計數
        Object.assign(note, result.note);
        renderThreadContent(note);
        
        // 訂閱此註記的 Realtime 收藏更新，讓其他用戶看到新收藏
        if(typeof realtimeClient !== 'undefined'){
          const subId = `favorites:${noteId}`;
          realtimeClient.subscribeToFavorites(noteId, (update)=>{
            if(update.data){
              note.favorite_count = update.data.favorite_count;
              renderThreadContent(note);
            }
          });
        }
        
        toast('已收藏');
      }catch(err){
        console.error('收藏失敗:',err);
        toast('收藏失敗');
      }
    };
  });
}

function closeThreadModal(){
  $('#thread-modal').hidden=true;
  $('#backdrop').hidden=true;
  window.threadData=null;
}

function showBubble(note){const tip=$('#bubble-tooltip');tip.innerHTML=`<strong>${esc(notePageName(note.doc))}</strong>${esc(note.comment||'尚未填寫註解')}`;tip.hidden=false;clearTimeout(showBubble.timer);showBubble.timer=setTimeout(hideBubble,5000);navigator.vibrate?.(25);}
function hideBubble(){$('#bubble-tooltip').hidden=true;}
function rangeFromOffsets(root,start,end){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,pos=0,sNode,eNode,sOffset,eOffset;
  while((node=walker.nextNode())){const next=pos+node.data.length;if(sNode==null&&start>=pos&&start<=next){sNode=node;sOffset=start-pos;}if(end>=pos&&end<=next){eNode=node;eOffset=end-pos;break;}pos=next;}
  if(!sNode||!eNode)return null;const range=document.createRange();range.setStart(sNode,sOffset);range.setEnd(eNode,eOffset);return range;
}

function openNotes(){
  const panel = $('#notes-panel');
  
  // 默認顯示占卜紀錄分頁
  document.querySelectorAll('.storage-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('[data-tab="divinations"]').classList.add('active');
  
  // 隱藏所有內容區域
  ['divinations-content','highlights-content','favorites-content','notifications-content','settings-content'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.hidden=(id!=='divinations-content');
  });
  
  // 加載占卜紀錄
  renderDivinations();
  
  // 顯示面板
  panel.hidden=false;
  $('#backdrop').hidden=false;
}
function renderNotes(){
  const box=$('#notes-list');
  if(!state.notes.length){
    box.innerHTML='<p class="empty">尚未加入螢光筆標記。</p>';
    return;
  }
  
  box.innerHTML=state.notes.slice().reverse().map(n=>`
    <article class="note-item" data-note-id="${n.id}">
      <div class="note-meta">
        <span>${notePageName(n.doc)}${n.visibility==='public'?' · 公開':'·私人'}</span>
        <span class="note-actions">
          <button class="edit-note" data-edit="${n.id}" type="button">編輯</button>
          <button class="delete-note" data-delete="${n.id}" type="button">刪除</button>
        </span>
      </div>
      <p class="note-text">「${esc(n.text)}」</p>
      <p class="note-comment">${esc(n.comment||'尚未填寫註解')}</p>
    </article>
  `).join('');
  
  box.onclick=e=>{
    const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');
    
    if(edit){const note=state.notes.find(n=>n.id===edit.dataset.edit);if(note)openAnnotationModal(note);}
    if(del){state.notes=state.notes.filter(n=>n.id!==del.dataset.delete);saveNotes();renderNotes();applyHighlights();}
  };
}

async function handleVote(noteId,voteType){
  if(typeof api==='undefined'||!authManager.isLoggedIn){
    toast('請先登入');
    return;
  }
  try{
    await api.voteNote(noteId,voteType);
    toast(voteType==='up'?'已按讚':'已倒讚');
  }catch(err){
    console.error('投票失敗:',err);
    toast('投票失敗');
  }
}

async function handleFavorite(noteId){
  if(typeof api==='undefined'||!authManager.isLoggedIn){
    toast('請先登入');
    return;
  }
  try{
    await api.toggleFavorite(noteId);
    toast('已收藏');
  }catch(err){
    console.error('收藏失敗:',err);
    toast('收藏失敗');
  }
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
    
    // 安全檢查 d.result 結構
    if(!d.result||!d.result.originalHexagram||!d.result.resultHexagram){
      return `<article class="note-item divination-item">
        <div class="note-meta">
          <span class="divination-date">${new Date(d.timestamp).toLocaleString('zh-Hant')}</span>
          <span class="note-actions">
            <button class="delete-note" data-delete-divination="${d.timestamp}" type="button">刪除</button>
          </span>
        </div>
        <p class="note-text">「${esc(d.question)}」</p>
        <div class="divination-result"><p class="empty">數據格式已過期，請重新占卜</p></div>
      </article>`;
    }
    
    const original=state.hexagrams.find(h=>h.id===d.result.originalHexagram.id)||{name:'未知',symbol:'？',id:0,lines:[]};
    const result=state.hexagrams.find(h=>h.id===d.result.resultHexagram.id)||{name:'未知',symbol:'？',id:0};
    const n=d.result.changingLines?.length||0;

    // 之卦行
    const gongzhi=n>0
      ?`<span class="div-hexagram-label">${esc(original.symbol)} ${esc(original.name)} 之 ${esc(result.name)} ${esc(result.symbol)}</span>`
      :`<span class="div-hexagram-label">${esc(original.symbol)} ${esc(original.name)}（無變爻）</span>`;

    // 變爻行
    let changingInfo='';
    if(n>0&&d.result.changingLines){
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

// ===== 認證 UI 管理 =====
function updateAuthUI(){
  const authContainer=$('#auth-container');
  if(!authContainer)return;
  
  if(typeof authManager !== 'undefined' && authManager.isLoggedIn){
    // 已登入 - 顯示用戶菜單
    $('#login-button').style.display='none';
    $('#user-menu').style.display='flex';
    
    const user=authManager.getCurrentUser();
    if(user){
      const nickname=user.displayName||user.email||'使用者';
      $('#user-nickname').textContent=nickname;
      
      // 加載統計數據
      loadUserStats();
    }
  }else{
    // 未登入 - 顯示登入按鈕
    $('#login-button').style.display='block';
    $('#user-menu').style.display='none';
    closeUserMenu();
  }
}

function loadUserStats(){
  // 加載用戶統計數據
  try{
    // 本地統計
    const notesCount=state.notes.length;
    
    $('#stat-notes-count').textContent=notesCount;
    
    // 從 API 加載遠端統計
    if(typeof api !== 'undefined'){
      api.getStats?.().then(stats=>{
        if(stats){
          $('#stat-upvotes').textContent=stats.total_upvotes||0;
          $('#stat-favorites').textContent=stats.total_favorites||0;
        }
      }).catch(()=>{
        // 如果 API 調用失敗，保持默認值
        $('#stat-upvotes').textContent='0';
        $('#stat-favorites').textContent='0';
      });
    }
  }catch(err){
    console.warn('加載用戶統計失敗:',err);
  }
}

function closeUserMenu(){
  const dropdown=$('#user-menu-dropdown');
  if(dropdown)dropdown.hidden=true;
}

// 監聽認證狀態變化
if(typeof authManager !== 'undefined'){
  authManager.onAuthChange(()=>{
    updateAuthUI();
  });
}

let pendingTermsSessionToken = null;
let pendingTermsUser = null;

// ===== 登入流程 =====
async function showLoginModal(){
  const modal=$('#login-modal');
  const accountList=$('#account-list');
  
  if(!modal||!accountList)return;
  
  try{
    // 啟動 OAuth 流程
    const oauthStart = await api.startOAuth?.('/');
    if (!oauthStart) {
      throw new Error('無法啟動 OAuth 流程');
    }

    // 保存 state 和 nonce 用於回調驗證
    sessionStorage.setItem('oauth_state', oauthStart.state);
    sessionStorage.setItem('oauth_nonce', oauthStart.nonce);
    sessionStorage.setItem('oauth_return_to', '/');
    
    console.log('🔵 OAuth Mode:', oauthStart.mode);
    
    if (oauthStart.mode === 'google-oauth') {
      // 真實 Google OAuth - 重定向到 Google 登入
      console.log('🔵 使用真實 Google OAuth，重定向到 Google...');
      window.location.href = oauthStart.authUrl;
    } else {
      // Mock OAuth - 顯示測試帳號選擇器
      console.log('🟡 使用 Mock OAuth，顯示帳號選擇器...');
      const response = await api.getMockAccounts?.();
      if (response && response.accounts) {
        accountList.innerHTML = response.accounts.map(account => `
          <button class="login-account-button" data-account="${account.id}" type="button" style="padding:12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s">
            <strong>${account.name}</strong><br>
            <span style="font-size:0.85rem;color:#666">${account.email}</span>
            ${account.isDisabled ? '<span style="display:block;color:#f00;font-size:0.8rem;margin-top:4px">（已禁用）</span>' : ''}
          </button>
        `).join('');
        
        // 綁定帳號選擇事件
        accountList.onclick = async e => {
          const btn = e.target.closest('[data-account]');
          if (!btn) return;
          const accountId = btn.dataset.account;
          
          // 完成 Mock OAuth 登入
          await completeMockOAuthLogin(accountId, oauthStart.state, oauthStart.nonce);
        };
      }
      modal.hidden = false;
      $('#backdrop').hidden = false;
    }
  } catch(err){
    console.error('登入啟動失敗:', err);
    accountList.innerHTML = `<p style="color:#f00">登入失敗: ${err.message}</p>`;
    modal.hidden = false;
    $('#backdrop').hidden = false;
  }
}

// ===== Mock OAuth 完成流程 =====
async function completeMockOAuthLogin(accountId, state, nonce) {
  try {
    // 直接顯示服務條款接受界面
    showTermsModal(accountId, state, nonce);
  } catch (err) {
    console.error('Mock OAuth 登入失敗:', err);
    alert(`登入失敗: ${err.message}`);
  }
}

// ===== Google OAuth 回調處理（由後端重定向回來）=====
async function handleGoogleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    console.log('非 Google OAuth 回調');
    return false;
  }

  try {
    console.log('🔵 處理 Google OAuth 回調...');
    
    // 檢查 state 是否匹配
    const savedState = sessionStorage.getItem('oauth_state');
    if (state !== savedState) {
      throw new Error('State 驗證失敗（防 CSRF 攻擊）');
    }

    // 完成 Google OAuth 登入
    const result = await api.post('/auth/google/callback', {
      code,
      state
    });

    if (result.requiresTermsAcceptance && result.sessionToken) {
      // Google 首次登入：先接受條款，再完成登入
      pendingTermsSessionToken = result.sessionToken;
      pendingTermsUser = result.user || null;
      showTermsModal(null, null, null);
      return true;
    }

    if (result.success) {
      // 保存會話 token
      api.saveSessionToken(result.sessionToken);

      // 保存用戶信息
      if (typeof authManager !== 'undefined') {
        authManager.user = result.user;
        authManager.isLoggedIn = true;
        authManager.saveToStorage();
        authManager.notifyListeners();
      }

      // 清理臨時存儲
      sessionStorage.removeItem('oauth_state');
      sessionStorage.removeItem('oauth_nonce');
      sessionStorage.removeItem('oauth_return_to');

      // 更新 UI
      updateAuthUI();

      // 重定向到應用（清除 URL 參數）
      window.location.href = result.returnTo || '/';
    }
  } catch (err) {
    console.error('Google OAuth 回調失敗:', err);
    alert(`登入失敗: ${err.message}`);
    // 重新導向到登入頁面
    window.location.href = '/';
  }
}

// 頁面加載時檢查 Google OAuth 回調
if (window.location.search.includes('code=')) {
  handleGoogleOAuthCallback();
}

// ===== 服務條款接受流程 =====
async function showTermsModal(accountId, state, nonce){
  const modal=$('#terms-modal');
  const checkbox=$('#terms-agree-checkbox');
  const acceptBtn=$('#accept-terms');
  const cancelBtn=$('#cancel-terms');
  const closeBtn=$('#close-terms');
  
  if(!modal)return;
  
  // 重置複選框
  checkbox.checked=false;
  acceptBtn.disabled=true;
  
  // 複選框變更事件
  checkbox.onchange=()=>{
    acceptBtn.disabled=!checkbox.checked;
  };
  
  // 接受按鈕
  acceptBtn.onclick=async ()=>{
    try{
      acceptBtn.disabled=true;
      acceptBtn.textContent='處理中...';

      let result = null;

      if (pendingTermsSessionToken) {
        // Google OAuth：先使用暫時 session 接受條款，再視為登入完成
        api.saveSessionToken(pendingTermsSessionToken);
        await api.acceptTerms('1.0');
        result = {
          success: true,
          sessionToken: pendingTermsSessionToken,
          user: pendingTermsUser
        };
      } else {
        // Mock OAuth：原流程
        result = await api.post('/auth/accept-terms-then-login', {
          state,
          nonce,
          selectedAccount: accountId,
          docVersion: '1.0',
          agreedToAll: true
        });
      }
      
      if (result.success) {
        // 保存會話 token
        api.saveSessionToken(result.sessionToken);
        
        // 保存用戶信息
        if(typeof authManager !== 'undefined'){
          authManager.user=result.user;
          authManager.isLoggedIn=true;
          authManager.saveToStorage();
          authManager.notifyListeners();
        }
        
        // 清理臨時存儲
        sessionStorage.removeItem('oauth_state');
        sessionStorage.removeItem('oauth_nonce');
        sessionStorage.removeItem('oauth_return_to');

        // 清理 Google 條款暫存狀態
        pendingTermsSessionToken = null;
        pendingTermsUser = null;

        // 清除 URL query（code/state）
        if (window.location.search.includes('code=')) {
          window.history.replaceState({}, document.title, '/');
        }
        
        // 登入成功
        modal.hidden=true;
        $('#login-modal').hidden=true;
        $('#backdrop').hidden=true;
        updateAuthUI();
      } else {
        throw new Error(result.message || '登入失敗');
      }
    }catch(err){
      console.error('接受條款失敗:', err);
      alert(`操作失敗: ${err.message}`);
      acceptBtn.disabled=false;
      acceptBtn.textContent='接受條款並登入';
    }
  };
  
  // 取消按鈕
  cancelBtn.onclick=()=>{
    pendingTermsSessionToken = null;
    pendingTermsUser = null;
    modal.hidden=true;
    $('#backdrop').hidden=true;
    // 顯示登入模態框
    showLoginModal();
  };
  
  // 關閉按鈕
  closeBtn.onclick=()=>{
    pendingTermsSessionToken = null;
    pendingTermsUser = null;
    modal.hidden=true;
    $('#backdrop').hidden=true;
  };
  
  modal.hidden=false;
  $('#backdrop').hidden=false;
}

// ===== 設定頁面 =====
async function initializeSettings(){
  try{
    // 獲取用戶設置
    const settingsData=await api.getUserSettings();
    if(!settingsData)return;
    
    const user=settingsData.user;
    const settings=settingsData.settings;
    
    // 顯示帳號信息
    const accountEl=$('#settings-account');
    if(accountEl){
      accountEl.textContent=user.email||'未知';
    }
    
    // 設置儲存設定複選框
    const saveNotesEl=$('#settings-save-notes');
    if(saveNotesEl){
      saveNotesEl.checked=settings.saveNotesToCloud;
      saveNotesEl.onchange=async e=>{
        await updateSetting('saveNotesToCloud',e.target.checked);
      };
    }
    
    const saveDivinationsEl=$('#settings-save-divinations');
    if(saveDivinationsEl){
      saveDivinationsEl.checked=settings.saveDivinationToCloud;
      saveDivinationsEl.onchange=async e=>{
        await updateSetting('saveDivinationToCloud',e.target.checked);
      };
    }
    
    const allowPublicNotesEl=$('#settings-public-notes');
    if(allowPublicNotesEl){
      allowPublicNotesEl.checked=settings.allowPublicNotes;
      allowPublicNotesEl.onchange=async e=>{
        await updateSetting('allowPublicNotes',e.target.checked);
      };
    }
    
    // 設置閾值滑桿
    const thresholdEl=$('#settings-threshold');
    const thresholdValueEl=$('#settings-threshold-value');
    if(thresholdEl){
      thresholdEl.value=settings.noteVisibilityThresholdPercent||50;
      thresholdEl.oninput=e=>{
        thresholdValueEl.textContent=e.target.value+'%';
      };
      thresholdEl.onchange=async e=>{
        await updateSetting('noteVisibilityThresholdPercent',parseInt(e.target.value));
        // 立即重新加載當前頁面的註記
        handleThresholdChange();
      };
    }
    
    // 通知設定
    const notifyReplyEl=$('#settings-notify-replies');
    if(notifyReplyEl){
      notifyReplyEl.checked=settings.notifyOnReply;
      notifyReplyEl.onchange=async e=>{
        await updateSetting('notifyOnReply',e.target.checked);
      };
    }
    
    // 清除本機資料按鈕
    const clearLocalBtn=$('#settings-clear-local');
    if(clearLocalBtn){
      clearLocalBtn.onclick=async()=>{
        if(confirm('確定要清除本機資料？此操作不可逆。\n\n將清除：\n- 本機註記\n- 本機占卜紀錄\n- 本機偏好設定\n- 本機快取')){
          try{
            clearLocalStorage();
            alert('本機資料已清除，頁面將重新整理。');
            setTimeout(()=>location.reload(),500);
          }catch(err){
            alert('清除失敗：'+err.message);
          }
        }
      };
    }
    
    // 刪除雲端資料按鈕
    const deleteDataBtn=$('#settings-delete-data');
    if(deleteDataBtn){
      deleteDataBtn.onclick=()=>showDeleteDataModal();
    }
    
    // 刪除帳號按鈕
    const deleteAccountBtn=$('#settings-delete-account');
    if(deleteAccountBtn){
      deleteAccountBtn.onclick=()=>showDeleteAccountModal();
    }
  }catch(err){
    console.error('初始化設定頁面失敗:',err);
  }
}

// 清除所有本機儲存的資料
function clearLocalStorage(){
  const keysToRemove=[
    'user',
    'iching-highlights-v1',  // 本機註記
    'iching-divinations-v1',  // 本機占卜紀錄
    'userSettings',           // 本機設定
    'thread-state',           // 討論串狀態快取
    'scroll-position',        // 滾動位置快取
    'article-cache',          // 文章快取
  ];
  
  keysToRemove.forEach(key=>{
    try{
      localStorage.removeItem(key);
      console.log(`✓ 已清除: ${key}`);
    }catch(err){
      console.warn(`清除 ${key} 失敗:`,err);
    }
  });
  
  // 清除 sessionStorage
  sessionStorage.clear();
  
  // 重置應用狀態
  state.notes=[];
  state.divinations=[];
  window.publicNotesByArticle={};
  window.threadData={};
  
  console.log('✓ 所有本機資料已清除');
}

async function updateSetting(key,value){
  try{
    const settings={};
    settings[key]=value;
    await api.updateUserSettings(settings);
    console.log('設定已更新:',key,value);
  }catch(err){
    console.error('更新設定失敗:',err);
    alert('更新失敗：'+err.message);
  }
}

function showDeleteDataModal(){
  const modal=document.createElement('div');
  modal.innerHTML=`
    <div class="modal-overlay" id="delete-data-modal-overlay">
      <div class="modal-content" style="max-width:400px">
        <h3 style="margin-top:0">刪除雲端資料</h3>
        <p style="color:#666;font-size:0.9rem">此操作將刪除以下內容：</p>
        <ul style="color:#666;font-size:0.9rem;margin:12px 0">
          <li>✓ 雲端占卜紀錄</li>
          <li>✓ 公開註記與討論</li>
          <li>✓ 收藏列表</li>
          <li>✗ 本機資料不會被刪除</li>
        </ul>
        <p style="color:#f00;font-size:0.85rem;margin:12px 0"><strong>此操作不可逆。</strong></p>
        <label style="display:flex;flex-direction:column;gap:4px;margin:16px 0;font-size:0.9rem">
          <span style="color:#333">請輸入您的 Email 地址以確認：</span>
          <input type="email" id="delete-data-email" placeholder="your@email.com" style="padding:8px;border:1px solid #ddd;border-radius:4px">
        </label>
        <div style="display:flex;gap:12px;margin-top:20px">
          <button class="secondary-button" style="flex:1" onclick="document.getElementById('delete-data-modal-overlay').remove()">取消</button>
          <button id="confirm-delete-data-btn" class="primary-button" style="flex:1;background:#d9534f;border-color:#d9534f">確認刪除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const confirmBtn=modal.querySelector('#confirm-delete-data-btn');
  const emailInput=modal.querySelector('#delete-data-email');
  const overlay=modal.querySelector('.modal-overlay');
  
  confirmBtn.onclick=async()=>{
    const email=emailInput.value.trim();
    if(!email){
      alert('請輸入 Email');
      return;
    }
    
    try{
      await api.deleteCloudData(email);
      alert('雲端資料已開始刪除。');
      overlay.remove();
    }catch(err){
      alert('刪除失敗：'+err.message);
    }
  };
  
  overlay.onclick=e=>{
    if(e.target===overlay)overlay.remove();
  };
}

// ===== 收藏列表 =====
async function loadFavoritesList(){
  try{
    const response=await api.getUserFavorites();
    const favoritesList=$('#favorites-list');
    
    if(!response||!response.notes||response.notes.length===0){
      favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#888">暫無收藏</div>';
      return;
    }
    
    const html=response.notes.map(note=>`
      <div class="favorite-card" style="padding:12px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;cursor:pointer;transition:all 0.2s;background:#fff" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='none'" onclick="navigateToFavorite('${note.id}','${note.article_id}')">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <strong style="color:#333">${esc(note.public_alias||'匿名使用者')}</strong>
            <span style="color:#999;font-size:0.85rem"> · ${new Date(note.created_at).toLocaleDateString('zh-TW')}</span>
          </div>
          <div style="text-align:right;font-size:0.85rem;color:#888">
            <div>💬 ${note.reply_count||0} 個回覆</div>
            <div>👍 ${note.upvote_count||0}</div>
          </div>
        </div>
        <p style="color:#333;line-height:1.5;margin:8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(note.content)}</p>
        <div style="font-size:0.85rem;color:#999">
          <span>分數: ${note.score||0}</span>
        </div>
      </div>
    `).join('');
    
    favoritesList.innerHTML=html;
  }catch(err){
    console.error('加載收藏列表失敗:',err);
    const favoritesList=$('#favorites-list');
    favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#f00">加載失敗，請重試</div>';
  }
}

function navigateToFavorite(noteId,articleId){
  // 導航到原文章
  const guaId=articleId.split('-')[1];
  window.location.hash=`gua/${guaId}`;
  
  // 等待頁面加載後打開討論串
  setTimeout(()=>{
    const notes=window.publicNotesByArticle?.[guaId];
    if(notes){
      const note=notes.find(n=>n.id===noteId);
      if(note){
        const cluster=[{note}];
        openThreadModal(cluster);
      }
    }
  },500);
}

// ===== 通知列表 =====
async function loadNotificationsList(){
  try{
    const response=await api.getNotifications();
    const notificationsList=$('#notifications-list');
    
    if(!response||!response.notifications||response.notifications.length===0){
      notificationsList.innerHTML='<div style="padding:12px;text-align:center;color:#888">暫無通知</div>';
      return;
    }
    
    const html=response.notifications.map((notif,i)=>`
      <div class="notification-item" style="padding:12px;border-bottom:1px solid #eee;cursor:pointer;transition:all 0.2s;background:${notif.read_at?'#fff':'#f9f9f9'}" onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='${notif.read_at?'#fff':'#f9f9f9'}'" onclick="navigateToNotification('${notif.id}','${notif.reference_id}')">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
          <div>
            <strong style="color:#333">${
              notif.type==='reply'?'💬 有人回覆了你的註記':
              notif.type==='vote'?'👍 有人讚了你的註記':
              notif.type==='favorite'?'⭐ 有人收藏了你的註記':'新通知'
            }</strong>
          </div>
          <span style="font-size:0.85rem;color:#999">${new Date(notif.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <p style="color:#666;font-size:0.9rem;margin:4px 0;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${esc(notif.message||'')}</p>
        ${!notif.read_at?'<div style="font-size:0.8rem;color:#963b2e">● 未讀</div>':''}
      </div>
    `).join('');
    
    notificationsList.innerHTML=html;
  }catch(err){
    console.error('加載通知列表失敗:',err);
    const notificationsList=$('#notifications-list');
    notificationsList.innerHTML='<div style="padding:12px;text-align:center;color:#f00">加載失敗，請重試</div>';
  }
}

function navigateToNotification(notificationId,referenceId){
  // 標記為已讀
  api.markNotificationAsRead(notificationId).catch(()=>{});
  
  // 導航到相關注記（需要先查詢該注記的信息）
  api.getNote(referenceId).then(note=>{
    // 檢查內容是否已被刪除
    if(!note||note.deleted_at){
      alert('抱歉，該內容已被刪除。');
      return;
    }
    
    const guaId=note.article_id.split('-')[1];
    window.location.hash=`gua/${guaId}`;
    
    setTimeout(()=>{
      const notes=window.publicNotesByArticle?.[guaId];
      if(notes){
        const targetNote=notes.find(n=>n.id===referenceId);
        if(targetNote){
          const cluster=[{note:targetNote}];
          openThreadModal(cluster);
        }
      }
    },500);
  }).catch(err=>{
    console.error('獲取通知相關注記失敗:',err);
    if(err.status===404||err.message.includes('404')){
      alert('抱歉，該內容已被刪除。');
    }else{
      alert('無法載入該內容，請稍後重試。');
    }
  });
}

function showDeleteAccountModal(){
  const modal=document.createElement('div');
  modal.innerHTML=`
    <div class="modal-overlay" id="delete-account-modal-overlay">
      <div class="modal-content" style="max-width:400px">
        <h3 style="margin-top:0;color:#d9534f">⚠️ 刪除帳號</h3>
        <p style="color:#f00;font-size:0.9rem"><strong>此操作無法撤銷</strong></p>
        <p style="color:#666;font-size:0.9rem;margin:12px 0">您確定要永久刪除帳號嗎？刪除後：</p>
        <ul style="color:#666;font-size:0.9rem;margin:12px 0">
          <li>✓ 帳號將被停用</li>
          <li>✓ 所有雲端資料將被刪除</li>
          <li>✓ 您將被登出</li>
          <li>✓ 無法恢復</li>
        </ul>
        <label style="display:flex;flex-direction:column;gap:4px;margin:16px 0;font-size:0.9rem">
          <span style="color:#333">請輸入您的 Email 地址以確認刪除：</span>
          <input type="email" id="delete-account-email" placeholder="your@email.com" style="padding:8px;border:1px solid #ddd;border-radius:4px">
        </label>
        <div style="display:flex;gap:12px;margin-top:20px">
          <button class="secondary-button" style="flex:1" onclick="document.getElementById('delete-account-modal-overlay').remove()">取消</button>
          <button id="confirm-delete-account-btn" class="primary-button" style="flex:1;background:#d9534f;border-color:#d9534f">確認刪除帳號</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const confirmBtn=modal.querySelector('#confirm-delete-account-btn');
  const emailInput=modal.querySelector('#delete-account-email');
  const overlay=modal.querySelector('.modal-overlay');
  
  confirmBtn.onclick=async()=>{
    const email=emailInput.value.trim();
    if(!email){
      alert('請輸入 Email');
      return;
    }
    
    try{
      const result=await api.deleteAccount(email);
      alert('帳號已刪除，即將返回首頁...');
      overlay.remove();
      // 清除登入信息
      api.clearSessionToken();
      localStorage.removeItem('user');
      // 導回首頁
      setTimeout(()=>window.location.href='/',1500);
    }catch(err){
      alert('刪除失敗：'+err.message);
    }
  };
  
  overlay.onclick=e=>{
    if(e.target===overlay)overlay.remove();
  };
}
