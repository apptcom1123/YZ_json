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
const PUBLIC_NOTE_RANK_WINDOW=20;
const BUBBLE_LONG_PRESS_MS=220;
const THRESHOLD_SAVE_DELAY_MS=220;
let currentNoteThresholdPercent=50;
const thresholdSaveState={timer:null,saving:false,desired:50,persisted:50};
const publicNotesInFlight=new Map();
const publicNotesRefreshTimers=new Map();
const publicNotesRefreshPending=new Set();
const publicNoteRealtimeQueue=new Map();
const publicNoteRankTables=new Map();
let publicNoteRenderFrame=null;
let thresholdRenderFrame=null;
let activePublicNotesArticleId=null;
let activePublicNotesSubscriptionId=null;
let statsRequestVersion=0;
const threadRealtimeSubscriptionIds=new Set();
let threadRealtimeNoteId=null;
let threadRefreshTimer=null;
let notificationCache=[];
let notificationFetchedAt=0;
let notificationLoadPromise=null;
let favoritesCache=[];
let favoritesFetchedAt=0;
let favoritesLoadPromise=null;
const personalNoteCache=new Map();
const PERSONAL_CONTENT_CACHE_TTL=60000;
const pendingEngagementActions=new Set();
let personalCacheUserId=null;
const notificationRealtimeQueue=new Map();
let notificationRenderFrame=null;
const threadReplyRealtimeQueue=new Map();
let threadReplyRenderFrame=null;
const threadNoteRealtimeQueue=new Map();
let threadNoteRenderFrame=null;
let realtimeReconcileTimer=null;
const threadRepliesCache=new Map();
const threadPrefetchQueue=new Map();
const authorDisplayNameCache=new Map();
const authorPublicCodeCache=new Map();
const authorDisplayNameRequests=new Map();
const authorDisplayNameFailures=new Map();
const THREAD_REPLIES_CACHE_TTL=60000;
const THREAD_REPLIES_CACHE_LIMIT=30;
let threadPrefetchScheduled=false;

