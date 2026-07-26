/**
 * Base Repository Pattern - 可插拔的數據層
 * 完整支持 SQLite (開發) 和 Supabase PostgreSQL (生產)
 */

export class BaseRepository {
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
    
    // 判斷是 SQLite 還是 Supabase（檢查 from 方法是否存在）
    this.isSupabase = db?.from ? true : false;
    this.isSQLite = !this.isSupabase;
  }

  /**
   * 查詢單筆記錄
   */
  async findById(id) {
    if (this.isSupabase) {
      const { data, error } = await this.db
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      const query = `SELECT * FROM ${this.tableName} WHERE id = ? AND deleted_at IS NULL`;
      return this.db.get(query, [id]) || null;
    }
  }

  /**
   * 查詢多筆記錄
   */
  async findAll(options = {}) {
    if (this.isSupabase) {
      let query = this.db.from(this.tableName).select('*').is('deleted_at', null);
      
      if (options.where) {
        for (const [key, value] of Object.entries(options.where)) {
          query = query.eq(key, value);
        }
      }
      
      if (options.orderBy) {
        const parts = options.orderBy.split(' ');
        const column = parts[0];
        const direction = parts[1] || 'ASC';
        query = query.order(column, { ascending: direction === 'ASC' });
      }
      
      if (options.limit) {
        query = query.limit(options.limit);
      }
      
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } else {
      let query = `SELECT * FROM ${this.tableName} WHERE deleted_at IS NULL`;
      const params = [];

      if (options.where) {
        const conditions = Object.entries(options.where)
          .map(([key, value]) => `${key} = ?`)
          .join(' AND ');
        query += ` AND ${conditions}`;
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

      return this.db.all(query, params) || [];
    }
  }

  /**
   * 創建新記錄
   */
  async create(data) {
    if (this.isSupabase) {
      const { data: result, error } = await this.db
        .from(this.tableName)
        .insert([data])
        .select('id');
      
      if (error) throw error;
      return result?.[0]?.id;
    } else {
      const keys = Object.keys(data).filter(k => data[k] !== undefined);
      const values = keys.map(k => data[k]);
      const placeholders = keys.map(() => '?').join(', ');

      const query = `
        INSERT INTO ${this.tableName} (${keys.join(', ')})
        VALUES (${placeholders})
      `;

      try {
        await this.db.run(query, values);
        
        if (data.id) {
          return data.id;
        }
        
        const lastRow = await this.db.get(
          `SELECT id FROM ${this.tableName} ORDER BY rowid DESC LIMIT 1`
        );
        return lastRow?.id;
      } catch (error) {
        console.error(`Error creating ${this.tableName}:`, error);
        throw error;
      }
    }
  }

  /**
   * 更新記錄
   */
  async update(id, data) {
    if (this.isSupabase) {
      const updateData = {
        ...data,
        updated_at: new Date().toISOString()
      };
      
      const { error } = await this.db
        .from(this.tableName)
        .update(updateData)
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } else {
      const updates = Object.entries(data)
        .map(([key]) => `${key} = ?`)
        .join(', ');
      const values = [...Object.values(data), id];

      const query = `
        UPDATE ${this.tableName}
        SET ${updates}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      try {
        await this.db.run(query, values);
        return true;
      } catch (error) {
        console.error(`Error updating ${this.tableName}:`, error);
        throw error;
      }
    }
  }

  /**
   * 軟刪除記錄（設置 deleted_at）
   */
  async delete(id) {
    if (this.isSupabase) {
      const { error } = await this.db
        .from(this.tableName)
        .update({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      
      if (error) throw error;
      return true;
    } else {
      const query = `
        UPDATE ${this.tableName}
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      try {
        await this.db.run(query, [id]);
        return true;
      } catch (error) {
        console.error(`Error deleting ${this.tableName}:`, error);
        throw error;
      }
    }
  }

  /**
   * 原始查詢（用於複雜 SQL - SQLite 專用）
   */
  async rawQuery(query, params = []) {
    if (this.isSupabase) {
      throw new Error('rawQuery is not supported for Supabase. Use the query builder instead.');
    }
    return this.db.all(query, params);
  }

  /**
   * 原始執行（用於 INSERT/UPDATE/DELETE - SQLite 專用）
   */
  async rawRun(query, params = []) {
    if (this.isSupabase) {
      throw new Error('rawRun is not supported for Supabase. Use the query builder instead.');
    }
    return this.db.run(query, params);
  }

  /**
   * 取得資料庫類型
   */
  getDbType() {
    return this.isSupabase ? 'Supabase' : 'SQLite';
  }
}
