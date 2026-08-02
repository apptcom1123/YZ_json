/** Supabase Auth token verification for every API request. */

async function resolveSupabaseUser(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice(7).trim();
  if (!token || !req.app.locals.supabaseAuthClient) return null;

  const { data, error } = await req.app.locals.supabaseAuthClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function authMiddleware(req, res, next) {
  try {
    const authUser = await resolveSupabaseUser(req);
    if (authUser) {
      req.authUser = authUser;
      req.user = {
        userId: authUser.id,
        email: authUser.email || null
      };
    } else {
      req.user = null;
    }
    next();
  } catch (error) {
    console.error('Supabase Auth verification failed:', error.message);
    req.user = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: '請先登入' });
  }
  next();
}

export function optionalAuth(req, res, next) {
  next();
}

export function requireRole(role) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED', message: '請先登入' });
    const user = await req.app.locals.repositories.user.findById(req.user.userId);
    if (!user || user.role !== role) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '權限不足' });
    }
    next();
  };
}

export async function attachUserInfo(req, res, next) {
  if (!req.user || !req.authUser) return next();
  try {
    const userRepo = req.app.locals.repositories?.user;
    if (!userRepo) return next();
    req.userInfo = await userRepo.upsertFromSupabaseAuth(req.authUser);
    next();
  } catch (error) {
    next(error);
  }
}
