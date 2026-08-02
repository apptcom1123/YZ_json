/** Shared Supabase repository helpers. SQLite is intentionally unsupported. */
export class BaseRepository {
  constructor(db, tableName) {
    if (!db?.from) throw new Error('Supabase client is required');
    this.db = db;
    this.tableName = tableName;
    this.isSupabase = true;
    this.hasDeletedAt = ['users', 'divination_records', 'notes', 'deletion_audit_logs'].includes(tableName);
  }

  async callOptionalRpc(name,args){
    const {data,error}=await this.db.rpc(name,args);
    if(error){
      const missing=error.code==='PGRST202'||error.code==='42883'
        ||error.message?.includes('Could not find the function')
        ||/function\s+.+does not exist/i.test(error.message||'');
      if(missing)return null;
      throw error;
    }
    return data;
  }

  async findById(id) {
    let query = this.db.from(this.tableName).select('*').eq('id', id);
    if (this.hasDeletedAt) query = query.is('deleted_at', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async findOne(where = {}) {
    if (!Object.keys(where).length) throw new Error('findOne requires a condition');
    let query = this.db.from(this.tableName).select('*');
    if (this.hasDeletedAt) query = query.is('deleted_at', null);
    for (const [key, value] of Object.entries(where)) query = query.eq(key, value);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async findAll(options = {}) {
    let query = this.db.from(this.tableName).select('*');
    if (this.hasDeletedAt) query = query.is('deleted_at', null);
    for (const [key, value] of Object.entries(options.where || {})) query = query.eq(key, value);
    if (options.orderBy) {
      const [column, direction = 'ASC'] = options.orderBy.split(' ');
      query = query.order(column, { ascending: direction.toUpperCase() === 'ASC' });
    }
    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async create(data) {
    const { data: result, error } = await this.db.from(this.tableName).insert(data).select('id').single();
    if (error) throw error;
    return result.id;
  }

  async update(id, data) {
    const { error } = await this.db.from(this.tableName).update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return true;
  }

  async delete(id) {
    const query = this.hasDeletedAt
      ? this.db.from(this.tableName).update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
      : this.db.from(this.tableName).delete().eq('id', id);
    const { error } = await query;
    if (error) throw error;
    return true;
  }

  getDbType() { return 'Supabase PostgreSQL'; }
}
