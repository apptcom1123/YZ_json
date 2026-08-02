/**
 * 通知 API 路由
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/me/notifications
 * 獲取用戶的通知列表
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const { notification: notificationRepo } = req.app.locals.repositories;

    const [notifications, summary] = await Promise.all([
      notificationRepo.getUserNotifications(req.user.userId, parseInt(limit), parseInt(offset)),
      notificationRepo.getNotificationSummary(req.user.userId)
    ]);

    res.json({
      notifications,
      summary,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: summary.total_notifications
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      error: 'FETCH_NOTIFICATIONS_FAILED',
      message: '無法獲取通知'
    });
  }
});

/**
 * GET /api/me/notifications/unread
 * 獲取未讀通知
 */
router.get('/unread', requireAuth, async (req, res) => {
  try {
    const { notification: notificationRepo } = req.app.locals.repositories;
    const unreadNotifications = await notificationRepo.getUnreadNotifications(req.user.userId);

    res.json({
      unreadNotifications,
      count: unreadNotifications.length
    });
  } catch (error) {
    console.error('Get unread notifications error:', error);
    res.status(500).json({
      error: 'FETCH_UNREAD_FAILED',
      message: '無法獲取未讀通知'
    });
  }
});

/**
 * PATCH /api/me/notifications/:id/read
 * 標記單一通知為已讀
 */
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const { notification: notificationRepo } = req.app.locals.repositories;

    // 驗證通知屬於當前用戶
    const notif = await notificationRepo.findById(req.params.id);
    if (!notif || notif.user_id !== req.user.userId) {
      return res.status(404).json({
        error: 'NOTIFICATION_NOT_FOUND',
        message: '通知不存在'
      });
    }

    await notificationRepo.markAsRead(req.params.id);
    await notificationRepo.updateUnreadCount(req.user.userId);

    res.json({
      success: true,
      message: '已標記為已讀'
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      error: 'MARK_READ_FAILED',
      message: '無法標記為已讀'
    });
  }
});

/**
 * PATCH /api/me/notifications/read-all
 * 標記所有通知為已讀
 */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const { notification: notificationRepo } = req.app.locals.repositories;

    await notificationRepo.markAllAsRead(req.user.userId);
    await notificationRepo.updateUnreadCount(req.user.userId);

    res.json({
      success: true,
      message: '已標記所有通知為已讀'
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      error: 'MARK_ALL_READ_FAILED',
      message: '無法標記所有通知為已讀'
    });
  }
});

/**
 * DELETE /api/me/notifications/:id
 * 刪除通知
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { notification: notificationRepo } = req.app.locals.repositories;

    // 驗證通知屬於當前用戶
    const notif = await notificationRepo.findById(req.params.id);
    if (!notif || notif.user_id !== req.user.userId) {
      return res.status(404).json({
        error: 'NOTIFICATION_NOT_FOUND',
        message: '通知不存在'
      });
    }

    await notificationRepo.deleteNotification(req.params.id);

    res.json({
      success: true,
      message: '通知已刪除'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      error: 'DELETE_NOTIFICATION_FAILED',
      message: '無法刪除通知'
    });
  }
});

/**
 * GET /api/me/stats
 * 獲取用戶統計
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { user: userRepo, notification: notificationRepo, reply: replyRepo } = req.app.locals.repositories;

    const stats = await userRepo.getUserStats(req.user.userId);
    const repliesReceived = await replyRepo.getRepliesReceivedByUser(req.user.userId);
    const summary = await notificationRepo.getNotificationSummary(req.user.userId);

    res.json({
      stats: {
        totalRepliesReceived: stats?.total_replies_received || 0,
        unreadNotificationsCount: stats?.unread_notifications_count || 0,
        repliesCount: repliesReceived.length,
        notificationsSummary: summary
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'FETCH_STATS_FAILED',
      message: '無法獲取統計'
    });
  }
});

export default router;