function applySettingsToControls(settings=DEFAULT_USER_SETTINGS){
  if($('#settings-save-notes'))$('#settings-save-notes').checked=Boolean(settings.saveNotesToCloud);
  if($('#settings-save-divinations'))$('#settings-save-divinations').checked=Boolean(settings.saveDivinationToCloud);
  if($('#settings-public-notes'))$('#settings-public-notes').checked=Boolean(settings.allowPublicNotes);
  if($('#settings-notify-replies'))$('#settings-notify-replies').checked=settings.notifyOnReply!==false;
  const threshold=$('#settings-threshold');
  const hasPendingThreshold=Boolean(thresholdSaveState.timer)
    ||thresholdSaveState.saving
    ||thresholdSaveState.desired!==thresholdSaveState.persisted;
  const thresholdValue=hasPendingThreshold
    ?thresholdSaveState.desired
    :Number(settings.noteVisibilityThresholdPercent ?? 50);
  currentNoteThresholdPercent=thresholdValue;
  if(!hasPendingThreshold){
    thresholdSaveState.desired=thresholdValue;
    thresholdSaveState.persisted=thresholdValue;
  }
  if(threshold){
    threshold.value=thresholdValue;
    threshold.dataset.savedValue=String(thresholdValue);
  }
  if($('#settings-threshold-value'))$('#settings-threshold-value').textContent=thresholdValue+'%';
  handleThresholdChange();
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
function personalNotesForCurrentViewer(){
  const userId=currentUserId();
  if(userId)return state.notes.filter(note=>note.ownerId===userId);
  return state.notes.filter(note=>!note.ownerId&&!note.serverId);
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
  if(userId!==personalCacheUserId){
    personalCacheUserId=userId;
    favoritesCache=[];
    favoritesFetchedAt=0;
    notificationCache=[];
    notificationFetchedAt=0;
    personalNoteCache.clear();
  }
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
  $('#annotation-form').onsubmit=event=>{
    const form=event.currentTarget;
    event.preventDefault();
    if(form.dataset.submitting==='true')return;
    form.dataset.submitting='true';
    const submitButton=form.querySelector('[type="submit"]');
    if(submitButton)submitButton.disabled=true;
    Promise.resolve(submitAnnotation(event)).finally(()=>{
      delete form.dataset.submitting;
      if(submitButton)submitButton.disabled=false;
    });
  };
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
      else if(tabName==='highlights'){
        renderNotes();
        if(authManager?.isLoggedIn&&typeof refreshOwnCloudNotes==='function'){
          refreshOwnCloudNotes().catch(error=>console.warn('Own notes refresh failed:',error));
        }
      }
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
      const saveButton=$('#save-nickname-btn');
      const newNickname=input.value.trim();
      
      if(!newNickname){
        alert('暱稱不能為空');
        return;
      }
      
      const user=authManager.getCurrentUser?.();
      if(!user)return;
      const previousNickname=user.displayName;
      const renderNickname=name=>{
        user.displayName=name;
        authorDisplayNameCache.set(user.id,name);
        if($('#user-nickname'))$('#user-nickname').textContent=name;
        if($('#user-menu-toggle')){
          $('#user-menu-toggle').textContent=name.trim().slice(0,1).toUpperCase()||'●';
          $('#user-menu-toggle').setAttribute('aria-label',`${name} 的用戶選單`);
        }
      };
      renderNickname(newNickname);
      $('#nickname-edit-form').style.display='none';
      toast('暱稱已更新');
      try{
        saveButton.disabled=true;
        const result=await api.updateProfile({displayName:newNickname});
        renderNickname(result.user.displayName);
      }catch(err){
        console.error('更新暱稱失敗:', err);
        renderNickname(previousNickname||user.email||'使用者');
        $('#nickname-edit-form').style.display='block';
        alert('更新暱稱失敗');
      }finally{
        saveButton.disabled=false;
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
  reader.innerHTML=`<article class="text-page annotatable" data-doc="text-about"><header><p class="text-kicker">使 用 說 明</p><h1>網站介紹</h1></header><div class="about-grid"><section class="feature-card"><h2>六十四卦查閱</h2><p>從左上角目錄開啟六十四卦索引，可依卦名、卦序、卦辭、爻辭或詩訣搜尋。</p></section><section class="feature-card"><h2>易傳獨立閱讀</h2><p>文言、繫辭、說卦、序卦、雜卦與彖象合參皆整理為獨立文字頁。</p></section><section class="feature-card"><h2>本機螢光筆註解</h2><ol class="steps"><li>反白想記錄的內文。</li><li>點擊畫面下方「加入螢光筆註解」。</li><li>在視窗選擇「私人」或「公開」，輸入心得後送出。</li><li>私人註解只會存在您的裝置，公開註解會與其他使用者分享。</li><li>長按內文旁的小泡泡可快速查看；雙擊泡泡可重新編輯。</li></ol></section><section class="feature-card"><h2>社群功能</h2><ol class="steps"><li>當您設定註解為「公開」時，其他登入使用者可以看到您的匿名註解。</li><li>相同位置的公開註解會自動聚合成小氣泡，您可長按顯示內容，或雙擊查看討論串。</li><li>在討論串內，您可以按讚、倒讚或收藏他人的公開註解。</li><li>投票結果（按讚/倒讚）會決定註解的排序與可見性。</li></ol></section><section class="feature-card"><h2>易經占卜</h2><ol class="steps"><li>點擊螢幕右下方的「占」按鈕。</li><li>輸入你的提問或所求。</li><li>系統將使用古法蓍草演卦生成結果。</li><li>結果會顯示本卦、變爻與之卦。</li><li>可將占卜結果儲存，方便日後查閱。</li></ol></section></div><div class="privacy-note"><strong>隱私說明</strong><br><strong>私人註解：</strong>只存放在目前瀏覽器的 localStorage，不會上傳到伺服器。清除網站資料、換瀏覽器或換裝置時，資料不會自動保留。<br><br><strong>公開註解：</strong>使用者在設定中同意相關行為後，資料始能儲存在伺服器上與其他使用者分享，支援跨裝置使用。</div></article>`; 
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
  let noteToSync=null;
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
    const newNote={...state.pending,comment,visibility,id:crypto.randomUUID?.()||String(Date.now()),ownerId:currentUserId()||null,syncStatus:'local'};
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
    if(visibility==='private'&&authManager.isLoggedIn&&$('#settings-save-notes')?.checked){
      noteToSync=newNote;
    }
  }
  saveNotes();getSelection()?.removeAllRanges();state.pending=null;state.editingId=null;$('#annotation-modal').hidden=true;$('#highlight-action').hidden=true;
  applyHighlights({refreshPublic:visibility==='public'});if(!$('#notes-panel').hidden)renderNotes();toast(visibility==='public'?'公開註解已儲存':'註解已保存在此裝置');navigator.vibrate?.(35);
  if(noteToSync&&typeof syncCloudNote==='function'){
    syncCloudNote(noteToSync).then(()=>{
      if(!$('#notes-panel').hidden)renderNotes();
    }).catch(error=>{
      console.warn('Private note cloud sync failed:',error);
      toast(error.message||'私人註解同步失敗，內容仍保存在此瀏覽器');
      if(!$('#notes-panel').hidden)renderNotes();
    });
  }
}

function applyHighlights({refreshPublic=true}={}){
  const root=$('.annotatable');if(!root)return;
  
  // 加載私人註記
  const privateEntries=localNotesForDocument(root.dataset.doc).filter(n=>n.visibility!=='public'||!n.serverId).map(n=>({note:n,range:rangeFromOffsets(root,n.start,n.end),type:'private',clusterId:Math.floor(n.start/5)})).filter(x=>x.range);
  
  const hasPublicCache=Array.isArray(window.publicNotesByArticle?.[root.dataset.doc]);
  requestAnimationFrame(()=>{
    if(hasPublicCache)renderCachedPublicNotes(root.dataset.doc);
    else renderBubbles(privateEntries);
  });
  
  // 加載公開註記（異步）
  if(refreshPublic&&typeof api!=='undefined'){
    loadPublicNotesForPage(root.dataset.doc);
  }
  
  // 設置私人註記高亮
  if(CSS.highlights&&window.Highlight){
    CSS.highlights.delete('user-notes');
    CSS.highlights.delete('public-notes');
    if(privateEntries.length)CSS.highlights.set('user-notes',new Highlight(...privateEntries.map(x=>x.range)));
  }
}

async function loadPublicNotesForPageLegacy(articleId){
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
function handleThresholdChangeLegacy(){
  const root=$('.annotatable');
  if(root){
    const articleId=root.dataset.doc;
    if(articleId){
      loadPublicNotesForPage(articleId);
    }
  }
}

window.addEventListener('supabase-realtime-ready',()=>{
  const articleId=$('.annotatable')?.dataset.doc;
  if(articleId){ensurePublicNotesSubscription(articleId);schedulePublicNotesRefresh(articleId,0);}
});
window.addEventListener('supabase-realtime-reconcile',()=>{
  clearTimeout(realtimeReconcileTimer);
  realtimeReconcileTimer=setTimeout(async()=>{
    const articleId=$('.annotatable')?.dataset.doc;
    if(articleId)schedulePublicNotesRefresh(articleId,0);
    if(authManager?.isLoggedIn){
      loadNotificationsList();
      loadUserStats();
    }
    const thread=window.threadData;
    const note=thread?.cluster?.[thread.currentIndex]?.note;
    if(note){
      try{
        const [noteResponse,repliesResponse]=await Promise.all([api.getNote(note.id),api.getNoteReplies(note.id)]);
        Object.assign(note,noteResponse?.note||noteResponse);
        note.replies=dedupeById(repliesResponse?.replies||[]);
        cacheThreadReplies(note);
        if(window.threadData)renderThreadContent(note);
      }catch(error){
        console.warn('Realtime reconciliation failed:',error);
      }
    }
  },100);
});

function dedupeById(items){
  return [...new Map((items||[]).filter(item=>item?.id).map(item=>[item.id,item])).values()];
}

function publicNoteClusterKey(note){
  const clusterKey=Number(note.cluster_key);
  return String(Number.isFinite(clusterKey)?clusterKey:Math.floor(Number(note.anchor_offset_start||0)/5));
}

function buildPublicNoteRankTable(notes){
  const clusters=new Map();
  (notes||[]).forEach(note=>{
    const key=publicNoteClusterKey(note);
    if(!clusters.has(key))clusters.set(key,[]);
    clusters.get(key).push(note);
  });
  const regions=new Map();
  clusters.forEach((cluster,key)=>{
    const region=Math.floor(Number(key)/PUBLIC_NOTE_RANK_WINDOW);
    if(!regions.has(region))regions.set(region,[]);
    regions.get(region).push({
      key,
      score:Math.max(...cluster.map(note=>Number(note.score)||0)),
      upvotes:Math.max(...cluster.map(note=>Number(note.upvote_count)||0)),
      newest:Math.max(...cluster.map(note=>new Date(note.created_at).getTime()||0))
    });
  });
  regions.forEach(region=>region.sort((a,b)=>
    b.score-a.score||b.upvotes-a.upvotes||b.newest-a.newest||Number(a.key)-Number(b.key)
  ));
  return regions;
}

function applyPublicNoteThreshold(notes,thresholdPercent=currentNoteThresholdPercent,rankTable=null){
  const percent=Math.min(100,Math.max(0,Number(thresholdPercent)||0));
  if(percent<=0)return notes||[];
  const visibleClusters=new Set();
  (rankTable||buildPublicNoteRankTable(notes)).forEach(region=>{
    const showCount=Math.max(1,Math.ceil(region.length*(100-percent)/100));
    const cutoff=region[Math.min(showCount,region.length)-1];
    region.forEach(item=>{
      if(item.score>cutoff.score||(item.score===cutoff.score&&item.upvotes>=cutoff.upvotes)){
        visibleClusters.add(item.key);
      }
    });
  });
  return (notes||[]).filter(note=>visibleClusters.has(publicNoteClusterKey(note)));
}

function rebuildPublicNoteRankTable(articleId){
  const notes=window.publicNotesByArticle?.[articleId]||[];
  publicNoteRankTables.set(articleId,buildPublicNoteRankTable(notes));
}

function renderCachedPublicNotes(articleId,{animateThreshold=false}={}){
  const root=$('.annotatable');
  if(!root||root.dataset.doc!==articleId)return;
  const sourceNotes=window.publicNotesByArticle?.[articleId]||[];
  if(!publicNoteRankTables.has(articleId))rebuildPublicNoteRankTable(articleId);
  const notes=applyPublicNoteThreshold(sourceNotes,currentNoteThresholdPercent,publicNoteRankTables.get(articleId));
  const publicEntries=notes.map(note=>({
    note:{...note,visibility:'public',doc:articleId,start:note.anchor_offset_start,end:note.anchor_offset_end,comment:note.content},
    range:rangeFromOffsets(root,note.anchor_offset_start,note.anchor_offset_end),
    type:'public',
    clusterId:Number.isFinite(Number(note.cluster_key))?Number(note.cluster_key):Math.floor(note.anchor_offset_start/5)
  })).filter(entry=>entry.range);
  if(CSS.highlights&&window.Highlight){
    CSS.highlights.delete('public-notes');
    if(publicEntries.length)CSS.highlights.set('public-notes',new Highlight(...publicEntries.map(entry=>entry.range)));
  }
  const privateEntries=localNotesForDocument(articleId)
    .filter(note=>note.visibility!=='public'||!note.serverId)
    .map(note=>({note,range:rangeFromOffsets(root,note.start,note.end),type:'private',clusterId:Math.floor(note.start/5)}))
    .filter(entry=>entry.range);
  renderBubbles([...privateEntries,...publicEntries],{animatePublic:animateThreshold});
}

function schedulePublicNotesRefresh(articleId,delay=100){
  clearTimeout(publicNotesRefreshTimers.get(articleId));
  publicNotesRefreshTimers.set(articleId,setTimeout(()=>{
    publicNotesRefreshTimers.delete(articleId);
    loadPublicNotesForPage(articleId);
  },delay));
}

function applyPublicNoteRealtimeUpdate(articleId,update,render=true){
  if(!window.publicNotesByArticle?.[articleId]){
    schedulePublicNotesRefresh(articleId,0);
    return;
  }
  const notes=window.publicNotesByArticle[articleId];
  const changed=update.data;
  if(!changed?.id)return;
  const index=notes.findIndex(note=>note.id===changed.id);
  const previousCommit=index>=0?notes[index]._realtimeCommitTimestamp:null;
  if(previousCommit&&update.commitTimestamp&&previousCommit>update.commitTimestamp)return;
  const remainsPublic=update.event!=='DELETE'
    && changed.article_id===articleId
    && changed.visibility==='public'
    && changed.status==='active'
    && !changed.deleted_at;
  if(remainsPublic){
    const nextNote={...changed,_realtimeCommitTimestamp:update.commitTimestamp||previousCommit||null};
    if(index>=0)notes[index]={...notes[index],...nextNote};
    else notes.push(nextNote);
  }else if(index>=0){
    notes.splice(index,1);
  }
  if(render){rebuildPublicNoteRankTable(articleId);renderCachedPublicNotes(articleId);}
}

function queuePublicNoteRealtimeUpdate(articleId,update){
  if(!publicNoteRealtimeQueue.has(articleId))publicNoteRealtimeQueue.set(articleId,new Map());
  const articleQueue=publicNoteRealtimeQueue.get(articleId);
  const queued=articleQueue.get(update.data?.id);
  if(!queued||!queued.commitTimestamp||!update.commitTimestamp||queued.commitTimestamp<=update.commitTimestamp){
    articleQueue.set(update.data?.id,update);
  }
  if(publicNoteRenderFrame)return;
  publicNoteRenderFrame=requestAnimationFrame(()=>{
    publicNoteRenderFrame=null;
    publicNoteRealtimeQueue.forEach((updates,queuedArticleId)=>{
      updates.forEach(item=>applyPublicNoteRealtimeUpdate(queuedArticleId,item,false));
      rebuildPublicNoteRankTable(queuedArticleId);
      renderCachedPublicNotes(queuedArticleId);
    });
    publicNoteRealtimeQueue.clear();
  });
}

function ensurePublicNotesSubscription(articleId){
  if(typeof realtimeClient==='undefined'||!realtimeClient.isEnabled)return;
  if(activePublicNotesArticleId===articleId)return;
  if(activePublicNotesSubscriptionId)realtimeClient.unsubscribe(activePublicNotesSubscriptionId).catch(()=>{});
  activePublicNotesArticleId=articleId;
  activePublicNotesSubscriptionId=realtimeClient.subscribeToNotes(articleId,update=>{
    if(['INSERT','UPDATE','DELETE'].includes(update.event))queuePublicNoteRealtimeUpdate(articleId,update);
  });
}

async function loadPublicNotesForPage(articleId){
  if(!articleId)return;
  ensurePublicNotesSubscription(articleId);
  if(publicNotesInFlight.has(articleId)){
    publicNotesRefreshPending.add(articleId);
    return publicNotesInFlight.get(articleId);
  }
  const request=(async()=>{
    try{
      const response=await fetch(`/api/notes?articleId=${encodeURIComponent(articleId)}&thresholdPercent=0`);
      if(!response.ok)return;
      const data=await response.json();
      if(!window.publicNotesByArticle)window.publicNotesByArticle={};
      window.publicNotesByArticle[articleId]=dedupeById(Array.isArray(data.notes)?data.notes:[]);
      rebuildPublicNoteRankTable(articleId);
      renderCachedPublicNotes(articleId);
    }catch(err){
      console.warn('Public annotation refresh failed:',err);
    }finally{
      publicNotesInFlight.delete(articleId);
      if(publicNotesRefreshPending.delete(articleId))schedulePublicNotesRefresh(articleId,60);
    }
  })();
  publicNotesInFlight.set(articleId,request);
  return request;
}

function handleThresholdChange(){
  const articleId=$('.annotatable')?.dataset.doc;
  if(!articleId||thresholdRenderFrame)return;
  thresholdRenderFrame=requestAnimationFrame(()=>{
    thresholdRenderFrame=null;
    renderCachedPublicNotes(articleId,{animateThreshold:true});
  });
}

function queueThresholdSettingSave(control,valueEl,value){
  thresholdSaveState.desired=value;
  clearTimeout(thresholdSaveState.timer);
  thresholdSaveState.timer=setTimeout(()=>{
    thresholdSaveState.timer=null;
    flushThresholdSetting(control,valueEl);
  },THRESHOLD_SAVE_DELAY_MS);
}

async function flushThresholdSetting(control,valueEl){
  if(thresholdSaveState.saving||thresholdSaveState.desired===thresholdSaveState.persisted)return;
  const target=thresholdSaveState.desired;
  const previous=thresholdSaveState.persisted;
  thresholdSaveState.saving=true;
  control.setAttribute('aria-busy','true');
  try{
    await api.updateUserSettings({noteVisibilityThresholdPercent:target});
    thresholdSaveState.persisted=target;
    control.dataset.savedValue=String(target);
  }catch(err){
    console.error('更新閾值失敗:',err);
    if(thresholdSaveState.desired===target){
      thresholdSaveState.desired=previous;
      currentNoteThresholdPercent=previous;
      control.value=String(previous);
      if(valueEl)valueEl.textContent=previous+'%';
      handleThresholdChange();
      toast('閾值儲存失敗，已恢復原設定');
    }
  }finally{
    thresholdSaveState.saving=false;
    control.removeAttribute('aria-busy');
    if(thresholdSaveState.desired!==thresholdSaveState.persisted&&!thresholdSaveState.timer){
      thresholdSaveState.timer=setTimeout(()=>{
        thresholdSaveState.timer=null;
        flushThresholdSetting(control,valueEl);
      },0);
    }
  }
}

function renderBubbles(entries,{animatePublic=false}={}){
  document.querySelectorAll('.annotation-bubble:not([data-bubble-key])').forEach(bubble=>bubble.remove());
  const existingBubbles=new Map([...document.querySelectorAll('.annotation-bubble[data-bubble-key]')]
    .map(bubble=>[bubble.dataset.bubbleKey,bubble]));
  const retainedKeys=new Set();
  
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
  const bubbleOrder=new Map();
  entries
    .map(entry=>({
      key:`${entry.type}:${entry.clusterId ?? Math.floor(Number(entry.note.start||0)/5)}`,
      start:Number(entry.note.start ?? entry.note.anchor_offset_start ?? 0),
      type:entry.type
    }))
    .sort((a,b)=>a.start-b.start||a.type.localeCompare(b.type))
    .forEach(item=>{if(!bubbleOrder.has(item.key))bubbleOrder.set(item.key,bubbleOrder.size+1);});
  
  // 渲染私人氣泡（不聚合，直接顯示）
  privateEntries.forEach(({note,range},idx)=>{
    const rect=[...range.getClientRects()].at(-1)||range.getBoundingClientRect();
    if(!rect.width&&!rect.height)return;
    const clusterId=Math.floor(Number(note.start||0)/5);
    const bubbleKey=`private:${clusterId}`;
    let bubble=existingBubbles.get(bubbleKey);
    if(!bubble){
      bubble=document.createElement('button');
      bubble.className='annotation-bubble annotation-bubble-private';
      bubble.type='button';
      bubble.dataset.bubbleKey=bubbleKey;
      document.body.appendChild(bubble);
      bindBubble(bubble);
    }
    retainedKeys.add(bubbleKey);
    bubble._note=note;
    bubble.textContent=bubbleOrder.get(`private:${Math.floor(Number(note.start||0)/5)}`)||idx+1;
    bubble.dataset.note=note.id;
    bubble.dataset.type='private';
    bubble.style.left=`${Math.min(innerWidth-32,rect.right+scrollX)}px`;
    bubble.style.top=`${rect.bottom+scrollY}px`;
    bubble.setAttribute('aria-label',`註解：${note.comment||note.text}`);
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
      
      const bubbleKey=`public:${clusterId}`;
      let bubble=existingBubbles.get(bubbleKey);
      if(!bubble){
        bubble=document.createElement('button');
        bubble.className='annotation-bubble annotation-bubble-public';
        bubble.type='button';
        bubble.dataset.bubbleKey=bubbleKey;
        document.body.appendChild(bubble);
        bindClusterBubble(bubble);
        if(animatePublic)bubble.classList.add('annotation-bubble-threshold-enter');
      }
      retainedKeys.add(bubbleKey);
      bubble._cluster=cluster;
      
      // 氣泡顯示註記數量或"聚合"標誌
      bubble.textContent=bubbleOrder.get(`public:${clusterId}`)||1;
      bubble.dataset.cluster=clusterId;
      bubble.dataset.type='public-cluster';
      bubble.dataset.notesCount=cluster.length;
      bubble.dataset.notes=JSON.stringify(cluster.map(e=>e.note));
      
      bubble.style.left=`${Math.min(innerWidth-32,rect.right+scrollX+35)}px`;
      bubble.style.top=`${rect.bottom+scrollY}px`;
      bubble.setAttribute('aria-label',`${cluster.length}條討論 - 最高分：${Math.max(...cluster.map(e=>e.note.score||0))}`);
      
      queueThreadPrefetch([cluster[0]?.note]);
    });
  }
  existingBubbles.forEach((bubble,key)=>{
    if(!retainedKeys.has(key))bubble.remove();
  });
}

function bindClusterBubble(bubble){
  const getCluster=()=>bubble._cluster||[];
  const prefetch=()=>queueThreadPrefetch(orderedThreadCluster(getCluster()).slice(0,2).map(entry=>entry.note));
  bubble.addEventListener('pointerenter',prefetch,{once:true,passive:true});
  bubble.addEventListener('focus',prefetch,{once:true});
  bindBubbleLongPress(bubble,()=>orderedThreadCluster(getCluster())[0]?.note,prefetch);
  bubble.addEventListener('dblclick',e=>{
    e.preventDefault();
    openThreadModal(getCluster());
  });
}

function bindBubbleLongPress(bubble,getNote,onStart=null){
  let timer=null;
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null;}};
  bubble.addEventListener('pointerdown',e=>{
    e.preventDefault();
    cancel();
    onStart?.();
    timer=setTimeout(()=>{
      timer=null;
      const note=getNote();
      if(note)showBubble(note);
    },BUBBLE_LONG_PRESS_MS);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type=>bubble.addEventListener(type,cancel));
}

