class RealtimeClient {
  constructor() {
    this.client = null;
    this.isEnabled = false;
    this.subscriptions = new Map();
  }

  initialize() {
    const connect = () => {
      const wasEnabled = this.isEnabled;
      this.client = typeof authManager !== 'undefined' ? authManager.client : null;
      this.isEnabled = Boolean(this.client?.channel);
      if (!wasEnabled && this.isEnabled) window.dispatchEvent(new Event('supabase-realtime-ready'));
    };
    connect();
    if (typeof authManager !== 'undefined') authManager.onAuthChange(connect);
  }

  subscribeToNotes(articleId, onUpdate) {
    const id = `notes:${articleId}`;
    if (!this.isEnabled || this.subscriptions.has(id)) return id;
    const channel = this.client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notes', filter: `article_id=eq.${articleId}`
      }, payload => onUpdate({ event: payload.eventType, data: payload.new || payload.old }))
      .subscribe();
    this.subscriptions.set(id, channel);
    return id;
  }

  subscribeToReplies(noteId, onUpdate) {
    const id = `replies:${noteId}`;
    if (!this.isEnabled || this.subscriptions.has(id)) return id;
    const channel = this.client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'note_replies', filter: `note_id=eq.${noteId}`
      }, onUpdate)
      .subscribe();
    this.subscriptions.set(id, channel);
    return id;
  }

  subscribeToVotes(noteId, onUpdate) {
    return this.subscribeToNoteChanges('votes', noteId, onUpdate);
  }

  subscribeToFavorites(noteId, onUpdate) {
    return this.subscribeToNoteChanges('favorites', noteId, onUpdate);
  }

  subscribeToNoteChanges(type, noteId, onUpdate) {
    const id = `${type}:${noteId}`;
    if (!this.isEnabled || this.subscriptions.has(id)) return id;
    const channel = this.client
      .channel(id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notes', filter: `id=eq.${noteId}`
      }, payload => onUpdate({ event: payload.eventType, data: payload.new }))
      .subscribe();
    this.subscriptions.set(id, channel);
    return id;
  }

  subscribeToNotifications(userId, onUpdate) {
    return this.subscribeToUserTable('notifications', 'notifications', userId, onUpdate);
  }

  subscribeToDivinations(userId, onUpdate) {
    return this.subscribeToUserTable('divinations', 'divination_records', userId, onUpdate);
  }

  subscribeToUserTable(type, table, userId, onUpdate) {
    const id = `${type}:${userId}`;
    if (!this.isEnabled || this.subscriptions.has(id)) return id;
    const channel = this.client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table, filter: `user_id=eq.${userId}`
      }, payload => onUpdate({ event: payload.eventType, data: payload.new || payload.old }))
      .subscribe();
    this.subscriptions.set(id, channel);
    return id;
  }

  async unsubscribe(id) {
    const channel = this.subscriptions.get(id);
    if (!channel) return;
    await this.client.removeChannel(channel);
    this.subscriptions.delete(id);
  }

  async unsubscribeAll() {
    await Promise.all([...this.subscriptions.keys()].map(id => this.unsubscribe(id)));
  }
}

const realtimeClient = new RealtimeClient();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => realtimeClient.initialize());
} else {
  realtimeClient.initialize();
}
