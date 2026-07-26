/**
 * Mock Google OAuth 2.0
 * 用於本地開發，完全模擬 Google 登入流程
 * 支持測試帳號快速切換
 */

// 預定義的測試帳號
const TEST_ACCOUNTS = {
  'test1': {
    sub: 'test1_google_sub_12345',
    email: 'test1@example.com',
    name: '測試用戶一',
    picture: 'https://via.placeholder.com/40?text=T1'
  },
  'test2': {
    sub: 'test2_google_sub_67890',
    email: 'test2@example.com',
    name: '測試用戶二',
    picture: 'https://via.placeholder.com/40?text=T2'
  },
  'admin': {
    sub: 'admin_google_sub_99999',
    email: 'admin@example.com',
    name: '管理員',
    picture: 'https://via.placeholder.com/40?text=ADM'
  },
  'disabled': {
    sub: 'disabled_google_sub_88888',
    email: 'disabled@example.com',
    name: '已禁用用戶',
    picture: 'https://via.placeholder.com/40?text=DIS',
    _disabled: true,
    _disabledReason: 'ACCOUNT_DISABLED'
  }
};

// Mock OAuth 狀態存儲（實際開發中應使用 Redis）
const mockOAuthStates = new Map();

/**
 * 啟動 Mock OAuth 流程
 */
export function startMockOAuthFlow(returnTo = '/') {
  const state = generateRandomString(32);
  const nonce = generateRandomString(32);

  mockOAuthStates.set(state, {
    nonce,
    returnTo,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 分鐘過期
  });

  return {
    authUrl: `/mock-oauth/authorize?state=${state}&nonce=${nonce}&return_to=${encodeURIComponent(returnTo)}`,
    state,
    nonce
  };
}

/**
 * 獲取測試帳號列表
 */
export function getTestAccounts() {
  return Object.keys(TEST_ACCOUNTS).map(key => ({
    id: key,
    email: TEST_ACCOUNTS[key].email,
    name: TEST_ACCOUNTS[key].name,
    isDisabled: TEST_ACCOUNTS[key]._disabled || false
  }));
}

/**
 * 模擬 OAuth callback
 * 支持開發環境：如果 state 不在存儲中（例如直接調用 API），仍然允許登入
 */
export function handleMockOAuthCallback(state, nonce, selectedAccount = 'test1') {
  let returnTo = '/';

  // 開發環境寬鬆驗證：如果 state 不存在，允許直接使用（用於 API 測試）
  if (mockOAuthStates.has(state)) {
    const stateData = mockOAuthStates.get(state);
    if (stateData.expiresAt < Date.now()) {
      mockOAuthStates.delete(state);
      throw new Error('STATE_EXPIRED');
    }

    if (stateData.nonce !== nonce) {
      throw new Error('INVALID_NONCE');
    }

    returnTo = stateData.returnTo;
    // 清理狀態
    mockOAuthStates.delete(state);
  } else {
    // 開發環境允許：直接 API 調用時 state 可能不在存儲中
    console.log('💡 Mock OAuth：State 不在存儲中，允許直接 API 測試');
  }

  // 取得測試帳號
  const account = TEST_ACCOUNTS[selectedAccount];
  if (!account) {
    throw new Error('UNKNOWN_ACCOUNT');
  }

  // 返回 ID Token 格式的模擬信息
  return {
    idToken: generateMockIdToken(account),
    profile: {
      sub: account.sub,
      email: account.email,
      name: account.name,
      picture: account.picture,
      _disabled: account._disabled || false,
      _disabledReason: account._disabledReason || null
    },
    returnTo
  };
}

/**
 * 生成模擬的 JWT ID Token
 */
function generateMockIdToken(account) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    iss: 'https://accounts.google.com',
    azp: 'mock-client-id',
    aud: 'mock-client-id',
    sub: account.sub,
    email: account.email,
    email_verified: true,
    name: account.name,
    picture: account.picture,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: generateRandomString(16)
  };

  // 簡單的 Base64 編碼（實際應使用 JWT 庫）
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = generateRandomString(64);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * 驗證 Mock Token（實際項目中應驗證真實 JWT）
 */
export function verifyMockToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8')
    );

    if (payload.exp * 1000 < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * 生成隨機字符串
 */
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 清理過期的狀態
 */
export function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, data] of mockOAuthStates.entries()) {
    if (data.expiresAt < now) {
      mockOAuthStates.delete(state);
    }
  }
}

// 定期清理過期狀態
setInterval(cleanupExpiredStates, 60000); // 每分鐘清理一次
