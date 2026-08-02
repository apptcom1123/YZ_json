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

function currentUserId(){ return authManager?.getCurrentUser?.()?.id || null; }
const DEFAULT_USER_SETTINGS={
  saveNotesToCloud:false,
  saveDivinationToCloud:false,
  allowPublicNotes:false,
  noteVisibilityThresholdPercent:50,
  notifyOnReply:true
};

function applySettingsToControls(settings=DEFAULT_USER_SETTINGS){
  if($('#settings-save-notes'))$('#settings-save-notes').checked=Boolean(settings.saveNotesToCloud);
  if($('#settings-save-divinations'))$('#settings-save-divinations').checked=Boolean(settings.saveDivinationToCloud);
  if($('#settings-public-notes'))$('#settings-public-notes').checked=Boolean(settings.allowPublicNotes);
  if($('#settings-notify-replies'))$('#settings-notify-replies').checked=settings.notifyOnReply!==false;
  const threshold=$('#settings-threshold');
  const thresholdValue=Number(settings.noteVisibilityThresholdPercent ?? 50);
  if(threshold){
    threshold.value=thresholdValue;
    threshold.dataset.savedValue=String(thresholdValue);
  }
  if($('#settings-threshold-value'))$('#settings-threshold-value').textContent=thresholdValue+'%';
}

function setCloudSettingsDisabled(disabled){
  ['#settings-save-notes','#settings-save-divinations','#settings-public-notes','#settings-threshold','#settings-notify-replies']
    .forEach(selector=>{const control=$(selector);if(control)control.disabled=disabled;});
}

function canAccessLocalNote(note){
  const userId=currentUserId();
  return note.ownerId ? note.ownerId===userId : true;
}
function canAccessLocalDivination(record){
  return record.ownerId ? record.ownerId===currentUserId() : !record.serverId;
}
function localNotesForDocument(doc){
  return state.notes.filter(note=>note.doc===doc&&canAccessLocalNote(note));
}

// 初始化認證系統（在其他 UI 初始化前進行）
if(typeof authManager !== 'undefined'){
  authManager.onAuthChange(authState=>{
    updateAuthUI?.();
    scheduleAccountStateRefresh(authState);
  });
  authManager.init().then(()=>{
    // 再檢查一次，確保後載入的帳戶資料同步函式也會執行。
    setTimeout(()=>{
      updateAuthUI?.();
      scheduleAccountStateRefresh({
        isLoggedIn:authManager.isLoggedIn,
        user:authManager.getCurrentUser?.()
      });
    },100);
  }).catch(err=>{
    console.warn('認證初始化失敗:', err);
    // Keep the real Google sign-in action reachable if the session check fails.
    updateAuthUI?.();
  });
}

let accountRefreshVersion=0;

function scheduleAccountStateRefresh(authState){
  const version=++accountRefreshVersion;
  setTimeout(()=>refreshAccountState(authState,version).catch(error=>{
    console.warn('帳戶資料刷新失敗:',error);
  }),0);
}

