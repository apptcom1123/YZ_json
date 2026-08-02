class AuthManager {
  constructor() { this.user = null; this.isLoggedIn = false; this.listeners = []; this.client = null; }
  async init() {
    const config = await fetch('/api/auth/config').then(async response => {
      if (!response.ok) throw new Error('無法讀取 Supabase 設定');
      return response.json();
    });
    if (!window.supabase?.createClient) throw new Error('Supabase SDK 未載入');
    this.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) api.saveSessionToken(session.access_token);
      if (!session) api.clearSessionToken();
    });
    const { data: { session } } = await this.client.auth.getSession();
    if (session?.access_token) api.saveSessionToken(session.access_token);
    return this.checkAuthStatus();
  }
  async startLogin(returnTo = '/') {
    if (!this.client) await this.init();
    sessionStorage.setItem('auth_return_to', returnTo);
    const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
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
      this.user = response.user; this.isLoggedIn = Boolean(response.loggedIn);
      this.notifyListeners(); return response;
    } catch (_) { this.user = null; this.isLoggedIn = false; this.notifyListeners(); return { loggedIn: false }; }
  }
  onAuthChange(callback) { this.listeners.push(callback); }
  notifyListeners() { this.listeners.forEach(callback => callback({ isLoggedIn: this.isLoggedIn, user: this.user })); }
  getUser() { return this.user; }
  getCurrentUser() { return this.user; }
  isAuthenticated() { return this.isLoggedIn; }
}
const authManager = new AuthManager();
