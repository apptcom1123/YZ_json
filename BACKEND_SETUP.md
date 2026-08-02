# 後端與認證設定

本專案使用 Supabase PostgreSQL 與 Supabase Auth。

## 架構

- 瀏覽器以 Supabase Auth 的 Google OAuth PKCE 登入。
- 瀏覽器只使用 Supabase publishable key。
- Express API 以 Supabase access token 驗證登入者。
- API 使用 server-only 的 SUPABASE_SERVICE_KEY；每個受保護路由仍驗證登入身分與資料擁有權。
- Supabase RLS 會封鎖匿名 PostgREST 直接存取並限制登入者資料列。

## 必要條件

- Node.js 18 或更新版本
- Supabase 專案
- Google Cloud OAuth Web application
- Vercel 專案

## 環境變數

本機根目錄 .env：

    PORT=3001
    NODE_ENV=development
    SUPABASE_URL=https://your-project-ref.supabase.co
    SUPABASE_KEY=sb_publishable_your_publishable_key
    SUPABASE_SERVICE_KEY=your_service_role_key

SUPABASE_SERVICE_KEY 是機密，絕不能放進前端、Git repository 或任何 PUBLIC 類型的環境變數。

## Supabase 設定

### 資料表與 RLS

1. 新專案先在 Supabase SQL Editor 執行 server/db/schema-supabase.sql。
2. 執行 server/db/rls-policies-supabase.sql。
3. 確認 SQL Editor 顯示成功。

RLS migration 會針對 11 張 public 資料表啟用 RLS：users、user_settings、user_stats、divination_records、notes、note_votes、note_favorites、note_replies、legal_consents、notifications、deletion_audit_logs。

public.users.id 必須使用與 Supabase Auth auth.uid() 相同的 UUID 字串。使用者首次登入時，後端會建立或更新對應的 public profile、settings 與 stats。

### Google Provider

Supabase Dashboard 路徑：

    Authentication -> Sign In / Providers -> Google

啟用 Google，並填入由 Google Cloud 建立的 Client ID 與 Client Secret。OAuth Server 與此無關，應維持關閉。

### URL Configuration

Supabase Dashboard 路徑：

    Authentication -> URL Configuration

正式設定：

    Site URL:
    https://iching-reader-seven.vercel.app

    Redirect URLs:
    http://localhost:3001/
    https://iching-reader-seven.vercel.app/

## Google Cloud 設定

在 Google Auth Platform 建立 Web application OAuth client：

    Authorized JavaScript origins:
    http://localhost:3001
    https://iching-reader-seven.vercel.app

    Authorized redirect URIs:
    https://tppijacljktspgbiphml.supabase.co/auth/v1/callback

Google redirect URI 固定指向 Supabase callback，不是本機或 Vercel 的 API 路徑。請保留標準 scope：openid、email 與 profile。

## 本機啟動與驗證

    npm install
    npm run build
    npm run dev

開啟 http://localhost:3001 後以真實 Google 帳號登入。

健康檢查：

    GET http://localhost:3001/api/health

預期包含：

    { "status": "ok", "database": "supabase-postgresql", "auth": "supabase-google-oauth" }

未登入呼叫個人設定、卦象紀錄、投票、收藏、回覆與通知寫入 API 時，應回傳 401。

## API 保護範圍

- 登入狀態：GET /api/auth/status
- 個人資料、設定、條款、同步與刪除：/api/me/*
- 卦象紀錄：/api/divinations/*
- 註記寫入、修改、刪除、投票與收藏：/api/notes/*
- 回覆寫入、修改與刪除：/api/notes/:noteId/replies/*
- 通知：/api/me/notifications/*

公開註記與公開回覆可以讀取；所有個人資料與寫入操作都需要有效的 Supabase session。
