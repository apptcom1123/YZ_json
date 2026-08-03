function toLocalCloudNote(note) {
  return {
    id: note.local_uuid || note.id,
    serverId: note.id,
    doc: note.article_id,
    start: note.anchor_offset_start,
    end: note.anchor_offset_end,
    text: '',
    comment: note.content,
    visibility: note.visibility,
    ownerId: note.author_id,
    updatedAt: note.updated_at,
    serverVersion: note.updated_at,
    syncStatus: 'synced'
  };
}

function indexLocalCloudNotes() {
  const index = new Map();
  for (const note of state.notes) {
    if (note.id) index.set(String(note.id), note);
    if (note.serverId) index.set(String(note.serverId), note);
  }
  return index;
}

function mergeOwnCloudNotes(remoteNotes) {
  const userId=authManager.getCurrentUser()?.id;
  if(!userId)return false;
  let changed=false;
  const localByKey=indexLocalCloudNotes();
  for(const remoteNote of remoteNotes||[]){
    if(remoteNote.author_id!==userId){
      console.warn('Ignored a cloud note that did not belong to the authenticated user.');
      continue;
    }
    const local=localByKey.get(String(remoteNote.local_uuid||''))||localByKey.get(String(remoteNote.id));
    if(!local){
      const normalized=toLocalCloudNote(remoteNote);
      state.notes.push(normalized);
      localByKey.set(String(normalized.id),normalized);
      localByKey.set(String(normalized.serverId),normalized);
      changed=true;
      continue;
    }
    const wasChanged=local.serverId!==remoteNote.id||
      local.ownerId!==userId||
      local.syncStatus!=='synced'||
      (!['pending','error','offline'].includes(local.syncStatus)&&local.updatedAt!==remoteNote.updated_at);
    local.serverId=remoteNote.id;
    local.ownerId=userId;
    const hasUnsyncedLocalChanges=['pending','error','offline'].includes(local.syncStatus);
    if(!hasUnsyncedLocalChanges){
      local.comment=remoteNote.content;
      local.visibility=remoteNote.visibility;
      local.updatedAt=remoteNote.updated_at;
      local.syncStatus='synced';
    }
    local.serverVersion=remoteNote.updated_at;
    changed=changed||wasChanged;
  }
  return changed;
}

async function syncCloudNote(note) {
  if (!authManager.isLoggedIn || !canAccessLocalNote(note)) return null;
  note.syncStatus = 'pending';
  saveNotes();
  try {
    const response = note.serverId
      ? await api.updateNote(note.serverId, {
          content: note.comment,
          visibility: note.visibility || 'private'
        })
      : await api.createNote({
          articleType: note.doc?.startsWith('gua-') ? 'iching' : 'md',
          articleId: note.doc,
          paragraphAnchor: String(note.start || 0),
          anchorOffsetStart: note.start || 0,
          anchorOffsetEnd: note.end || 0,
          content: note.comment,
          visibility: note.visibility || 'private',
          localUuid: note.id
        });
    const remote = response.note || response;
    if (remote?.id) note.serverId = remote.id;
    note.ownerId = remote?.author_id || authManager.getCurrentUser()?.id || note.ownerId || null;
    note.updatedAt = remote?.updated_at || new Date().toISOString();
    note.serverVersion = note.updatedAt;
    note.syncStatus = 'synced';
    saveNotes();
    return remote;
  } catch (error) {
    note.syncStatus = navigator.onLine ? 'error' : 'offline';
    saveNotes();
    throw error;
  }
}

async function performCloudNotesSync() {
  if (!authManager.isLoggedIn) return { changed: false };
  const settingsResponse = await api.getUserSettings();
  const savePrivateNotes = Boolean(settingsResponse.settings?.saveNotesToCloud);
  let changed = false;
  const pending = state.notes.filter(note =>
    canAccessLocalNote(note) &&
    !note.serverId &&
    (note.visibility === 'public' || savePrivateNotes)
  );
  const uploadResults = await Promise.allSettled(pending.map(note => syncCloudNote(note)));
  if (uploadResults.some(result => result.status === 'fulfilled')) changed = pending.length > 0;

  const response = await api.getMyNotes();
  changed=mergeOwnCloudNotes(response.notes)||changed;
  saveNotes();
  return { changed };
}

let cloudNotesSyncPromise = null;
function syncCloudNotes() {
  if (cloudNotesSyncPromise) return cloudNotesSyncPromise;
  cloudNotesSyncPromise = performCloudNotesSync().finally(() => {
    cloudNotesSyncPromise = null;
  });
  return cloudNotesSyncPromise;
}

