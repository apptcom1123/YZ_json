/** Supabase access-token verification and application eligibility checks. */

async function resolveSupabaseUser(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token || !req.app.locals.supabaseAuthClient) return null;
  const { data, error } = await req.app.locals.supabaseAuthClient.auth.getClaims(token);
  const claims=data?.claims;
  if(error||!claims?.sub)return null;
  return {
    id:claims.sub,
    email:claims.email||null,
    user_metadata:claims.user_metadata||{},
    app_metadata:claims.app_metadata||{},
    identities:[]
  };
}

export async function authMiddleware(req, _res, next) {
  try {
    const authUser = await resolveSupabaseUser(req);
    req.authUser = authUser || null;
    req.user = authUser ? { userId: authUser.id, email: authUser.email || null } : null;
    next();
  } catch (error) {
    console.error('Supabase Auth verification failed:', error.message);
    req.authUser = null;
    req.user = null;
    next();
  }
}

export function requireSession(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'IDENTITY_VERIFICATION_FAILED', message: '身分驗證失敗：請先以 Google 登入。' });
  }
  next();
}

export async function requireAuth(req, res, next) {
  if (!req.user) return requireSession(req, res, next);
  try {
    const eligibility=await req.app.locals.repositories.user.getLoginEligibility(req.user.userId);
    const user=eligibility.user;
    const login=eligibility.login;
    req.userInfo=user;
    if (!login.allowed) {
      const message = login.reason === 'TERMS_NOT_ACCEPTED'
        ? '身分驗證失敗：請先在此瀏覽器接受使用條款。'
        : '身分驗證失敗：非使用者本人、帳號已失效，或驗證已過期。';
      return res.status(403).json({ error: 'IDENTITY_VERIFICATION_FAILED', message, reason: login.reason });
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuth(_req, _res, next) { next(); }

export function requireRole(role) {
  return async (req, res, next) => {
    await requireAuth(req, res, async () => {
      const user = req.userInfo || await req.app.locals.repositories.user.findById(req.user.userId);
      if (!user || user.role !== role) {
        return res.status(403).json({ error: 'IDENTITY_VERIFICATION_FAILED', message: '身分驗證失敗：非使用者本人或權限不足。' });
      }
      next();
    });
  };
}

export async function attachUserInfo(req, _res, next) {
  if (!req.user || !req.authUser) return next();
  try {
    const userRepo = req.app.locals.repositories?.user;
    if (userRepo) req.userInfo = await userRepo.upsertFromSupabaseAuth(req.authUser);
    next();
  } catch (error) {
    next(error);
  }
}
