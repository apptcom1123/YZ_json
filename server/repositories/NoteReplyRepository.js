import { BaseRepository } from './BaseRepository.js';

export class NoteReplyRepository extends BaseRepository {
  constructor(db) {
    super(db, 'note_replies');
  }

  /**
   * 在註記上添加回覆
   */
  addReplyAtomic(noteId,authorId,content,parentReplyId=null,clientMutationId=null){
    return this.callOptionalRpc('create_note_reply_tx',{
      p_note_id:noteId,
      p_user_id:authorId,
      p_content:content,
      p_parent_reply_id:parentReplyId,
      p_client_request_id:clientMutationId
    });
  }

  async addReply(noteId, authorId, content, parentReplyId = null, clientMutationId = null) {
    if (this.isSupabase) {
      let useClientMutationId = Boolean(clientMutationId);
      const insertData = {
        note_id: noteId,
        parent_reply_id: parentReplyId,
        author_id: authorId,
        content,
        status: 'active'
      };
      if (useClientMutationId) insertData.client_mutation_id = clientMutationId;
      let {data,error}=await this.db
        .from('note_replies')
        .insert(insertData)
        .select('id')
        .single();
      if(error&&useClientMutationId&&(error.code==='PGRST204'||error.code==='42703'||error.message?.includes('client_mutation_id'))){
        delete insertData.client_mutation_id;
        ({data,error}=await this.db.from('note_replies').insert(insertData).select('id').single());
        useClientMutationId=false;
      }
      if (error?.code === '23505' && useClientMutationId) {
        const { data: existing, error: existingError } = await this.db
          .from('note_replies')
          .select('id')
          .eq('note_id', noteId)
          .eq('author_id', authorId)
          .eq('client_mutation_id', clientMutationId)
          .single();
        if (existingError) throw existingError;
        return existing.id;
      }
      if (error) throw error;

      await this.updateNoteReplyCount(noteId);
      if (parentReplyId) await this.updateReplyCount(parentReplyId);
      return data.id;
    }

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
    if (this.isSupabase) {
      let query = this.db
        .from('note_replies')
        .select('*')
        .eq('note_id', noteId)
        .order('upvote_count', { ascending: false })
        .order('created_at', { ascending: false });

      if (!includeDeleted) query = query.eq('status', 'active');

      const { data, error } = await query;
      if (error) throw error;

      const replies=data||[];
      const authorIds=[...new Set(replies.map(reply=>reply.author_id).filter(Boolean))];
      let displayNames=new Map();
      if(authorIds.length){
        const {data:users,error:usersError}=await this.db
          .from('users')
          .select('id,display_name,public_display_name')
          .in('id',authorIds);
        if(usersError)console.warn('Reply author lookup failed:',usersError.message);
        else displayNames=new Map((users||[]).map(user=>[user.id,user.public_display_name||user.display_name]));
      }
      return this.buildReplyTree(replies.map(reply=>({
        ...reply,
        public_display_name:displayNames.get(reply.author_id)||null
      })));
    }

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

  async getUserVotesForReplies(replyIds,userId){
    const ids=[...new Set(replyIds||[])];
    if(!ids.length)return new Map();
    if(this.isSupabase){
      const {data,error}=await this.db
        .from('reply_votes')
        .select('reply_id,vote_type')
        .eq('user_id',userId)
        .in('reply_id',ids);
      if(error)throw error;
      return new Map((data||[]).map(row=>[row.reply_id,row.vote_type]));
    }
    return new Map();
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

    if (this.isSupabase) {
      const { error } = await this.db
        .from('note_replies')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', replyId)
        .eq('author_id', userId);
      if (error) throw error;
      return this.findById(replyId);
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

    if (this.isSupabase) {
      const { error } = await this.db
        .from('note_replies')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', replyId)
        .eq('author_id', userId);
      if (error) throw error;
      await this.updateNoteReplyCount(reply.note_id);
      return;
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
  voteReplyAtomic(noteId,replyId,userId,voteType){
    return this.callOptionalRpc('toggle_reply_vote_tx',{
      p_note_id:noteId,p_reply_id:replyId,p_user_id:userId,p_vote_type:voteType
    });
  }

  async voteReply(replyId, userId, voteType) {
    if (this.isSupabase) {
      const { data: existing, error: findError } = await this.db
        .from('reply_votes')
        .select('vote_type')
        .eq('reply_id', replyId)
        .eq('user_id', userId)
        .maybeSingle();
      if (findError) throw findError;

      let userVote=voteType;
      if (voteType === 'none' || existing?.vote_type === voteType) {
        userVote=null;
        if (existing) {
          const { error } = await this.db
            .from('reply_votes')
            .delete()
            .eq('reply_id', replyId)
            .eq('user_id', userId);
          if (error) throw error;
        }
      } else if (existing) {
        const { error } = await this.db
          .from('reply_votes')
          .update({ vote_type: voteType, updated_at: new Date().toISOString() })
          .eq('reply_id', replyId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await this.db
          .from('reply_votes')
          .insert({ reply_id: replyId, user_id: userId, vote_type: voteType });
        if (error) throw error;
      }

      return {...(await this.updateReplyScore(replyId)),userVote};
    }

    const query = `
      INSERT OR REPLACE INTO note_votes (note_id, user_id, vote_type)
      VALUES ((SELECT note_id FROM note_replies WHERE id = ?), ?, ?)
    `;

    let userVote=voteType;
    if (voteType === 'none') {
      userVote=null;
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
    return {...(await this.updateReplyScore(replyId)),userVote};
  }

  /**
   * 重新計算回覆分數
   */
  async updateReplyScore(replyId) {
    if (this.isSupabase) {
      const [upvoteResult,downvoteResult]=await Promise.all([
        this.db.from('reply_votes').select('*',{count:'exact',head:true}).eq('reply_id',replyId).eq('vote_type','up'),
        this.db.from('reply_votes').select('*',{count:'exact',head:true}).eq('reply_id',replyId).eq('vote_type','down')
      ]);
      if(upvoteResult.error)throw upvoteResult.error;
      if(downvoteResult.error)throw downvoteResult.error;
      const upvoteCount=upvoteResult.count||0;
      const downvoteCount=downvoteResult.count||0;

      const { error } = await this.db
        .from('note_replies')
        .update({
          upvote_count: upvoteCount || 0,
          downvote_count: downvoteCount || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', replyId);
      if (error) throw error;
      return {upvote_count:upvoteCount,downvote_count:downvoteCount};
    }

    // 注：在實現中，我們將投票存在 note_votes 上
    // 這裡簡化版本，實際應該有單獨的 reply_votes 表
    const query = `
      UPDATE note_replies
      SET upvote_count = ?, downvote_count = ?
      WHERE id = ?
    `;

    // 暫時不實現詳細計算，留作 TODO
    await this.db.run(query, [0, 0, replyId]);
    return {upvote_count:0,downvote_count:0};
  }

  /**
   * 更新註記的回覆計數
   */
  async updateNoteReplyCount(noteId) {
    if (this.isSupabase) {
      const { count, error: countError } = await this.db
        .from('note_replies')
        .select('*', { count: 'exact', head: true })
        .eq('note_id', noteId)
        .eq('status', 'active');
      if (countError) throw countError;

      const { error } = await this.db
        .from('notes')
        .update({ reply_count: count || 0 })
        .eq('id', noteId);
      if (error) throw error;
      return;
    }

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
    if (this.isSupabase) {
      return;
    }

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
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('note_replies')
        .select('*, notes(article_id, paragraph_anchor)')
        .eq('author_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(reply => ({
        ...reply,
        article_id: reply.notes?.article_id,
        paragraph_anchor: reply.notes?.paragraph_anchor
      }));
    }

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
    if (this.isSupabase) {
      const { data: notes, error: notesError } = await this.db
        .from('notes')
        .select('id')
        .eq('author_id', userId);
      if (notesError) throw notesError;

      const noteIds = (notes || []).map(note => note.id);
      if (noteIds.length === 0) return [];

      const { data, error } = await this.db
        .from('note_replies')
        .select('*, users(public_display_name), notes(author_id)')
        .in('note_id', noteIds)
        .neq('author_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) throw error;

      return (data || []).map(reply => ({
        ...reply,
        note_author_id: reply.notes?.author_id,
        public_display_name: reply.users?.public_display_name
      }));
    }

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
