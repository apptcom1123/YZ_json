/**
 * 前端認證管理
 * 處理登入、登出、會話管理
 * 假設 api 已作為全局變量可用（來自 api-client.js）
 */

class AuthManager {
  constructor() {
    this.user = null;
    this.isLoggedIn = false;
    this.listeners = [];
    this.loadFromStorage();
  }

  /**
   * 初始化認證（檢查會話狀態）
   */
  async init() {
    try {
      // 檢查是否有有效的會話
      if (typeof api !== 'undefined' && api.sessionToken) {
        const status = await api.getAuthStatus();
        if (status.loggedIn) {
          this.user = status.user;
          this.isLoggedIn = true;
          this.notifyListeners();
        }
      }
    } catch (error) {
      console.warn('Auth check failed:', error);
    }
  }

  /**
   * 從存儲加載用戶信息
   */
  loadFromStorage() {
    const userJson = localStorage.getItem('user');
    if (userJson) {
      try {
        this.user = JSON.parse(userJson);
        this.isLoggedIn = true;
      } catch (e) {
        console.error('Failed to load user from storage:', e);
      }
    }
  }

  /**
   * 保存用戶信息到存儲
   */
  saveToStorage() {
    if (this.user) {
      localStorage.setItem('user', JSON.stringify(this.user));
    } else {
      localStorage.removeItem('user');
    }
  }

  /**
   * 啟動 Mock OAuth 流程
   */
  async startLogin(returnTo = '/') {
    try {
      const { authUrl, state, nonce } = await api.startOAuth(returnTo);

      // 保存狀態用於回調驗證
      sessionStorage.setItem('oauth_state', state);
      sessionStorage.setItem('oauth_nonce', nonce);
      sessionStorage.setItem('oauth_return_to', returnTo);

      // 在開發環境中，顯示測試帳號選擇器
      return {
        state,
        nonce,
        returnTo,
        authUrl
      };
    } catch (error) {
      console.error('Failed to start login:', error);
      throw error;
    }
  }

  /**
   * 完成 OAuth 登入
   */
  async completeLogin(state, nonce, selectedAccount = 'test1') {
    try {
      const storedState = sessionStorage.getItem('oauth_state');
      const storedNonce = sessionStorage.getItem('oauth_nonce');
      const returnTo = sessionStorage.getItem('oauth_return_to') || '/';

      if (state !== storedState || nonce !== storedNonce) {
        throw new Error('State/Nonce mismatch');
      }

      const response = await api.completeOAuth(state, nonce, selectedAccount);

      // 保存會話 token
      api.saveSessionToken(response.sessionToken);

      // 保存用戶信息
      this.user = response.user;
      this.isLoggedIn = true;
      this.saveToStorage();

      // 清理臨時存儲
      sessionStorage.removeItem('oauth_state');
      sessionStorage.removeItem('oauth_nonce');
      sessionStorage.removeItem('oauth_return_to');

      // 通知監聽者
      this.notifyListeners();

      return {
        success: true,
        user: this.user,
        returnTo: response.returnTo
      };
    } catch (error) {
      console.error('Failed to complete login:', error);
      throw error;
    }
  }

  /**
   * 登出
   */
  async logout() {
    try {
      await api.logout();
      this.user = null;
      this.isLoggedIn = false;
      api.clearSessionToken();
      this.saveToStorage();
      this.notifyListeners();
      return { success: true };
    } catch (error) {
      console.error('Logout failed:', error);
      // 即使 API 失敗也清除本地會話
      this.user = null;
      this.isLoggedIn = false;
      api.clearSessionToken();
      this.saveToStorage();
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * 檢查登入狀態
   */
  async checkAuthStatus() {
    try {
      const response = await api.getAuthStatus();
      if (response.loggedIn) {
        this.user = response.user;
        this.isLoggedIn = true;
      } else {
        this.user = null;
        this.isLoggedIn = false;
        api.clearSessionToken();
      }
      this.saveToStorage();
      this.notifyListeners();
      return response;
    } catch (error) {
      // 未認證狀態也是有效的
      this.user = null;
      this.isLoggedIn = false;
      api.clearSessionToken();
      this.saveToStorage();
      this.notifyListeners();
      return { loggedIn: false };
    }
  }

  /**
   * 訂閱認證狀態變更
   */
  onAuthChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * 通知所有監聽者
   */
  notifyListeners() {
    this.listeners.forEach(callback => {
      callback({
        isLoggedIn: this.isLoggedIn,
        user: this.user
      });
    });
  }

  /**
   * 獲取當前用戶
   */
  getUser() {
    return this.user;
  }

  /**
   * 檢查是否已登入
   */
  isAuthenticated() {
    return this.isLoggedIn;
  }

  /**
   * 獲取當前用戶
   */
  getCurrentUser() {
    return this.user;
  }
}

// 創建全局單一實例
const authManager = new AuthManager();

