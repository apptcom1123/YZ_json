/**
 * 認證 API 路由
 */

import express from 'express';
import {
  startGoogleOAuthFlow,
  handleGoogleOAuthCallback,
  isGoogleOAuthConfigured
} from '../middleware/googleOAuth.js';
import {
  startMockOAuthFlow,
  handleMockOAuthCallback,
  getTestAccounts
} from '../middleware/mockOAuth.js';
import {
  generateSessionToken,
  validateReturnTo,
  requireAuth
} from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/auth/mock-accounts
 * 獲取可用的測試帳號
 */
router.get('/mock-accounts', (req, res) => {
  res.json({
    accounts: getTestAccounts(),
    message: '本地開發環境 - 選擇測試帳號進行登入'
  });
});

/**
 * POST /api/auth/google/start
 * 啟動 OAuth 流程
 */
router.post('/google/start', (req, res) => {
  const { returnTo } = req.body;
  const validReturnTo = validateReturnTo(returnTo || '/');

  try {
    // 優先使用真實 Google OAuth，如果未配置則使用 Mock
    if (isGoogleOAuthConfigured()) {
      console.log('🔵 使用真實 Google OAuth');
      const { authUrl, state, nonce } = startGoogleOAuthFlow(validReturnTo);
      res.json({
        authUrl,
        state,
        nonce,
        mode: 'google-oauth'
      });
    } else {
      console.log('🟡 未配置 Google OAuth，使用 Mock OAuth');
      const { authUrl, state, nonce } = startMockOAuthFlow(validReturnTo);
      res.json({
        authUrl,
        state,
        nonce,
        mode: 'mock-oauth',
        dev_note: '開發模式 - 請在 authUrl 選擇測試帳號'
      });
    }
  } catch (error) {
    console.error('OAuth start error:', error);
    res.status(400).json({
      error: 'OAUTH_START_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/auth/google/callback
 * Google 會以 GET 回調。此路由將 code/state 轉回前端首頁，
 * 由前端 handleGoogleOAuthCallback() 再以 POST 呼叫 API 完成登入。
 */
router.get('/google/callback', (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    const err = encodeURIComponent(error_description || error);
    return res.redirect(`/?oauth_error=${err}`);
  }

  if (!code || !state) {
    return res.redirect('/?oauth_error=missing_code_or_state');
  }

  const redirectUrl = `/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  return res.redirect(redirectUrl);
});

/**
 * POST /api/auth/google/callback
 * 處理 OAuth 回調（支持真實 Google OAuth 和 Mock OAuth）
 */
router.post('/google/callback', async (req, res) => {
  try {
    const { state, code, selectedAccount, nonce } = req.body;

    if (!state) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: '缺少 state 參數'
      });
    }

    let profile, idToken, returnTo;

    // 判斷使用真實 Google OAuth 還是 Mock OAuth
    if (code) {
      // 真實 Google OAuth 流程
      console.log('🔵 處理真實 Google OAuth 回調');
      const oauthResult = await handleGoogleOAuthCallback(state, code);
      profile = oauthResult.profile;
      idToken = oauthResult.idToken;
      returnTo = oauthResult.returnTo;
    } else if (nonce) {
      // Mock OAuth 流程
      console.log('🟡 處理 Mock OAuth 回調');
      if (!nonce) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: '缺少 nonce 參數'
        });
      }
      const mockResult = handleMockOAuthCallback(state, nonce, selectedAccount || 'test1');
      profile = mockResult.profile;
      idToken = mockResult.idToken;
      returnTo = mockResult.returnTo;
    } else {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: '缺少 code（Google OAuth）或 nonce（Mock OAuth）'
      });
    }

    // 使用 Repository 創建或更新用戶
    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.upsertFromGoogleAuth(profile);

    // 檢查用戶是否可以登入
    const canLogin = await userRepo.canLogin(user.id);

    if (!canLogin.allowed) {
      const reasonMessages = {
        'ACCOUNT_DISABLED': '您的帳號已被停用',
        'ACCOUNT_DELETED': '您的帳號已被刪除',
        'TERMS_NOT_ACCEPTED': '需要接受服務條款'
      };

      // 首次登入：允許前端拿到暫時 session 以完成條款同意
      if (canLogin.reason === 'TERMS_NOT_ACCEPTED') {
        const pendingSessionToken = generateSessionToken(user.id, profile.sub);
        return res.json({
          success: false,
          requiresTermsAcceptance: true,
          sessionToken: pendingSessionToken,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url
          },
          returnTo: validateReturnTo(returnTo)
        });
      }

      return res.status(403).json({
        error: canLogin.reason,
        message: reasonMessages[canLogin.reason] || canLogin.reason,
        disabledReason: canLogin.disabledReason
      });
    }

    // 生成會話 token
    const sessionToken = generateSessionToken(user.id, profile.sub);

    res.json({
      success: true,
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      },
      returnTo: validateReturnTo(returnTo)
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(400).json({
      error: 'OAUTH_CALLBACK_FAILED',
      message: error.message || '登入失敗，請稍後重試'
    });
  }
});

/**
 * POST /api/auth/logout
 * 登出
 */
router.post('/logout', requireAuth, (req, res) => {
  // 在實際應用中，這可能會使 token 失效
  res.json({
    success: true,
    message: '已登出'
  });
});

/**
 * POST /api/auth/accept-terms-then-login
 * 接受條款並完成登入（用於首次登入需要接受條款的情況）
 */
router.post('/accept-terms-then-login', async (req, res) => {
  try {
    const { state, nonce, selectedAccount, docVersion = '1.0' } = req.body;

    if (!state || !nonce) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: '缺少必要參數'
      });
    }

    // 處理 Mock OAuth
    const { idToken, profile, returnTo } = handleMockOAuthCallback(
      state,
      nonce,
      selectedAccount || 'test1'
    );

    // 使用 Repository 創建或更新用戶
    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.upsertFromGoogleAuth(profile);

    // 帳號禁用檢查
    const loginCheck = await userRepo.canLogin(user.id);
    if (!loginCheck.allowed) {
      return res.status(403).json({
        error: 'ACCOUNT_DISABLED',
        message: loginCheck.reason,
        disabledReason: loginCheck.disabledReason
      });
    }

    // 接受條款
    const userIp = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent') || '';
    await userRepo.acceptTerms(user.id, docVersion, userIp, userAgent);

    // 生成會話 token
    const sessionToken = generateSessionToken(user.id, profile.sub);

    res.json({
      success: true,
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      },
      returnTo: validateReturnTo(returnTo)
    });
  } catch (error) {
    console.error('Accept terms then login error:', error);
    res.status(400).json({
      error: error.message,
      message: error.message
    });
  }
});

/**
 * GET /api/auth/status
 * 獲取當前登入狀態
 */
router.get('/status', async (req, res) => {
  if (!req.user) {
    return res.json({
      loggedIn: false,
      user: null
    });
  }

  try {
    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.findById(req.user.userId);

    if (!user) {
      return res.json({
        loggedIn: false,
        user: null
      });
    }

    const canLogin = await userRepo.canLogin(user.id);

    res.json({
      loggedIn: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        role: user.role
      },
      loginBlocked: !canLogin.allowed,
      blockReason: canLogin.reason
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      error: 'STATUS_CHECK_FAILED',
      message: '無法檢查登入狀態'
    });
  }
});

/**
 * 登入被阻擋的消息
 */
router.getLoginBlockedMessage = (reason) => {
  const messages = {
    'TERMS_NOT_ACCEPTED': '請先同意使用條款，完成後才能登入',
    'ACCOUNT_DISABLED': '帳號已停用，請聯絡管理員',
    'ACCOUNT_DELETED': '帳號已刪除',
    'USER_NOT_FOUND': '用戶不存在'
  };

  return messages[reason] || '無法登入';
};

export default router;
