/**
 * 註記 API 路由
 */

import express from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

const router = express.Router();

function canReadNote(note, userId = null) {
  return Boolean(note
    && note.status === 'active'
    && !note.deleted_at
    && (note.visibility === 'public' || note.author_id === userId));
}

/**
 * GET /api/notes?article_id=&paragraph_anchor=&cluster_key=&threshold_percent=
 * 獲取公開註記（可選過濾）
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { articleId, paragraphAnchor, clusterKey, thresholdPercent = 50 } = req.query;

    if (!articleId) {
      return res.status(400).json({
        error: 'MISSING_PARAMS',
        message: '必須提供 articleId 和 paragraphAnchor'
      });
    }

    const { note: noteRepo } = req.app.locals.repositories;

    // 獲取公開註記
    let notes = paragraphAnchor === undefined
      ? await noteRepo.getPublicNotesForArticle(articleId, thresholdPercent)
      : await noteRepo.getPublicNotesForParagraph(articleId, paragraphAnchor, thresholdPercent);

    // 為每條註記添加當前用戶的投票和收藏狀態
    if (req.user) {
      const engagement=await noteRepo.getUserEngagementForNotes(notes.map(note=>note.id),req.user.userId);
      notes=notes.map(note=>({...note,...engagement.get(note.id)}));
    }

    res.json({
      notes,
      pagination: {
        total: notes.length,
        limit: 50
      }
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({
      error: 'FETCH_NOTES_FAILED',
      message: '無法獲取註記'
    });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const userId=req.user?.userId;
    if(!userId)return res.status(401).json({error:'IDENTITY_VERIFICATION_FAILED',message:'身分驗證失敗：請重新登入。'});
    const notes = await req.app.locals.repositories.note.getUserPrivateNotes(userId);
    res.set('Cache-Control','private, no-store');
    res.set('Vary','Authorization');
    res.json({notes:notes.filter(note=>note.author_id===userId)});
  } catch (error) {
    console.error('Get own notes error:', error);
    res.status(500).json({ error: 'FETCH_OWN_NOTES_FAILED' });
  }
});

/**
 * POST /api/notes
 * 創建新註記
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      articleType,
      articleId,
      paragraphAnchor,
      anchorOffsetStart,
      anchorOffsetEnd,
      content,
      visibility = 'private',
      localUuid = null
    } = req.body;

    // 驗證必填字段
    const required = ['articleType', 'articleId', 'paragraphAnchor', 'anchorOffsetStart', 'anchorOffsetEnd', 'content'];
    for (const field of required) {
      if (req.body[field] === undefined) {
        return res.status(400).json({
          error: 'MISSING_FIELD',
          message: `缺少必填字段: ${field}`
        });
      }
    }

    const { note: noteRepo, user: userRepo } = req.app.locals.repositories;

    // 公開註記才需要額外檢查公開權限；私人註記直接寫入。
    let settings=null;
    if(visibility==='public'&&userRepo.isSupabase){
      const { data, error } = await userRepo.db
        .from('user_settings')
        .select('allow_public_notes')
        .eq('user_id', req.user.userId)
        .maybeSingle();
      if (error) throw error;
      settings = data;
    }else if(visibility==='public'){
      settings = await userRepo.db.get(`
        SELECT allow_public_notes FROM user_settings WHERE user_id = ?
      `, [req.user.userId]);
    }

    if (visibility === 'public' && !(settings?.allow_public_notes === true || settings?.allow_public_notes === 1)) {
      return res.status(403).json({
        error: 'PUBLIC_NOTES_DISABLED',
        message: '您未啟用公開註記功能'
      });
    }

    // 創建註記
    const note = await noteRepo.createNote({
      authorId: req.user.userId,
      articleType,
      articleId,
      paragraphAnchor,
      anchorOffsetStart,
      anchorOffsetEnd,
      content,
      visibility,
      localUuid
    });

    res.status(201).json({
      success: true,
      note
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({
      error: 'CREATE_NOTE_FAILED',
      message: '無法創建註記'
    });
  }
});

/**
 * GET /api/notes/:id
 * 獲取單一註記
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const {note:noteRepo}=req.app.locals.repositories;
    const note=await noteRepo.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        error: 'NOTE_NOT_FOUND',
        message: '註記不存在'
      });
    }

    // 檢查權限
    if (note.visibility === 'private' && note.author_id !== req.user?.userId) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非註記持有者本人'
      });
    }

    if (req.user) {
      const [userVote,isFavorited]=await Promise.all([
        noteRepo.getUserVote(note.id,req.user.userId),
        noteRepo.isFavoritedBy(note.id,req.user.userId)
      ]);

      note.userVote = userVote?.vote_type || null;
      note.isFavoritedByUser = isFavorited;
    }

    res.json({ note });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      error: 'FETCH_NOTE_FAILED',
      message: '無法獲取註記'
    });
  }
});

/**
 * PATCH /api/notes/:id
 * 更新註記
 */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { content, visibility } = req.body;

    const {note:noteRepo}=req.app.locals.repositories;
    const [note,publicSettingsResult]=await Promise.all([
      noteRepo.findById(req.params.id),
      visibility==='public'
        ? req.app.locals.supabaseClient.from('user_settings').select('allow_public_notes').eq('user_id',req.user.userId).maybeSingle()
        : Promise.resolve({data:null,error:null})
    ]);
    if(publicSettingsResult.error)throw publicSettingsResult.error;

    if (!note) {
      return res.status(404).json({
        error: 'NOTE_NOT_FOUND',
        message: '註記不存在'
      });
    }

    if (note.author_id !== req.user.userId) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非註記持有者本人'
      });
    }

    if (visibility === 'public') {
      if(!publicSettingsResult.data?.allow_public_notes){
        return res.status(403).json({
          error: 'PUBLIC_NOTES_DISABLED',
          message: '請先在設定中啟用公開註記。'
        });
      }
    }

    if (content) {
      note.content = content;
    }

    if(visibility)note.visibility=visibility;
    const updates={
      content:note.content,
      visibility:note.visibility,
      public_alias:note.visibility==='public'?(note.public_alias||noteRepo.generatePublicAlias(req.user.userId,note.article_id)):null,
      updated_at:new Date().toISOString()
    };
    const {data:updatedNote,error:updateError}=await noteRepo.db
      .from('notes')
      .update(updates)
      .eq('id',req.params.id)
      .eq('author_id',req.user.userId)
      .select('*')
      .single();
    if(updateError)throw updateError;

    res.json({
      success: true,
      note:updatedNote
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({
      error: 'UPDATE_NOTE_FAILED',
      message: '無法更新註記'
    });
  }
});

