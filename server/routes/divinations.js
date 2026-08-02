/**
 * 占卜記錄 API 路由
 */

import express from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/divinations
 * 獲取用戶的占卜記錄
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { divination: divinationRepo } = req.app.locals.repositories;
    const records = await divinationRepo.getUserDivinations(req.user.userId);

    res.json({
      records,
      count: records.length
    });
  } catch (error) {
    console.error('Get divinations error:', error);
    res.status(500).json({
      error: 'FETCH_DIVINATIONS_FAILED',
      message: '無法獲取占卜紀錄'
    });
  }
});

/**
 * POST /api/divinations
 * 創建新占卜記錄
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { guaId, questionText, resultPayload } = req.body;

    if (!guaId || !resultPayload) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: '缺少必填字段'
      });
    }

    const { divination: divinationRepo } = req.app.locals.repositories;

    const recordId = await divinationRepo.createDivination(
      req.user.userId,
      guaId,
      questionText || null,
      resultPayload,
      'cloud'
    );

    const record = await divinationRepo.findById(recordId);

    res.status(201).json({
      success: true,
      record: {
        ...record,
        result_payload: typeof record.result_payload === 'string'
          ? JSON.parse(record.result_payload)
          : record.result_payload
      }
    });
  } catch (error) {
    console.error('Create divination error:', error);
    res.status(500).json({
      error: 'CREATE_DIVINATION_FAILED',
      message: '無法創建占卜紀錄'
    });
  }
});

/**
 * GET /api/divinations/:id
 * 獲取單一占卜記錄
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { divination: divinationRepo } = req.app.locals.repositories;
    const record = await divinationRepo.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        error: 'DIVINATION_NOT_FOUND',
        message: '占卜紀錄不存在'
      });
    }

    if (record.user_id !== req.user.userId) {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非占卜紀錄持有者本人'
      });
    }

    res.json({
      record: {
        ...record,
        result_payload: typeof record.result_payload === 'string'
          ? JSON.parse(record.result_payload)
          : record.result_payload
      }
    });
  } catch (error) {
    console.error('Get divination error:', error);
    res.status(500).json({
      error: 'FETCH_DIVINATION_FAILED',
      message: '無法獲取占卜紀錄'
    });
  }
});

/**
 * PATCH /api/divinations/:id
 * 更新占卜記錄
 */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { questionText, resultPayload } = req.body;

    const { divination: divinationRepo } = req.app.locals.repositories;
    const updated = await divinationRepo.updateDivination(
      req.params.id,
      req.user.userId,
      {
        question_text: questionText,
        result_payload: resultPayload
      }
    );

    res.json({
      success: true,
      record: updated
    });
  } catch (error) {
    if (error.message === 'NOT_RECORD_OWNER') {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非占卜紀錄持有者本人'
      });
    }

    console.error('Update divination error:', error);
    res.status(500).json({
      error: 'UPDATE_DIVINATION_FAILED',
      message: '無法更新占卜紀錄'
    });
  }
});

/**
 * DELETE /api/divinations/:id
 * 刪除占卜記錄
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { divination: divinationRepo } = req.app.locals.repositories;
    await divinationRepo.deleteDivination(req.params.id, req.user.userId);

    res.json({
      success: true,
      message: '占卜紀錄已刪除'
    });
  } catch (error) {
    if (error.message === 'NOT_RECORD_OWNER') {
      return res.status(403).json({
        error: 'IDENTITY_VERIFICATION_FAILED',
        message: '身分驗證失敗：非占卜紀錄持有者本人'
      });
    }

    console.error('Delete divination error:', error);
    res.status(500).json({
      error: 'DELETE_DIVINATION_FAILED',
      message: '無法刪除占卜紀錄'
    });
  }
});

/**
 * POST /api/divinations/sync
 * 同步本地占卜記錄
 */
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { localRecords } = req.body;

    if (!Array.isArray(localRecords)) {
      return res.status(400).json({
        error: 'INVALID_FORMAT',
        message: 'localRecords 必須是陣列'
      });
    }

    const { divination: divinationRepo } = req.app.locals.repositories;
    const syncResults = await divinationRepo.syncLocalDivinations(
      req.user.userId,
      localRecords
    );

    res.json({
      success: true,
      syncResults
    });
  } catch (error) {
    console.error('Sync divinations error:', error);
    res.status(500).json({
      error: 'SYNC_FAILED',
      message: '無法同步占卜紀錄'
    });
  }
});

/**
 * GET /api/divinations/gua/:guaId/stats
 * 獲取特定卦的占卜統計
 */
router.get('/gua/:guaId/stats', optionalAuth, async (req, res) => {
  try {
    const { divination: divinationRepo } = req.app.locals.repositories;
    const stats = await divinationRepo.getGuaDivinationStats(req.params.guaId);

    res.json({
      guaId: req.params.guaId,
      stats
    });
  } catch (error) {
    console.error('Get gua stats error:', error);
    res.status(500).json({
      error: 'GET_STATS_FAILED',
      message: '無法獲取卦象統計'
    });
  }
});

export default router;
