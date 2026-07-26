import { BaseRepository } from './BaseRepository.js';
import crypto from 'crypto';

export class NoteRepository extends BaseRepository {
  constructor(db) {
    super(db, 'notes');
  }

  /**
   * 為文章與段落創建註記
   */
  async createNote(noteData) {
    const {
      authorId,
      articleType,
      articleId,
      paragraphAnchor,
      anchorOffsetStart,
      anchorOffsetEnd,
      content,
      visibility = 'private',
      localUuid = null
    } = noteData;

    // 計算 cluster_key
    const clusterKey = Math.floor(anchorOffsetStart / 5);

    // 生成公開別名
    let publicAlias = null;
    if (visibility === 'public') {
      publicAlias = this.generatePublicAlias(authorId, articleId);
    }

    const query = `
      INSERT INTO notes (
        author_id, article_type, article_id, paragraph_anchor,
        anchor_offset_start, anchor_offset_end, cluster_key,
        content, visibility, public_alias, local_uuid, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `;

    const result = await this.db.run(query, [
      authorId, articleType, articleId, paragraphAnchor,
      anchorOffsetStart, anchorOffsetEnd, clusterKey,
      content, visibility, publicAlias, localUuid
    ]);

    return result.lastID || noteData.id;
  }

  /**
   * 獲取文章特定段落的公開註記（帶聚合）
   */
  async getPublicNotesForParagraph(articleId, paragraphAnchor, thresholdPercent = 60) {
    const query = `
      SELECT n.*, u.public_display_name
      FROM notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.article_id = ?
        AND n.paragraph_anchor = ?
        AND n.visibility = 'public'
        AND n.status = 'active'
      ORDER BY n.cluster_key ASC, n.score DESC, n.created_at DESC
    `;

    return this.db.all(query, [articleId, paragraphAnchor]);
  }

  /**
   * 獲取用戶的私人註記
   */
  async getUserPrivateNotes(userId, articleId = null) {
    let query = `
      SELECT n.*
      FROM notes n
      WHERE n.author_id = ?
        AND n.visibility = 'private'
        AND n.status = 'active'
    `;
    const params = [userId];

    if (articleId) {
      query += ` AND n.article_id = ?`;
      params.push(articleId);
    }

    query += ` ORDER BY n.created_at DESC`;

    return this.db.all(query, params);
  }

  /**
   * 計算聚合泡泡（每 5 字視窗）
   */
  async getClusterSummary(articleId, paragraphAnchor, thresholdPercent = 60) {
    const query = `
      SELECT 
        n.cluster_key,
        COUNT(*) as total_count,
        SUM(CASE WHEN n.score > 0 THEN 1 ELSE 0 END) as qualifying_count,
        MAX(n.score) as top_score,
        GROUP_CONCAT(n.id, ',') as note_ids
      FROM notes n
      WHERE n.article_id = ?
        AND n.paragraph_anchor = ?
        AND n.visibility = 'public'
        AND n.status = 'active'
      GROUP BY n.cluster_key
    `;

    const clusters = await this.db.all(query, [articleId, paragraphAnchor]);

    return clusters.map(cluster => {
      const keepCount = Math.ceil((cluster.total_count * thresholdPercent) / 100);
      return {
        clusterKey: cluster.cluster_key,
        totalCount: cluster.total_count,
        qualifyingCount: cluster.qualifying_count,
        topScore: cluster.top_score,
        keepCount: keepCount,
        showBubble: cluster.total_count >= 2,
        noteIds: cluster.note_ids.split(',')
      };
    });
  }

