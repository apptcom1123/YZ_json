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
    const { articleId, paragraphAnchor, clusterKey, thresholdPercent = 60 } = req.query;

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
      for (const note of notes) {
        const userVote = await noteRepo.getUserVote(note.id, req.user.userId);
        const isFavorited = await noteRepo.isFavoritedBy(note.id, req.user.userId);

        note.userVote = userVote?.vote_type || null;
        note.isFavoritedByUser = isFavorited;
      }
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
    const notes = await req.app.locals.repositories.note.getUserPrivateNotes(req.user.userId);
    res.json({ notes });
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

    // 檢查用戶設置
    let settings;
    if (userRepo.isSupabase) {
      const { data, error } = await userRepo.db
        .from('user_settings')
        .select('allow_public_notes')
        .eq('user_id', req.user.userId)
        .maybeSingle();
      if (error) throw error;
      settings = data;
    } else {
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
    const noteId = await noteRepo.createNote({
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

    const note = await noteRepo.findById(noteId);

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
    const { note: noteRepo } = req.app.locals.repositories;
    const note = await noteRepo.findById(req.params.id);

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
      const userVote = await noteRepo.getUserVote(note.id, req.user.userId);
      const isFavorited = await noteRepo.isFavoritedBy(note.id, req.user.userId);

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

    const { note: noteRepo } = req.app.locals.repositories;
    const note = await noteRepo.findById(req.params.id);

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
      const { data: settings, error: settingsError } = await req.app.locals.supabaseClient
        .from('user_settings')
        .select('allow_public_notes')
        .eq('user_id', req.user.userId)
        .maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings?.allow_public_notes) {
        return res.status(403).json({
          error: 'PUBLIC_NOTES_DISABLED',
          message: '請先在設定中啟用公開註記。'
        });
      }
    }

    if (content) {
      note.content = content;
    }

    if (visibility) {
      await noteRepo.toggleVisibility(req.params.id, req.user.userId, visibility);
      note.visibility = visibility;
    }

    await noteRepo.update(req.params.id, {
      content: note.content,
      visibility: note.visibility
    });

    res.json({
      success: true,
      note: await noteRepo.findById(req.params.id)
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

    const targetNote = await noteRepo.findById(req.params.id);
    if (!canReadNote(targetNote, req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權對此註記投票'
      });
    }

    await noteRepo.vote(req.params.id, req.user.userId, voteType);
    const note = await noteRepo.findById(req.params.id);

    const userVote = await noteRepo.getUserVote(req.params.id, req.user.userId);

    res.json({
      success: true,
      note,
      userVote: userVote?.vote_type || null
    });
  } catch (error) {
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

    const targetNote = await noteRepo.findById(req.params.id);
    if (!canReadNote(targetNote, req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權收藏此註記'
      });
    }

    await noteRepo.toggleFavorite(req.params.id, req.user.userId);
    const isFavorited = await noteRepo.isFavoritedBy(req.params.id, req.user.userId);
    const note = await noteRepo.findById(req.params.id);

    res.json({
      success: true,
      isFavorited,
      note
    });
  } catch (error) {
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
