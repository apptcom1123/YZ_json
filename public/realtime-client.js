class RealtimeClient {
  constructor() {
    this.client = null;
    this.isEnabled = false;
    this.isInitialized = false;
    this.subscriptions = new Map();
    this.registrations = new Map();
    this.updateHandlers = new Map();
    this.statuses = new Map();
    this.retryAttempts = new Map();
    this.retryTimers = new Map();
  }

  initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    const connect = () => {
      const wasEnabled = this.isEnabled;
      this.client = typeof authManager !== 'undefined' ? authManager.client : null;
      this.isEnabled = Boolean(this.client?.channel);
      if (this.isEnabled) this.activateAll();
      if (!wasEnabled && this.isEnabled) {
        window.dispatchEvent(new Event('supabase-realtime-ready'));
      }
    };
    connect();
    if (typeof authManager !== 'undefined') authManager.onAuthChange(connect);
    window.addEventListener('online', () => this.reconcileConnection());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.reconcileConnection();
    });
  }

  normalizePayload(payload) {
    return {
      event: payload.eventType,
      data: payload.new || payload.old,
      commitTimestamp: payload.commit_timestamp || null
    };
  }

  register(id, channelFactory) {
    this.registrations.set(id, channelFactory);
    this.activate(id);
    return id;
  }

  dispatchUpdate(id, payload) {
    const handler = this.updateHandlers.get(id);
    if (handler) handler(this.normalizePayload(payload));
  }

  activateAll() {
    for (const id of this.registrations.keys()) this.activate(id);
  }

  activate(id) {
    if (!this.isEnabled || this.subscriptions.has(id)) return;
    const channelFactory = this.registrations.get(id);
    if (!channelFactory) return;
    const channel = channelFactory(this.client);
    this.subscriptions.set(id, channel);
    channel.subscribe(status => this.setStatus(id, status));
  }

  subscribeToNotes(articleId, onUpdate) {
    const id = `notes:${articleId}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notes', filter: `article_id=eq.${articleId}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  subscribeToReplies(noteId, onUpdate) {
    const id = `replies:${noteId}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'note_replies', filter: `note_id=eq.${noteId}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  subscribeToVotes(noteId, onUpdate) {
    return this.subscribeToRelatedTable('votes', 'note_votes', 'note_id', noteId, onUpdate);
  }

  subscribeToFavorites(noteId, onUpdate) {
    return this.subscribeToRelatedTable('favorites', 'note_favorites', 'note_id', noteId, onUpdate);
  }

  subscribeToReplyVotes(replyId, onUpdate) {
    return this.subscribeToRelatedTable('reply-votes', 'reply_votes', 'reply_id', replyId, onUpdate);
  }

  subscribeToRelatedTable(type, table, column, value, onUpdate) {
    const id = `${type}:${value}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table, filter: `${column}=eq.${value}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  subscribeToNoteChanges(type, noteId, onUpdate) {
    const id = `${type}:${noteId}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notes', filter: `id=eq.${noteId}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  subscribeToNoteActivity(noteId, onUpdate) {
    const id = `activity:${noteId}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(`note:${noteId}:activity`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'realtime_note_events', filter: `note_id=eq.${noteId}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  subscribeToNotifications(userId, onUpdate) {
    return this.subscribeToUserTable('notifications', 'notifications', userId, onUpdate);
  }

  subscribeToDivinations(userId, onUpdate) {
    return this.subscribeToUserTable('divinations', 'divination_records', userId, onUpdate);
  }

  subscribeToUserTable(type, table, userId, onUpdate) {
    const id = `${type}:${userId}`;
    this.updateHandlers.set(id, onUpdate);
    return this.register(id, client => client
      .channel(`user:${userId}:${type === 'notifications' ? 'notifications' : 'sync'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table, filter: `user_id=eq.${userId}`
      }, payload => this.dispatchUpdate(id, payload)));
  }

  setStatus(id, status) {
    if (!this.registrations.has(id)) return;
    this.statuses.set(id, status);
    if (status === 'SUBSCRIBED') {
      this.retryAttempts.delete(id);
      this.clearRetry(id);
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
      this.scheduleRetry(id);
    }
    window.dispatchEvent(new CustomEvent('supabase-realtime-status', { detail: { id, status } }));
  }

  scheduleRetry(id, immediate = false) {
    if (!this.registrations.has(id) || this.retryTimers.has(id)) return;
    const attempt = this.retryAttempts.get(id) || 0;
    const delay = immediate ? 0 : Math.min(30000, 1000 * (2 ** attempt));
    this.retryAttempts.set(id, attempt + 1);
    this.retryTimers.set(id, window.setTimeout(() => {
      this.retryTimers.delete(id);
      this.replaceChannel(id);
    }, delay));
  }

  async replaceChannel(id) {
    const channel = this.subscriptions.get(id);
    this.subscriptions.delete(id);
    if (channel && this.client?.removeChannel) {
      try { await this.client.removeChannel(channel); } catch (_) { /* Retry below. */ }
    }
    if (this.registrations.has(id) && this.isEnabled) this.activate(id);
  }

  reconcileConnection() {
    if (!this.isEnabled) return;
    for (const id of this.registrations.keys()) {
      if (this.statuses.get(id) !== 'SUBSCRIBED') this.scheduleRetry(id, true);
    }
    window.dispatchEvent(new Event('supabase-realtime-reconcile'));
  }

  clearRetry(id) {
    const timer = this.retryTimers.get(id);
    if (timer) window.clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  async unsubscribe(id) {
    this.registrations.delete(id);
    this.updateHandlers.delete(id);
    this.clearRetry(id);
    this.retryAttempts.delete(id);
    this.statuses.delete(id);
    const channel = this.subscriptions.get(id);
    this.subscriptions.delete(id);
    if (channel && this.client?.removeChannel) await this.client.removeChannel(channel);
  }

  getStatus(id) {
    return this.statuses.get(id) || (this.registrations.has(id) ? 'PENDING' : 'NOT_SUBSCRIBED');
  }

  async unsubscribeAll() {
    await Promise.all([...this.registrations.keys()].map(id => this.unsubscribe(id)));
  }
}

const realtimeClient = new RealtimeClient();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => realtimeClient.initialize());
} else {
  realtimeClient.initialize();
}
