/**
 * 主服務器文件
 * Express 應用配置與啟動
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db/index.js';
import { UserRepository } from './repositories/UserRepository.js';
import { NoteRepository } from './repositories/NoteRepository.js';
import { DivinationRepository } from './repositories/DivinationRepository.js';
import { NoteReplyRepository } from './repositories/NoteReplyRepository.js';
import { NotificationRepository } from './repositories/NotificationRepository.js';
import { authMiddleware, attachUserInfo } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import notesRoutes from './routes/notes.js';
import divinationsRoutes from './routes/divinations.js';
import repliesRoutes from './routes/replies.js';
import notificationsRoutes from './routes/notifications.js';
import { getRealtimeService } from './services/realtimeService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || './data/app.db';

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 靜態文件
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../dist')));
app.use('/image', express.static(path.join(__dirname, '../image')));

// 認證中間件
app.use(authMiddleware);
app.use(attachUserInfo);

/**
 * 初始化數據庫和 repositories
 */
async function initializeApp() {
  try {
    console.log('🔄 初始化數據庫...');
    
    let repositories, db;
    let dbProvider = 'SQLite';

    // 判斷使用 Supabase 還是 SQLite
    if (SUPABASE_URL && SUPABASE_KEY) {
      console.log('🟦 使用 Supabase PostgreSQL 作為數據庫');
      dbProvider = 'Supabase PostgreSQL';
      
      // 使用 Supabase 客戶端
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
      
      // 初始化 Supabase repositories
      repositories = {
        user: new UserRepository(supabaseClient),
        note: new NoteRepository(supabaseClient),
        divination: new DivinationRepository(supabaseClient),
        reply: new NoteReplyRepository(supabaseClient),
        notification: new NotificationRepository(supabaseClient)
      };
      
      app.locals.supabaseClient = supabaseClient;
      db = supabaseClient;
    } else {
      console.log('🟩 使用 SQLite 作為數據庫（開發環境）');
      dbProvider = 'SQLite';
      
      db = await initDatabase(DB_PATH);

      // 初始化 SQLite repositories
      repositories = {
        user: new UserRepository(db),
        note: new NoteRepository(db),
        divination: new DivinationRepository(db),
        reply: new NoteReplyRepository(db),
        notification: new NotificationRepository(db)
      };
    }

    // 將 repositories 存儲在 app.locals 中
    app.locals.repositories = repositories;
    app.locals.db = db;
    app.locals.dbProvider = dbProvider;

    // 初始化 Supabase Realtime 服務
    if (SUPABASE_URL && SUPABASE_KEY) {
      console.log('🔄 初始化 Supabase Realtime...');
      const realtimeService = getRealtimeService(SUPABASE_URL, SUPABASE_KEY);
      app.locals.realtimeService = realtimeService;
    } else {
      console.log('⚠️  未配置 Supabase Realtime');
      app.locals.realtimeService = null;
    }

    console.log(`✓ 數據庫已初始化 (${dbProvider})`);
    return db;
  } catch (error) {
    console.error('✗ 初始化失敗:', error);
    process.exit(1);
  }
}

/**
 * API 路由
 */
function setupRoutes(app) {
  // 健康檢查
  app.get('/api/health', (req, res) => {
    const realtimeService = app.locals.realtimeService;
    const realtimeStatus = realtimeService ? realtimeService.getStatus() : null;
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: 'development',
      features: {
        mockOAuth: true,
        localStorage: 'supported',
        sqlite: 'local',
        realtime: realtimeStatus ? {
          connected: realtimeStatus.isConnected,
          subscriptions: realtimeStatus.subscriptionCount
        } : null
      }
    });
  });

  // 認證路由
  app.use('/api/auth', authRoutes);

  // 用戶路由
  app.use('/api/me', userRoutes);

  // 註記路由
  app.use('/api/notes', notesRoutes);

  // 占卜路由
  app.use('/api/divinations', divinationsRoutes);

  // 回覆路由（嵌套在 notes 下）
  app.use('/api/notes', repliesRoutes);

  // 通知路由（嵌套在 me 下）
  app.use('/api/me/notifications', notificationsRoutes);

  // 根路徑重定向到前端
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // 404 處理
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '端點不存在'
      });
    } else {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    }
  });

  // 錯誤處理
  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: '服務器錯誤',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });
}

/**
 * 啟動服務器
 */
async function startServer() {
  try {
    // 初始化應用
    await initializeApp();

    // 設置路由
    setupRoutes(app);

    // 啟動服務器
    app.listen(PORT, () => {
      console.log('');
      console.log('╔════════════════════════════════════════╗');
      console.log('║     周易讀本 - 本地開發服務器          ║');
      console.log('╚════════════════════════════════════════╝');
      console.log('');
      console.log(`🌐 服務器運行於: http://localhost:${PORT}`);
      console.log('');
      console.log('📋 可用的測試帳號：');
      console.log('   - test1@example.com (測試用戶一)');
      console.log('   - test2@example.com (測試用戶二)');
      console.log('   - admin@example.com (管理員)');
      console.log('');
      console.log('💾 數據庫: SQLite (PostgreSQL 兼容)');
      console.log(`📁 位置: ${DB_PATH}`);
      console.log('');
      console.log('⚙️  API 端點:');
      console.log('   - GET  /api/health');
      console.log('   - GET  /api/auth/mock-accounts');
      console.log('   - POST /api/auth/google/start');
      console.log('   - POST /api/auth/google/callback');
      console.log('   - GET  /api/me/settings');
      console.log('   - GET  /api/notes');
      console.log('');
      console.log('🔧 環境變量:');
      console.log(`   - PORT=${PORT}`);
      console.log(`   - DB_PATH=${DB_PATH}`);
      console.log('');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// 優雅關閉
process.on('SIGINT', async () => {
  console.log('\n🛑 正在關閉服務器...');
  if (app.locals.db) {
    await app.locals.db.close();
  }
  process.exit(0);
});

// 啟動
startServer();

export default app;
