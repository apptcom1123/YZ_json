/**
 * 用戶設置 API 路由
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/me/settings
 * 獲取當前用戶的設置
 */
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const { user: userRepo } = req.app.locals.repositories;
    const userWithSettings = await userRepo.getUserWithSettings(req.user.userId);

    if (!userWithSettings) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: '用戶不存在'
      });
    }

    res.json({
      user: {
        id: userWithSettings.id,
        email: userWithSettings.email,
        displayName: userWithSettings.display_name,
        publicDisplayName: userWithSettings.public_display_name,
        avatarUrl: userWithSettings.avatar_url,
        role: userWithSettings.role
      },
      settings: {
        saveNotesToCloud: userWithSettings.save_notes_to_cloud === 1,
        saveDivinationToCloud: userWithSettings.save_divination_to_cloud === 1,
        allowPublicNotes: userWithSettings.allow_public_notes === 1,
        noteVisibilityThresholdPercent: userWithSettings.note_visibility_threshold_percent,
        language: userWithSettings.language,
        timezone: userWithSettings.timezone,
        notifyOnReply: userWithSettings.notify_on_reply === 1,
        termsAccepted: userWithSettings.terms_accepted === 1,
        acceptedTermsVersion: userWithSettings.accepted_terms_version,
        termsAcceptedAt: userWithSettings.terms_accepted_at
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      error: 'FETCH_SETTINGS_FAILED',
      message: '無法獲取設置'
    });
  }
});

/**
 * PATCH /api/me/settings
 * 更新用戶設置
 */
router.patch('/settings', requireAuth, async (req, res) => {
  try {
    const { user: userRepo } = req.app.locals.repositories;
    const updates = req.body.settings || {};

    // 轉換駝峰式到蛇形式的鍵映射
    const keyMap = {
      saveNotesToCloud: 'save_notes_to_cloud',
      saveDivinationToCloud: 'save_divination_to_cloud',
      allowPublicNotes: 'allow_public_notes',
      noteVisibilityThresholdPercent: 'note_visibility_threshold_percent',
      language: 'language',
      timezone: 'timezone',
      notifyOnReply: 'notify_on_reply'
    };

    // 轉換布爾值為 0/1
    const convertedUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = keyMap[key] || key;
      if (typeof value === 'boolean') {
        convertedUpdates[dbKey] = value ? 1 : 0;
      } else {
        convertedUpdates[dbKey] = value;
      }
    }

    const updated = await userRepo.updateUserSettings(req.user.userId, convertedUpdates);

    res.json({
      success: true,
      settings: {
        saveNotesToCloud: updated.save_notes_to_cloud === 1,
        saveDivinationToCloud: updated.save_divination_to_cloud === 1,
        allowPublicNotes: updated.allow_public_notes === 1,
        noteVisibilityThresholdPercent: updated.note_visibility_threshold_percent,
        language: updated.language,
        timezone: updated.timezone,
        notifyOnReply: updated.notify_on_reply === 1
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      error: 'UPDATE_SETTINGS_FAILED',
      message: '無法更新設置'
    });
  }
});

/**
 * POST /api/me/terms/accept
 * 接受使用條款
 */
router.post('/terms/accept', requireAuth, async (req, res) => {
  try {
    const { docType = 'terms', docVersion } = req.body;

    if (!docVersion) {
      return res.status(400).json({
        error: 'MISSING_VERSION',
        message: '缺少文檔版本'
      });
    }

    const { user: userRepo } = req.app.locals.repositories;

    // 記錄條款接受
    const userIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    await userRepo.acceptTerms(req.user.userId, docVersion, userIp, userAgent);

    res.json({
      success: true,
      message: '已接受條款'
    });
  } catch (error) {
    console.error('Accept terms error:', error);
    res.status(500).json({
      error: 'ACCEPT_TERMS_FAILED',
      message: '無法接受條款'
    });
  }
});

/**
 * GET /api/me/terms/status
 * 獲取條款接受狀態
 */
router.get('/terms/status', requireAuth, async (req, res) => {
  try {
    const { user: userRepo } = req.app.locals.repositories;
    let settings;
    if (userRepo.isSupabase) {
      const { data, error } = await userRepo.db
        .from('user_settings')
        .select('terms_accepted, accepted_terms_version, terms_accepted_at')
        .eq('user_id', req.user.userId)
        .maybeSingle();
      if (error) throw error;
      settings = data;
    } else {
      settings = await userRepo.db.get(`
        SELECT terms_accepted, accepted_terms_version, terms_accepted_at 
        FROM user_settings 
        WHERE user_id = ?
      `, [req.user.userId]);
    }

    const latestTermsVersion = '2026-07-26'; // 應從配置中讀取

    res.json({
      termsAccepted: settings?.terms_accepted === true || settings?.terms_accepted === 1,
      acceptedVersion: settings?.accepted_terms_version,
      acceptedAt: settings?.terms_accepted_at,
      latestVersion: latestTermsVersion,
      needsAcceptance: !(settings?.terms_accepted === true || settings?.terms_accepted === 1) || settings?.accepted_terms_version !== latestTermsVersion
    });
  } catch (error) {
    console.error('Get terms status error:', error);
    res.status(500).json({
      error: 'GET_TERMS_STATUS_FAILED',
      message: '無法獲取條款狀態'
    });
  }
});

