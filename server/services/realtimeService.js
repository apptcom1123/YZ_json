/**
 * Supabase Realtime 服務
 * 提供實時數據同步功能
 */

import { createClient } from '@supabase/supabase-js';

class RealtimeService {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.client = null;
    this.subscriptions = new Map();
    this.isConnected = false;

    // 如果提供了有效的憑據，初始化客戶端
    if (supabaseUrl && supabaseKey) {
      this.initialize();
    }
  }

  /**
   * 初始化 Supabase 客戶端
   */
  initialize() {
    try {
      this.client = createClient(this.supabaseUrl, this.supabaseKey);
      this.isConnected = true;
      console.log('✓ Supabase Realtime 已連接');
    } catch (error) {
      console.error('✗ Supabase 初始化失敗:', error.message);
      this.isConnected = false;
    }
  }

  /**
   * 訂閱注記更新
   * 監聽特定文章的注記變化
   */
  subscribeToNotes(articleId, paragraphAnchor, onUpdate) {
    if (!this.client || !this.isConnected) {
      console.warn('Supabase Realtime 未連接');
      return null;
    }

    const channelName = `notes:${articleId}:${paragraphAnchor}`;
    
    try {
      const channel = this.client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notes',
            filter: `article_id=eq.${articleId}` // 過濾特定文章
          },
          (payload) => {
            // 檢查段落錨點是否匹配
            if (payload.new && payload.new.paragraph_anchor === paragraphAnchor) {
              onUpdate({
                event: payload.eventType,
                data: payload.new || payload.old,
                oldData: payload.old
              });
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`✓ 已訂閱注記更新: ${channelName}`);
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`✗ 注記訂閱錯誤: ${channelName}`);
          }
        });

      this.subscriptions.set(channelName, channel);
      return channelName;
    } catch (error) {
      console.error('訂閱注記失敗:', error);
      return null;
    }
  }

  /**
   * 訂閱回覆更新
   * 監聽特定注記的回覆變化
   */
  subscribeToReplies(noteId, onUpdate) {
    if (!this.client || !this.isConnected) {
      console.warn('Supabase Realtime 未連接');
      return null;
    }

    const channelName = `replies:${noteId}`;
    
    try {
      const channel = this.client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'note_replies',
            filter: `note_id=eq.${noteId}`
          },
          (payload) => {
            onUpdate({
              event: payload.eventType,
              data: payload.new || payload.old,
              oldData: payload.old
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`✓ 已訂閱回覆更新: ${channelName}`);
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`✗ 回覆訂閱錯誤: ${channelName}`);
          }
        });

      this.subscriptions.set(channelName, channel);
      return channelName;
    } catch (error) {
      console.error('訂閱回覆失敗:', error);
      return null;
    }
  }

  /**
   * 訂閱投票更新
   * 監聽特定注記的投票變化
   */
  subscribeToVotes(noteId, onUpdate) {
    if (!this.client || !this.isConnected) {
      console.warn('Supabase Realtime 未連接');
      return null;
    }

    const channelName = `votes:${noteId}`;
    
    try {
      const channel = this.client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'note_votes',
            filter: `note_id=eq.${noteId}`
          },
          (payload) => {
            onUpdate({
              event: payload.eventType,
              data: payload.new || payload.old
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`✓ 已訂閱投票更新: ${channelName}`);
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`✗ 投票訂閱錯誤: ${channelName}`);
          }
        });

      this.subscriptions.set(channelName, channel);
      return channelName;
    } catch (error) {
      console.error('訂閱投票失敗:', error);
      return null;
    }
  }

  /**
   * 取消訂閱
   */
  unsubscribe(channelName) {
    if (this.subscriptions.has(channelName)) {
      try {
        const channel = this.subscriptions.get(channelName);
        this.client.removeChannel(channel);
        this.subscriptions.delete(channelName);
        console.log(`✓ 已取消訂閱: ${channelName}`);
      } catch (error) {
        console.error('取消訂閱失敗:', error);
      }
    }
  }

  /**
   * 取消所有訂閱
   */
  unsubscribeAll() {
    for (const [channelName] of this.subscriptions) {
      this.unsubscribe(channelName);
    }
  }

  /**
   * 廣播消息（用於通知客戶端）
   */
  broadcast(channelName, event, payload) {
    if (!this.client || !this.isConnected) {
      console.warn('Supabase Realtime 未連接');
      return false;
    }

    try {
      this.client.channel(channelName).send({
        type: 'broadcast',
        event: event,
        payload: payload
      });
      return true;
    } catch (error) {
      console.error('廣播失敗:', error);
      return false;
    }
  }

  /**
   * 獲取連接狀態
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      subscriptionCount: this.subscriptions.size,
      subscriptions: Array.from(this.subscriptions.keys())
    };
  }
}

// 單例實例
let realtimeService = null;

/**
 * 獲取或創建 Realtime 服務實例
 */
export function getRealtimeService(supabaseUrl, supabaseKey) {
  if (!realtimeService) {
    realtimeService = new RealtimeService(supabaseUrl, supabaseKey);
  }
  return realtimeService;
}

export default RealtimeService;
