# 開發指南

## 快速開始

    npm install
    npm run build
    npm run dev

本機應用程式與 API 位於 http://localhost:3001。請使用真實 Google 帳號登入。

## 開發環境

建立根目錄 .env：

    PORT=3001
    NODE_ENV=development
    SUPABASE_URL=https://your-project-ref.supabase.co
    SUPABASE_KEY=sb_publishable_your_publishable_key
    SUPABASE_SERVICE_KEY=your_service_role_key

.env.development 是不含機密值的範本。實際 .env 已被 .gitignore 排除。

## 指令

| 指令 | 用途 |
| --- | --- |
| npm run dev | 啟動本機 Express API 與靜態網站 |
| npm run build | 建立 Vercel 靜態輸出到 dist |
| npm run dev:with-build | 先 build 再啟動本機伺服器 |
| npm run preview | 僅預覽靜態 dist；不提供需要 API 的完整登入流程 |

## 認證流程

1. public/auth-manager.js 從 /api/auth/config 取得 Project URL 與 publishable key。
2. 瀏覽器執行 Supabase signInWithOAuth，provider 為 google。
3. Supabase Auth 完成 Google OAuth PKCE，回到目前網站 origin。
4. 前端將 Supabase access token 放進 API Authorization Bearer header。
5. server/middleware/auth.js 以 Supabase Auth 驗證 token。
6. 後端將 Supabase user 同步到 public.users，再執行 owner check。

不要自行解析 access token，也不要在前端使用 service role key。

## 專案結構

    api/[...path].js                 Vercel catch-all Serverless Function
    server/app.js                    可供本機與 Vercel 共用的 Express app
    server/index.js                  僅本機 listen 入口
    server/routes/                   API 路由
    server/repositories/             Supabase query builder 存取層
    server/middleware/auth.js        Supabase access token 驗證
    server/db/schema-supabase.sql    Supabase schema
    server/db/rls-policies-supabase.sql
    public/                          前端
    scripts/build.js                 將網站資產與 Supabase browser SDK 複製到 dist

## 開發檢查

    node --check server/app.js
    node --check api/[...path].js
    npm run build

瀏覽器測試：

1. 未登入呼叫 GET /api/divinations，預期 401。
2. 登入後確認 /api/auth/status 回傳目前使用者。
3. 建立私人卦象紀錄並確認其他帳號不可讀取。
4. 測試註記、投票、收藏、回覆與通知。

## 常見問題

### Google 顯示 redirect_uri_mismatch

Google Cloud 的 Authorized redirect URI 必須完全等於：

    https://tppijacljktspgbiphml.supabase.co/auth/v1/callback

### 登入後顯示 API 設定讀取失敗

確認 /api/auth/config 可正常回應，且 Vercel 環境變數已有 SUPABASE_URL、SUPABASE_KEY、SUPABASE_SERVICE_KEY。新增變數後需要重新部署。

### RLS 拒絕資料

確認 SQL Editor 已執行 server/db/rls-policies-supabase.sql，並確認 public profile 的 users.id 與 auth.uid() 相同。