function bindBubble(bubble){
  bindBubbleLongPress(bubble,()=>bubble._note);
  bubble.addEventListener('dblclick',e=>{e.preventDefault();hideBubble();if(bubble._note)openAnnotationModal(bubble._note);});
}

function pruneThreadRepliesCache(){
  if(threadRepliesCache.size<=THREAD_REPLIES_CACHE_LIMIT)return;
  [...threadRepliesCache.entries()]
    .sort((a,b)=>(a[1].accessedAt||0)-(b[1].accessedAt||0))
    .slice(0,threadRepliesCache.size-THREAD_REPLIES_CACHE_LIMIT)
    .forEach(([noteId])=>threadRepliesCache.delete(noteId));
}

function applyCachedThreadReplies(note){
  const cached=threadRepliesCache.get(note.id);
  if(!cached?.replies)return false;
  cached.accessedAt=Date.now();
  note.replies=cached.replies;
  return true;
}

function cacheThreadReplies(note,replies=note.replies||[]){
  const normalized=dedupeById(replies);
  note.replies=normalized;
  threadRepliesCache.set(note.id,{
    replies:normalized,
    fetchedAt:Date.now(),
    accessedAt:Date.now(),
    promise:null
  });
  pruneThreadRepliesCache();
}

async function hydrateThreadNote(note,{force=false}={}){
  const cached=threadRepliesCache.get(note.id);
  note.repliesError=null;
  if(cached?.replies)applyCachedThreadReplies(note);
  if(!force&&cached?.replies&&Date.now()-cached.fetchedAt<THREAD_REPLIES_CACHE_TTL){
    note.repliesLoading=false;
    return note;
  }
  if(cached?.promise){
    note.repliesLoading=!cached.replies;
    await cached.promise;
    applyCachedThreadReplies(note);
    note.repliesLoading=false;
    return note;
  }
  note.repliesLoading=!cached?.replies;
  const request=api.getNoteReplies(note.id).then(response=>{
    cacheThreadReplies(note,response.replies||[]);
    note.repliesLoading=false;
    note.repliesError=null;
    return note;
  }).catch(error=>{
    note.repliesLoading=false;
    note.repliesError=error;
    const failed=threadRepliesCache.get(note.id);
    if(failed)failed.promise=null;
    throw error;
  });
  threadRepliesCache.set(note.id,{
    replies:cached?.replies||null,
    fetchedAt:cached?.fetchedAt||0,
    accessedAt:Date.now(),
    promise:request
  });
  return request;
}

