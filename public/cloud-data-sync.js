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
    updatedAt: note.updated_at
  };
}

async function syncCloudNotes() {
  if (!authManager.isLoggedIn) return;
  const settingsResponse = await api.getUserSettings();
  const savePrivateNotes = Boolean(settingsResponse.settings?.saveNotesToCloud);

  for (const note of state.notes) {
    if (!canAccessLocalNote(note)) continue;
    if (note.serverId || (!savePrivateNotes && note.visibility !== 'public')) continue;
    const response = await api.createNote({
      articleType: note.doc?.startsWith('gua-') ? 'iching' : 'md',
      articleId: note.doc,
      paragraphAnchor: String(note.start || 0),
      anchorOffsetStart: note.start || 0,
      anchorOffsetEnd: note.end || 0,
      content: note.comment,
      visibility: note.visibility || 'private',
      localUuid: note.id
    });
    note.serverId = response.note.id;
  }

  const response = await api.getMyNotes();
  const localByKey = new Map(state.notes.map(note => [note.serverId || note.id, note]));
  for (const remoteNote of response.notes || []) {
    const key = remoteNote.local_uuid || remoteNote.id;
    if (!localByKey.has(key)) state.notes.push(toLocalCloudNote(remoteNote));
  }
  saveNotes();
  applyHighlights();
  if (!document.getElementById('notes-panel').hidden) renderNotes();
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

authManager.onAuthChange(({ isLoggedIn }) => {
  if (!isLoggedIn) return;
  const userId = authManager.getCurrentUser()?.id;
  if (!userId || typeof realtimeClient === 'undefined') return;
  realtimeClient.subscribeToNotifications(userId, () => loadNotificationsList());
  realtimeClient.subscribeToDivinations(userId, () => syncCloudDivinations());
});