  /**
   * 切換註記可見性
   */
  async toggleVisibility(noteId, userId, newVisibility) {
    // 驗證所有者
    const note = await this.findById(noteId);
    if (note.author_id !== userId) {
      throw new Error('NOT_NOTE_OWNER');
    }

    let publicAlias = null;
    if (newVisibility === 'public') {
      publicAlias = this.generatePublicAlias(userId, note.article_id);
    }

    const query = `
      UPDATE notes
      SET visibility = ?, public_alias = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [newVisibility, publicAlias, noteId]);
    return this.findById(noteId);
  }

  /**
   * 刪除註記（軟刪除）
   */
  async deleteNote(noteId, userId) {
    const note = await this.findById(noteId);
    if (note.author_id !== userId) {
      throw new Error('NOT_NOTE_OWNER');
    }

    const query = `
      UPDATE notes
      SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [noteId]);
  }

  /**
   * 投票（上 / 下 / 取消）
   */
  async vote(noteId, userId, voteType) {
    // 檢查是否已投票
    const existing = await this.db.get(`
      SELECT * FROM note_votes WHERE note_id = ? AND user_id = ?
    `, [noteId, userId]);

    if (voteType === 'none') {
      // 取消投票
      if (existing) {
        await this.db.run(`
          DELETE FROM note_votes WHERE note_id = ? AND user_id = ?
        `, [noteId, userId]);
      }
    } else {
      if (existing) {
        // 更新投票
        if (existing.vote_type === voteType) {
          // 同方向重複點擊 = 取消
          await this.db.run(`
            DELETE FROM note_votes WHERE note_id = ? AND user_id = ?
          `, [noteId, userId]);
        } else {
          // 改變投票方向
          await this.db.run(`
            UPDATE note_votes SET vote_type = ? WHERE note_id = ? AND user_id = ?
          `, [voteType, noteId, userId]);
        }
      } else {
        // 新投票
        await this.db.run(`
          INSERT INTO note_votes (note_id, user_id, vote_type)
          VALUES (?, ?, ?)
        `, [noteId, userId, voteType]);
      }
    }

    // 重新計算分數
    await this.updateNoteScore(noteId);
  }

  /**
   * 收藏/取消收藏
   */
  async toggleFavorite(noteId, userId) {
    const existing = await this.db.get(`
      SELECT * FROM note_favorites WHERE note_id = ? AND user_id = ?
    `, [noteId, userId]);

    if (existing) {
      await this.db.run(`
        DELETE FROM note_favorites WHERE note_id = ? AND user_id = ?
      `, [noteId, userId]);
    } else {
      await this.db.run(`
        INSERT INTO note_favorites (note_id, user_id)
        VALUES (?, ?)
      `, [noteId, userId]);
    }

    // 更新收藏計數
    await this.updateNoteFavoriteCount(noteId);
  }

  /**
   * 重新計算註記分數
   */
  async updateNoteScore(noteId) {
    const stats = await this.db.get(`
      SELECT 
        COUNT(CASE WHEN vote_type = 'up' THEN 1 END) as upvotes,
        COUNT(CASE WHEN vote_type = 'down' THEN 1 END) as downvotes
      FROM note_votes
      WHERE note_id = ?
    `, [noteId]);

    const score = (stats.upvotes || 0) - (stats.downvotes || 0);

    const query = `
      UPDATE notes
      SET upvote_count = ?, downvote_count = ?, score = ?
      WHERE id = ?
    `;

    await this.db.run(query, [stats.upvotes || 0, stats.downvotes || 0, score, noteId]);
  }

  /**
   * 更新收藏計數
   */
  async updateNoteFavoriteCount(noteId) {
    const count = await this.db.get(`
      SELECT COUNT(*) as total FROM note_favorites WHERE note_id = ?
    `, [noteId]);

    const query = `
      UPDATE notes SET favorite_count = ? WHERE id = ?
    `;

    await this.db.run(query, [count.total || 0, noteId]);
  }

  /**
   * 取得用戶對特定註記的投票
   */
  async getUserVote(noteId, userId) {
    const query = `
      SELECT vote_type FROM note_votes WHERE note_id = ? AND user_id = ?
    `;
    return this.db.get(query, [noteId, userId]);
  }

  /**
   * 檢查用戶是否收藏了該註記
   */
  async isFavoritedBy(noteId, userId) {
    const query = `
      SELECT 1 FROM note_favorites WHERE note_id = ? AND user_id = ?
    `;
    return this.db.get(query, [noteId, userId]) != null;
  }

  /**
   * 生成匿名代碼（同一用戶在同一文章內保持一致）
   */
  generatePublicAlias(userId, articleId) {
    // 基於 userId 和 articleId 生成一致的匿名代碼
    const hash = crypto.createHash('md5')
      .update(`${userId}:${articleId}`)
      .digest('hex')
      .substring(0, 4)
      .toUpperCase();
    return `匿名使用者 ${hash}`;
  }

  /**
   * 獲取用戶收藏的所有註記
   */
  async getUserFavorites(userId) {
    const query = `
      SELECT n.*
      FROM notes n
      JOIN note_favorites nf ON n.id = nf.note_id
      WHERE nf.user_id = ?
      ORDER BY nf.created_at DESC
    `;
    return this.db.all(query, [userId]);
  }
}
