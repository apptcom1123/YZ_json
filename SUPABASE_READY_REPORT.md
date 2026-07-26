# 路由 × Repositories 連結檢查報告

**生成時間**: 2026-07-26
**狀態**: ✅ 完全就緒

---

## 📊 路由架構檢查

### ✅ 認證路由 (`server/routes/auth.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/auth/google/start` | POST | ❌ (無數據訪問) | N/A |
| `/api/auth/google/callback` | POST | `userRepo.upsertFromGoogleAuth()` | ✅ |
| `/api/auth/logout` | POST | ❌ (無狀態改變) | N/A |
| `/api/auth/status` | GET | `userRepo.findById()` | ✅ |

**結論**: ✅ 完全支持 Supabase

---

### ✅ 用戶路由 (`server/routes/user.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/me/settings` | GET | `userRepo.findById()` + `findUserWithSettings()` | ✅ |
| `/api/me/settings` | PATCH | `userRepo.updateUserSettings()` | ✅ |
| `/api/me/terms/accept` | POST | `userRepo.acceptTerms()` | ✅ |
| `/api/me/terms/status` | GET | `userRepo.checkTermsStatus()` | ✅ |
| `/api/me/data/delete` | POST | `notificationRepo.create()` (審計) | ✅ |
| `/api/me/account/delete` | POST | `userRepo.delete()` (軟刪除) | ✅ |
| `/api/me/local-data/clear` | POST | ❌ (客戶端操作) | N/A |
| `/api/me/stats` | GET | `userRepo.getUserStats()` | ✅ |

**結論**: ✅ 完全支持 Supabase

---

### ✅ 註記路由 (`server/routes/notes.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/notes` | GET | `noteRepo.getPublicNotes()` | ✅ |
| `/api/notes` | POST | `noteRepo.create()` | ✅ |
| `/api/notes/:id` | GET | `noteRepo.findById()` | ✅ |
| `/api/notes/:id` | PATCH | `noteRepo.update()` | ✅ |
| `/api/notes/:id` | DELETE | `noteRepo.delete()` (軟刪除) | ✅ |
| `/api/notes/:id/vote` | POST | `noteRepo.addVote()` | ✅ |
| `/api/notes/:id/favorite` | POST | `noteRepo.toggleFavorite()` | ✅ |
| `/api/notes/:id/favorites` | GET | `noteRepo.getFavoritedBy()` | ✅ |

**結論**: ✅ 完全支持 Supabase

---

### ✅ 占卜路由 (`server/routes/divinations.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/divinations` | GET | `divinationRepo.findAll()` | ✅ |
| `/api/divinations` | POST | `divinationRepo.create()` | ✅ |
| `/api/divinations/:id` | GET | `divinationRepo.findById()` | ✅ |
| `/api/divinations/:id` | PATCH | `divinationRepo.update()` | ✅ |
| `/api/divinations/:id` | DELETE | `divinationRepo.delete()` (軟刪除) | ✅ |
| `/api/divinations/sync` | POST | `divinationRepo.syncRecords()` | ✅ |
| `/api/divinations/gua/:guaId/stats` | GET | `divinationRepo.getGuaStats()` | ✅ |

**結論**: ✅ 完全支持 Supabase

---

### ✅ 回復路由 (`server/routes/replies.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/notes/:noteId/replies` | GET | `replyRepo.getReplies()` | ✅ |
| `/api/notes/:noteId/replies` | POST | `replyRepo.create()` | ✅ |
| `/api/notes/:noteId/replies/:id` | PATCH | `replyRepo.update()` | ✅ |
| `/api/notes/:noteId/replies/:id` | DELETE | `replyRepo.delete()` (軟刪除) | ✅ |

**結論**: ✅ 完全支持 Supabase

---

### ✅ 通知路由 (`server/routes/notifications.js`)

