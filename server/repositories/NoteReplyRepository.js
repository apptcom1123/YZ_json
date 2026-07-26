import { BaseRepository } from './BaseRepository.js';

export class NoteReplyRepository extends BaseRepository {
  constructor(db) {
    super(db, 'note_replies');
  }

  /**
   * 在註記上添加回覆
   */
  async addReply(noteId, authorId, content, parentReplyId = null) {
    const query = `
      INSERT INTO note_replies (note_id, parent_reply_id, author_id, content, status)
      VALUES (?, ?, ?, ?, 'active')
    `;

    await this.db.run(query, [noteId, parentReplyId, authorId, content]);

    // 更新註記的回覆計數
    await this.updateNoteReplyCount(noteId);

    // 如果有父回覆，更新其計數
    if (parentReplyId) {
      await this.updateReplyCount(parentReplyId);
    }

    // 獲取最新插入的回覆
    const newReply = await this.db.get(`
      SELECT * FROM note_replies 
      WHERE note_id = ? AND author_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `, [noteId, authorId]);

    return newReply?.id;
  }

  /**
   * 獲取註記的所有回覆（包含子回覆）
   */
  async getNoteReplies(noteId, includeDeleted = false) {
    let query = `
      SELECT nr.*, u.public_display_name
      FROM note_replies nr
      LEFT JOIN users u ON nr.author_id = u.id
      WHERE nr.note_id = ?
    `;
    const params = [noteId];

    if (!includeDeleted) {
      query += ` AND nr.status = 'active'`;
    }

    query += ` ORDER BY nr.created_at ASC`;

    const replies = await this.db.all(query, params);

    // 構建樹狀結構
    return this.buildReplyTree(replies);
  }

  /**
   * 構建回覆樹狀結構
   */
  buildReplyTree(replies) {
    const replyMap = {};
    const roots = [];

    // 第一遍 - 建立映射
    for (const reply of replies) {
      replyMap[reply.id] = { ...reply, children: [] };
    }

    // 第二遍 - 構建樹
    for (const reply of replies) {
      if (reply.parent_reply_id && replyMap[reply.parent_reply_id]) {
        replyMap[reply.parent_reply_id].children.push(replyMap[reply.id]);
      } else {
        roots.push(replyMap[reply.id]);
      }
    }

    return roots;
  }

  /**
   * 編輯回覆
   */
  async updateReply(replyId, userId, content) {
    // 驗證所有者
    const reply = await this.findById(replyId);
    if (reply.author_id !== userId) {
      throw new Error('NOT_REPLY_OWNER');
    }

    const query = `
      UPDATE note_replies
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [content, replyId]);
    return this.findById(replyId);
  }

  /**
   * 刪除回覆（軟刪除）
   */
  async deleteReply(replyId, userId) {
    const reply = await this.findById(replyId);
    if (reply.author_id !== userId) {
      throw new Error('NOT_REPLY_OWNER');
    }

    const query = `
      UPDATE note_replies
      SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [replyId]);

    // 更新註記的回覆計數
    await this.updateNoteReplyCount(reply.note_id);
  }

  /**
   * 為回覆投票
   */
  async voteReply(replyId, userId, voteType) {
    const query = `
      INSERT OR REPLACE INTO note_votes (note_id, user_id, vote_type)
      VALUES ((SELECT note_id FROM note_replies WHERE id = ?), ?, ?)
    `;

    if (voteType === 'none') {
      const deleteQuery = `
        DELETE FROM note_votes 
        WHERE note_id = (SELECT note_id FROM note_replies WHERE id = ?)
          AND user_id = ?
      `;
      await this.db.run(deleteQuery, [replyId, userId]);
    } else {
      await this.db.run(query, [replyId, userId, voteType]);
    }

    // 重新計算回覆的分數
    await this.updateReplyScore(replyId);
  }

  /**
   * 重新計算回覆分數
   */
  async updateReplyScore(replyId) {
    // 注：在實現中，我們將投票存在 note_votes 上
    // 這裡簡化版本，實際應該有單獨的 reply_votes 表
    const query = `
      UPDATE note_replies
      SET upvote_count = ?, downvote_count = ?
      WHERE id = ?
    `;

    // 暫時不實現詳細計算，留作 TODO
    await this.db.run(query, [0, 0, replyId]);
  }

  /**
   * 更新註記的回覆計數
   */
  async updateNoteReplyCount(noteId) {
    const count = await this.db.get(`
      SELECT COUNT(*) as total 
      FROM note_replies 
      WHERE note_id = ? AND status = 'active'
    `, [noteId]);

    const query = `
      UPDATE notes SET reply_count = ? WHERE id = ?
    `;

    await this.db.run(query, [count.total || 0, noteId]);
  }

  /**
   * 更新回覆計數（遞歸計算子回覆）
   */
  async updateReplyCount(replyId) {
    const count = await this.db.get(`
      SELECT COUNT(*) as total 
      FROM note_replies 
      WHERE parent_reply_id = ? AND status = 'active'
    `, [replyId]);

    // 回覆本身不需要回覆計數
    // 這個方法預留作未來擴展
  }

  /**
   * 獲取用戶的所有回覆
   */
  async getUserReplies(userId) {
    const query = `
      SELECT nr.*, n.article_id, n.paragraph_anchor
      FROM note_replies nr
      JOIN notes n ON nr.note_id = n.id
      WHERE nr.author_id = ? AND nr.status = 'active'
      ORDER BY nr.created_at DESC
    `;

    return this.db.all(query, [userId]);
  }

  /**
   * 獲取收到的回覆（有人回覆我的註記）
   */
  async getRepliesReceivedByUser(userId) {
    const query = `
      SELECT nr.*, n.author_id as note_author_id, u.public_display_name
      FROM note_replies nr
      JOIN notes n ON nr.note_id = n.id
      LEFT JOIN users u ON nr.author_id = u.id
      WHERE n.author_id = ? 
        AND nr.author_id != ?
        AND nr.status = 'active'
      ORDER BY nr.created_at DESC
    `;

    return this.db.all(query, [userId, userId]);
  }
}
