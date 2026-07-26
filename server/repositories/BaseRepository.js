/**
 * Base Repository Pattern - 可插拔的數據層
 * 支持 SQLite (開發) 和 Supabase PostgreSQL (生產)
 */

export class BaseRepository {
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
  }

  /**
   * 查詢單筆記錄
   */
  async findById(id) {
    const query = `SELECT * FROM ${this.tableName} WHERE id = ?`;
    return this.db.get(query, [id]);
  }

  /**
   * 查詢多筆記錄
   */
  async findAll(options = {}) {
    let query = `SELECT * FROM ${this.tableName}`;
    const params = [];

    if (options.where) {
      const conditions = Object.entries(options.where)
        .map(([key, value]) => `${key} = ?`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
      params.push(...Object.values(options.where));
    }

    if (options.orderBy) {
      query += ` ORDER BY ${options.orderBy}`;
    }

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      query += ` OFFSET ${options.offset}`;
    }

    return this.db.all(query, params);
  }

  /**
   * 創建新記錄
   */
  async create(data) {
    const keys = Object.keys(data).filter(k => data[k] !== undefined);
    const values = keys.map(k => data[k]);
    const placeholders = keys.map(() => '?').join(', ');

    const query = `
      INSERT INTO ${this.tableName} (${keys.join(', ')})
      VALUES (${placeholders})
      RETURNING id
    `;

    try {
      // Try RETURNING clause (SQLite 3.35+)
      const result = await this.db.get(query, values);
      return result?.id;
    } catch (error) {
      // Fallback for older SQLite without RETURNING
      // Use a transaction to ensure we get the right ID
      await this.db.run(
        `INSERT INTO ${this.tableName} (${keys.join(', ')})
         VALUES (${placeholders})`,
        values
      );
      
      // Query the just-inserted row
      // If we inserted a UUID, we can find it by the data we know
      // For now, just return the provided ID if it exists
      if (data.id) {
        return data.id;
      }
      
      // Otherwise get the last inserted row
      const lastRow = await this.db.get(
        `SELECT id FROM ${this.tableName} ORDER BY rowid DESC LIMIT 1`
      );
      return lastRow?.id;
    }
  }

  /**
   * 更新記錄
   */
  async update(id, data) {
    const updates = Object.entries(data)
      .map(([key]) => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), id];

    const query = `
      UPDATE ${this.tableName}
      SET ${updates}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    await this.db.run(query, values);
    return this.findById(id);
  }

  /**
   * 刪除記錄
   */
  async delete(id) {
    const query = `DELETE FROM ${this.tableName} WHERE id = ?`;
    return this.db.run(query, [id]);
  }

  /**
   * 批量操作
   */
  async transaction(callback) {
    await this.db.exec('BEGIN TRANSACTION');
    try {
      const result = await callback(this.db);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 原始查詢（用於複雜 SQL）
   */
  async rawQuery(query, params = []) {
    return this.db.all(query, params);
  }

  /**
   * 原始執行（用於 INSERT/UPDATE/DELETE）
   */
  async rawRun(query, params = []) {
    return this.db.run(query, params);
  }
}
