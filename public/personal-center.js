// ===== 個人中心功能 =====

function initializeSettings() {
  const accountEl = document.getElementById('settings-account');
  const saveDivEl = document.getElementById('settings-save-divinations');
  const saveNotesEl = document.getElementById('settings-save-notes');
  const publicNotesEl = document.getElementById('settings-public-notes');
  const thresholdEl = document.getElementById('settings-threshold');
  const thresholdValueEl = document.getElementById('settings-threshold-value');
  const notifyRepliesEl = document.getElementById('settings-notify-replies');

  if (!accountEl) return;

  // 獲取用戶信息（從 localStorage）
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  
  if (user && user.email) {
    accountEl.textContent = user.email;
  } else if (typeof authManager !== 'undefined' && authManager.currentUser) {
    accountEl.textContent = authManager.currentUser.email || 'unknown@example.com';
  } else {
    accountEl.textContent = '未登入';
  }

  // 加載設定
  const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
  if (saveDivEl) saveDivEl.checked = settings.save_divination_to_cloud || false;
  if (saveNotesEl) saveNotesEl.checked = settings.save_notes_to_cloud || false;
  if (publicNotesEl) publicNotesEl.checked = settings.allow_public_notes || false;
  if (thresholdEl) thresholdEl.value = settings.threshold_percent || 50;
  if (notifyRepliesEl) notifyRepliesEl.checked = settings.notify_on_reply !== false;

  // 更新閾值顯示
  if (thresholdEl && thresholdValueEl) {
    thresholdEl.oninput = (e) => {
      thresholdValueEl.textContent = e.target.value + '%';
    };
  }

  // 綁定按鈕事件
  const clearLocalBtn = document.getElementById('settings-clear-local');
  const deleteDataBtn = document.getElementById('settings-delete-data');
  const deleteAccountBtn = document.getElementById('settings-delete-account');
  const closeBtn = document.getElementById('close-panel');

  if (clearLocalBtn) {
    clearLocalBtn.onclick = () => {
      if (confirm('確定要刪除僅保存在這個瀏覽器的所有資料嗎？此操作無法撤銷。')) {
        localStorage.removeItem('divinations');
        localStorage.removeItem('notes');
        alert('本機資料已刪除');
        // 重新加載頁面
        location.reload();
      }
    };
  }

  if (deleteDataBtn) {
    deleteDataBtn.onclick = () => {
      alert('此功能需要與後端集成。請實現雲端資料刪除邏輯。');
    };
  }

  if (deleteAccountBtn) {
    deleteAccountBtn.onclick = () => {
      alert('此功能需要與後端集成。請實現帳號刪除邏輯。');
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      const panel = document.getElementById('notes-panel');
      if (panel) panel.hidden = true;
    };
  }

  // 自動保存設定
  ['save-divinations', 'save-notes', 'public-notes', 'threshold', 'notify-replies'].forEach((id) => {
    const el = document.getElementById(`settings-${id.replace(/-/g, '_')}`);
    if (el) {
      el.onchange = () => {
        const newSettings = {
          save_divination_to_cloud: saveDivEl?.checked || false,
          save_notes_to_cloud: saveNotesEl?.checked || false,
          allow_public_notes: publicNotesEl?.checked || false,
          threshold_percent: parseInt(thresholdEl?.value || 50),
          notify_on_reply: notifyRepliesEl?.checked !== false
        };
        localStorage.setItem('userSettings', JSON.stringify(newSettings));
      };
    }
  });
}



// 綁定關閉面板按鈕
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('close-panel');
  if (closeBtn) {
    closeBtn.onclick = () => {
      const panel = document.getElementById('notes-panel');
      if (panel) panel.hidden = true;
    };
  }
});