function queueThreadPrefetch(notes){
  (notes||[]).forEach(note=>{
    const cached=threadRepliesCache.get(note?.id);
    if(note?.id&&(!cached?.replies||Date.now()-cached.fetchedAt>=THREAD_REPLIES_CACHE_TTL)){
      threadPrefetchQueue.set(note.id,note);
    }
  });
  if(threadPrefetchScheduled||!threadPrefetchQueue.size)return;
  threadPrefetchScheduled=true;
  const run=()=>{
    threadPrefetchScheduled=false;
    const candidates=[...threadPrefetchQueue.values()].slice(0,4);
    threadPrefetchQueue.clear();
    Promise.allSettled(candidates.map(note=>hydrateThreadNote(note)));
  };
  if('requestIdleCallback' in window)window.requestIdleCallback(run,{timeout:1200});
  else setTimeout(run,180);
}

function renderThreadNoteImmediately(note){
  const hasCachedReplies=applyCachedThreadReplies(note);
  note.repliesLoading=!hasCachedReplies;
  renderThreadContent(note);
  hydrateThreadNote(note).then(()=>{
    const current=window.threadData?.cluster?.[window.threadData.currentIndex]?.note;
    if(current?.id===note.id)renderThreadContent(note);
  }).catch(error=>{
    console.warn('Thread preload failed:',error);
    const current=window.threadData?.cluster?.[window.threadData.currentIndex]?.note;
    if(current?.id===note.id)renderThreadContent(note);
  });
}

function applyOptimisticVote(target,voteType){
  const snapshot={
    userVote:target.userVote||null,
    upvote_count:Number(target.upvote_count)||0,
    downvote_count:Number(target.downvote_count)||0,
    score:Number(target.score)||0
  };
  const nextVote=voteType==='none'||snapshot.userVote===voteType?null:voteType;
  if(snapshot.userVote==='up')target.upvote_count=Math.max(0,snapshot.upvote_count-1);
  if(snapshot.userVote==='down')target.downvote_count=Math.max(0,snapshot.downvote_count-1);
  if(nextVote==='up')target.upvote_count++;
  if(nextVote==='down')target.downvote_count++;
  target.userVote=nextVote;
  target.score=target.upvote_count-target.downvote_count;
  return snapshot;
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
    : ((b.upvote_count||0)-(b.downvote_count||0))-((a.upvote_count||0)-(a.downvote_count||0))
      ||(b.upvote_count||0)-(a.upvote_count||0)
      ||new Date(b.created_at)-new Date(a.created_at));
}

function flattenReplies(replies,depth=0){
  const flattened=[];
  (replies||[]).forEach(reply=>{
    flattened.push({...reply,_depth:depth});
    flattened.push(...flattenReplies(reply.children||[],depth+1));
  });
  return flattened;
}

function findReplyById(replies,replyId){
  for(const reply of replies||[]){
    if(reply.id===replyId)return reply;
    const nested=findReplyById(reply.children,replyId);
    if(nested)return nested;
  }
  return null;
}

function animateThreadControl(selector,className){
  const control=$('#thread-content')?.querySelector(selector);
  if(!control)return;
  control.classList.add(className);
  control.addEventListener('animationend',()=>control.classList.remove(className),{once:true});
}

async function sendThreadReply(note,reply,submitButton=null){
  if(reply._sending)return;
  const wasPending=reply._pending;
  const wasFailed=reply._failed;
  if(wasFailed)note.reply_count=(Number(note.reply_count)||0)+1;
  reply._pending=true;
  reply._failed=false;
  reply._sending=true;
  if(submitButton)submitButton.disabled=true;
  if(!wasPending)renderThreadContent(note);
  try{
    const result=await api.addReply(note.id,reply.content,null,reply._clientMutationId);
    const official=result.reply;
    const temporaryIndex=note.replies.findIndex(item=>item.id===reply.id);
    const existingIndex=official?note.replies.findIndex(item=>item.id===official.id):-1;
    if(existingIndex>=0&&existingIndex!==temporaryIndex){
      note.replies[existingIndex]={...note.replies[existingIndex],...official};
      if(temporaryIndex>=0)note.replies.splice(temporaryIndex,1);
    }else if(temporaryIndex>=0&&official){
      note.replies.splice(temporaryIndex,1,official);
    }else if(official&&existingIndex<0){
      note.replies.push(official);
    }
    if(result.version)note._activityVersion=Math.max(Number(note._activityVersion)||0,Number(result.version)||0);
    cacheThreadReplies(note);
    renderThreadContent(note);
    toast('回覆成功');
  }catch(err){
    console.error('回覆失敗:',err);
    const committed=note.replies.some(item=>
      item.client_mutation_id===reply._clientMutationId&&!item._pending&&!item._failed
    );
    if(committed){
      cacheThreadReplies(note);
      renderThreadContent(note);
      toast('回覆已送出');
      return;
    }
    reply._pending=false;
    reply._failed=true;
    reply._sending=false;
    note.reply_count=Math.max(0,(Number(note.reply_count)||1)-1);
    cacheThreadReplies(note);
    renderThreadContent(note);
    toast(err.message||'回覆失敗，可重新傳送');
  }finally{
    reply._sending=false;
    if(submitButton)submitButton.disabled=false;
  }
}

function captureReplyPositions(){
  return new Map([...document.querySelectorAll('#thread-content .thread-reply[data-reply-id]')]
    .map(element=>[element.dataset.replyId,element.getBoundingClientRect().top]));
}

