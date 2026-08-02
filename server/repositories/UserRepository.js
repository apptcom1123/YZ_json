import { BaseRepository } from './BaseRepository.js';

export class UserRepository extends BaseRepository {
  constructor(db) { super(db, 'users'); }
  async findByGoogleSub(googleSub) { return this.findOne({ google_sub: googleSub }); }
  async findByEmail(email) { return this.findOne({ email }); }

  async upsertFromSupabaseAuth(authUser) {
    const identity = authUser.identities?.find(item => item.provider === 'google');
    const metadata = authUser.user_metadata || {};
    const now = new Date().toISOString();
    const googleSub = identity?.identity_data?.sub || metadata.sub || authUser.id;
    const displayName = metadata.full_name || metadata.name || authUser.email || '使用者';
    const { error } = await this.db.from('users').upsert({
      id: authUser.id, google_sub: googleSub, email: authUser.email,
      display_name: displayName, public_display_name: displayName,
      avatar_url: metadata.avatar_url || metadata.picture || null, last_login_at: now,
      is_active: true, updated_at: now
    }, { onConflict: 'id' });
    if (error) throw error;
    const { error: settingsError } = await this.db.from('user_settings').upsert({ user_id: authUser.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (settingsError) throw settingsError;
    const { error: statsError } = await this.db.from('user_stats').upsert({ user_id: authUser.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (statsError) throw statsError;
    return this.findById(authUser.id);
  }

  async getUserWithSettings(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    const { data, error } = await this.db.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return { ...user, ...(data || {}) };
  }

  async updateUserSettings(userId, settings) {
    const allowed = ['save_notes_to_cloud', 'save_divination_to_cloud', 'allow_public_notes', 'note_visibility_threshold_percent', 'language', 'timezone', 'notify_on_reply'];
    const updates = Object.fromEntries(Object.entries(settings).filter(([key]) => allowed.includes(key)));
    if (Object.keys(updates).length) {
      const { error } = await this.db.from('user_settings').update({ ...updates, updated_at: new Date().toISOString() }).eq('user_id', userId);
      if (error) throw error;
    }
    return this.getUserWithSettings(userId);
  }

  async updateProfile(userId, { displayName }) {
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (!name || name.length > 50) throw new Error('INVALID_DISPLAY_NAME');
    const { data, error } = await this.db
      .from('users')
      .update({ display_name: name, public_display_name: name, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, display_name, public_display_name, avatar_url, role')
      .single();
    if (error) throw error;
    return data;
  }

  async hasAcceptedTerms(userId, version) {
    const { data, error } = await this.db.from('legal_consents').select('*').eq('user_id', userId).eq('doc_type', 'terms').eq('doc_version', version).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async acceptTerms(userId, version, ipAddress = null, userAgent = null) {
    const { error: deleteError } = await this.db.from('legal_consents').delete().eq('user_id', userId).eq('doc_type', 'terms');
    if (deleteError) throw deleteError;
    const { error: consentError } = await this.db.from('legal_consents').insert({ user_id: userId, doc_type: 'terms', doc_version: version, ip_address: ipAddress, user_agent: userAgent });
    if (consentError) throw consentError;
    const { error: settingsError } = await this.db.from('user_settings').update({ terms_accepted: true, accepted_terms_version: version, terms_accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (settingsError) throw settingsError;
  }

  async disableUser(userId, reason) {
    const { error } = await this.db.from('users').update({ is_active: false, disabled_reason: reason, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw error;
  }

  async softDelete(userId) {
    const deletedAt = new Date().toISOString();
    const operations = [
      this.db.from('users').update({ deleted_at: deletedAt, is_active: false, updated_at: deletedAt }).eq('id', userId),
      this.db.from('notes').update({ status: 'deleted', deleted_at: deletedAt, updated_at: deletedAt }).eq('author_id', userId),
      this.db.from('note_replies').update({ status: 'deleted', updated_at: deletedAt }).eq('author_id', userId),
      this.db.from('note_votes').delete().eq('user_id', userId), this.db.from('note_favorites').delete().eq('user_id', userId),
      this.db.from('divination_records').delete().eq('user_id', userId)
    ];
    for (const operation of operations) { const { error } = await operation; if (error) throw error; }
  }

  async canLogin(userId) {
    const user = await this.findById(userId);
    if (!user) return { allowed: false, reason: 'USER_NOT_FOUND' };
    if (!user.is_active) return { allowed: false, reason: 'ACCOUNT_DISABLED', disabledReason: user.disabled_reason };
    const { data, error } = await this.db.from('user_settings').select('terms_accepted').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.terms_accepted ? { allowed: true } : { allowed: false, reason: 'TERMS_NOT_ACCEPTED' };
  }

  async getUserStats(userId) {
    const { data, error } = await this.db.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  }
}
