class AuthManager {
  constructor() {
    this.user = null;
    this.isLoggedIn = false;
    this.requiresTerms = false;
    this.listeners = [];
    this.client = null;
    this.statusPromise = null;
    this.authRefreshQueue = Promise.resolve();
  }

  async init() {
    const config = window.__SUPABASE_CONFIG__;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
      throw new Error('Supabase public configuration is unavailable.');
    }
    if (!window.supabase?.createClient) throw new Error('Supabase SDK failed to load.');

    this.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) api.saveSessionToken(session.access_token);
      if (!session) api.clearSessionToken();
      window.setTimeout(() => this.queueAuthStatusRefresh(), 0);
    });
    const { data: { session } } = await this.client.auth.getSession();
    if (session?.access_token) api.saveSessionToken(session.access_token);
    return this.checkAuthStatus();
  }

  async startLogin(returnTo = '/') {
    if (!this.client) await this.init();
    sessionStorage.setItem('auth_return_to', returnTo);
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` }
    });
    if (error) throw error;
  }

  async logout() {
    try { await api.logout(); } catch (_) { /* Continue local sign-out. */ }
    if (this.client) await this.client.auth.signOut();
    this.user = null; this.isLoggedIn = false; api.clearSessionToken(); this.notifyListeners();
  }

  async checkAuthStatus() {
    if (this.statusPromise) return this.statusPromise;
    this.statusPromise = this.refreshAuthStatus();
    try {
      return await this.statusPromise;
    } finally {
      this.statusPromise = null;
    }
  }

  queueAuthStatusRefresh() {
    this.authRefreshQueue = this.authRefreshQueue
      .catch(() => {})
      .then(async () => {
        if (this.statusPromise) await this.statusPromise;
        return this.checkAuthStatus();
      });
    return this.authRefreshQueue;
  }

  async refreshAuthStatus() {
    let response = null;
    try {
      const termsVersion = window.ICHING_TERMS_VERSION || '2026-07-26';
      const browserAccepted = localStorage.getItem('iching_terms_version') === termsVersion;
      response = await api.getAuthStatus();

      // The pre-login checkbox is recorded locally before OAuth. Once Google has
      // verified the user, use that authenticated session to persist the consent.
      if (response.requiresTerms && browserAccepted) {
        const accepted = await api.acceptTerms(termsVersion);
        if (!accepted?.termsAccepted || accepted.acceptedVersion !== termsVersion) {
          throw new Error('TERMS_STATUS_NOT_UPDATED');
        }
        response = await api.getAuthStatus();
      }

      this.user = response.user || null;
      this.requiresTerms = Boolean(response.requiresTerms) || (Boolean(response.loggedIn) && !browserAccepted);
      this.isLoggedIn = Boolean(response.loggedIn) && browserAccepted && !this.requiresTerms;
      this.notifyListeners(); return response;
    } catch (error) {
      console.error('Authentication status refresh failed:', error);
      this.user = response?.user || this.user || null;
      this.isLoggedIn = false;
      this.requiresTerms = Boolean(response?.requiresTerms && this.user);
      this.notifyListeners();
      return { loggedIn: false, requiresTerms: this.requiresTerms, user: this.user };
    }
  }

  onAuthChange(callback) { this.listeners.push(callback); }
  notifyListeners() { this.listeners.forEach(callback => callback({ isLoggedIn: this.isLoggedIn, user: this.user })); }
  getUser() { return this.user; }
  getCurrentUser() { return this.user; }
  isAuthenticated() { return this.isLoggedIn; }
}

const authManager = new AuthManager();
