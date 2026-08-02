# Supabase 上線準備報告

更新日期：2026-08-02

## 結論

專案已收斂為 Supabase-only 架構：

- 資料庫：Supabase PostgreSQL
- 登入：Supabase Auth + Google OAuth PKCE
- 後端驗證：Supabase access token
- 正式 API：Vercel Serverless Function

## 已完成項目

### 認證

- 前端使用 Supabase JavaScript SDK 的 Google OAuth。
- Supabase SDK 以 PKCE flow 處理 OAuth callback。
- 後端以 supabase.auth.getUser(accessToken) 驗證每一個 Bearer token。

### 授權與隱私

- 個人設定、卦象紀錄、通知、條款與刪除紀錄有 owner scope。
- 註記、投票、收藏與回覆寫入都要求登入。
- API 會驗證資源擁有權，避免使用者讀寫其他人的私人資料。
- 前端只有 publishable key；service role key 僅在 server runtime 使用。

### RLS

server/db/rls-policies-supabase.sql 包含 11 張 public 資料表的 RLS、privilege revoke/grant 與 policy。

RLS 保護直接透過 PostgREST 的存取；後端 service role 會繞過 RLS，因此後端的 token 驗證與 owner check 仍是必要的第二層保護。

### 部署

- api/[...path].js 是 Vercel API 入口。
- server/app.js 是共享 Express app；不會在 Vercel 執行 listen。
- scripts/build.js 會複製 Supabase browser SDK 到 dist/vendor/supabase/supabase.js。
- vercel.json 已宣告 API function。

## 必須在 Dashboard 完成的設定

### Supabase

1. Authentication -> Sign In / Providers -> Google：啟用並輸入 Google Client ID/Secret。
2. Authentication -> URL Configuration：

       Site URL:
       https://iching-reader-seven.vercel.app

       Redirect URLs:
       http://localhost:3001/
       https://iching-reader-seven.vercel.app/

3. OAuth Server 不需要，保持關閉。

### Google Cloud

    Authorized JavaScript origins:
    http://localhost:3001
    https://iching-reader-seven.vercel.app

    Authorized redirect URIs:
    https://tppijacljktspgbiphml.supabase.co/auth/v1/callback

### Vercel

在 Project Settings -> Environment Variables 設定：

| 變數 | Production | Preview | 機密 |
| --- | --- | --- | --- |
| SUPABASE_URL | 是 | 是 | 否 |
| SUPABASE_KEY | 是 | 是 | 否 |
| SUPABASE_SERVICE_KEY | 是 | 是 | 是 |

每次更新環境變數後都要重新部署。

## 部署後驗收

1. https://iching-reader-seven.vercel.app/api/health 回傳 status ok。
2. 網站可開啟並載入 /vendor/supabase/supabase.js。
3. Google 登入後 /api/auth/status 回傳登入使用者。
4. 未登入呼叫受保護 API 回傳 401。
5. 兩個不同帳號不能互讀私人卦象紀錄、設定與通知。
6. 確認 Vercel logs 沒有缺少 Supabase 環境變數或 service key 外洩。

## 安全限制

- service role key 不可放入 Git、前端、瀏覽器 localStorage 或公開環境變數。
- Google Client Secret 僅放 Google Cloud 與 Supabase Provider 設定，不放前端。
- production 與 preview 可使用不同 Supabase 專案，避免測試資料混入正式資料。
- 若任一 secret 曾被公開，立即在 Supabase 或 Google Cloud rotate。