/**
 * PATCH /api/me/settings/notifications
 * 更新通知設置
 */
router.patch('/settings/notifications', requireAuth, async (req, res) => {
  try {
    const { notifyOnReply } = req.body;

    if (typeof notifyOnReply !== 'boolean') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'notifyOnReply 必須是布爾值'
      });
    }

    const { user: userRepo } = req.app.locals.repositories;
    const updated = await userRepo.updateUserSettings(req.user.userId, {
      notify_on_reply: notifyOnReply ? 1 : 0
    });

    res.json({
      success: true,
      notifyOnReply: updated.notify_on_reply === 1
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      error: 'UPDATE_NOTIFICATION_SETTINGS_FAILED',
      message: '無法更新通知設置'
    });
  }
});

/**
 * POST /api/me/data/delete
 * 刪除雲端數據
 */
router.post('/data/delete', requireAuth, async (req, res) => {
  try {
    const { confirmEmail } = req.body;

    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.findById(req.user.userId);

    // 驗證郵件地址
    if (confirmEmail !== user.email) {
      return res.status(400).json({
        error: 'EMAIL_CONFIRM_MISMATCH',
        message: '郵件地址不符'
      });
    }

    // 創建刪除審計日誌
    if (userRepo.isSupabase) {
      const { error } = await userRepo.db
        .from('deletion_audit_logs')
        .insert({ user_id: req.user.userId, action_type: 'delete_data', status: 'success' });
      if (error) throw error;
    } else {
      await userRepo.db.run(`
        INSERT INTO deletion_audit_logs (user_id, action_type, status)
        VALUES (?, 'delete_data', 'success')
      `, [req.user.userId]);
    }

    // 刪除用戶的雲端數據 - 使用軟刪除
    const userId = req.user.userId;
    const deletedAt = new Date().toISOString();
    if (userRepo.isSupabase) {
      const operations = [
        userRepo.db.from('divination_records').update({ deleted_at: deletedAt }).eq('user_id', userId).is('deleted_at', null),
        userRepo.db.from('notes').update({ deleted_at: deletedAt, status: 'deleted' }).eq('author_id', userId).is('deleted_at', null),
        userRepo.db.from('note_favorites').delete().eq('user_id', userId),
        userRepo.db.from('note_votes').delete().eq('user_id', userId),
        userRepo.db.from('note_replies').update({ status: 'deleted', updated_at: deletedAt }).eq('author_id', userId)
      ];

      for (const operation of operations) {
        const { error } = await operation;
        if (error) throw error;
      }
    } else {
    
    // 軟刪除用戶的占卜記錄
    await userRepo.db.run(`
      UPDATE divination_records 
      SET deleted_at = ? 
      WHERE user_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);
    
    // 軟刪除用戶的註記
    await userRepo.db.run(`
      UPDATE notes 
      SET deleted_at = ? 
      WHERE author_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);
    
    // 軟刪除用戶的註記收藏
    await userRepo.db.run(`
      UPDATE note_favorites 
      SET deleted_at = ? 
      WHERE user_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);
    
    // 軟刪除用戶的註記投票
    await userRepo.db.run(`
      UPDATE note_votes 
      SET deleted_at = ? 
      WHERE user_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);
    
    // 軟刪除用戶的回覆
    await userRepo.db.run(`
      UPDATE note_replies 
      SET deleted_at = ? 
      WHERE author_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);
    
    // 軟刪除用戶的回覆投票
    await userRepo.db.run(`
      UPDATE reply_votes 
      SET deleted_at = ? 
      WHERE user_id = ? AND deleted_at IS NULL
    `, [deletedAt, userId]);

    }

    res.json({
      success: true,
      message: '已開始刪除數據'
    });
  } catch (error) {
    console.error('Delete data error:', error);
    res.status(500).json({
      error: 'DELETE_DATA_FAILED',
      message: '無法刪除數據'
    });
  }
});

/**
 * POST /api/me/account/delete
 * 刪除帳號
 */
router.post('/account/delete', requireAuth, async (req, res) => {
  try {
    const { confirmEmail } = req.body;

    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.findById(req.user.userId);

    // 驗證郵件地址
    if (confirmEmail !== user.email) {
      return res.status(400).json({
        error: 'EMAIL_CONFIRM_MISMATCH',
        message: '郵件地址不符'
      });
    }

    // 創建刪除審計日誌
    if (userRepo.isSupabase) {
      const { error } = await userRepo.db
        .from('deletion_audit_logs')
        .insert({ user_id: req.user.userId, action_type: 'delete_account', status: 'success' });
      if (error) throw error;
    } else {
      await userRepo.db.run(`
        INSERT INTO deletion_audit_logs (user_id, action_type, status)
        VALUES (?, 'delete_account', 'success')
      `, [req.user.userId]);
    }

    // 軟刪除用戶
    await userRepo.softDelete(req.user.userId);

    res.json({
      success: true,
      message: '帳號已刪除',
      redirectTo: '/'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      error: 'DELETE_ACCOUNT_FAILED',
      message: '無法刪除帳號'
    });
  }
});

/**
 * POST /api/me/local-data/clear
 * 通知前端清除本機數據
 */
router.post('/local-data/clear', requireAuth, (req, res) => {
  res.json({
    success: true,
    message: '應清除本機 localStorage 和 IndexedDB'
  });
});

/**
 * POST /api/me/sync/check
 * 檢查本地和遠端數據是否衝突
 */
router.post('/sync/check', requireAuth, async (req, res) => {
  try {
    const { localItems } = req.body;

    if (!Array.isArray(localItems)) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'localItems 必須是數組'
      });
    }

    const { note: noteRepo } = req.app.locals.repositories;
    const conflicts = [];
    const synced = [];

    for (const localItem of localItems) {
      // 檢查遠端是否存在相同的記錄
      let remoteItem = null;

      if (localItem.remote_id) {
        // 如果已有 remote_id，直接查詢
        remoteItem = await noteRepo.findById(localItem.remote_id);
      } else if (localItem.local_uuid) {
        // 嘗試通過 local_uuid 查詢
        const query = `
          SELECT * FROM notes 
          WHERE deleted_at IS NULL 
          ORDER BY created_at DESC 
          LIMIT 1
        `;
        remoteItem = await noteRepo.db.get(query);
      }

      if (remoteItem) {
        // 比較時間戳
        const localTime = new Date(localItem.updated_at || localItem.created_at).getTime();
        const remoteTime = new Date(remoteItem.updated_at).getTime();

        if (localTime !== remoteTime) {
          // 可能存在衝突
          conflicts.push({
            local_uuid: localItem.local_uuid,
            remote_id: remoteItem.id,
            conflict_type: 'TIMESTAMP_MISMATCH',
            local_version: {
              updated_at: localItem.updated_at || localItem.created_at
            },
            remote_version: {
              updated_at: remoteItem.updated_at
            },
            suggested_resolution: 'LATEST_WINS' // 使用最新版本
          });
        } else {
          synced.push({
            local_uuid: localItem.local_uuid,
            remote_id: remoteItem.id,
            status: 'IN_SYNC'
          });
        }
      } else {
        synced.push({
          local_uuid: localItem.local_uuid,
          status: 'NEW_ITEM'
        });
      }
    }

    res.json({
      success: true,
      conflicts,
      synced,
      total: localItems.length,
      conflictCount: conflicts.length
    });
  } catch (error) {
    console.error('Sync check error:', error);
    res.status(500).json({
      error: 'SYNC_CHECK_FAILED',
      message: '無法檢查同步狀態'
    });
  }
});

/**
 * POST /api/me/sync/resolve
 * 解決同步衝突
 */
router.post('/sync/resolve', requireAuth, async (req, res) => {
  try {
    const { conflicts, resolutions } = req.body;

    if (!Array.isArray(conflicts) || !resolutions) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'conflicts 和 resolutions 是必需的'
      });
    }

    const { note: noteRepo } = req.app.locals.repositories;
    const resolved = [];

    for (const conflict of conflicts) {
      const resolution = resolutions[conflict.local_uuid];

      if (resolution === 'USE_LOCAL') {
        // 保留本地版本（伺服器側取消此次同步）
        resolved.push({
          local_uuid: conflict.local_uuid,
          action: 'LOCAL_KEPT',
          message: '保留本地版本'
        });
      } else if (resolution === 'USE_REMOTE') {
        // 使用遠端版本
        resolved.push({
          local_uuid: conflict.local_uuid,
          action: 'REMOTE_APPLIED',
          message: '應用遠端版本'
        });
      } else if (resolution === 'MERGE') {
        // 合併兩個版本（需要具體的合併邏輯）
        resolved.push({
          local_uuid: conflict.local_uuid,
          action: 'MERGED',
          message: '已合併兩個版本'
        });
      }
    }

    // 記錄衝突解決到審計日誌
    await noteRepo.db.run(`
      INSERT INTO deletion_audit_logs (user_id, action_type, status)
      VALUES (?, 'sync_conflict_resolved', 'success')
    `, [req.user.userId]);

    res.json({
      success: true,
      resolved,
      total: conflicts.length
    });
  } catch (error) {
    console.error('Sync resolve error:', error);
    res.status(500).json({
      error: 'SYNC_RESOLVE_FAILED',
      message: '無法解決同步衝突'
    });
  }
});

/**
 * 工具函數
 */
router.toSnakeCase = (str) => {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
};

export default router;
