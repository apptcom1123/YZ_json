import { BaseRepository } from './BaseRepository.js';
import crypto from 'crypto';

export class UserRepository extends BaseRepository {
  constructor(db) {
    super(db, 'users');
  }

  /**
   * 通過 Google Sub 查找用戶
   */
  async findByGoogleSub(googleSub) {
    return this.findOne({ google_sub: googleSub });
  }

  /**
   * 通過 Email 查找用戶
   */
  async findByEmail(email) {
    return this.findOne({ email });
  }

  /**
   * 創建或更新用戶（OAuth 登入流程用）
   */
  async upsertFromGoogleAuth(googleData) {
    const { sub, email, name, picture, _disabled, _disabledReason } = googleData;
    
    let user = await this.findByGoogleSub(sub);

    if (user) {
      // 更新最後登入時間
      await this.update(user.id, {
        last_login_at: new Date().toISOString()
      });
      return this.findById(user.id);
    }

    // 生成匿名代碼用於公開顯示
    const publicAlias = this.generatePublicAlias();

    // 創建新用戶 - 讓 SQLite 自動生成 ID
    const userId = await this.create({
      google_sub: sub,
      email: email,
      display_name: name || email,
      avatar_url: picture || null,
      public_display_name: name || email,
      last_login_at: new Date().toISOString(),
      is_active: _disabled ? 0 : 1,
      disabled_reason: _disabled ? (_disabledReason || '帳號已禁用') : null
    });

    // 為新用戶創建設定
    const db = this.db;
    await db.run(`
      INSERT INTO user_settings (user_id, terms_accepted)
      VALUES (?, 0)
    `, [userId]);

    // 為新用戶創建統計
    await db.run(`
      INSERT INTO user_stats (user_id)
      VALUES (?)
    `, [userId]);

    return this.findById(userId);
  }

  /**
   * 獲取用戶的完整信息（含設定）
   */
  async getUserWithSettings(userId) {
    const user = await this.findById(userId);
    if (!user) return null;

    // 從 user_settings 表獲取設置
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      const settings = data || {};
      return { ...user, ...settings };
    } else {
      const query = `
        SELECT u.*, us.* 
        FROM users u
        LEFT JOIN user_settings us ON u.id = us.user_id
        WHERE u.id = ? AND u.deleted_at IS NULL
      `;
      return this.db.get(query, [userId]) || null;
    }
  }

  /**
   * 更新用戶設定
   */
  async updateUserSettings(userId, settings) {
    const allowedKeys = [
      'save_notes_to_cloud',
      'save_divination_to_cloud',
      'allow_public_notes',
      'note_visibility_threshold_percent',
      'language',
      'timezone',
      'notify_on_reply'
    ];

    const updates = {};
    for (const [key, value] of Object.entries(settings)) {
      if (allowedKeys.includes(key)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.getUserWithSettings(userId);
    }

    const setClauses = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(updates), userId];

    const query = `
      UPDATE user_settings
      SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `;

    await this.db.run(query, values);
    return this.getUserWithSettings(userId);
  }

  /**
   * 檢查用戶是否已接受條款
   */
  async hasAcceptedTerms(userId, version) {
    return this.findOne({ 
      user_id: userId, 
      doc_type: 'terms', 
      doc_version: version 
    });
  }

  /**
   * 記錄條款接受
   */
  async acceptTerms(userId, version, ipAddress = null, userAgent = null) {
    // 刪除舊的同類型文檔記錄
    await this.db.run(`
      DELETE FROM legal_consents WHERE user_id = ? AND doc_type = 'terms'
    `, [userId]);
    
    // 插入新記錄
    const query = `
      INSERT INTO legal_consents (user_id, doc_type, doc_version, ip_address, user_agent)
      VALUES (?, 'terms', ?, ?, ?)
    `;

    await this.db.run(query, [userId, version, ipAddress, userAgent]);

    // 更新用戶設定
    await this.db.run(`
      UPDATE user_settings
      SET terms_accepted = 1, accepted_terms_version = ?, terms_accepted_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [version, userId]);
  }

  /**
   * 禁用用戶
   */
  async disableUser(userId, reason) {
    const query = `
      UPDATE users
      SET is_active = 0, disabled_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await this.db.run(query, [reason, userId]);
  }

  /**
   * 軟刪除用戶（不可恢復）
   */
  async softDelete(userId) {
    const query = `
      UPDATE users
      SET deleted_at = CURRENT_TIMESTAMP, is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await this.db.run(query, [userId]);

    // 級聯刪除相關數據
    await this.transaction(async (db) => {
      // 刪除用戶的所有註記
      await db.run(`UPDATE notes SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?`, [userId]);
      
      // 刪除用戶的所有回覆
      await db.run(`UPDATE note_replies SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE author_id = ?`, [userId]);
      
      // 清除用戶的投票和收藏
      await db.run(`DELETE FROM note_votes WHERE user_id = ?`, [userId]);
      await db.run(`DELETE FROM note_favorites WHERE user_id = ?`, [userId]);
      
      // 刪除用戶的占卜記錄
      await db.run(`DELETE FROM divination_records WHERE user_id = ?`, [userId]);
    });
  }

  /**
   * 生成匿名代碼
   */
  generatePublicAlias() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let alias = '';
    for (let i = 0; i < 4; i++) {
      alias += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return alias;
  }

  /**
   * 檢查用戶是否可以登入
   */
  async canLogin(userId) {
    const user = await this.findById(userId);
    if (!user) return { allowed: false, reason: 'USER_NOT_FOUND' };
    if (!user.is_active) return { allowed: false, reason: 'ACCOUNT_DISABLED', disabledReason: user.disabled_reason };
    if (user.deleted_at) return { allowed: false, reason: 'ACCOUNT_DELETED' };

    let settings;
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('user_settings')
        .select('terms_accepted')
        .eq('user_id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      settings = data;
    } else {
      settings = this.db.get('SELECT terms_accepted FROM user_settings WHERE user_id = ?', [userId]);
    }

    if (!settings?.terms_accepted) {
      return { allowed: false, reason: 'TERMS_NOT_ACCEPTED' };
    }

    return { allowed: true };
  }

  /**
   * 獲取用戶統計
   */
  async getUserStats(userId) {
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      const query = `SELECT * FROM user_stats WHERE user_id = ?`;
      return this.db.get(query, [userId]) || null;
    }
  }
}