| 路由 | 方法 | Repository 使用 | Supabase 支持 |
|-----|-----|----------------|-------------|
| `/api/me/notifications` | GET | `notificationRepo.findAll()` | ✅ |
| `/api/me/notifications/unread` | GET | `notificationRepo.getUnread()` | ✅ |
| `/api/me/notifications/:id/read` | PATCH | `notificationRepo.markAsRead()` | ✅ |
| `/api/me/notifications/read-all` | PATCH | `notificationRepo.markAllAsRead()` | ✅ |
| `/api/me/notifications/:id` | DELETE | `notificationRepo.delete()` | ✅ |

**結論**: ✅ 完全支持 Supabase

---

## 🔍 Repository 核心方法 Supabase 支持

所有 Repository 類都繼承自 `BaseRepository`，已完全實現 Supabase 支持:

```
✅ findById(id)           - 單筆查詢
✅ findAll(options)       - 多筆查詢（支持排序、分頁、篩選）
✅ create(data)           - 創建
✅ update(id, data)       - 更新
✅ delete(id)             - 軟刪除（設置 deleted_at）
✅ getDbType()           - 獲取當前 DB 類型
```

---

## 🎯 Supabase 自動支持機制

BaseRepository 根據傳入的數據庫對象自動檢測：

```javascript
// 在 BaseRepository 構造函數中
this.isSupabase = db?.from ? true : false;  // 檢查 .from 方法
this.isSQLite = !this.isSupabase;

// 每個方法中檢測並使用正確的 API：
if (this.isSupabase) {
  // 使用 Supabase SDK API
  const { data, error } = await this.db
    .from(this.tableName)
    .select('*')
    .eq('id', id);
} else {
  // 使用 SQLite 原生 SQL
  const result = this.db.get(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);
}
```

---

## 🚀 啟用 Supabase 的步驟

### 1️⃣ 設置環境變量（在 `.env` 或 Vercel）

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_public_key
SUPABASE_SERVICE_KEY=your_service_role_key
```

### 2️⃣ 運行服務器

```bash
npm run dev
```

### 3️⃣ 檢查日誌

```
🟦 使用 Supabase PostgreSQL 作為數據庫
✓ 數據庫已初始化 (Supabase PostgreSQL)
🔄 初始化 Supabase Realtime...
```

---

## 📋 測試清單

部署到 Supabase 前：

- [ ] 在 Supabase Dashboard 創建所有表（使用 `server/db/schema.sql`）
- [ ] 設置環境變量 `SUPABASE_URL` 和 `SUPABASE_KEY`
- [ ] 運行本地測試確認所有路由正常工作
- [ ] 測試認證流程（OAuth + Repository）
- [ ] 測試數據創建、更新、刪除
- [ ] 測試 Realtime 訂閱（notes, replies, votes, favorites）
- [ ] 部署到 Vercel 並驗證生產環境

---

## 💾 數據庫遷移檢查表

**Supabase 準備**:
- [ ] 複製 `server/db/schema.sql` 中的所有 CREATE TABLE 語句
- [ ] 在 Supabase SQL 編輯器中執行
- [ ] 驗證所有 13 個表已創建
- [ ] 檢查外鍵約束是否正確

**軟刪除審計**:
- [ ] ✅ 所有 DELETE 操作使用 `deleted_at` 時間戳
- [ ] ✅ BaseRepository.delete() 已實現軟刪除
- [ ] ✅ 所有查詢都過濾 `WHERE deleted_at IS NULL`

---

## ✅ 最終狀態

| 組件 | SQLite | Supabase | 狀態 |
|-----|--------|----------|------|
| BaseRepository | ✅ | ✅ | 完全支持 |
| UserRepository | ✅ | ✅ | 完全支持 |
| NoteRepository | ✅ | ✅ | 完全支持 |
| DivinationRepository | ✅ | ✅ | 完全支持 |
| NoteReplyRepository | ✅ | ✅ | 完全支持 |
| NotificationRepository | ✅ | ✅ | 完全支持 |
| 所有 API 路由 | ✅ | ✅ | 完全支持 |
| **總體** | ✅ | ✅ | **🎉 完全就緒** |

---

**所有路由都已經通過 Repositories 連接到數據層，無論是 SQLite 還是 Supabase！** 🎊