async function refreshAccountState({isLoggedIn,user}={},version=accountRefreshVersion){
  const userId=isLoggedIn ? user?.id : null;
  if(!userId){
    renderNotes();
    renderDivinations();
    applyHighlights();
    const favoritesList=$('#favorites-list');
    const notificationsList=$('#notifications-list');
    if(favoritesList)favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#888">尚未登入</div>';
    if(notificationsList)notificationsList.innerHTML='<div style="padding:12px;text-align:center;color:#888">尚未登入</div>';
    return;
  }

  const tasks=[initializeSettings(),loadFavoritesList(),loadNotificationsList()];
  if(typeof syncCloudNotes==='function')tasks.push(syncCloudNotes());
  if(typeof syncCloudDivinations==='function')tasks.push(syncCloudDivinations());
  await Promise.allSettled(tasks);

  if(version!==accountRefreshVersion||!authManager.isLoggedIn||currentUserId()!==userId)return;
  updateAuthUI();
  renderNotes();
  renderDivinations();
  applyHighlights();
  const root=$('.annotatable');
  if(root?.dataset.doc)await loadPublicNotesForPage(root.dataset.doc);
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
  bindDangerZoneButtons();
  
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
      if(tabName==='settings')bindDangerZoneButtons();
    };
  });
  
  // 用戶菜單綁定
  if($('#login-button')){
    $('#login-button').onclick=async ()=>{
      if(typeof authManager !== 'undefined'){
        try{
          if(authManager.isLoggedIn&&authManager.getCurrentUser?.()){
            updateAuthUI();
            return;
          }
          await beginTermsGate();
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
            const result=await api.updateProfile({displayName:newNickname});
            user.displayName=result.user.displayName;
            authManager.notifyListeners();

            // 更新 UI
            $('#nickname-edit-form').style.display='none';
            toast('暱稱已更新');
            
            // 如果有 API 可用，也發送到後端
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
  if(note&&!canAccessLocalNote(note)){
    toast('身分驗證失敗：非使用者本人');
    return;
  }
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
  if(visibility==='public'&&!authManager.isLoggedIn){
    toast('公開註解需要先完成 Google 登入');
    return;
  }
  
  if(state.editingId){
    const note=state.notes.find(n=>n.id===state.editingId);
    if(note){
      if(!canAccessLocalNote(note)){
        toast('身分驗證失敗：非使用者本人');
        return;
      }
      // 公開內容或既有雲端內容必須先通過後端本人驗證，成功後才改本地狀態。
      if((visibility==='public'||note.serverId)&&typeof api!=='undefined'&&authManager.isLoggedIn){
        try{
          if(note.serverId){
            await api.updateNote(note.serverId,{content:comment,visibility});
          }else{
            const result=await api.createNote({
              articleType:note.doc?.startsWith('gua-')?'iching':'md',
              articleId:note.doc,
              paragraphAnchor:String(note.start||0),
              anchorOffsetStart:note.start||0,
              anchorOffsetEnd:note.end||0,
              content:comment,
              visibility,
              localUuid:note.id
            });
            note.serverId=result.note?.id;
          }
        }catch(err){
          console.warn('無法同步註記到伺服器:',err);
          toast(err.message||'公開註解儲存失敗');
          return;
        }
      }
      note.comment=comment;
      note.visibility=visibility;
    }
  }
  else if(state.pending){
    const newNote={...state.pending,comment,visibility,id:crypto.randomUUID?.()||String(Date.now()),ownerId:currentUserId()||null};
    // 公開註記先完成雲端建立，避免失敗後留下「假公開」本地資料。
    if(visibility==='public'&&typeof api!=='undefined'&&authManager.isLoggedIn){
      try{
        const result=await api.createNote({
          articleType:state.page==='hexagrams'?'iching':'md',
          articleId:state.pending.doc,
          paragraphAnchor:state.pending.start?.toString()||'0',
          anchorOffsetStart:state.pending.start||0,
          anchorOffsetEnd:state.pending.end||0,
          content:comment,
          visibility:'public',
          localUuid:newNote.id
        });
        newNote.serverId=result.note?.id;
      }catch(err){
        console.warn('無法保存公開註記到伺服器:',err);
        toast(err.message||'公開註解儲存失敗');
        return;
      }
    }
    state.notes.push(newNote);
  }
  saveNotes();getSelection()?.removeAllRanges();state.pending=null;state.editingId=null;$('#annotation-modal').hidden=true;$('#highlight-action').hidden=true;
  applyHighlights();if(!$('#notes-panel').hidden)renderNotes();toast(visibility==='public'?'公開註解已儲存':'註解已保存在此裝置');navigator.vibrate?.(35);
}

function applyHighlights(){
  document.querySelectorAll('.annotation-bubble').forEach(x=>x.remove());
  const root=$('.annotatable');if(!root)return;
  
  // 加載私人註記
  const privateEntries=localNotesForDocument(root.dataset.doc).filter(n=>n.visibility!=='public'||!n.serverId).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end),type:'private',clusterId:Math.floor(n.start/5)})).filter(x=>x.range);
  
  // 先渲染私人氣泡
  requestAnimationFrame(()=>renderBubbles(privateEntries));
  
  // 加載公開註記（異步）
  if(typeof api!=='undefined'){
    loadPublicNotesForPage(root.dataset.doc);
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
    // 即使目前沒有公開註記，也要先訂閱，才能收到其他人新增的第一筆資料。
    if(typeof realtimeClient !== 'undefined'&&realtimeClient.isEnabled){
      realtimeClient.subscribeToNotes(articleId,update=>{
        if(['INSERT','UPDATE','DELETE'].includes(update.event)){
          loadPublicNotesForPage(articleId);
        }
      });
    }

    // 讀取用戶設置的閾值
    let thresholdPercent=50;
    if(authManager?.isLoggedIn){
      try{
      const settings=await api.getUserSettings();
      if(settings&&settings.settings){
        thresholdPercent=settings.settings.noteVisibilityThresholdPercent ?? 50;
      }
      }catch(err){
        console.warn('無法讀取閾值設定，使用默認值');
      }
    }
    
    // 從伺服器加載公開註記，應用用戶設置的閾值
    const response=await fetch(`/api/notes?articleId=${encodeURIComponent(articleId)}&thresholdPercent=${thresholdPercent}`);
    if(!response.ok)return;
    
    const data=await response.json();
    const root=$('.annotatable');if(!root||root.dataset.doc!==articleId)return;
    const notes=Array.isArray(data.notes)?data.notes:[];
    
    // 儲存公開註記到全局狀態供討論串使用
    if(!window.publicNotesByArticle)window.publicNotesByArticle={};
    window.publicNotesByArticle[articleId]=notes;
    
    // 將公開註記轉換為 entries 格式並計算 cluster
    const publicEntries=notes.map(note=>({
      note:{...note,visibility:'public',id:note.id,doc:articleId,start:note.anchor_offset_start,end:note.anchor_offset_end,comment:note.content},
      range:rangeFromOffsets(root,note.anchor_offset_start,note.anchor_offset_end),
      type:'public',
      clusterId:Math.floor(note.anchor_offset_start/5)
    })).filter(x=>x.range);
    
    // 設置公開註記高亮
    if(CSS.highlights&&window.Highlight){
      CSS.highlights.delete('public-notes');
      if(publicEntries.length)CSS.highlights.set('public-notes',new Highlight(...publicEntries.map(x=>x.range)));
    }
    
    // 與私人註記一起渲染所有氣泡
    const privateEntries=localNotesForDocument(root.dataset.doc).filter(n=>n.visibility!=='public'||!n.serverId).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end),type:'private',clusterId:Math.floor(n.start/5)})).filter(x=>x.range);
    renderBubbles([...privateEntries,...publicEntries]);
  }catch(err){
    console.warn('無法加載公開註記:',err);
  }
}

