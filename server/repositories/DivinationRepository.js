import { BaseRepository } from './BaseRepository.js';

export class DivinationRepository extends BaseRepository {
  constructor(db) {
    super(db, 'divination_records');
  }

  /**
   * 創建占卜記錄
   */
  async createDivination(userId, guaId, questionText, resultPayload, source = 'cloud', localUuid = null) {
    const query = `
      INSERT INTO divination_records (
        user_id, gua_id, question_text, result_payload, source, local_uuid
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const result = await this.db.run(query, [
      userId,
      guaId,
      questionText,
      typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload),
      source,
      localUuid
    ]);

    return result.lastID || result;
  }

  /**
   * 獲取用戶的所有占卜記錄（包含本地和雲端）
   */
  async getUserDivinations(userId, includeDeleted = false) {
    let query = `
      SELECT * FROM divination_records
      WHERE user_id = ?
    `;
    const params = [userId];

    if (!includeDeleted) {
      query += ` AND deleted_at IS NULL`;
    }

    query += ` ORDER BY created_at DESC`;

    const records = await this.db.all(query, params);

    // 解析 JSON payload
    return records.map(record => ({
      ...record,
      result_payload: typeof record.result_payload === 'string' 
        ? JSON.parse(record.result_payload) 
        : record.result_payload
    }));
  }

  /**
   * 更新占卜記錄（編輯問題或結果）
   */
  async updateDivination(divinationId, userId, updates) {
    // 驗證所有者
    const record = await this.findById(divinationId);
    if (record.user_id !== userId) {
      throw new Error('NOT_RECORD_OWNER');
    }

    const allowedKeys = ['question_text', 'result_payload'];
    const data = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        data[key] = key === 'result_payload' 
          ? (typeof value === 'string' ? value : JSON.stringify(value))
          : value;
      }
    }

    if (Object.keys(data).length === 0) {
      return this.findById(divinationId);
    }

    const setClauses = Object.keys(data)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), divinationId];

    const query = `
      UPDATE divination_records
      SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, values);

    const result = await this.findById(divinationId);
    if (result.result_payload) {
      result.result_payload = JSON.parse(result.result_payload);
    }
    return result;
  }

  /**
   * 刪除占卜記錄（軟刪除）
   */
  async deleteDivination(divinationId, userId) {
    const record = await this.findById(divinationId);
    if (record.user_id !== userId) {
      throw new Error('NOT_RECORD_OWNER');
    }

    const query = `
      UPDATE divination_records
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, [divinationId]);
  }

  /**
   * 同步本地占卜記錄到雲端
   * 處理衝突：last write wins
   */
  async syncLocalDivinations(userId, localRecords) {
    const syncResults = {
      synced: [],
      conflicts: [],
      errors: []
    };

    for (const localRecord of localRecords) {
      try {
        if (localRecord.local_uuid) {
          const existing = await this.db.get(`
            SELECT * FROM divination_records 
            WHERE user_id = ? AND local_uuid = ?
          `, [userId, localRecord.local_uuid]);

          if (existing) {
            // 比較時間戳 - 較新的版本獲勝
            const localTime = new Date(localRecord.updated_at || localRecord.created_at).getTime();
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();

            if (localTime > existingTime) {
              // 本地版本更新 - 更新雲端
              await this.updateDivination(existing.id, userId, {
                question_text: localRecord.question_text,
                result_payload: localRecord.result_payload
              });
              syncResults.synced.push(localRecord.local_uuid);
            } else {
              // 雲端版本較新 - 記錄衝突
              syncResults.conflicts.push({
                localUuid: localRecord.local_uuid,
                cloudId: existing.id,
                cloudVersion: existing.updated_at || existing.created_at
              });
            }
          } else {
            // 新記錄 - 保存
            await this.createDivination(
              userId,
              localRecord.gua_id,
              localRecord.question_text,
              localRecord.result_payload,
              'imported',
              localRecord.local_uuid
            );
            syncResults.synced.push(localRecord.local_uuid);
          }
        }
      } catch (error) {
        syncResults.errors.push({
          localUuid: localRecord.local_uuid,
          error: error.message
        });
      }
    }

    return syncResults;
  }

  /**
   * 獲取特定卦的占卜統計
   */
  async getGuaDivinationStats(guaId) {
    const query = `
      SELECT COUNT(*) as total_count, COUNT(DISTINCT user_id) as unique_users
      FROM divination_records
      WHERE gua_id = ? AND deleted_at IS NULL
    `;

    return this.db.get(query, [guaId]);
  }
}
