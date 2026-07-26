/**
 * API 集成測試腳本
 * 驗證 Mock OAuth 和核心 API 端點功能
 */

import http from 'http';

const BASE_URL = 'http://localhost:3001';

// 顏色輸出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

async function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    log(colors.green, `✓ ${name}`);
    return true;
  } catch (error) {
    log(colors.red, `✗ ${name}: ${error.message}`);
    return false;
  }
}

async function runTests() {
  log(colors.cyan, '\n🧪 開始 API 集成測試\n');

  let passed = 0;
  let failed = 0;

  // 1. 健康檢查
  if (await test('GET /api/health - 健康檢查', async () => {
    const res = await request('GET', '/api/health');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.data.status !== 'ok') throw new Error('Status is not ok');
  })) passed++; else failed++;

  // 2. 獲取 Mock 帳號
  if (await test('GET /api/auth/mock-accounts - 獲取測試帳號', async () => {
    const res = await request('GET', '/api/auth/mock-accounts');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.data.accounts)) throw new Error('Accounts is not an array');
    if (res.data.accounts.length !== 4) throw new Error('Expected 4 accounts');
  })) passed++; else failed++;

  // 3. 啟動 OAuth
  let oauthState = null;
  let oauthNonce = null;
  if (await test('POST /api/auth/google/start - 啟動 OAuth 流程', async () => {
    const res = await request('POST', '/api/auth/google/start');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.data.state) throw new Error('No state in response');
    if (!res.data.nonce) throw new Error('No nonce in response');
    oauthState = res.data.state;
    oauthNonce = res.data.nonce;
  })) passed++; else failed++;

  // 4. 接受條款
  let userId = null;
  let sessionToken = null;
  if (oauthState && oauthNonce) {
    if (await test('POST /api/auth/google/callback - OAuth 登入', async () => {
      const res = await request('POST', '/api/auth/google/callback', {
        state: oauthState,
        nonce: oauthNonce,
        selectedAccount: 'test1'
      });
      if (res.status !== 403) {
        // 如果已登入，應該是 200
        if (res.status !== 200) throw new Error(`Expected 200 or 403, got ${res.status}`);
        sessionToken = res.data.sessionToken;
        userId = res.data.user.id;
      } else if (res.data.error !== 'TERMS_NOT_ACCEPTED') {
        throw new Error(`Unexpected error: ${res.data.error}`);
      }
    })) passed++; else failed++;

    // 5. 接受服務條款
    if (userId && sessionToken) {
      if (await test('POST /api/me/terms/accept - 接受服務條款', async () => {
        const res = await request('POST', '/api/me/terms/accept', {
          version: '1.0.0',
          agreedToAll: true
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      })) passed++; else failed++;
    }
  }

  // 6. 獲取用戶設置
  if (sessionToken && userId) {
    if (await test('GET /api/me/settings - 獲取用戶設置', async () => {
      const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/me/settings',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`Expected 200, got ${res.statusCode}`));
            } else {
              const parsed = JSON.parse(data);
              if (!parsed.user) reject(new Error('No user in response'));
              resolve();
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
    })) passed++; else failed++;
  }

  log(colors.blue, `\n📊 測試結果: ${colors.green}${passed} 通過${colors.reset} / ${colors.red}${failed} 失敗${colors.reset}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  log(colors.red, `\n❌ 測試中止: ${err.message}\n`);
  process.exit(1);
});
