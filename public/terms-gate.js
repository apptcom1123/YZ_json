const TERMS_VERSION = '2026-07-26';
const TERMS_STORAGE_KEY = 'iching_terms_version';

function hasAcceptedTermsInBrowser() {
  return localStorage.getItem(TERMS_STORAGE_KEY) === TERMS_VERSION;
}

function beginTermsGate({ afterOAuth = false } = {}) {
  if (!afterOAuth && hasAcceptedTermsInBrowser()) {
    return authManager.startLogin('/');
  }

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
    acceptButton.disabled = true;
    try {
      localStorage.setItem(TERMS_STORAGE_KEY, TERMS_VERSION);
      if (afterOAuth || authManager.requiresTerms) {
        await api.acceptTerms(TERMS_VERSION);
        await authManager.checkAuthStatus();
        await close();
      } else {
        await close();
        await authManager.startLogin('/');
      }
    } catch (error) {
      console.error('Terms acceptance failed:', error);
      acceptButton.disabled = false;
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