/**
 * DELETE /api/notes/:id
 * 刪除註記
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { note: noteRepo } = req.app.locals.repositories;

    await noteRepo.deleteNote(req.params.id, req.user.userId);

    res.json({
      success: true,
      message: '註記已刪除'
    });
  } catch (error) {
    if (error.message === 'NOT_NOTE_OWNER') {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非註記持有者本人'
      });
    }

    console.error('Delete note error:', error);
    res.status(500).json({
      error: 'DELETE_NOTE_FAILED',
      message: '無法刪除註記'
    });
  }
});

/**
 * POST /api/notes/:id/vote
 * 投票（上/下/取消）
 */
router.post('/:id/vote', requireAuth, async (req, res) => {
  try {
    const { voteType } = req.body;

    if (!['up', 'down', 'none'].includes(voteType)) {
      return res.status(400).json({
        error: 'INVALID_VOTE_TYPE',
        message: '無效的投票類型'
      });
    }

    const { note: noteRepo } = req.app.locals.repositories;

    const atomicResult=await noteRepo.voteAtomic(req.params.id,req.user.userId,voteType);
    if(atomicResult){
      return res.json(atomicResult);
    }

    const targetNote = await noteRepo.findById(req.params.id);
    if (!canReadNote(targetNote, req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權對此註記投票'
      });
    }

    const result=await noteRepo.vote(req.params.id, req.user.userId, voteType);
    const note={...targetNote,...result};

    res.json({
      success: true,
      note,
      userVote:result.userVote
    });
  } catch (error) {
    if(error.message?.includes('IDENTITY_VERIFICATION_FAILED')){
      return res.status(403).json({error:'IDENTITY_VERIFICATION_FAILED',message:'身分驗證失敗：無權對此註記投票'});
    }
    console.error('Vote error:', error);
    res.status(500).json({
      error: 'VOTE_FAILED',
      message: '無法投票'
    });
  }
});

/**
 * POST /api/notes/:id/favorite
 * 收藏/取消收藏
 */
router.post('/:id/favorite', requireAuth, async (req, res) => {
  try {
    const { note: noteRepo } = req.app.locals.repositories;

    const atomicResult=await noteRepo.toggleFavoriteAtomic(req.params.id,req.user.userId);
    if(atomicResult){
      return res.json(atomicResult);
    }

    const targetNote = await noteRepo.findById(req.params.id);
    if (!canReadNote(targetNote, req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權收藏此註記'
      });
    }

    const result=await noteRepo.toggleFavorite(req.params.id, req.user.userId);
    const note={...targetNote,...result,isFavoritedByUser:result.isFavorited};

    res.json({
      success: true,
      isFavorited:result.isFavorited,
      note
    });
  } catch (error) {
    if(error.message?.includes('IDENTITY_VERIFICATION_FAILED')){
      return res.status(403).json({error:'IDENTITY_VERIFICATION_FAILED',message:'身分驗證失敗：無權收藏此註記'});
    }
    console.error('Favorite error:', error);
    res.status(500).json({
      error: 'FAVORITE_FAILED',
      message: '無法收藏'
    });
  }
});

/**
 * GET /api/notes/:id/favorites
 * 獲取註記的收藏者
 */
router.get('/:id/favorites', async (req, res) => {
  try {
    const { note: noteRepo } = req.app.locals.repositories;
    let favorites;
    if (noteRepo.isSupabase) {
      const { data, error } = await noteRepo.db
        .from('note_favorites')
        .select('users(id, public_display_name)')
        .eq('note_id', req.params.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      favorites = (data || []).map(item => item.users).filter(Boolean);
    } else {
      favorites = await noteRepo.db.all(`
        SELECT u.id, u.public_display_name FROM note_favorites nf
        JOIN users u ON nf.user_id = u.id
        WHERE nf.note_id = ?
        ORDER BY nf.created_at DESC
      `, [req.params.id]);
    }

    res.json({
      favorites,
      count: favorites.length
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({
      error: 'GET_FAVORITES_FAILED',
      message: '無法獲取收藏'
    });
  }
});

export default router;
