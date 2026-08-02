import { BaseRepository } from './BaseRepository.js';
import crypto from 'crypto';

export class NoteRepository extends BaseRepository {
  constructor(db) {
    super(db, 'notes');
  }

  applyVisibilityThreshold(notes, thresholdPercent = 50) {
    const percent = Math.min(100, Math.max(0, Number(thresholdPercent) || 0));
    const clusters = new Map();
    for (const note of notes || []) {
      const key = `${note.paragraph_anchor}:${note.cluster_key}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(note);
    }

    const visible = [];
    for (const cluster of clusters.values()) {
      cluster.sort((a, b) =>
        (b.score || 0) - (a.score || 0)
        || (b.upvote_count || 0) - (a.upvote_count || 0)
        || new Date(b.created_at) - new Date(a.created_at));
      visible.push(...cluster.slice(0, Math.ceil(cluster.length * percent / 100)));
    }
    return visible;
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

    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('notes')
        .insert({
          author_id: authorId,
          article_type: articleType,
          article_id: articleId,
          paragraph_anchor: paragraphAnchor,
          anchor_offset_start: anchorOffsetStart,
          anchor_offset_end: anchorOffsetEnd,
          cluster_key: clusterKey,
          content,
          visibility,
          public_alias: publicAlias,
          local_uuid: localUuid,
          status: 'active'
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
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
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('notes')
        .select('*, users!notes_author_id_fkey(public_display_name)')
        .eq('article_id', articleId)
        .eq('paragraph_anchor', paragraphAnchor)
        .eq('visibility', 'public')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('cluster_key', { ascending: true })
        .order('score', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return this.applyVisibilityThreshold((data || []).map(note => ({
        ...note,
        public_display_name: note.users?.public_display_name
      })), thresholdPercent);
    }

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

    return this.applyVisibilityThreshold(await this.db.all(query, [articleId, paragraphAnchor]), thresholdPercent);
  }

  /**
   * 獲取用戶的私人註記
   */
  async getUserPrivateNotes(userId, articleId = null) {
    if (this.isSupabase) {
      let query = this.db
        .from('notes')
        .select('*')
        .eq('author_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (articleId) query = query.eq('article_id', articleId);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    let query = `
      SELECT n.*
      FROM notes n
      WHERE n.author_id = ?
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

  async getPublicNotesForArticle(articleId, thresholdPercent = 50) {
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('notes')
        .select('*, users!notes_author_id_fkey(public_display_name)')
        .eq('article_id', articleId)
        .eq('visibility', 'public')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('cluster_key', { ascending: true })
        .order('score', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return this.applyVisibilityThreshold((data || []).map(note => ({
        ...note,
        public_display_name: note.users?.public_display_name
      })), thresholdPercent);
    }

    return this.applyVisibilityThreshold(await this.db.all(`
      SELECT n.*, u.public_display_name
      FROM notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.article_id = ?
        AND n.visibility = 'public'
        AND n.status = 'active'
      ORDER BY n.cluster_key ASC, n.score DESC, n.created_at DESC
    `, [articleId]), thresholdPercent);
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

    if (this.isSupabase) {
      const { error } = await this.db
        .from('notes')
        .update({
          visibility: newVisibility,
          public_alias: publicAlias,
          updated_at: new Date().toISOString()
        })
        .eq('id', noteId)
        .eq('author_id', userId);
      if (error) throw error;
      return this.findById(noteId);
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

    if (this.isSupabase) {
      const { error } = await this.db
        .from('notes')
        .update({
          status: 'deleted',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', noteId)
        .eq('author_id', userId);
      if (error) throw error;
      return;
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
    if (this.isSupabase) {
      const { data: existing, error: findError } = await this.db
        .from('note_votes')
        .select('*')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (findError) throw findError;

      if (voteType === 'none' || existing?.vote_type === voteType) {
        if (existing) {
          const { error } = await this.db
            .from('note_votes')
            .delete()
            .eq('note_id', noteId)
            .eq('user_id', userId);
          if (error) throw error;
        }
      } else if (existing) {
        const { error } = await this.db
          .from('note_votes')
          .update({ vote_type: voteType, updated_at: new Date().toISOString() })
          .eq('note_id', noteId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await this.db
          .from('note_votes')
          .insert({ note_id: noteId, user_id: userId, vote_type: voteType });
        if (error) throw error;
      }

      await this.updateNoteScore(noteId);
      return;
    }

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
    if (this.isSupabase) {
      const { data: existing, error: findError } = await this.db
        .from('note_favorites')
        .select('*')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (findError) throw findError;

      if (existing) {
        const { error } = await this.db
          .from('note_favorites')
          .delete()
          .eq('note_id', noteId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await this.db
          .from('note_favorites')
          .insert({ note_id: noteId, user_id: userId });
        if (error) throw error;
      }

      await this.updateNoteFavoriteCount(noteId);
      return;
    }

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
    if (this.isSupabase) {
      const { data: votes, error: voteError } = await this.db
        .from('note_votes')
        .select('vote_type')
        .eq('note_id', noteId);
      if (voteError) throw voteError;

      const upvotes = (votes || []).filter(v => v.vote_type === 'up').length;
      const downvotes = (votes || []).filter(v => v.vote_type === 'down').length;
      const { error } = await this.db
        .from('notes')
        .update({ upvote_count: upvotes, downvote_count: downvotes, score: upvotes - downvotes })
        .eq('id', noteId);
      if (error) throw error;
      return;
    }

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
    if (this.isSupabase) {
      const { count, error: countError } = await this.db
        .from('note_favorites')
        .select('*', { count: 'exact', head: true })
        .eq('note_id', noteId);
      if (countError) throw countError;

      const { error } = await this.db
        .from('notes')
        .update({ favorite_count: count || 0 })
        .eq('id', noteId);
      if (error) throw error;
      return;
    }

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
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('note_votes')
        .select('vote_type')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }

    const query = `
      SELECT vote_type FROM note_votes WHERE note_id = ? AND user_id = ?
    `;
    return this.db.get(query, [noteId, userId]);
  }

  /**
   * 檢查用戶是否收藏了該註記
   */
  async isFavoritedBy(noteId, userId) {
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('note_favorites')
        .select('note_id')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data != null;
    }

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
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('note_favorites')
        .select('notes(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(item => item.notes).filter(Boolean);
    }

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