// 當閾值設定改變時重新加載註記
function handleThresholdChange(){
  const root=$('.annotatable');
  if(root){
    const articleId=root.dataset.doc;
    if(articleId){
      loadPublicNotesForPage(articleId);
    }
  }
}

window.addEventListener('supabase-realtime-ready',()=>handleThresholdChange());

function renderBubbles(entries){
  // 清除現有的所有氣泡
  document.querySelectorAll('.annotation-bubble').forEach(b => b.remove());
  
  // 分離私人和公開註記
  let privateEntries=entries.filter(e=>e.type==='private');
  const publicEntries=entries.filter(e=>e.type==='public');

  const privateClusterMap=new Map();
  privateEntries.forEach(entry=>{
    const clusterId=entry.clusterId ?? Math.floor(entry.note.start/5);
    if(!privateClusterMap.has(clusterId))privateClusterMap.set(clusterId,[]);
    privateClusterMap.get(clusterId).push(entry);
  });
  privateEntries=[...privateClusterMap.values()].map(cluster=>({
    ...cluster[0],
    note:{...cluster[0].note,clusterCount:cluster.length}
  }));
  
  // 渲染私人氣泡（不聚合，直接顯示）
  privateEntries.forEach(({note,range},idx)=>{
    const rect=[...range.getClientRects()].at(-1)||range.getBoundingClientRect();
    if(!rect.width&&!rect.height)return;
    
    const bubble=document.createElement('button');
    bubble.className='annotation-bubble annotation-bubble-private';
    bubble.type='button';
    bubble.textContent=note.clusterCount||idx+1;
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

async function hydrateThreadNote(note){
  const response=await api.getNoteReplies(note.id);
  note.replies=response.replies||[];
  return note;
}

function orderedThreadCluster(cluster){
  const byLikes=[...cluster].sort((a,b)=>(b.note.upvote_count||0)-(a.note.upvote_count||0)||new Date(b.note.created_at)-new Date(a.note.created_at));
  const byNewest=[...cluster].sort((a,b)=>new Date(b.note.created_at)-new Date(a.note.created_at));
  const ordered=[];
  const add=item=>{if(item&&!ordered.includes(item))ordered.push(item);};
  add(byLikes[0]); add(byLikes[1]); add(byNewest[0]); add(byLikes[2]); add(byNewest[1]); add(byLikes[3]); add(byNewest[2]);
  byNewest.forEach(add);
  return ordered;
}

function orderedReplies(replies, sortBy='best'){
  return [...replies].sort((a,b)=>sortBy==='latest'
    ? new Date(b.created_at)-new Date(a.created_at)
    : (b.upvote_count||0)-(a.upvote_count||0)||new Date(b.created_at)-new Date(a.created_at));
}

async function openThreadModal(cluster){
  cluster.splice(0,cluster.length,...orderedThreadCluster(cluster));
  window.threadData={cluster,currentIndex:0,replySort:'best'};
  const modal=$('#thread-modal');
  const backdrop=$('#backdrop');
  
  try{
    await hydrateThreadNote(cluster[0].note);
  }catch(error){
    console.warn('無法載入討論回覆:',error);
  }
  renderThreadContent(cluster[0].note);
  modal.hidden=false;
  backdrop.hidden=false;
  
  // 添加排序選項到 thread-content 頂部
  const contentDiv=$('#thread-content');
  if(!modal.querySelector('.thread-sort-options')){
    const sortHTML=`
      <div class="thread-sort-options" style="padding:12px;border-bottom:1px solid #ddd;background:#f9f9f9;display:flex;gap:8px;align-items:center">
        <span style="font-size:0.85rem;color:#999">&#22238;&#35206;&#25490;&#24207;</span>
        <button class="thread-sort-btn" data-sort="hot" style="padding:4px 12px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:0.85rem;border-color:#963b2e;color:#963b2e">&#26368;&#20339;</button>
        <button class="thread-sort-btn" data-sort="newest" style="padding:4px 12px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:0.85rem">&#26368;&#26032;</button>
      </div>
    `;
    contentDiv.insertAdjacentHTML('beforebegin',sortHTML);
    
    // 綁定排序按鈕事件
    const sortBtns=modal.querySelectorAll('.thread-sort-btn');
    const bestReplySort=modal.querySelector('[data-sort="hot"]');
    bestReplySort.style.borderColor=bestReplySort.style.color='#963b2e';
    sortBtns.forEach(btn=>{
      btn.onclick=()=>{
        const sortType=btn.dataset.sort;
        window.threadData.replySort=sortType==='hot'?'best':'latest';
        
        // 更新按鈕樣式
        sortBtns.forEach(b=>b.style.borderColor=b.style.color='#ddd');
        btn.style.borderColor=btn.style.color='#963b2e';
        
        // 重新排序並重新渲染
        if(false){
          cluster.sort((a,b)=>(b.note.score||0)-(a.note.score||0));
        }else if(false){
          cluster.sort((a,b)=>new Date(b.note.created_at)-new Date(a.note.created_at));
        }
        
        renderThreadContent(cluster[window.threadData.currentIndex].note);
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
    
    if(!authManager.isLoggedIn){
      toast('請先登入');
      return;
    }

    try{
      const currentNote=cluster[window.threadData.currentIndex].note;
      const result=await api.addReply(currentNote.id,text);
      
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
  const canEditNote=authManager.isLoggedIn&&note.author_id===currentUserId();
  
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
          ${canEditNote?`<button class="thread-edit-note" type="button" style="background:none;border:none;cursor:pointer">編輯</button>`:''}
        </div>
      </div>
      <p style="color:#333;line-height:1.5;margin:8px 0">${esc(note.content)}</p>
    </div>
  `;
  
  // 回覆列表
  const replies=orderedReplies(note.replies||[],window.threadData?.replySort);
  const repliesHTML=replies.length ? replies.map((r,i)=>`
    <div style="padding:12px;padding-left:32px;border-bottom:1px solid #eee;background:#fafafa">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong style="color:#555">${esc(r.public_alias||'\u533f\u540d\u4f7f\u7528\u8005')}</strong>
          <span style="color:#999;font-size:0.85rem"> &middot; ${new Date(r.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <div style="display:flex;gap:4px;font-size:0.9rem">
          <button class="thread-reply-vote" data-reply-id="${r.id}" data-vote="up" style="background:none;border:none;cursor:pointer">&#35738; ${r.upvote_count||0}</button>
          <button class="thread-reply-vote" data-reply-id="${r.id}" data-vote="down" style="background:none;border:none;cursor:pointer">&#20498;&#35738; ${r.downvote_count||0}</button>
        </div>
      </div>
      <p style="color:#666;line-height:1.5;margin:8px 0">${esc(r.content)}</p>
    </div>
  `).join('') : '<div style="padding:16px;text-align:center;color:#888;background:#fafafa">&#23578;&#28961;&#22238;&#35206;</div>';
    container.innerHTML=mainHTML+repliesHTML;
  const editButton=container.querySelector('.thread-edit-note');
  if(editButton){
    editButton.onclick=()=>{
      let localNote=state.notes.find(item=>item.serverId===note.id&&canAccessLocalNote(item));
      if(!localNote){
        localNote={
          id:note.local_uuid||note.id,
          serverId:note.id,
          ownerId:note.author_id,
          doc:note.article_id,
          start:note.anchor_offset_start,
          end:note.anchor_offset_end,
          text:'',
          comment:note.content,
          visibility:note.visibility
        };
        state.notes.push(localNote);
        saveNotes();
      }
      closeThreadModal();
      openAnnotationModal(localNote);
    };
  }
  if(typeof realtimeClient !== 'undefined'){
    const refreshReplies=async()=>{
      try{
        const response=await api.getNoteReplies(note.id);
        note.replies=response.replies||[];
        renderThreadContent(note);
      }catch(err){
        console.warn('無法同步最新回覆:',err);
      }
    };
    const refreshNote=async()=>{
      try{
        const response=await api.getNote(note.id);
        Object.assign(note,response?.note||response);
        renderThreadContent(note);
      }catch(err){
        console.warn('無法同步最新投票或收藏:',err);
      }
    };
    realtimeClient.subscribeToReplies(note.id,refreshReplies);
    realtimeClient.subscribeToVotes(note.id,refreshNote);
    realtimeClient.subscribeToFavorites(note.id,refreshNote);
    (note.replies||[]).forEach(reply=>{
      realtimeClient.subscribeToReplyVotes(reply.id,refreshReplies);
    });
    // 開啟討論串後立即監聽內容、投票與收藏計數，不必先互動才開始同步。
    realtimeClient.subscribeToNoteChanges('engagement',note.id,update=>{
      if(update.data){
        Object.assign(note,update.data);
        renderThreadContent(note);
      }
    });
  }
  
  // 綁定投票事件
  container.querySelectorAll('.thread-vote').forEach(btn=>{
    btn.onclick=async(e)=>{
      e.preventDefault();
      if(!authManager.isLoggedIn){
        toast('請先登入');
        return;
      }
      
      const noteId=btn.dataset.noteId;
      const voteType=btn.dataset.vote;
      
      try{
        const result=await api.voteNote(noteId,voteType);
        
        // 更新 note 對象的投票計數
        Object.assign(note, result.note);
        renderThreadContent(note);

        toast(voteType==='up'?'已按讚':'已倒讚');
      }catch(err){
        console.error('投票失敗:',err);
        toast('投票失敗');
      }
    };
  });

  container.querySelectorAll('.thread-reply-vote').forEach(btn=>{
    btn.onclick=async(e)=>{
      e.preventDefault();
      if(!authManager.isLoggedIn){
        toast('請先登入');
        return;
      }

      try{
        const result=await api.voteReply(note.id,btn.dataset.replyId,btn.dataset.vote);
        const reply=(note.replies||[]).find(item=>item.id===btn.dataset.replyId);
        if(reply&&result.reply)Object.assign(reply,result.reply);
        renderThreadContent(note);
      }catch(err){
        console.error('留言投票失敗:',err);
        toast(err.message||'留言投票失敗');
      }
    };
  });
  
  // 綁定收藏事件
  container.querySelectorAll('.thread-favorite').forEach(btn=>{
    btn.onclick=async(e)=>{
      e.preventDefault();
      if(!authManager.isLoggedIn){
        toast('請先登入');
        return;
      }
      
      const noteId=btn.dataset.noteId;
      
      try{
        const result=await api.toggleFavorite(noteId);
        
        // 更新 note 對象的收藏計數
        Object.assign(note, result.note);
        renderThreadContent(note);

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
  const notes=state.notes.filter(canAccessLocalNote);
  if(!notes.length){
    box.innerHTML='<p class="empty">尚未加入螢光筆標記。</p>';
    return;
  }
  
  box.innerHTML=notes.slice().reverse().map(n=>`
    <article class="note-item note-item-${n.visibility==='public'?'public':'private'}" data-note-id="${n.id}">
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
  
  box.onclick=async e=>{
    const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');
    
    if(edit){const note=state.notes.find(n=>n.id===edit.dataset.edit&&canAccessLocalNote(n));if(note)openAnnotationModal(note);}
    if(del){
      const note=state.notes.find(n=>n.id===del.dataset.delete&&canAccessLocalNote(n));
      if(!note){toast('身分驗證失敗：非使用者本人');return;}
      if(note.serverId){
        if(!authManager.isLoggedIn){toast('身分驗證失敗：請先登入目前瀏覽器的帳號');return;}
        try{
          await api.deleteNote(note.serverId);
        }catch(err){
          toast(err.message||'刪除註記失敗');
          return;
        }
      }
      state.notes=state.notes.filter(n=>n.id!==note.id);saveNotes();renderNotes();applyHighlights();
    }
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

async function saveDivinationResult(){
  if(!state.currentDivinationResult)return;
  const record=state.currentDivinationResult;
  record.ownerId=currentUserId()||null;
  if(authManager.isLoggedIn){
    try{
      const settingsResponse=await api.getUserSettings();
      if(settingsResponse.settings?.saveDivinationToCloud){
        const response=await api.createDivination(
          record.result.originalHexagram.id,
          record.question,
          record.result
        );
        record.serverId=response.record.id;
      }
    }catch(error){
      console.warn('無法儲存占卜至雲端:',error);
    }
  }
  state.divinations.push(record);
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
  if(!divination||!canAccessLocalDivination(divination)){
    toast('身分驗證失敗：非使用者本人');
    return;
  }
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

async function submitEditDivination(event){
  event.preventDefault();
  const question=$('#edit-divination-question').value.trim();
  if(!question)return;
  
  if(state.editingDivinationIndex!==null){
    const record=state.divinations[state.editingDivinationIndex];
    if(!record||!canAccessLocalDivination(record)){
      toast('身分驗證失敗：非使用者本人');
      return;
    }
    if(record.serverId){
      if(!authManager.isLoggedIn){toast('身分驗證失敗：請先登入目前瀏覽器的帳號');return;}
      try{
        await api.updateDivination(record.serverId,question,record.result);
      }catch(err){
        toast(err.message||'更新占卜紀錄失敗');
        return;
      }
    }
    record.question=question;
    saveDivinations();
    renderDivinations();
    toast('占卜紀錄已更新');
  }
  
  closeEditDivinationModal();
}

function renderDivinations(){
  const box=$('#divinations-list');
  const visibleDivinations=state.divinations.map((record,index)=>({record,index})).filter(item=>canAccessLocalDivination(item.record));
  box.innerHTML=visibleDivinations.length?visibleDivinations.slice().reverse().map(({record:d,index:actualIdx})=>{
    
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
  
  box.onclick=async e=>{
    const edit=e.target.closest('[data-edit-divination]');
    const del=e.target.closest('[data-delete-divination]');
    if(edit){
      const idx=parseInt(edit.dataset.editDivination);
      openEditDivinationModal(idx);
    }
    if(del){
      const timestamp=parseInt(del.dataset.deleteDivination);
      const record=state.divinations.find(d=>d.timestamp===timestamp&&canAccessLocalDivination(d));
      if(!record){toast('身分驗證失敗：非使用者本人');return;}
      if(record.serverId){
        if(!authManager.isLoggedIn){toast('身分驗證失敗：請先登入目前瀏覽器的帳號');return;}
        try{await api.deleteDivination(record.serverId);}catch(err){toast(err.message||'刪除占卜紀錄失敗');return;}
      }
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

  const loginButton=$('#login-button');
  const userMenu=$('#user-menu');
  const userMenuToggle=$('#user-menu-toggle');
  const userNickname=$('#user-nickname');
  const settingsAccount=$('#settings-account');
  const user=typeof authManager !== 'undefined' ? authManager.getCurrentUser?.() : null;
  const signedIn=Boolean(typeof authManager !== 'undefined'&&authManager.isLoggedIn&&user);

  if(signedIn){
    // 已登入 - 顯示用戶菜單
    if(loginButton)loginButton.style.display='none';
    if(userMenu)userMenu.style.display='flex';

    const nickname=user.displayName||user.email||'使用者';
    if(userNickname)userNickname.textContent=nickname;
    if(userMenuToggle){
      userMenuToggle.textContent=nickname.trim().slice(0,1).toUpperCase()||'●';
      userMenuToggle.setAttribute('aria-label',`${nickname} 的用戶選單`);
    }
    if(settingsAccount)settingsAccount.textContent=user.email||'未知';
    setCloudSettingsDisabled(false);

    // 加載統計數據
    loadUserStats();
  }else{
    // 未登入 - 顯示登入按鈕
    if(loginButton)loginButton.style.display='block';
    if(userMenu)userMenu.style.display='none';
    if(userMenuToggle){
      userMenuToggle.textContent='●';
      userMenuToggle.setAttribute('aria-label','登入');
    }
    if(userNickname)userNickname.textContent='';
    if(settingsAccount)settingsAccount.textContent='尚未登入';
    applySettingsToControls();
    setCloudSettingsDisabled(true);
    closeUserMenu();
  }
}

function loadUserStats(){
  // 加載用戶統計數據
  try{
    // 本地統計
    const notesCount=state.notes.filter(canAccessLocalNote).length;
    
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

// ===== 設定頁面 =====
function bindDangerZoneButtons(){
  const clearLocalBtn=$('#settings-clear-local');
  if(clearLocalBtn)clearLocalBtn.onclick=()=>showClearLocalDataModal();

  const deleteDataBtn=$('#settings-delete-data');
  if(deleteDataBtn)deleteDataBtn.onclick=()=>showDeleteDataModal();

  const deleteAccountBtn=$('#settings-delete-account');
  if(deleteAccountBtn)deleteAccountBtn.onclick=()=>showDeleteAccountModal();
}

async function initializeSettings(){
  // 帳號資訊直接來自目前瀏覽器已驗證的 session，不等待設定 API。
  updateAuthUI();
  const currentUser=typeof authManager !== 'undefined' ? authManager.getCurrentUser?.() : null;
  if(!currentUser||!authManager.isLoggedIn)return;

  try{
    // 獲取用戶設置
    const settingsData=await api.getUserSettings();
    if(!settingsData)return;
    
    const user=settingsData.user||currentUser;
    const settings={
      ...DEFAULT_USER_SETTINGS,
      ...(settingsData.settings||{})
    };
    applySettingsToControls(settings);
    
    // 顯示帳號信息
    const accountEl=$('#settings-account');
    if(accountEl){
      accountEl.textContent=user.email||currentUser.email||'未知';
    }
    
    // 設置儲存設定複選框
    const saveNotesEl=$('#settings-save-notes');
    if(saveNotesEl){
      saveNotesEl.checked=Boolean(settings.saveNotesToCloud);
      saveNotesEl.onchange=async e=>{
        const next=e.target.checked;
        if(!(await updateSetting('saveNotesToCloud',next)))e.target.checked=!next;
      };
    }
    
    const saveDivinationsEl=$('#settings-save-divinations');
    if(saveDivinationsEl){
      saveDivinationsEl.checked=Boolean(settings.saveDivinationToCloud);
      saveDivinationsEl.onchange=async e=>{
        const next=e.target.checked;
        if(!(await updateSetting('saveDivinationToCloud',next)))e.target.checked=!next;
      };
    }
    
    const allowPublicNotesEl=$('#settings-public-notes');
    if(allowPublicNotesEl){
      allowPublicNotesEl.checked=Boolean(settings.allowPublicNotes);
      allowPublicNotesEl.onchange=async e=>{
        const next=e.target.checked;
        if(!(await updateSetting('allowPublicNotes',next)))e.target.checked=!next;
      };
    }
    
    // 設置閾值滑桿
    const thresholdEl=$('#settings-threshold');
    const thresholdValueEl=$('#settings-threshold-value');
    if(thresholdEl){
      thresholdEl.value=settings.noteVisibilityThresholdPercent ?? 50;
      thresholdEl.dataset.savedValue=thresholdEl.value;
      if(thresholdValueEl)thresholdValueEl.textContent=thresholdEl.value+'%';
      thresholdEl.oninput=e=>{
        thresholdValueEl.textContent=e.target.value+'%';
      };
      thresholdEl.onchange=async e=>{
        const previous=e.target.dataset.savedValue||'50';
        const next=parseInt(e.target.value);
        if(await updateSetting('noteVisibilityThresholdPercent',next)){
          e.target.dataset.savedValue=String(next);
        }else{
          e.target.value=previous;
          if(thresholdValueEl)thresholdValueEl.textContent=previous+'%';
        }
      };
    }
    
    // 通知設定
    const notifyReplyEl=$('#settings-notify-replies');
    if(notifyReplyEl){
      notifyReplyEl.checked=settings.notifyOnReply !== false;
      notifyReplyEl.onchange=async e=>{
        const next=e.target.checked;
        if(!(await updateSetting('notifyOnReply',next)))e.target.checked=!next;
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
    if(clearLocalBtn)clearLocalBtn.onclick=()=>showClearLocalDataModal();

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
    'iching-highlights-v1',
    'iching-divinations-v1',
    'userSettings',
    'thread-state',
    'scroll-position',
    'article-cache'
  ];
  keysToRemove.forEach(key=>{
    try{
      localStorage.removeItem(key);
      console.log(`✓ 已清除: ${key}`);
    }catch(err){
      console.warn(`清除 ${key} 失敗:`,err);
    }
  });
  
  // 重置應用狀態
  state.notes=[];
  state.divinations=[];
  window.publicNotesByArticle={};
  window.threadData={};
  
  console.log('✓ 所有本機資料已清除');
}

function showClearLocalDataModal(){
  const modal=document.createElement('div');
  modal.id='clear-local-data-modal';
  modal.className='modal danger-confirm-modal';
  modal.innerHTML=`
    <section class="modal-card danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="clear-local-data-title">
      <div class="modal-head danger-confirm-head">
        <strong id="clear-local-data-title">刪除瀏覽器資料</strong>
        <button type="button" class="close-button close-action" aria-label="關閉">×</button>
      </div>
      <div class="danger-confirm-body">
        <p class="danger-confirm-copy">這會刪除目前瀏覽器內的註記、占卜紀錄與快取。Google 登入、條款同意與雲端資料不會被刪除。</p>
        <p class="danger-confirm-warning"><strong>此操作無法復原。</strong></p>
        <div class="modal-actions danger-confirm-actions">
          <button type="button" class="secondary-button cancel-action">取消</button>
          <button type="button" class="submit-button confirm-action">確認刪除</button>
        </div>
      </div>
    </section>`;
  const close=mountDangerModal(modal);
  modal.querySelector('.confirm-action').onclick=()=>{
    clearLocalStorage();
    close();
    location.reload();
  };
  modal.querySelector('.cancel-action').focus();
}

function mountDangerModal(modal){
  const close=()=>modal.remove();
  modal.querySelectorAll('.cancel-action,.close-action').forEach(button=>{
    button.onclick=close;
  });
  modal.onclick=event=>{
    if(event.target===modal)close();
  };
  document.body.appendChild(modal);
  return close;
}

function currentAuthenticatedEmail(){
  return authManager?.getCurrentUser?.()?.email || null;
}

function requireCurrentAuthenticatedEmail(){
  const email=currentAuthenticatedEmail();
  if(!authManager?.isLoggedIn||!email){
    toast('\u8eab\u5206\u9a57\u8b49\u5931\u6557\uff1a\u8acb\u5148\u767b\u5165\u76ee\u524d\u700f\u89bd\u5668\u7684\u5e33\u865f');
    return null;
  }
  return email;
}

function emailMatchesCurrentUser(inputEmail,currentEmail){
  return String(inputEmail||'').trim().toLowerCase()===String(currentEmail||'').trim().toLowerCase();
}

async function updateSetting(key,value){
  try{
    const settings={};
    settings[key]=value;
    await api.updateUserSettings(settings);
    if(key==='allowPublicNotes'||key==='noteVisibilityThresholdPercent'){
      handleThresholdChange();
    }
    if(key==='saveNotesToCloud'&&value&&typeof syncCloudNotes==='function'){
      syncCloudNotes().catch(error=>console.warn('Cloud note sync failed:',error));
    }
    if(key==='saveDivinationToCloud'&&value&&typeof syncCloudDivinations==='function'){
      syncCloudDivinations().catch(error=>console.warn('Cloud divination sync failed:',error));
    }
    console.log('設定已更新:',key,value);
    return true;
  }catch(err){
    console.error('更新設定失敗:',err);
    alert('更新失敗：'+err.message);
    return false;
  }
}

function showDeleteDataModal(){
  const currentEmail=requireCurrentAuthenticatedEmail();
  if(!currentEmail)return;
  const modal=document.createElement('div');
  modal.id='delete-data-modal-overlay';
  modal.className='modal danger-confirm-modal';
  modal.innerHTML=`
    <section class="modal-card danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-data-title">
      <div class="modal-head danger-confirm-head">
        <strong id="delete-data-title">刪除雲端資料</strong>
        <button type="button" class="close-button close-action" aria-label="關閉">×</button>
      </div>
      <div class="danger-confirm-body">
        <p class="danger-confirm-account">目前登入帳號：<strong>${esc(currentEmail)}</strong></p>
        <p class="danger-confirm-copy">此操作將刪除以下內容：</p>
        <ul class="danger-confirm-list">
          <li>✓ 雲端占卜紀錄</li>
          <li>✓ 公開註記與討論</li>
          <li>✓ 收藏列表</li>
          <li>✗ 本機資料不會被刪除</li>
        </ul>
        <p class="danger-confirm-warning"><strong>此操作不可逆。</strong></p>
        <label class="danger-confirm-field">
          <span>請輸入您的 Email 地址以確認：</span>
          <input type="email" id="delete-data-email" placeholder="your@email.com" autocomplete="email">
        </label>
        <div class="modal-actions danger-confirm-actions">
          <button type="button" class="secondary-button cancel-action">取消</button>
          <button type="button" id="confirm-delete-data-btn" class="submit-button">確認刪除</button>
        </div>
      </div>
    </section>
  `;
  const close=mountDangerModal(modal);
  
  const confirmBtn=modal.querySelector('#confirm-delete-data-btn');
  const emailInput=modal.querySelector('#delete-data-email');
  
  confirmBtn.onclick=async()=>{
    const email=emailInput.value.trim();
    if(!email){
      alert('請輸入 Email');
      return;
    }
    
    if(!emailMatchesCurrentUser(email,currentEmail)){
      alert('\u8eab\u5206\u9a57\u8b49\u5931\u6557\uff1a\u8acb\u8f38\u5165\u76ee\u524d\u767b\u5165\u5e33\u865f\u7684 Gmail');
      return;
    }

    try{
      await api.deleteCloudData(email);
      alert('雲端資料已開始刪除。');
      close();
    }catch(err){
      alert('刪除失敗：'+err.message);
    }
  };
  
  emailInput.focus();
}

// ===== 收藏列表 =====
async function loadFavoritesList(){
  try{
    const response=await api.getUserFavorites();
    const favoritesList=$('#favorites-list');
    
    if(!response||!response.notes||response.notes.length===0){
      favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#888">&#23578;&#28961;&#25910;&#34255;</div>';
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
    favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#888">尚無收藏</div>';
  }
}

function navigateToFavorite(noteId,articleId){
  // 導航到原文章
  const guaId=articleId.split('-')[1];
  window.location.hash=`gua/${guaId}`;
  
  // 等待頁面加載後打開討論串
  setTimeout(()=>{
    const notes=window.publicNotesByArticle?.[articleId];
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
      notificationsList.innerHTML='<div style="padding:12px;text-align:center;color:#888">&#23578;&#28961;&#36890;&#30693;</div>';
      return;
    }
    
    const html=response.notifications.map((notif,i)=>`
      <div class="notification-item" style="padding:12px;border-bottom:1px solid #eee;cursor:pointer;transition:all 0.2s;background:${notif.read_at?'#fff':'#f9f9f9'}" onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='${notif.read_at?'#fff':'#f9f9f9'}'" onclick="navigateToNotification('${notif.id}','${notif.note_id||notif.target_id||''}')">
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
    notificationsList.innerHTML='<div style="padding:12px;text-align:center;color:#888">尚無通知</div>';
  }
}

function navigateToNotification(notificationId,referenceId){
  // 標記為已讀
  api.markNotificationAsRead(notificationId).catch(()=>{});
  
  // 導航到相關注記（需要先查詢該注記的信息）
  api.getNote(referenceId).then(response=>{
    const note=response?.note||response;
    // 檢查內容是否已被刪除
    if(!note||note.deleted_at){
      alert('抱歉，該內容已被刪除。');
      return;
    }
    
    const guaId=note.article_id.split('-')[1];
    window.location.hash=`gua/${guaId}`;
    
    setTimeout(()=>{
      const notes=window.publicNotesByArticle?.[note.article_id];
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
  const currentEmail=requireCurrentAuthenticatedEmail();
  if(!currentEmail)return;
  const modal=document.createElement('div');
  modal.id='delete-account-modal-overlay';
  modal.className='modal danger-confirm-modal';
  modal.innerHTML=`
    <section class="modal-card danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <div class="modal-head danger-confirm-head">
        <strong id="delete-account-title">刪除帳號</strong>
        <button type="button" class="close-button close-action" aria-label="關閉">×</button>
      </div>
      <div class="danger-confirm-body">
        <p class="danger-confirm-account">目前登入帳號：<strong>${esc(currentEmail)}</strong></p>
        <p class="danger-confirm-copy">您確定要永久刪除帳號嗎？刪除後：</p>
        <ul class="danger-confirm-list">
          <li>✓ 帳號將被停用</li>
          <li>✓ 所有雲端資料將被刪除</li>
          <li>✓ 您將被登出</li>
          <li>✓ 無法恢復</li>
        </ul>
        <p class="danger-confirm-warning"><strong>此操作無法撤銷。</strong></p>
        <label class="danger-confirm-field">
          <span>請輸入您的 Email 地址以確認刪除：</span>
          <input type="email" id="delete-account-email" placeholder="your@email.com" autocomplete="email">
        </label>
        <div class="modal-actions danger-confirm-actions">
          <button type="button" class="secondary-button cancel-action">取消</button>
          <button type="button" id="confirm-delete-account-btn" class="submit-button">確認刪除帳號</button>
        </div>
      </div>
    </section>
  `;
  const close=mountDangerModal(modal);
  
  const confirmBtn=modal.querySelector('#confirm-delete-account-btn');
  const emailInput=modal.querySelector('#delete-account-email');
  
  confirmBtn.onclick=async()=>{
    const email=emailInput.value.trim();
    if(!email){
      alert('請輸入 Email');
      return;
    }
    
    if(!emailMatchesCurrentUser(email,currentEmail)){
      alert('\u8eab\u5206\u9a57\u8b49\u5931\u6557\uff1a\u8acb\u8f38\u5165\u76ee\u524d\u767b\u5165\u5e33\u865f\u7684 Gmail');
      return;
    }

    try{
      const result=await api.deleteAccount(email);
      alert('帳號已刪除，即將返回首頁...');
      close();
      // 清除登入信息
      api.clearSessionToken();
      localStorage.removeItem('user');
      // 導回首頁
      setTimeout(()=>window.location.href='/',1500);
    }catch(err){
      alert('刪除失敗：'+err.message);
    }
  };
  
  emailInput.focus();
}
