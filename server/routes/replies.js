/**
 * 註記回覆 API 路由
 */

import express from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

function flattenReplyTree(replies){
  return (replies||[]).flatMap(reply=>[reply,...flattenReplyTree(reply.children)]);
}

/**
 * GET /api/notes/:noteId/replies
 * 獲取註記的所有回覆
 */
router.get('/:noteId/replies', optionalAuth, async (req, res) => {
  try {
    const { reply: replyRepo, note: noteRepo } = req.app.locals.repositories;
    const note = await noteRepo.findById(req.params.noteId);
    if (!note || note.status !== 'active' || note.deleted_at) {
      return res.status(404).json({ error: 'NOTE_NOT_FOUND', message: '註記不存在' });
    }
    if (note.visibility !== 'public' && note.author_id !== req.user?.userId) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非註記持有者本人'
      });
    }
    const replies = await replyRepo.getNoteReplies(req.params.noteId);
    if(req.user){
      const flatReplies=flattenReplyTree(replies);
      const votes=await replyRepo.getUserVotesForReplies(flatReplies.map(reply=>reply.id),req.user.userId);
      flatReplies.forEach(reply=>{reply.userVote=votes.get(reply.id)||null;});
    }

    res.json({
      noteId: req.params.noteId,
      replies,
      count: replies.length
    });
  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({
      error: 'FETCH_REPLIES_FAILED',
      message: '無法獲取回覆'
    });
  }
});

/**
 * POST /api/notes/:noteId/replies
 * 在註記上新增回覆
 */
router.post('/:noteId/replies', requireAuth, async (req, res) => {
  try {
    const { content, parentReplyId = null, clientMutationId = null } = req.body;

    if (!content) {
      return res.status(400).json({
        error: 'MISSING_CONTENT',
        message: '缺少回覆內容'
      });
    }

    const { reply: replyRepo, notification: notificationRepo, note: noteRepo } = req.app.locals.repositories;

    // 獲取註記信息
    const note = await noteRepo.findById(req.params.noteId);
    if (!note) {
      return res.status(404).json({
        error: 'NOTE_NOT_FOUND',
        message: '註記不存在'
      });
    }

    if (note.status !== 'active' || note.deleted_at || (note.visibility !== 'public' && note.author_id !== req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權回覆此註記'
      });
    }

    // 添加回覆
    const replyId = await replyRepo.addReply(
      req.params.noteId,
      req.user.userId,
      content,
      parentReplyId,
      clientMutationId
    );

    const notificationTask=note.visibility==='public'&&note.author_id!==req.user.userId
      ? notificationRepo.shouldNotifyUser(note.author_id).then(shouldNotify=>{
          if(!shouldNotify)return null;
          const deepLink=`/#${note.article_id}?note_id=${note.id}&reply_id=${replyId}`;
          return notificationRepo.createReplyNotification(note.author_id,replyId,req.user.userId,note.id,deepLink);
        })
      : Promise.resolve(null);
    const [reply]=await Promise.all([replyRepo.findById(replyId),notificationTask]);

    res.status(201).json({
      success: true,
      reply
    });
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({
      error: 'CREATE_REPLY_FAILED',
      message: '無法新增回覆'
    });
  }
});

/**
 * POST /api/notes/:noteId/replies/:replyId/vote
 * Vote for a reply. The authenticated Supabase user is always the voter.
 */
router.post('/:noteId/replies/:replyId/vote', requireAuth, async (req, res) => {
  try {
    const { voteType } = req.body;
    if (!['up', 'down', 'none'].includes(voteType)) {
      return res.status(400).json({
        error: 'INVALID_VOTE_TYPE',
        message: '投票類型無效'
      });
    }

    const { reply: replyRepo, note: noteRepo } = req.app.locals.repositories;
    const [note,reply]=await Promise.all([
      noteRepo.findById(req.params.noteId),
      replyRepo.findById(req.params.replyId)
    ]);
    if (!note || note.status !== 'active' || note.deleted_at || (note.visibility !== 'public' && note.author_id !== req.user.userId)) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：無權對此留言投票'
      });
    }
    if (!reply || reply.note_id !== req.params.noteId || reply.status !== 'active') {
      return res.status(404).json({
        error: 'REPLY_NOT_FOUND',
        message: '找不到可投票的留言'
      });
    }

    const result=await replyRepo.voteReply(reply.id,req.user.userId,voteType);
    const updatedReply={...reply,...result};
    res.json({success:true,reply:updatedReply,userVote:result.userVote});
  } catch (error) {
    console.error('Vote reply error:', error);
    res.status(500).json({
      error: 'REPLY_VOTE_FAILED',
      message: '無法更新留言投票'
    });
  }
});

/**
 * PATCH /api/notes/:noteId/replies/:replyId
 * 編輯回覆
 */
router.patch('/:noteId/replies/:replyId', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        error: 'MISSING_CONTENT',
        message: '缺少回覆內容'
      });
    }

    const { reply: replyRepo } = req.app.locals.repositories;
    const updated = await replyRepo.updateReply(
      req.params.replyId,
      req.user.userId,
      content
    );

    res.json({
      success: true,
      reply: updated
    });
  } catch (error) {
    if (error.message === 'NOT_REPLY_OWNER') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: '無法編輯他人的回覆'
      });
    }

    console.error('Update reply error:', error);
    res.status(500).json({
      error: 'UPDATE_REPLY_FAILED',
      message: '無法更新回覆'
    });
  }
});

/**
 * DELETE /api/notes/:noteId/replies/:replyId
 * 刪除回覆
 */
router.delete('/:noteId/replies/:replyId', requireAuth, async (req, res) => {
  try {
    const { reply: replyRepo, notification: notificationRepo } = req.app.locals.repositories;

    // 標記指向此回覆的通知
    await notificationRepo.markTargetAsDeleted('reply', req.params.replyId);

    // 刪除回覆
    await replyRepo.deleteReply(req.params.replyId, req.user.userId);

    res.json({
      success: true,
      message: '回覆已刪除'
    });
  } catch (error) {
    if (error.message === 'NOT_REPLY_OWNER') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: '無法刪除他人的回覆'
      });
    }

    console.error('Delete reply error:', error);
    res.status(500).json({
      error: 'DELETE_REPLY_FAILED',
      message: '無法刪除回覆'
    });
  }
});

/**
 * GET /api/me/replies
 * 獲取當前用戶的所有回覆
 */
router.get('/me/replies', requireAuth, async (req, res) => {
  try {
    const { reply: replyRepo } = req.app.locals.repositories;
    const userReplies = await replyRepo.getUserReplies(req.user.userId);

    res.json({
      replies: userReplies,
      count: userReplies.length
    });
  } catch (error) {
    console.error('Get user replies error:', error);
    res.status(500).json({
      error: 'FETCH_USER_REPLIES_FAILED',
      message: '無法獲取您的回覆'
    });
  }
});

export default router;
