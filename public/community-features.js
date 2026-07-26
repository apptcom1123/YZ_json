/**
 * 社區功能擴展
 * 集成用戶認證、註記、投票、收藏等功能
 */

import { api } from './api-client.js';
import { authManager } from './auth-manager.js';

class CommunityFeatures {
  constructor() {
    this.isInitialized = false;
    this.currentThresholdPercent = 60;
  }

  /**
   * 初始化社區功能
   */
  async init() {
    if (this.isInitialized) return;

    // 檢查登入狀態
    await authManager.checkAuthStatus();

    // 設置 UI 元素
    this.setupAuthUI();
    this.setupCommunityUI();

    // 訂閱認證狀態變更
    authManager.onAuthChange(() => this.updateAuthUI());

    this.isInitialized = true;
  }

  /**
   * 設置認證 UI
   */
  setupAuthUI() {
    // 在右上角添加登入按鈕
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    const authContainer = document.createElement('div');
    authContainer.id = 'auth-container';
    authContainer.className = 'auth-container';

    topbar.insertAdjacentElement('beforeend', authContainer);

    this.updateAuthUI();
  }

  /**
   * 更新認證 UI
   */
  updateAuthUI() {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    if (authManager.isAuthenticated()) {
      const user = authManager.getUser();

      // 顯示用戶菜單
      const userMenu = document.createElement('div');
      userMenu.className = 'user-menu';
      userMenu.innerHTML = `
        <button class="user-avatar" title="${user.displayName}">
          ${user.avatarUrl ? `<img src="${user.avatarUrl}" alt="">` : '👤'}
        </button>
        <div class="user-dropdown" hidden>
          <div class="user-info">
            <strong>${user.displayName}</strong>
            <small>${user.email}</small>
          </div>
          <hr>
          <button class="menu-item" id="go-to-settings">⚙️ 設定</button>
          <button class="menu-item" id="go-to-profile">👤 個人中心</button>
          <button class="menu-item" id="logout-btn">🚪 登出</button>
        </div>
      `;

      authContainer.appendChild(userMenu);

      // 添加事件監聽
      const avatar = userMenu.querySelector('.user-avatar');
      const dropdown = userMenu.querySelector('.user-dropdown');

      avatar.addEventListener('click', () => {
        dropdown.hidden = !dropdown.hidden;
      });

      document.addEventListener('click', (e) => {
        if (!userMenu.contains(e.target)) {
          dropdown.hidden = true;
        }
      });

      document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
          await authManager.logout();
          location.href = '/';
        } catch (error) {
          alert('登出失敗: ' + error.message);
        }
      });

      document.getElementById('go-to-settings').addEventListener('click', () => {
        location.href = '/#settings';
      });

      document.getElementById('go-to-profile').addEventListener('click', () => {
        location.href = '/#profile';
      });
    } else {
      // 顯示登入按鈕
      const loginBtn = document.createElement('button');
      loginBtn.className = 'login-button icon-button';
      loginBtn.title = '登入';
      loginBtn.textContent = '🔓';
      loginBtn.addEventListener('click', () => this.openLoginModal());

      authContainer.appendChild(loginBtn);
    }
  }

  /**
   * 打開登入模態框
   */
  async openLoginModal() {
    try {
      // 獲取測試帳號列表
      const { accounts } = await api.getTestAccounts();

      // 創建模態框
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.id = 'login-modal';
      modal.innerHTML = `
        <section class="modal-card" role="dialog" aria-modal="true">
          <div class="modal-head">
            <strong>選擇登入帳號</strong>
            <button class="close-button" type="button">×</button>
          </div>
          <div class="accounts-list">
            ${accounts.map(acc => `
              <button class="account-item" data-account-id="${acc.id}" type="button">
                <div class="account-name">${acc.name}</div>
                <div class="account-email">${acc.email}</div>
                ${acc.isDisabled ? '<span class="account-disabled">（已禁用）</span>' : ''}
              </button>
            `).join('')}
          </div>
        </section>
      `;

      document.body.appendChild(modal);

      const closeBtn = modal.querySelector('.close-button');
      closeBtn.addEventListener('click', () => modal.remove());

      const accountButtons = modal.querySelectorAll('.account-item');
      accountButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
          const accountId = btn.dataset.accountId;
          await this.performLogin(accountId);
          modal.remove();
        });
      });

      modal.hidden = false;
    } catch (error) {
      alert('無法獲取帳號列表: ' + error.message);
    }
  }

  /**
   * 執行登入
   */
  async performLogin(selectedAccount) {
    try {
      const loginInfo = await authManager.startLogin('/');
      const response = await authManager.completeLogin(
        loginInfo.state,
        loginInfo.nonce,
        selectedAccount
      );

      if (response.success) {
        // 檢查是否需要同意條款
        const termsStatus = await api.getTermsStatus();
        if (termsStatus.needsAcceptance) {
          location.href = '/#terms';
        } else {
          location.href = response.returnTo;
        }
      }
    } catch (error) {
      alert('登入失敗: ' + error.message);
    }
  }

  /**
   * 設置社區 UI 元素
   */
  setupCommunityUI() {
    // 添加社區設置按鈕到筆記面板
    const notesHead = document.querySelector('.notes-head');
    if (notesHead) {
      const thresholdControl = document.createElement('div');
      thresholdControl.className = 'threshold-control';
      thresholdControl.innerHTML = `
        <label>
          <span>公開註記過濾 (${this.currentThresholdPercent}%)</span>
          <input type="range" min="0" max="100" value="${this.currentThresholdPercent}" id="threshold-slider">
        </label>
      `;

      notesHead.appendChild(thresholdControl);

      document.getElementById('threshold-slider').addEventListener('change', (e) => {
        this.currentThresholdPercent = parseInt(e.target.value);
        this.loadPublicNotes();
      });
    }
  }

  /**
   * 為段落加載公開註記
   */
  async loadPublicNotes(articleId, paragraphAnchor) {
    try {
      const response = await api.getNotes(
        articleId,
        paragraphAnchor,
        this.currentThresholdPercent
      );

      return response.notes;
    } catch (error) {
      console.error('Failed to load public notes:', error);
      return [];
    }
  }

  /**
   * 在段落中嵌入註記泡泡
   */
  async embeddNotesInParagraph(element, articleId, paragraphAnchor) {
    try {
      const notes = await this.loadPublicNotes(articleId, paragraphAnchor);

      // 按 anchor_offset_start 分組（聚合）
      const clusteredNotes = this.clusterNotes(notes);

      // 為每個聚合組添加泡泡
      for (const [clusterKey, cluster] of Object.entries(clusteredNotes)) {
        if (cluster.length >= 2 || cluster.length === 1) {
          const bubble = this.createNoteBubble(cluster, articleId, paragraphAnchor);
          this.insertBubbleIntoElement(element, bubble, parseInt(clusterKey) * 5);
        }
      }
    } catch (error) {
      console.error('Failed to embed notes:', error);
    }
  }

  /**
   * 聚合註記
   */
  clusterNotes(notes) {
    const clusters = {};
    for (const note of notes) {
      const key = Math.floor(note.anchor_offset_start / 5);
      if (!clusters[key]) {
        clusters[key] = [];
      }
      clusters[key].push(note);
    }
    return clusters;
  }

  /**
   * 創建註記泡泡
   */
  createNoteBubble(notes, articleId, paragraphAnchor) {
    const bubble = document.createElement('span');
    bubble.className = 'note-bubble';
    bubble.dataset.articleId = articleId;
    bubble.dataset.paragraphAnchor = paragraphAnchor;
    bubble.dataset.noteCount = notes.length;
    bubble.textContent = notes.length > 1 ? `💬 ${notes.length}` : '💬';

    bubble.addEventListener('click', () => {
      this.showNotesModal(notes, articleId, paragraphAnchor);
    });

    return bubble;
  }

  /**
   * 在文本中插入泡泡
   */
  insertBubbleIntoElement(element, bubble, offset) {
    // 簡化版本 - 真實版本需要更複雜的文本操作
    element.appendChild(bubble);
  }

  /**
   * 顯示註記列表模態框
   */
  showNotesModal(notes, articleId, paragraphAnchor) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'notes-modal';
    modal.innerHTML = `
      <section class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-head">
          <strong>社區註記 (${notes.length})</strong>
          <button class="close-button" type="button">×</button>
        </div>
        <div class="notes-list-modal">
          ${notes.map(note => `
            <div class="note-item">
              <div class="note-author">${note.public_alias || '匿名使用者'}</div>
              <div class="note-content">${this.escapeHtml(note.content)}</div>
              <div class="note-stats">
                <span>👍 ${note.upvote_count}</span>
                <span>👎 ${note.downvote_count}</span>
                <span>⭐ ${note.favorite_count}</span>
              </div>
              ${authManager.isAuthenticated() ? `
                <div class="note-actions">
                  <button class="vote-up" data-note-id="${note.id}">👍</button>
                  <button class="vote-down" data-note-id="${note.id}">👎</button>
                  <button class="favorite" data-note-id="${note.id}">⭐</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.close-button');
    closeBtn.addEventListener('click', () => modal.remove());

    // 添加投票事件
    if (authManager.isAuthenticated()) {
      modal.querySelectorAll('.vote-up').forEach(btn => {
        btn.addEventListener('click', async () => {
          const noteId = btn.dataset.noteId;
          await api.voteNote(noteId, 'up');
          alert('已投讚');
        });
      });

      modal.querySelectorAll('.vote-down').forEach(btn => {
        btn.addEventListener('click', async () => {
          const noteId = btn.dataset.noteId;
          await api.voteNote(noteId, 'down');
          alert('已投反對');
        });
      });

      modal.querySelectorAll('.favorite').forEach(btn => {
        btn.addEventListener('click', async () => {
          const noteId = btn.dataset.noteId;
          await api.toggleFavorite(noteId);
          alert('已收藏');
        });
      });
    }

    modal.hidden = false;
  }

  /**
   * 轉義 HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 導出單一實例
export const communityFeatures = new CommunityFeatures();

// 自動初始化
document.addEventListener('DOMContentLoaded', () => {
  communityFeatures.init().catch(console.error);
});