let ownCloudNotesRefreshPromise=null;
function refreshOwnCloudNotes(){
  if(!authManager.isLoggedIn)return Promise.resolve({changed:false});
  if(ownCloudNotesRefreshPromise)return ownCloudNotesRefreshPromise;
  const requestedUserId=authManager.getCurrentUser()?.id;
  ownCloudNotesRefreshPromise=api.getMyNotes().then(response=>{
    if(!authManager.isLoggedIn||authManager.getCurrentUser()?.id!==requestedUserId)return {changed:false};
    const changed=mergeOwnCloudNotes(response.notes);
    if(changed)saveNotes();
    renderNotes();
    return {changed};
  }).finally(()=>{ownCloudNotesRefreshPromise=null;});
  return ownCloudNotesRefreshPromise;
}

function toLocalCloudDivination(record) {
  return {
    serverId: record.id,
    question: record.question_text || '',
    result: record.result_payload,
    timestamp: new Date(record.created_at).getTime(),
    ownerId: record.user_id || authManager.getCurrentUser()?.id || null
  };
}

async function syncCloudDivinations() {
  if (!authManager.isLoggedIn) return;
  const settingsResponse = await api.getUserSettings();
  if (!settingsResponse.settings?.saveDivinationToCloud) return;

  const response = await api.getDivinations();
  const remoteRecords = response.records || [];
  const remoteIds = new Set(remoteRecords.map(record => record.id));
  const localByServerId = new Map(state.divinations.filter(item => item.serverId).map(item => [item.serverId, item]));
  state.divinations = state.divinations.filter(item => !item.serverId || remoteIds.has(item.serverId));
  for (const remoteRecord of remoteRecords) {
    const localRecord = localByServerId.get(remoteRecord.id);
    const normalized = toLocalCloudDivination(remoteRecord);
    if (localRecord) Object.assign(localRecord, normalized);
    else state.divinations.push(normalized);
  }
  saveDivinations();
  if (!document.getElementById('notes-panel').hidden) renderDivinations();
}

function handlePrivateNoteRealtimeUpdate(update) {
  const remote = update?.data;
  const userId=authManager.getCurrentUser()?.id;
  if (!remote?.id || !userId || remote.author_id!==userId) return;
  const localIndex = indexLocalCloudNotes();
  const local = localIndex.get(String(remote.local_uuid || '')) || localIndex.get(String(remote.id));
  if (local?._realtimeCommitTimestamp && update.commitTimestamp &&
      local._realtimeCommitTimestamp > update.commitTimestamp) return;
  if (update.event === 'DELETE' || remote.status !== 'active' || remote.deleted_at) {
    if (local) state.notes = state.notes.filter(note => note !== local);
  } else if (local) {
    local.serverId = remote.id;
    local.ownerId = remote.author_id;
    local.serverVersion = remote.updated_at;
    local._realtimeCommitTimestamp = update.commitTimestamp || null;
    if (!['pending', 'error', 'offline'].includes(local.syncStatus)) {
      local.comment = remote.content;
      local.visibility = remote.visibility;
      local.updatedAt = remote.updated_at;
      local.syncStatus = 'synced';
    }
  } else {
    const normalized = toLocalCloudNote(remote);
    normalized._realtimeCommitTimestamp = update.commitTimestamp || null;
    state.notes.push(normalized);
  }
  saveNotes();
  const currentArticleId = document.querySelector('.annotatable')?.dataset.doc;
  const changedArticleId = remote.article_id;
  if (currentArticleId && currentArticleId === changedArticleId) applyHighlights({ refreshPublic: false });
  if (!document.getElementById('notes-panel').hidden) renderNotes();
}

let realtimeAccountUserId = null;

function syncAccountRealtimeSubscriptions() {
  const userId = authManager.isLoggedIn ? authManager.getCurrentUser()?.id : null;
  if (realtimeAccountUserId && realtimeAccountUserId !== userId && typeof realtimeClient !== 'undefined') {
    realtimeClient.unsubscribe(`notifications:${realtimeAccountUserId}`).catch(() => {});
    realtimeClient.unsubscribe(`divinations:${realtimeAccountUserId}`).catch(() => {});
    realtimeClient.unsubscribe(`private-notes:${realtimeAccountUserId}`).catch(() => {});
    realtimeAccountUserId = null;
  }
  if (!userId || typeof realtimeClient === 'undefined' || !realtimeClient.isEnabled) return;
  realtimeAccountUserId = userId;
  realtimeClient.subscribeToNotifications(userId, update => {
    if (typeof handleNotificationRealtimeUpdate === 'function') handleNotificationRealtimeUpdate(update);
    else loadNotificationsList();
  });
  realtimeClient.subscribeToPrivateNotes(userId, handlePrivateNoteRealtimeUpdate);
  realtimeClient.subscribeToDivinations(userId, () => syncCloudDivinations());
}

authManager.onAuthChange(syncAccountRealtimeSubscriptions);
window.addEventListener('supabase-realtime-ready', syncAccountRealtimeSubscriptions);
syncAccountRealtimeSubscriptions();
