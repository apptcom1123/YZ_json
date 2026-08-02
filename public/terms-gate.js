const TERMS_VERSION = '2026-07-26';
const TERMS_STORAGE_KEY = 'iching_terms_version';
window.ICHING_TERMS_VERSION = TERMS_VERSION;

function hasAcceptedTermsInBrowser() {
  return localStorage.getItem(TERMS_STORAGE_KEY) === TERMS_VERSION;
}

function beginTermsGate({ afterOAuth = false } = {}) {
  const modal = document.getElementById('terms-modal');
  const backdrop = document.getElementById('backdrop');
  const checkbox = document.getElementById('terms-agree-checkbox');
  const acceptButton = document.getElementById('accept-terms');
  const cancelButton = document.getElementById('cancel-terms');
  const closeButton = document.getElementById('close-terms');
  if (!modal || !checkbox || !acceptButton) throw new Error('Terms dialog is unavailable.');

  checkbox.checked = false;
  acceptButton.disabled = true;
  acceptButton.textContent = afterOAuth ? '接受條款並完成登入' : '接受條款並登入';
  checkbox.onchange = () => { acceptButton.disabled = !checkbox.checked; };

  const close = async ({ signOut = false } = {}) => {
    modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (signOut) await authManager.logout();
  };

  acceptButton.onclick = async () => {
    if (!checkbox.checked) return;
    const idleText = afterOAuth ? '接受條款並完成登入' : '接受條款並登入';
    acceptButton.disabled = true;
    acceptButton.textContent = '正在更新條款狀態...';
    try {
      if (afterOAuth || authManager.requiresTerms) {
        const accepted = await api.acceptTerms(TERMS_VERSION);
        if (!accepted?.termsAccepted || accepted.acceptedVersion !== TERMS_VERSION) {
          throw new Error('後端未確認條款狀態');
        }
        const status = await api.getTermsStatus();
        if (!status?.termsAccepted || status.needsAcceptance || status.acceptedVersion !== TERMS_VERSION) {
          throw new Error('後端條款狀態尚未更新');
        }
        localStorage.setItem(TERMS_STORAGE_KEY, TERMS_VERSION);
        await authManager.queueAuthStatusRefresh();
        if (!authManager.isLoggedIn) throw new Error('登入狀態尚未完成更新');
        await close();
      } else {
        localStorage.setItem(TERMS_STORAGE_KEY, TERMS_VERSION);
        await close();
        await authManager.startLogin('/');
      }
    } catch (error) {
      console.error('Terms acceptance failed:', error);
      acceptButton.disabled = false;
      acceptButton.textContent = idleText;
      alert('無法記錄條款同意，請重試。');
    }
  };

  cancelButton.onclick = () => close({ signOut: afterOAuth || authManager.requiresTerms });
  closeButton.onclick = () => close({ signOut: afterOAuth || authManager.requiresTerms });
  modal.hidden = false;
  if (backdrop) backdrop.hidden = false;
}

authManager.onAuthChange(() => {
  if (authManager.requiresTerms) beginTermsGate({ afterOAuth: true });
});
