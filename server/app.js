import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { UserRepository } from './repositories/UserRepository.js';
import { NoteRepository } from './repositories/NoteRepository.js';
import { DivinationRepository } from './repositories/DivinationRepository.js';
import { NoteReplyRepository } from './repositories/NoteReplyRepository.js';
import { NotificationRepository } from './repositories/NotificationRepository.js';
import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import notesRoutes from './routes/notes.js';
import divinationsRoutes from './routes/divinations.js';
import repliesRoutes from './routes/replies.js';
import notificationsRoutes from './routes/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSingleEnvValue(name) {
  const values = String(process.env[name] || '').trim().split(/\s+/).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length > 1) {
    throw new Error(`${name} must contain exactly one value.`);
  }
  return uniqueValues[0] || '';
}

export async function createApp({ serveStatic = false } = {}) {
  const SUPABASE_URL = readSingleEnvValue('SUPABASE_URL');
  const SUPABASE_KEY = readSingleEnvValue('SUPABASE_KEY');
  const SUPABASE_SERVICE_KEY = readSingleEnvValue('SUPABASE_SERVICE_KEY');
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL, SUPABASE_KEY, and SUPABASE_SERVICE_KEY are required.');
  }

  const app = express();
  const allowedOrigins = ['http://localhost:3001', 'http://127.0.0.1:3001', 'https://iching-reader-seven.vercel.app'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (serveStatic) {
    app.use(express.static(path.join(__dirname, '../public')));
    app.use(express.static(path.join(__dirname, '../dist')));
    app.use('/image', express.static(path.join(__dirname, '../image')));
    app.use('/vendor/supabase', express.static(path.join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd')));
  }

  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  app.locals.supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  app.locals.supabaseClient = supabaseClient;
  app.locals.db = supabaseClient;
  app.locals.dbProvider = 'Supabase PostgreSQL';
  app.locals.repositories = {
    user: new UserRepository(supabaseClient),
    note: new NoteRepository(supabaseClient),
    divination: new DivinationRepository(supabaseClient),
    reply: new NoteReplyRepository(supabaseClient),
    notification: new NotificationRepository(supabaseClient)
  };

  app.use(authMiddleware);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'supabase-postgresql', auth: 'supabase-google-oauth' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/me', userRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/divinations', divinationsRoutes);
  app.use('/api/notes', repliesRoutes);
  app.use('/api/me/notifications', notificationsRoutes);

  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '找不到 API' }));
  app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: '伺服器發生錯誤' });
  });
  return app;
}