function renderThreadContentWithReplyReorder(note){
  const previousPositions=captureReplyPositions();
  renderThreadContent(note);
  if(!previousPositions.size||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  document.querySelectorAll('#thread-content .thread-reply[data-reply-id]').forEach(element=>{
    const previousTop=previousPositions.get(element.dataset.replyId);
    if(previousTop==null)return;
    const delta=previousTop-element.getBoundingClientRect().top;
    if(Math.abs(delta)<1)return;
    element.animate(
      [{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],
      {duration:180,easing:'ease-out'}
    );
  });
}

function queueThreadActivityUpdate(note,update){
  const row=update?.data;
  const version=Number(row?.version)||0;
  if(!row||version<=(Number(note._activityVersion)||0))return;
  note._activityVersion=version;
  const payload=row.payload||{};
  if(row.event_type==='note.vote.updated'){
    note.upvote_count=payload.upvote_count;
    note.downvote_count=payload.downvote_count;
    note.score=payload.score;
  }else if(row.event_type==='note.favorite.updated'){
    note.favorite_count=payload.favorite_count;
  }else if(row.event_type==='reply.vote.updated'){
    const reply=findReplyById(note.replies,payload.reply_id);
    if(reply){
      reply.upvote_count=payload.upvote_count;
      reply.downvote_count=payload.downvote_count;
      reply._activityVersion=version;
    }
  }else if(row.event_type==='reply.created'){
    note.reply_count=payload.reply_count;
  }
  if(window.threadData)requestAnimationFrame(()=>{
    if(row.event_type==='reply.vote.updated')renderThreadContentWithReplyReorder(note);
    else renderThreadContent(note);
  });
}

function queueThreadReplyRealtimeUpdate(note,update){
  if(!update?.data?.id)return;
  const queued=threadReplyRealtimeQueue.get(update.data.id);
  if(!queued||!queued.update.commitTimestamp||!update.commitTimestamp||queued.update.commitTimestamp<=update.commitTimestamp){
    threadReplyRealtimeQueue.set(update.data.id,{note,update});
  }
  if(threadReplyRenderFrame)return;
  threadReplyRenderFrame=requestAnimationFrame(()=>{
    threadReplyRenderFrame=null;
    const touchedNotes=new Set();
    threadReplyRealtimeQueue.forEach(({note:targetNote,update:item})=>{
      const replies=targetNote.replies||(targetNote.replies=[]);
      const mutationIndex=item.data.client_mutation_id
        ?replies.findIndex(reply=>reply._clientMutationId===item.data.client_mutation_id)
        :-1;
      const index=replies.findIndex(reply=>reply.id===item.data.id);
      const previousCommit=index>=0?replies[index]._realtimeCommitTimestamp:null;
      if(previousCommit&&item.commitTimestamp&&previousCommit>item.commitTimestamp)return;
      if(item.event==='DELETE'||item.data.status!=='active'){
        if(index>=0)replies.splice(index,1);
      }else{
        const next={...item.data,_realtimeCommitTimestamp:item.commitTimestamp||previousCommit||null};
        if(index>=0)replies[index]={...replies[index],...next};
        else if(mutationIndex>=0)replies[mutationIndex]={...replies[mutationIndex],...next,_pending:false,_failed:false};
        else replies.push({...next,_justInserted:true});
      }
      touchedNotes.add(targetNote);
    });
    threadReplyRealtimeQueue.clear();
    touchedNotes.forEach(targetNote=>{
      cacheThreadReplies(targetNote);
      if(window.threadData)renderThreadContentWithReplyReorder(targetNote);
    });
  });
}

function queueThreadNoteRealtimeUpdate(note,update){
  if(!update?.data?.id)return;
  const queued=threadNoteRealtimeQueue.get(update.data.id);
  if(!queued||!queued.update.commitTimestamp||!update.commitTimestamp||queued.update.commitTimestamp<=update.commitTimestamp){
    threadNoteRealtimeQueue.set(update.data.id,{note,update});
  }
  if(threadNoteRenderFrame)return;
  threadNoteRenderFrame=requestAnimationFrame(()=>{
    threadNoteRenderFrame=null;
    threadNoteRealtimeQueue.forEach(({note:targetNote,update:item})=>{
      const previousCommit=targetNote._realtimeCommitTimestamp;
      if(previousCommit&&item.commitTimestamp&&previousCommit>item.commitTimestamp)return;
      Object.assign(targetNote,item.data,{
        _realtimeCommitTimestamp:item.commitTimestamp||previousCommit||null
      });
      if(window.threadData)renderThreadContent(targetNote);
    });
    threadNoteRealtimeQueue.clear();
  });
}

async function openThreadModal(cluster){
  cluster.splice(0,cluster.length,...orderedThreadCluster(cluster));
  window.threadData={cluster,currentIndex:0,replySort:'best'};
  const modal=$('#thread-modal');
  const backdrop=$('#backdrop');
  
  try{
    renderThreadNoteImmediately(cluster[0].note);
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
        
        const threadData=window.threadData;
        if(threadData?.cluster?.length){
          renderThreadContentWithReplyReorder(threadData.cluster[threadData.currentIndex].note);
        }
      };
    });
  }
  
  // 綁定事件
  modal.querySelectorAll('.thread-sort-btn').forEach(btn=>{
    const selected=btn.dataset.sort==='hot';
    btn.style.borderColor=btn.style.color=selected?'#963b2e':'#ddd';
    btn.setAttribute('aria-pressed',String(selected));
  });

  $('#thread-prev').onclick=async()=>{
    if(window.threadData.currentIndex>0){
      window.threadData.currentIndex--;
      const note=cluster[window.threadData.currentIndex].note;
      renderThreadNoteImmediately(note);
    }
  };
  
  $('#thread-next').onclick=async()=>{
    if(window.threadData.currentIndex<cluster.length-1){
      window.threadData.currentIndex++;
      const note=cluster[window.threadData.currentIndex].note;
      renderThreadNoteImmediately(note);
    }
  };
  
  $('#close-thread').onclick=()=>closeThreadModal();
  
  $('#thread-reply-submit').onclick=async()=>{
    const submitButton=$('#thread-reply-submit');
    if(submitButton.disabled)return;
    const text=$('#thread-reply-text').value.trim();
    if(!text){toast('請輸入回覆內容');return;}
    
    if(!authManager.isLoggedIn){
      toast('請先登入');
      return;
    }

    const currentNote=cluster[window.threadData.currentIndex].note;
    const mutationId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
    const temporaryId=`pending-${mutationId}`;
    const temporaryReply={
      id:temporaryId,note_id:currentNote.id,author_id:currentUserId(),content:text,
      status:'active',created_at:new Date().toISOString(),upvote_count:0,downvote_count:0,
      userVote:null,public_display_name:authManager.getCurrentUser?.()?.displayName||'我',
      public_user_code:authManager.getCurrentUser?.()?.publicCode||null,
      _pending:true,_failed:false,_justInserted:true,_clientMutationId:mutationId
    };
    if(!currentNote.replies)currentNote.replies=[];
    currentNote.replies.push(temporaryReply);
    currentNote.reply_count=(Number(currentNote.reply_count)||0)+1;
    $('#thread-reply-text').value='';
    renderThreadContent(currentNote);
    await sendThreadReply(currentNote,temporaryReply,submitButton);
  };
  
  $('#thread-reply-cancel').onclick=()=>$('#thread-reply-text').value='';
}

function rememberAuthorDisplayName(target){
  const name=String(target?.public_display_name||target?.publicDisplayName||'').trim();
  if(name&&target?.author_id)authorDisplayNameCache.set(target.author_id,name);
  return name;
}

function rememberAuthorPublicCode(target){
  const code=String(target?.public_user_code||target?.publicCode||'').trim();
  if(code&&target?.author_id)authorPublicCodeCache.set(target.author_id,code);
  return code;
}

function threadAuthorDisplayName(target){
  const user=authManager.getCurrentUser?.();
  if(target?.author_id&&target.author_id===user?.id){
    const ownName=String(user.displayName||'').trim();
    if(ownName){authorDisplayNameCache.set(user.id,ownName);return ownName;}
  }
  const direct=rememberAuthorDisplayName(target);
  if(direct)return direct;
  return authorDisplayNameCache.get(target?.author_id)||'暱稱讀取中';
}

function formatPublicUserCode(code){
  const value=String(code||'').replace(/^U-/i,'');
  return value?`U-${value.slice(0,4).toUpperCase()}`:'識別碼讀取中';
}

function threadAuthorPublicCode(target){
  const user=authManager.getCurrentUser?.();
  let code='';
  if(target?.author_id&&target.author_id===user?.id&&user.publicCode){
    authorPublicCodeCache.set(user.id,user.publicCode);
    code=user.publicCode;
  }else{
    code=rememberAuthorPublicCode(target)||authorPublicCodeCache.get(target?.author_id)||'';
  }
  return formatPublicUserCode(code);
}

function scheduleThreadAuthorNameRender(){
  if(scheduleThreadAuthorNameRender.frame)return;
  scheduleThreadAuthorNameRender.frame=requestAnimationFrame(()=>{
    scheduleThreadAuthorNameRender.frame=null;
    const thread=window.threadData;
    const current=thread?.cluster?.[thread.currentIndex]?.note;
    if(current)renderThreadContent(current);
  });
}

function hydrateThreadAuthorNames(note){
  const targets=[{value:note,type:'note'},...flattenReplies(note.replies||[]).map(value=>({value,type:'reply'}))];
  targets.forEach(({value,type})=>{
    const authorId=value?.author_id;
    if(!authorId)return;
    const hasName=Boolean(rememberAuthorDisplayName(value)||authorDisplayNameCache.has(authorId));
    const hasCode=Boolean(rememberAuthorPublicCode(value)||authorPublicCodeCache.has(authorId));
    if(hasName&&hasCode)return;
    const ownUser=authManager.getCurrentUser?.();
    if(authorId===ownUser?.id&&ownUser.displayName&&ownUser.publicCode){
      authorDisplayNameCache.set(authorId,ownUser.displayName);
      authorPublicCodeCache.set(authorId,ownUser.publicCode);
      return;
    }
    if(authorDisplayNameRequests.has(authorId)||Date.now()-(authorDisplayNameFailures.get(authorId)||0)<30000)return;
    const request=(type==='note'
      ?api.getNote(value.id).then(response=>response?.note||response)
      :api.getReplyAuthor(note.id,value.id)
    ).then(response=>{
      const name=String(response?.public_display_name||response?.publicDisplayName||'').trim();
      const code=String(response?.public_user_code||response?.publicCode||'').trim();
      if(name)authorDisplayNameCache.set(authorId,name);
      if(code)authorPublicCodeCache.set(authorId,code);
      if(name||code)scheduleThreadAuthorNameRender();
    }).catch(error=>{
      authorDisplayNameFailures.set(authorId,Date.now());
      console.warn('Thread author name refresh failed:',error);
    }).finally(()=>authorDisplayNameRequests.delete(authorId));
    authorDisplayNameRequests.set(authorId,request);
  });
}

