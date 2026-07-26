import { BaseRepository } from './BaseRepository.js';

export class NotificationRepository extends BaseRepository {
  constructor(db) {
    super(db, 'notifications');
  }

  /**
   * 創建回覆通知
   */
  async createReplyNotification(userId, replyId, actorUserId, noteId, deepLink) {
    const note = await this.db.get(`
      SELECT article_id, paragraph_anchor FROM notes WHERE id = ?
    `, [noteId]);

    const query = `
      INSERT INTO notifications (
        user_id, type, actor_user_id, target_type, target_id,
        note_id, reply_id, article_id, paragraph_anchor, deep_link, message
      ) VALUES (?, 'reply', ?, 'reply', ?, ?, ?, ?, ?, ?, ?)
    `;

    const actor = await this.db.get(`
      SELECT public_display_name FROM users WHERE id = ?
    `, [actorUserId]);

    const message = `${actor?.public_display_name || '使用者'} 回覆了你的註記`;

    const result = await this.db.run(query, [
      userId,
      actorUserId,
      replyId,
      noteId,
      replyId,
      note?.article_id,
      note?.paragraph_anchor,
      deepLink,
      message
    ]);

    // 更新用戶統計
    await this.updateUnreadCount(userId);

    return result.lastID || result;
  }

  /**
   * 創建系統通知
   */
  async createSystemNotification(userId, message, deepLink = null) {
    const query = `
      INSERT INTO notifications (
        user_id, type, target_type, message, deep_link
      ) VALUES (?, 'system', 'system', ?, ?)
    `;

    return this.db.run(query, [userId, message, deepLink]);
  }

  /**
   * 獲取用戶的未讀通知
   */
  async getUnreadNotifications(userId) {
    const query = `
      SELECT * FROM notifications
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC
    `;

    return this.db.all(query, [userId]);
  }

  /**
   * 獲取用戶的所有通知
   */
  async getUserNotifications(userId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    return this.db.all(query, [userId, limit, offset]);
  }

  /**
   * 標記通知為已讀
   */
  async markAsRead(notificationId) {
    const query = `
      UPDATE notifications
      SET is_read = 1, read_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [notificationId]);
  }

  /**
   * 標記所有通知為已讀
   */
  async markAllAsRead(userId) {
    const query = `
      UPDATE notifications
      SET is_read = 1, read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND is_read = 0
    `;

    await this.db.run(query, [userId]);
  }

  /**
   * 刪除通知
   */
  async deleteNotification(notificationId) {
    const query = `DELETE FROM notifications WHERE id = ?`;
    await this.db.run(query, [notificationId]);
  }

  /**
   * 標記指向的目標為已刪除
   */
  async markTargetAsDeleted(targetType, targetId) {
    let query = '';

    if (targetType === 'note') {
      query = `
        UPDATE notifications
        SET target_deleted = 1
        WHERE note_id = ?
      `;
    } else if (targetType === 'reply') {
      query = `
        UPDATE notifications
        SET target_deleted = 1
        WHERE reply_id = ?
      `;
    }

    if (query) {
      await this.db.run(query, [targetId]);
    }
  }

  /**
   * 更新用戶未讀通知計數
   */
  async updateUnreadCount(userId) {
    const count = await this.db.get(`
      SELECT COUNT(*) as total FROM notifications
      WHERE user_id = ? AND is_read = 0
    `, [userId]);

    const query = `
      UPDATE user_stats
      SET unread_notifications_count = ?
      WHERE user_id = ?
    `;

    await this.db.run(query, [count.total || 0, userId]);
  }

  /**
   * 獲取用戶的通知摘要
   */
  async getNotificationSummary(userId) {
    const query = `
      SELECT 
        COUNT(*) as total_notifications,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
        SUM(CASE WHEN type = 'reply' THEN 1 ELSE 0 END) as reply_count
      FROM notifications
      WHERE user_id = ?
    `;

    return this.db.get(query, [userId]);
  }

  /**
   * 檢查用戶是否應該接收回覆通知
   */
  async shouldNotifyUser(userId) {
    const settings = await this.db.get(`
      SELECT notify_on_reply FROM user_settings WHERE user_id = ?
    `, [userId]);

    return settings?.notify_on_reply === 1;
  }

  /**
   * 清除已刪除的通知
   */
  async cleanupDeletedTargetNotifications() {
    // 找到指向已刪除註記或回覆的通知
    const query = `
      UPDATE notifications
      SET target_deleted = 1
      WHERE (
        (note_id IS NOT NULL AND note_id NOT IN (
          SELECT id FROM notes WHERE deleted_at IS NULL
        ))
        OR (reply_id IS NOT NULL AND reply_id NOT IN (
          SELECT id FROM note_replies WHERE status = 'active'
        ))
      )
    `;

    await this.db.run(query);
  }

  /**
   * 獲取特定回覆的回覆計數（用於顯示統計）
   */
  async getReplyStats(userId) {
    const query = `
      SELECT 
        COUNT(*) as total_replies_received,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_replies
      FROM notifications
      WHERE user_id = ? AND type = 'reply'
    `;

    return this.db.get(query, [userId]);
  }
}
