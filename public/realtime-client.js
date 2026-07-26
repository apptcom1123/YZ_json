/**
 * Realtime 客戶端
 * 前端 Supabase Realtime 訂閱管理
 */

class RealtimeClient {
  constructor() {
    this.isEnabled = false;
    this.subscriptions = new Map();
    this.supabaseUrl = null;
    this.supabaseKey = null;
    this.client = null;
  }

  /**
   * 初始化 Realtime 客戶端
   */
  async initialize() {
    try {
      // 從伺服器獲取配置和狀態
      const response = await fetch('/api/health');
      const data = await response.json();

      if (data.features?.realtime?.connected) {
        this.isEnabled = true;
        console.log('✓ Realtime 已啟用');
        
        // 動態導入 Supabase 客戶端（如果已在全局加載）
        if (typeof window.supabase !== 'undefined') {
          this.client = window.supabase;
        }
      } else {
        console.log('⚠️  Realtime 未啟用');
      }
    } catch (error) {
      console.warn('無法初始化 Realtime:', error);
      this.isEnabled = false;
    }
  }

  /**
   * 訂閱注記更新
   */
  subscribeToNotes(articleId, paragraphAnchor, onUpdate) {
    if (!this.isEnabled) {
      console.warn('Realtime 未啟用，使用 polling');
      return null;
    }

    const subscriptionId = `notes:${articleId}:${paragraphAnchor}`;

    // 設置 polling 作為備用方案
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.getNotes(articleId, paragraphAnchor);
        onUpdate({
          event: 'REALTIME_UPDATE',
          data: response
        });
      } catch (error) {
        console.error('Polling 失敗:', error);
      }
    }, 5000); // 每 5 秒檢查一次

    this.subscriptions.set(subscriptionId, {
      type: 'poll',
      interval: pollInterval
    });

    return subscriptionId;
  }

  /**
   * 訂閱回覆更新
   */
  subscribeToReplies(noteId, onUpdate) {
    if (!this.isEnabled) {
      console.warn('Realtime 未啟用，使用 polling');
      return null;
    }

    const subscriptionId = `replies:${noteId}`;

    // 設置 polling 作為備用方案
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.getNoteReplies(noteId);
        onUpdate({
          event: 'REALTIME_UPDATE',
          data: response
        });
      } catch (error) {
        console.error('Polling 失敗:', error);
      }
    }, 5000); // 每 5 秒檢查一次

    this.subscriptions.set(subscriptionId, {
      type: 'poll',
      interval: pollInterval
    });

    return subscriptionId;
  }

  /**
   * 訂閱投票更新
   */
  subscribeToVotes(noteId, onUpdate) {
    if (!this.isEnabled) {
      return null;
    }

    const subscriptionId = `votes:${noteId}`;

    // 設置 polling 作為備用方案
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.getNote(noteId);
        onUpdate({
          event: 'REALTIME_UPDATE',
          data: {
            upvote_count: response.upvote_count,
            downvote_count: response.downvote_count,
            favorite_count: response.favorite_count
          }
        });
      } catch (error) {
        console.error('投票 Polling 失敗:', error);
      }
    }, 5000); // 每 5 秒檢查一次

    this.subscriptions.set(subscriptionId, {
      type: 'poll',
      interval: pollInterval
    });

    return subscriptionId;
  }

  /**
   * 訂閱收藏更新
   */
  subscribeToFavorites(noteId, onUpdate) {
    if (!this.isEnabled) {
      return null;
    }

    const subscriptionId = `favorites:${noteId}`;

    // 設置 polling 作為備用方案
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.getNote(noteId);
        onUpdate({
          event: 'REALTIME_UPDATE',
          data: {
            favorite_count: response.favorite_count
          }
        });
      } catch (error) {
        console.error('收藏 Polling 失敗:', error);
      }
    }, 5000); // 每 5 秒檢查一次

    this.subscriptions.set(subscriptionId, {
      type: 'poll',
      interval: pollInterval
    });

    return subscriptionId;
  }

  /**
   * 取消訂閱
   */
  unsubscribe(subscriptionId) {
    if (this.subscriptions.has(subscriptionId)) {
      const subscription = this.subscriptions.get(subscriptionId);
      
      if (subscription.type === 'poll') {
        clearInterval(subscription.interval);
      }

      this.subscriptions.delete(subscriptionId);
      console.log(`✓ 已取消訂閱: ${subscriptionId}`);
    }
  }

  /**
   * 取消所有訂閱
   */
  unsubscribeAll() {
    for (const [subscriptionId] of this.subscriptions) {
      this.unsubscribe(subscriptionId);
    }
  }

  /**
   * 獲取訂閱狀態
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      subscriptionCount: this.subscriptions.size,
      subscriptions: Array.from(this.subscriptions.keys())
    };
  }
}

// 全局實例
const realtimeClient = new RealtimeClient();

// 自動初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    realtimeClient.initialize();
  });
} else {
  realtimeClient.initialize();
}