function renderThreadContent(note){
  const container=$('#thread-content');
  const counter=$('#thread-counter');
  const {cluster,currentIndex}=window.threadData||{};
  
  if(!cluster)return;
  hydrateThreadAuthorNames(note);
  counter.textContent=`${currentIndex+1}/${cluster.length}`;
  const canEditNote=authManager.isLoggedIn&&note.author_id===currentUserId();
  
  // 主註記
  const mainHTML=`
    <div class="thread-note" style="padding:12px;border-bottom:1px solid #ddd">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong style="color:#333">${esc(threadAuthorDisplayName(note))}</strong><span class="thread-author-code">${esc(threadAuthorPublicCode(note))}</span>
          <span style="color:#999;font-size:0.85rem"> · ${new Date(note.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <div style="display:flex;gap:4px;font-size:0.9rem">
          <button class="thread-vote" data-note-id="${note.id}" data-vote="up" aria-pressed="${note.userVote==='up'}" style="background:none;border:none;cursor:pointer;color:${note.userVote==='up'?'#963b2e':'inherit'}"><span class="thread-vote-symbol">▲</span> ${note.upvote_count||0}</button>
          <button class="thread-vote" data-note-id="${note.id}" data-vote="down" aria-pressed="${note.userVote==='down'}" style="background:none;border:none;cursor:pointer;color:${note.userVote==='down'?'#963b2e':'inherit'}"><span class="thread-vote-symbol">▼</span> ${note.downvote_count||0}</button>
          <button class="thread-favorite" data-note-id="${note.id}" aria-pressed="${Boolean(note.isFavoritedByUser)}" style="background:none;border:none;cursor:pointer;color:${note.isFavoritedByUser?'#963b2e':'inherit'}">✦ ${note.favorite_count||0}</button>
          ${canEditNote?`<button class="thread-edit-note" type="button" style="background:none;border:none;cursor:pointer">編輯</button>`:''}
        </div>
      </div>
      <p class="thread-message-content" style="color:#333;line-height:1.5;margin:8px 0">${esc(note.content)}</p>
    </div>
  `;
  
  // 回覆列表
  const replies=orderedReplies(flattenReplies(note.replies||[]),window.threadData?.replySort);
  const repliesHTML=note.repliesError&&!replies.length
    ? '<div class="thread-replies-error" style="padding:16px;text-align:center;color:#888;background:#fafafa">回覆載入失敗<br><button class="thread-replies-retry mini-btn" type="button" style="margin-top:8px">重新載入</button></div>'
    : note.repliesLoading&&!replies.length
    ? '<div style="padding:16px;text-align:center;color:#888;background:#fafafa">正在載入回覆...</div>'
    : replies.length ? replies.map((r,i)=>`
    <div class="thread-reply${r._justInserted?' thread-reply-enter':''}" data-reply-id="${r.id}" style="padding-left:${Math.min(88,32+(r._depth||0)*18)}px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <strong style="color:#555">${esc(threadAuthorDisplayName(r))}</strong><span class="thread-author-code">${esc(threadAuthorPublicCode(r))}</span>
          <span style="color:#999;font-size:0.85rem"> &middot; ${new Date(r.created_at).toLocaleDateString('zh-TW')}</span>
        </div>
        <div style="display:flex;gap:4px;font-size:0.9rem">
          ${r._pending?'<span style="color:#888;font-size:0.8rem">送出中</span>':r._failed
            ?`<button class="thread-reply-retry mini-btn" data-reply-id="${r.id}" type="button">重新傳送</button>`:`
          <button class="thread-reply-vote" data-reply-id="${r.id}" data-vote="up" aria-label="讚" aria-pressed="${r.userVote==='up'}" title="讚" style="background:none;border:none;cursor:pointer;color:${r.userVote==='up'?'#963b2e':'inherit'}"><span class="thread-vote-symbol">&#9650;</span> ${r.upvote_count||0}</button>
          <button class="thread-reply-vote" data-reply-id="${r.id}" data-vote="down" aria-label="不讚" aria-pressed="${r.userVote==='down'}" title="不讚" style="background:none;border:none;cursor:pointer;color:${r.userVote==='down'?'#963b2e':'inherit'}"><span class="thread-vote-symbol">&#9660;</span> ${r.downvote_count||0}</button>`}
        </div>
      </div>
      <p class="thread-message-content" style="color:#666;line-height:1.5;margin:8px 0">${esc(r.content)}</p>
    </div>
  `).join('') : '<div style="padding:16px;text-align:center;color:#888;background:#fafafa">&#23578;&#28961;&#22238;&#35206;</div>';
    container.innerHTML=mainHTML+repliesHTML;
  replies.filter(reply=>reply._justInserted).forEach(reply=>{
    const original=findReplyById(note.replies,reply.id);
    if(original)original._justInserted=false;
  });
  const editButton=container.querySelector('.thread-edit-note');
  const retryRepliesButton=container.querySelector('.thread-replies-retry');
  if(retryRepliesButton){
    retryRepliesButton.onclick=()=>{
      threadRepliesCache.delete(note.id);
      note.repliesError=null;
      renderThreadNoteImmediately(note);
    };
  }
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
  if(typeof realtimeClient !== 'undefined'&&threadRealtimeNoteId!==note.id){
    [...threadRealtimeSubscriptionIds].forEach(id=>realtimeClient.unsubscribe(id).catch(()=>{}));
    threadRealtimeSubscriptionIds.clear();
    threadRealtimeNoteId=note.id;
    const refreshReplies=update=>{
      queueThreadReplyRealtimeUpdate(note,update);
    };
    threadRealtimeSubscriptionIds.add(realtimeClient.subscribeToReplies(note.id,refreshReplies));
    threadRealtimeSubscriptionIds.add(realtimeClient.subscribeToNoteActivity(note.id,update=>{
      if(update.data)queueThreadActivityUpdate(note,update);
    }));
  }

  container.querySelectorAll('.thread-reply-retry').forEach(btn=>{
    btn.onclick=()=>{
      const reply=findReplyById(note.replies,btn.dataset.replyId);
      if(reply)sendThreadReply(note,reply);
    };
  });
  
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
      const actionKey=`note-vote:${noteId}`;
      if(pendingEngagementActions.has(actionKey))return;
      const snapshot=applyOptimisticVote(note,voteType);
      pendingEngagementActions.add(actionKey);
      renderThreadContent(note);
      animateThreadControl(`.thread-vote[data-note-id="${noteId}"][data-vote="${voteType}"]`,'interaction-pop');
      try{
        const result=await api.voteNote(noteId,voteType);
        Object.assign(note, result.note);
        note.userVote=result.userVote??result.note?.userVote??note.userVote;
        if(result.version)note._activityVersion=Math.max(Number(note._activityVersion)||0,Number(result.version)||0);
        renderThreadContent(note);

        toast(voteType==='up'?'已按讚':'已倒讚');
      }catch(err){
        console.error('投票失敗:',err);
        Object.assign(note,snapshot);
        renderThreadContent(note);
        toast('投票失敗');
      }finally{
        pendingEngagementActions.delete(actionKey);
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

      const reply=findReplyById(note.replies,btn.dataset.replyId);
      if(!reply)return;
      const actionKey=`reply-vote:${reply.id}`;
      if(pendingEngagementActions.has(actionKey))return;
      const snapshot=applyOptimisticVote(reply,btn.dataset.vote);
      pendingEngagementActions.add(actionKey);
      renderThreadContentWithReplyReorder(note);
      animateThreadControl(`.thread-reply-vote[data-reply-id="${reply.id}"][data-vote="${btn.dataset.vote}"]`,'interaction-pop');
      try{
        const result=await api.voteReply(note.id,btn.dataset.replyId,btn.dataset.vote);
        const currentReply=findReplyById(note.replies,reply.id)||reply;
        if(result.reply)Object.assign(currentReply,result.reply);
        currentReply.userVote=result.userVote??result.reply?.userVote??currentReply.userVote;
        if(result.version)note._activityVersion=Math.max(Number(note._activityVersion)||0,Number(result.version)||0);
        renderThreadContentWithReplyReorder(note);
      }catch(err){
        console.error('留言投票失敗:',err);
        Object.assign(findReplyById(note.replies,reply.id)||reply,snapshot);
        renderThreadContentWithReplyReorder(note);
        toast(err.message||'留言投票失敗');
      }finally{
        pendingEngagementActions.delete(actionKey);
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
      const actionKey=`favorite:${noteId}`;
      if(pendingEngagementActions.has(actionKey))return;
      const snapshot={favorite_count:Number(note.favorite_count)||0,isFavoritedByUser:Boolean(note.isFavoritedByUser)};
      note.isFavoritedByUser=!snapshot.isFavoritedByUser;
      note.favorite_count=Math.max(0,snapshot.favorite_count+(note.isFavoritedByUser?1:-1));
      pendingEngagementActions.add(actionKey);
      renderThreadContent(note);
      animateThreadControl(`.thread-favorite[data-note-id="${noteId}"]`,'interaction-settle');
      try{
        const result=await api.toggleFavorite(noteId);
        Object.assign(note, result.note);
        note.isFavoritedByUser=result.isFavorited??note.isFavoritedByUser;
        if(result.version)note._activityVersion=Math.max(Number(note._activityVersion)||0,Number(result.version)||0);
        favoritesFetchedAt=0;
        renderThreadContent(note);

        toast(result.isFavorited?'已收藏':'已取消收藏');
      }catch(err){
        console.error('收藏失敗:',err);
        Object.assign(note,snapshot);
        renderThreadContent(note);
        toast('收藏失敗');
      }finally{
        pendingEngagementActions.delete(actionKey);
      }
    };
  });
}

function closeThreadModal(){
  $('#thread-modal').hidden=true;
  $('#backdrop').hidden=true;
  clearTimeout(threadRefreshTimer);
  if(threadReplyRenderFrame)cancelAnimationFrame(threadReplyRenderFrame);
  if(threadNoteRenderFrame)cancelAnimationFrame(threadNoteRenderFrame);
  threadReplyRenderFrame=null;
  threadNoteRenderFrame=null;
  threadReplyRealtimeQueue.clear();
  threadNoteRealtimeQueue.clear();
  if(typeof realtimeClient!=='undefined'){
    [...threadRealtimeSubscriptionIds].forEach(id=>realtimeClient.unsubscribe(id).catch(()=>{}));
  }
  threadRealtimeSubscriptionIds.clear();
  threadRealtimeNoteId=null;
  window.threadData=null;
}

function annotationPreviewText(value,maxLength=50){
  const characters=Array.from(String(value||''));
  return characters.length>maxLength?characters.slice(0,maxLength).join('')+'...':characters.join('');
}
function showBubble(note){const tip=$('#bubble-tooltip');tip.innerHTML=`<strong>${esc(notePageName(note.doc))}</strong>${esc(annotationPreviewText(note.comment||'尚未填寫註解'))}`;tip.hidden=false;clearTimeout(showBubble.timer);showBubble.timer=setTimeout(hideBubble,5000);navigator.vibrate?.(25);}
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
  if(authManager?.isLoggedIn){
    const prefetch=()=>Promise.allSettled([loadFavoritesList(),loadNotificationsList()]);
    if('requestIdleCallback' in window)window.requestIdleCallback(prefetch,{timeout:1000});
    else setTimeout(prefetch,100);
  }
  
  // 顯示面板
  panel.hidden=false;
  $('#backdrop').hidden=false;
}
function renderNotes(){
  const box=$('#notes-list');
  const notes=personalNotesForCurrentViewer();
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
    
    if(edit){const note=personalNotesForCurrentViewer().find(n=>n.id===edit.dataset.edit);if(note)openAnnotationModal(note);}
    if(del){
      const note=personalNotesForCurrentViewer().find(n=>n.id===del.dataset.delete);
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
  const note=personalNoteCache.get(noteId)?.note
    ||Object.values(window.publicNotesByArticle||{}).flat().find(item=>item.id===noteId);
  const snapshot=note?applyOptimisticVote(note,voteType):null;
  toast(voteType==='up'?'已按讚':'已倒讚');
  try{
    const result=await api.voteNote(noteId,voteType);
    if(note){Object.assign(note,result.note);note.userVote=result.userVote??note.userVote;}
  }catch(err){
    console.error('投票失敗:',err);
    if(note&&snapshot)Object.assign(note,snapshot);
    toast('投票失敗');
  }
}

async function handleFavorite(noteId){
  if(typeof api==='undefined'||!authManager.isLoggedIn){
    toast('請先登入');
    return;
  }
  const note=personalNoteCache.get(noteId)?.note
    ||Object.values(window.publicNotesByArticle||{}).flat().find(item=>item.id===noteId);
  const snapshot=note?{favorite_count:Number(note.favorite_count)||0,isFavoritedByUser:Boolean(note.isFavoritedByUser)}:null;
  if(note){
    note.isFavoritedByUser=!snapshot.isFavoritedByUser;
    note.favorite_count=Math.max(0,snapshot.favorite_count+(note.isFavoritedByUser?1:-1));
  }
  toast(note?.isFavoritedByUser===false?'已取消收藏':'已收藏');
  try{
    const result=await api.toggleFavorite(noteId);
    if(note){Object.assign(note,result.note);note.isFavoritedByUser=result.isFavorited;}
    favoritesFetchedAt=0;
  }catch(err){
    console.error('收藏失敗:',err);
    if(note&&snapshot)Object.assign(note,snapshot);
    toast('收藏失敗');
  }
}
function notePageName(doc){if(doc.startsWith('gua-')){const x=state.hexagrams.find(g=>g.id===Number(doc.slice(4)));return x?`${x.name}卦`:'六十四卦';}return TEXTS.find(x=>`text-${x.id}`===doc)?.label||'原文';}
const NOTES_DB_NAME='iching-reader-local';
const NOTES_DB_STORE='annotations';
let indexedNotesWritePromise=Promise.resolve();

function loadNotes(){try{return (JSON.parse(localStorage.getItem('iching-highlights-v1'))||[]).map((n,i)=>({...n,id:n.id||`legacy-${i}-${n.createdAt||0}`,comment:n.comment||''}));}catch{return [];}}

function openNotesDatabase(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){resolve(null);return;}
    const request=indexedDB.open(NOTES_DB_NAME,1);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(NOTES_DB_STORE))request.result.createObjectStore(NOTES_DB_STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function writeNotesToIndexedDB(notes){
  const db=await openNotesDatabase();
  if(!db)return;
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction(NOTES_DB_STORE,'readwrite');
    transaction.objectStore(NOTES_DB_STORE).put(notes,'all');
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error);
  });
  db.close();
}

async function readNotesFromIndexedDB(){
  const db=await openNotesDatabase();
  if(!db)return [];
  const notes=await new Promise((resolve,reject)=>{
    const request=db.transaction(NOTES_DB_STORE,'readonly').objectStore(NOTES_DB_STORE).get('all');
    request.onsuccess=()=>resolve(Array.isArray(request.result)?request.result:[]);
    request.onerror=()=>reject(request.error);
  });
  db.close();
  return notes;
}

async function hydrateNotesFromIndexedDB(){
  const stored=await readNotesFromIndexedDB();
  if(!stored.length){
    if(state.notes.length)await writeNotesToIndexedDB(state.notes);
    return;
  }
  const known=new Set(state.notes.flatMap(note=>[note.id,note.serverId].filter(Boolean).map(String)));
  const missing=stored.filter(note=>![note.id,note.serverId].filter(Boolean).some(id=>known.has(String(id))));
  if(!missing.length)return;
  state.notes.push(...missing);
  localStorage.setItem('iching-highlights-v1',JSON.stringify(state.notes));
  applyHighlights({refreshPublic:false});
  if(!$('#notes-panel').hidden)renderNotes();
}

function saveNotes(){
  localStorage.setItem('iching-highlights-v1',JSON.stringify(state.notes));
  const snapshot=JSON.parse(JSON.stringify(state.notes));
  indexedNotesWritePromise=indexedNotesWritePromise
    .catch(()=>{})
    .then(()=>writeNotesToIndexedDB(snapshot))
    .catch(error=>console.warn('IndexedDB note save failed:',error));
}

async function clearIndexedNotes(){
  await indexedNotesWritePromise.catch(()=>{});
  const db=await openNotesDatabase();
  if(!db)return;
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction(NOTES_DB_STORE,'readwrite');
    transaction.objectStore(NOTES_DB_STORE).clear();
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error);
  });
  db.close();
}

queueMicrotask(()=>hydrateNotesFromIndexedDB().catch(error=>console.warn('IndexedDB note load failed:',error)));

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
  const saveToCloud=Boolean($('#settings-save-divinations')?.checked);
  state.divinations.push(record);
  saveDivinations();
  toast('占卜結果已儲存');
  closeDivinationResult();
  if(authManager.isLoggedIn&&saveToCloud){
    try{
      const response=await api.createDivination(
        record.result.originalHexagram.id,
        record.question,
        record.result
      );
      record.serverId=response.record.id;
      saveDivinations();
    }catch(error){
      console.warn('無法儲存占卜至雲端:',error);
      toast('已儲存在瀏覽器，雲端同步失敗');
    }
  }
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
      const previousQuestion=record.question;
      record.question=question;
      saveDivinations();
      renderDivinations();
      closeEditDivinationModal();
      toast('占卜紀錄已更新');
      try{
        await api.updateDivination(record.serverId,question,record.result);
      }catch(err){
        record.question=previousQuestion;
        saveDivinations();
        renderDivinations();
        toast(err.message||'更新占卜紀錄失敗');
      }
      return;
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
    loadUserStats();
  }
}

function loadUserStatsLegacy(){
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

async function loadUserStats(){
  const requestVersion=++statsRequestVersion;
  if(!authManager?.isLoggedIn){
    ['#stat-notes-count','#stat-upvotes','#stat-favorites'].forEach(selector=>{if($(selector))$(selector).textContent='0';});
    return;
  }
  try{
    const stats=await api.getStats();
    if(requestVersion!==statsRequestVersion||!authManager.isLoggedIn)return;
    if($('#stat-notes-count'))$('#stat-notes-count').textContent=String(stats.totalNotes||0);
    if($('#stat-upvotes'))$('#stat-upvotes').textContent=String(stats.totalUpvotes||0);
    if($('#stat-favorites'))$('#stat-favorites').textContent=String(stats.totalFavorites||0);
  }catch(error){
    console.warn('User stats refresh failed:',error);
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
        const next=parseInt(e.target.value,10);
        if(thresholdValueEl)thresholdValueEl.textContent=next+'%';
        currentNoteThresholdPercent=next;
        handleThresholdChange();
        queueThresholdSettingSave(e.target,thresholdValueEl,next);
      };
      thresholdEl.onchange=null;
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
            await clearLocalStorage();
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
async function clearLocalStorage(){
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
  await clearIndexedNotes();
  
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
  modal.querySelector('.confirm-action').onclick=async()=>{
    await clearLocalStorage();
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
    if(key==='noteVisibilityThresholdPercent')currentNoteThresholdPercent=Number(value);
    if(key==='allowPublicNotes'||key==='noteVisibilityThresholdPercent'){
      handleThresholdChange();
    }
    if(key==='saveNotesToCloud'&&value&&typeof syncCloudNotes==='function'){
      syncCloudNotes().then(result=>{
        if(!result?.changed)return;
        applyHighlights();
        if(!$('#notes-panel').hidden)renderNotes();
      }).catch(error=>console.warn('Cloud note sync failed:',error));
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
function renderFavoritesCache(){
  const favoritesList=$('#favorites-list');
  if(!favoritesList)return;
  if(!favoritesCache.length){
    favoritesList.innerHTML='<div style="padding:12px;text-align:center;color:#888">&#23578;&#28961;&#25910;&#34255;</div>';
    return;
  }
  favoritesList.innerHTML=favoritesCache.map(note=>`
      <div class="favorite-card" data-note-id="${esc(note.id)}" style="padding:12px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;cursor:pointer;transition:all 0.2s;background:#fff" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='none'" onclick="navigateToFavorite('${esc(note.id)}','${esc(note.article_id)}')">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <strong style="color:#333">${esc(threadAuthorDisplayName(note))}</strong><span class="thread-author-code">${esc(threadAuthorPublicCode(note))}</span>
            <span style="color:#999;font-size:0.85rem"> · ${new Date(note.created_at).toLocaleDateString('zh-TW')}</span>
          </div>
          <div style="text-align:right;font-size:0.85rem;color:#888">
            <div>💬 ${note.reply_count||0} 個回覆</div>
            <div>▲ ${note.upvote_count||0}</div>
          </div>
        </div>
        <p style="color:#333;line-height:1.5;margin:8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(note.content)}</p>
        <div style="font-size:0.85rem;color:#999">
          <span>分數: ${note.score||0}</span>
        </div>
      </div>
    `).join('');
  favoritesList.querySelectorAll('.favorite-card').forEach(card=>{
    const prefetch=()=>prefetchPersonalNote(card.dataset.noteId);
    card.addEventListener('pointerenter',prefetch,{once:true,passive:true});
    card.addEventListener('focusin',prefetch,{once:true});
  });
}

async function loadFavoritesList({force=false}={}){
  if(!authManager?.isLoggedIn){
    favoritesCache=[];
    favoritesFetchedAt=0;
    renderFavoritesCache();
    return;
  }
  if(favoritesCache.length)renderFavoritesCache();
  if(!force&&Date.now()-favoritesFetchedAt<PERSONAL_CONTENT_CACHE_TTL)return favoritesCache;
  if(favoritesLoadPromise)return favoritesLoadPromise;
  favoritesLoadPromise=api.getUserFavorites().then(response=>{
    favoritesCache=dedupeById(response?.notes||[]);
    favoritesFetchedAt=Date.now();
    favoritesCache.forEach(note=>personalNoteCache.set(note.id,{note,fetchedAt:favoritesFetchedAt}));
    renderFavoritesCache();
    return favoritesCache;
  }).catch(err=>{
    console.error('加載收藏列表失敗:',err);
    if(!favoritesCache.length)renderFavoritesCache();
    return favoritesCache;
  }).finally(()=>{favoritesLoadPromise=null;});
  return favoritesLoadPromise;
}

function articleHash(articleId=''){
  if(articleId.startsWith('gua-'))return `gua/${articleId.slice(4)}`;
  if(articleId.startsWith('text-'))return `text/${articleId.slice(5)}`;
  return articleId.replace(/^#/,'').replace('-', '/');
}

async function prefetchPersonalNote(noteId){
  if(!noteId)return null;
  const cached=personalNoteCache.get(noteId);
  if(cached?.promise)return cached.promise;
  if(cached&&Date.now()-cached.fetchedAt<PERSONAL_CONTENT_CACHE_TTL){
    queueThreadPrefetch([cached.note]);
    return cached.note;
  }
  const seeded=favoritesCache.find(note=>note.id===noteId);
  if(seeded){
    personalNoteCache.set(noteId,{note:seeded,fetchedAt:Date.now()});
    queueThreadPrefetch([seeded]);
    return seeded;
  }
  const request=api.getNote(noteId).then(response=>{
    const note=response?.note||response;
    if(note?.id){
      personalNoteCache.set(note.id,{note,fetchedAt:Date.now()});
      queueThreadPrefetch([note]);
    }
    return note;
  });
  personalNoteCache.set(noteId,{note:null,fetchedAt:0,promise:request});
  try{return await request;}finally{
    const entry=personalNoteCache.get(noteId);
    if(entry?.promise===request&&!entry.note)personalNoteCache.delete(noteId);
  }
}

async function navigateToPersonalNote(noteId,articleId=''){
  try{
    const note=await prefetchPersonalNote(noteId);
    if(!note||note.deleted_at)throw Object.assign(new Error('NOTE_NOT_FOUND'),{status:404});
    const targetArticle=note.article_id||articleId;
    window.publicNotesByArticle=window.publicNotesByArticle||{};
    const articleNotes=window.publicNotesByArticle[targetArticle]||[];
    if(!articleNotes.some(item=>item.id===note.id))articleNotes.push(note);
    window.publicNotesByArticle[targetArticle]=articleNotes;
    $('#notes-panel').hidden=true;
    window.location.hash=articleHash(targetArticle);
    openThreadModal([{note}]);
  }catch(err){
    console.error('載入相關註記失敗:',err);
    alert(err.status===404||err.message?.includes('404')?'抱歉，該內容已被刪除。':'無法載入該內容，請稍後重試。');
  }
}

function navigateToFavorite(noteId,articleId){
  navigateToPersonalNote(noteId,articleId);
}

// ===== 通知列表 =====
async function loadNotificationsListLegacy(){
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
              notif.type==='vote'?'▲ 有人讚了你的註記':
              notif.type==='favorite'?'✦ 有人收藏了你的註記':'新通知'
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

function notificationItemHTML(notif){
  const title=notif.type==='reply'?'有人回覆了你的註記':'系統通知';
  return `<div class="notification-item${notif._justInserted?' notification-item-enter':''}" data-notification-id="${esc(notif.id)}" data-note-id="${esc(notif.note_id||notif.target_id||'')}" style="padding:12px;border-bottom:1px solid #eee;cursor:pointer;background:${notif.read_at?'#fff':'#f9f9f9'}" onclick="navigateToNotification('${esc(notif.id)}','${esc(notif.note_id||notif.target_id||'')}')">
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px">
      <strong style="color:#333">${title}</strong>
      <span style="font-size:0.85rem;color:#999">${new Date(notif.created_at).toLocaleDateString('zh-TW')}</span>
    </div>
    <p style="color:#666;font-size:0.9rem;margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(notif.message||'')}</p>
    ${!notif.read_at?'<div style="font-size:0.8rem;color:#963b2e">尚未讀取</div>':''}
  </div>`;
}

function renderNotificationCache(){
  const list=$('#notifications-list');
  if(!list)return;
  list.innerHTML=notificationCache.length
    ? notificationCache.map(notificationItemHTML).join('')
    : '<div style="padding:12px;text-align:center;color:#888">尚無通知</div>';
  notificationCache.forEach(notification=>{notification._justInserted=false;});
  list.querySelectorAll('.notification-item').forEach(item=>{
    const prefetch=()=>prefetchPersonalNote(item.dataset.noteId);
    item.addEventListener('pointerenter',prefetch,{once:true,passive:true});
    item.addEventListener('focusin',prefetch,{once:true});
  });
}

async function loadNotificationsList(){
  const list=$('#notifications-list');
  if(!authManager?.isLoggedIn){
    notificationCache=[];
    notificationFetchedAt=0;
    renderNotificationCache();
    return;
  }
  if(notificationCache.length)renderNotificationCache();
  if(Date.now()-notificationFetchedAt<PERSONAL_CONTENT_CACHE_TTL)return notificationCache;
  if(notificationLoadPromise)return notificationLoadPromise;
  notificationLoadPromise=api.getNotifications().then(response=>{
    notificationCache=dedupeById(response?.notifications||[])
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    notificationFetchedAt=Date.now();
    renderNotificationCache();
    return notificationCache;
  }).catch(err=>{
    console.error('Notification refresh failed:',err);
    if(!notificationCache.length&&list)list.innerHTML='<div style="padding:12px;text-align:center;color:#888">尚無通知</div>';
    return notificationCache;
  }).finally(()=>{notificationLoadPromise=null;});
  return notificationLoadPromise;
}

function handleNotificationRealtimeUpdate(update){
  const changed=update?.data;
  if(!changed?.id)return;
  const queued=notificationRealtimeQueue.get(changed.id);
  if(!queued||!queued.commitTimestamp||!update.commitTimestamp||queued.commitTimestamp<=update.commitTimestamp){
    notificationRealtimeQueue.set(changed.id,update);
  }
  if(notificationRenderFrame)return;
  notificationRenderFrame=requestAnimationFrame(()=>{
    notificationRenderFrame=null;
    notificationRealtimeQueue.forEach(item=>{
      const index=notificationCache.findIndex(notification=>notification.id===item.data.id);
      const previousCommit=index>=0?notificationCache[index]._realtimeCommitTimestamp:null;
      if(previousCommit&&item.commitTimestamp&&previousCommit>item.commitTimestamp)return;
      if(item.event==='DELETE'){
        if(index>=0)notificationCache.splice(index,1);
      }else{
        const next={...item.data,_realtimeCommitTimestamp:item.commitTimestamp||previousCommit||null};
        if(index>=0)notificationCache[index]={...notificationCache[index],...next};
        else notificationCache.push({...next,_justInserted:true});
      }
    });
    notificationRealtimeQueue.clear();
    notificationFetchedAt=Date.now();
    notificationCache.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    renderNotificationCache();
  });
}

function navigateToNotification(notificationId,referenceId){
  const notification=notificationCache.find(item=>item.id===notificationId);
  if(notification&&!notification.read_at){
    notification.read_at=new Date().toISOString();
    renderNotificationCache();
  }
  api.markNotificationAsRead(notificationId).catch(()=>{
    notificationFetchedAt=0;
  });
  navigateToPersonalNote(referenceId);
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
