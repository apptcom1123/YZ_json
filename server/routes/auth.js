import express from 'express';
import { requireSession } from '../middleware/auth.js';

const router = express.Router();

// The browser needs only the publishable key. The service-role key never leaves the server.
router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_KEY
  });
});

router.get('/status', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.json({
        loggedIn: false,
        loginBlocked: false,
        requiresTerms: false,
        blockReason: null,
        user: null
      });
    }

    const user = await req.app.locals.repositories.user.upsertFromSupabaseAuth(req.authUser);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: '找不到使用者資料' });

    const login = await req.app.locals.repositories.user.canLogin(user.id,user);
    res.json({
      loggedIn: login.allowed,
      loginBlocked: !login.allowed,
      requiresTerms: !login.allowed && login.reason === 'TERMS_NOT_ACCEPTED',
      blockReason: login.reason || null,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireSession, (req, res) => res.json({ success: true }));

export default router;
