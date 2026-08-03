/**
 * 前端 API 客戶端
 * 管理所有與後端的通信
 */

class APIClient {
  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
    this.sessionToken = this.loadSessionToken();
  }

  /**
   * 從 localStorage 載入會話 token
   */
  loadSessionToken() {
    return localStorage.getItem('sessionToken');
  }

  /**
   * 保存會話 token
   */
  saveSessionToken(token) {
    this.sessionToken = token;
    localStorage.setItem('sessionToken', token);
  }

  /**
   * 清除會話 token
   */
  clearSessionToken() {
    this.sessionToken = null;
    localStorage.removeItem('sessionToken');
  }

  /**
   * 獲取 Authorization header
   */
  getAuthHeader() {
    if (this.sessionToken) {
      return {
        'Authorization': `Bearer ${this.sessionToken}`
      };
    }
    return {};
  }

  /**
   * 發送 HTTP 請求
   */
  async request(method, endpoint, data = null) {
    const url = `${this.baseURL}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader()
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);
      const responseData = await response.json();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || responseData.error === 'IDENTITY_VERIFICATION_FAILED') {
          throw new APIError(
            'IDENTITY_VERIFICATION_FAILED',
            responseData.error === 'IDENTITY_VERIFICATION_FAILED'
              ? responseData.message
              : '身分驗證失敗：非使用者本人、沒有此操作權限，或驗證已失效。',
            response.status
          );
        }
        throw new APIError(
          responseData.error || 'UNKNOWN_ERROR',
          responseData.message || '未知錯誤',
          response.status
        );
      }

      return responseData;
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError('NETWORK_ERROR', '網路連接失敗', 0);
    }
  }

  /**
   * GET 請求
   */
  get(endpoint) {
    return this.request('GET', endpoint);
  }

  /**
   * POST 請求
   */
  post(endpoint, data) {
    return this.request('POST', endpoint, data);
  }

  /**
   * PATCH 請求
   */
  patch(endpoint, data) {
    return this.request('PATCH', endpoint, data);
  }

  /**
   * DELETE 請求
   */
  delete(endpoint) {
    return this.request('DELETE', endpoint);
  }

  // ========== 認證 API ==========

  /**
   * 登出
   */
  logout() {
    this.clearSessionToken();
    return this.post('/auth/logout', {});
  }

  /**
   * 獲取登入狀態
   */
  getAuthStatus() {
    return this.get('/auth/status');
  }

  // ========== 用戶 API ==========

  /**
   * 獲取用戶設置
   */
  getUserSettings() {
    return this.get('/me/settings');
  }

  /**
   * 更新用戶設置
   */
  updateUserSettings(settings) {
    return this.patch('/me/settings', { settings });
  }

  updateProfile(profile) {
    return this.patch('/me/profile', profile);
  }

  /**
   * 接受使用條款
   */
  acceptTerms(docVersion) {
    return this.post('/me/terms/accept', {
      docType: 'terms',
      docVersion
    });
  }

  /**
   * 獲取條款接受狀態
   */
  getTermsStatus() {
    return this.get('/me/terms/status');
  }

  /**
   * 更新通知設置
   */
  updateNotificationSettings(notifyOnReply) {
    return this.patch('/me/settings/notifications', { notifyOnReply });
  }

  /**
   * 刪除雲端數據
   */
  deleteCloudData(confirmEmail) {
    return this.post('/me/data/delete', { confirmEmail });
  }

  /**
   * 刪除帳號
   */
  deleteAccount(confirmEmail) {
    return this.post('/me/account/delete', { confirmEmail });
  }

  /**
   * 清除本機數據
   */
  clearLocalData(confirmEmail) {
    return this.post('/me/local-data/clear', { confirmEmail });
  }

  // ========== 註記 API ==========

  /**
   * 獲取公開註記
   */
  getNotes(articleId, paragraphAnchor, thresholdPercent = 50) {
    const params = new URLSearchParams({
      articleId,
      paragraphAnchor,
      thresholdPercent
    });
    return this.get(`/notes?${params}`);
  }

  getMyNotes() {
    return this.get('/notes/mine');
  }

  /**
   * 創建註記
   */
  createNote(noteData) {
    return this.post('/notes', noteData);
  }

  /**
   * 獲取單一註記
   */
  getNote(noteId) {
    return this.get(`/notes/${noteId}`);
  }

  /**
   * 更新註記
   */
  updateNote(noteId, updates) {
    return this.patch(`/notes/${noteId}`, updates);
  }

  /**
   * 刪除註記
   */
  deleteNote(noteId) {
    return this.delete(`/notes/${noteId}`);
  }

  /**
   * 投票
   */
  voteNote(noteId, voteType) {
    return this.post(`/notes/${noteId}/vote`, { voteType });
  }

  /**
   * 收藏/取消收藏
   */
  toggleFavorite(noteId) {
    return this.post(`/notes/${noteId}/favorite`, {});
  }

  /**
   * 獲取用戶收藏
   */
  getUserFavorites() {
    return this.get('/me/favorites');
  }

  // ========== 占卜 API ==========

  /**
   * 獲取用戶的占卜記錄
   */
  getDivinations() {
    return this.get('/divinations');
  }

  /**
   * 創建占卜記錄
   */
  createDivination(guaId, questionText, resultPayload) {
    return this.post('/divinations', {
      guaId,
      questionText,
      resultPayload
    });
  }

  /**
   * 更新占卜記錄
   */
  updateDivination(divinationId, questionText, resultPayload) {
    return this.patch(`/divinations/${divinationId}`, {
      questionText,
      resultPayload
    });
  }

  /**
   * 刪除占卜記錄
   */
  deleteDivination(divinationId) {
    return this.delete(`/divinations/${divinationId}`);
  }

  /**
   * 同步本地占卜記錄
   */
  syncDivinations(localRecords) {
    return this.post('/divinations/sync', { localRecords });
  }

  // ========== 回覆 API ==========

  /**
   * 獲取註記的回覆
   */
  getNoteReplies(noteId) {
    return this.get(`/notes/${noteId}/replies`);
  }

  getReplyAuthor(noteId, replyId) {
    return this.get(`/notes/${noteId}/replies/${replyId}/author`);
  }

  /**
   * 添加回覆
   */
  addReply(noteId, content, parentReplyId = null, clientMutationId = null) {
    return this.post(`/notes/${noteId}/replies`, {
      content,
      parentReplyId,
      clientMutationId
    });
  }

  /**
   * 編輯回覆
   */
  updateReply(noteId, replyId, content) {
    return this.patch(`/notes/${noteId}/replies/${replyId}`, { content });
  }

  /**
   * 刪除回覆
   */
  deleteReply(noteId, replyId) {
    return this.delete(`/notes/${noteId}/replies/${replyId}`);
  }

  /**
   * Vote for a reply. The API derives the voter from the verified session.
   */
  voteReply(noteId, replyId, voteType) {
    return this.post(`/notes/${noteId}/replies/${replyId}/vote`, { voteType });
  }

  // ========== 通知 API ==========

  /**
   * 獲取通知列表
   */
  getNotifications(limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit, offset });
    return this.get(`/me/notifications?${params}`);
  }

  /**
   * 獲取未讀通知
   */
  getUnreadNotifications() {
    return this.get('/me/notifications/unread');
  }

  /**
   * 標記通知為已讀
   */
  markNotificationAsRead(notificationId) {
    return this.patch(`/me/notifications/${notificationId}/read`, {});
  }

  /**
   * 標記所有通知為已讀
   */
  markAllNotificationsAsRead() {
    return this.patch('/me/notifications/read-all', {});
  }

  /**
   * 刪除通知
   */
  deleteNotification(notificationId) {
    return this.delete(`/me/notifications/${notificationId}`);
  }

  /**
   * 獲取統計信息
   */
  getStats() {
    return this.get('/me/stats');
  }

  // ========== 同步與衝突解決 API ==========

  /**
   * 檢查本地和遠端數據是否衝突
   */
  checkSync(localItems) {
    return this.post('/me/sync/check', { localItems });
  }

  /**
   * 解決同步衝突
   */
  resolveSync(conflicts, resolutions) {
    return this.post('/me/sync/resolve', { conflicts, resolutions });
  }
}

class APIError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'APIError';
  }
}

// 創建全局單一實例
const api = new APIClient();


