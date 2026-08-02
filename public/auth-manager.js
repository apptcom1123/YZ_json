class AuthManager {
  constructor() { this.user = null; this.isLoggedIn = false; this.requiresTerms = false; this.listeners = []; this.client = null; }

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
      window.setTimeout(() => this.checkAuthStatus(), 0);
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
    try {
      const response = await api.getAuthStatus();
      const browserAccepted = localStorage.getItem('iching_terms_version') === '2026-07-26';
      this.user = response.user;
      this.requiresTerms = Boolean(response.requiresTerms) || !browserAccepted;
      this.isLoggedIn = Boolean(response.loggedIn) && browserAccepted;
      this.notifyListeners(); return response;
    } catch (_) {
      this.user = null; this.isLoggedIn = false; this.requiresTerms = false; this.notifyListeners(); return { loggedIn: false };
    }
  }

  onAuthChange(callback) { this.listeners.push(callback); }
  notifyListeners() { this.listeners.forEach(callback => callback({ isLoggedIn: this.isLoggedIn, user: this.user })); }
  getUser() { return this.user; }
  getCurrentUser() { return this.user; }
  isAuthenticated() { return this.isLoggedIn; }
}

const authManager = new AuthManager();
