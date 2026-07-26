import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Google OAuth 配置
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// 儲存 state 用於驗證（簡單實現，實際應使用 Redis）
const stateStore = new Map();

/**
 * 啟動 Google OAuth 流程
 */
export function startGoogleOAuthFlow(returnTo = '/') {
  const state = uuidv4();
  const nonce = uuidv4();

  // 儲存 state 和 nonce（5 分鐘過期）
  stateStore.set(state, {
    nonce,
    returnTo,
    timestamp: Date.now()
  });

  // 5 分鐘後清理
  setTimeout(() => stateStore.delete(state), 5 * 60 * 1000);

  // 構建 Google OAuth URL
  const googleAuthURL = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthURL.searchParams.append('client_id', GOOGLE_CLIENT_ID);
  googleAuthURL.searchParams.append('redirect_uri', GOOGLE_REDIRECT_URI);
  googleAuthURL.searchParams.append('response_type', 'code');
  googleAuthURL.searchParams.append('scope', 'openid email profile');
  googleAuthURL.searchParams.append('state', state);
  googleAuthURL.searchParams.append('nonce', nonce);
  googleAuthURL.searchParams.append('access_type', 'offline');

  return {
    authUrl: googleAuthURL.toString(),
    state,
    nonce
  };
}

/**
 * 交換授權碼取得 ID Token
 */
export async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: GOOGLE_REDIRECT_URI
    });

    return response.data;
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    throw new Error('Failed to exchange code for token');
  }
}

/**
 * 驗證 ID Token 並提取用戶信息
 */
export async function verifyIdToken(idToken) {
  try {
    // 調用 Google tokeninfo 端點
    const response = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (response.data.aud !== GOOGLE_CLIENT_ID) {
      throw new Error('Token audience mismatch');
    }

    return response.data;
  } catch (error) {
    console.error('Token verification error:', error.response?.data || error.message);
    throw new Error('Failed to verify ID token');
  }
}

/**
 * 處理 Google OAuth 回調
 */
export async function handleGoogleOAuthCallback(state, code) {
  // 驗證 state
  const stateData = stateStore.get(state);
  if (!stateData) {
    throw new Error('Invalid or expired state');
  }

  stateStore.delete(state);

  // 交換代碼取得 token
  const tokenData = await exchangeCodeForToken(code);

  // 驗證 ID token
  const profile = await verifyIdToken(tokenData.id_token);

  return {
    idToken: tokenData.id_token,
    accessToken: tokenData.access_token || null,
    profile: {
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture
    },
    returnTo: stateData.returnTo,
    nonce: stateData.nonce
  };
}

/**
 * 驗證 Google OAuth 是否已配置
 */
export function isGoogleOAuthConfigured() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}
