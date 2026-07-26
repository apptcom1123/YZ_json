import jwt from 'jwt-simple';
import { verifyMockToken } from './mockOAuth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mock-development-secret-key-not-for-production';

/**
 * 生成會話 JWT
 */
export function generateSessionToken(userId, googleSub) {
  const payload = {
    userId,
    googleSub,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 // 24 小時
  };

  return jwt.encode(payload, JWT_SECRET);
}

/**
 * 驗證會話 JWT
 */
export function verifySessionToken(token) {
  try {
    return jwt.decode(token, JWT_SECRET, true, 'HS256');
  } catch (error) {
    return null;
  }
}

/**
 * 認證中間件 - 檢查 Authorization header
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // 未認證 - 允許繼續（某些端點允許未認證訪問）
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  // 首先嘗試驗證會話 JWT
  let decoded = verifySessionToken(token);

  // 如果失敗，嘗試驗證 Mock OAuth Token
  if (!decoded) {
    decoded = verifyMockToken(token);
  }

  if (decoded) {
    req.user = {
      userId: decoded.userId || decoded.sub,
      googleSub: decoded.googleSub || decoded.sub
    };
  }

  next();
}

/**
 * 需要認證的中間件
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '需要登入'
    });
  }
  next();
}

/**
 * 需要特定權限的中間件
 */
export function requireRole(role) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '需要登入'
      });
    }

    // 從 repositories 獲取用戶信息
    const { user: userRepo } = req.app.locals.repositories;
    const user = await userRepo.findById(req.user.userId);

    if (!user || user.role !== role) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: '沒有權限'
      });
    }

    next();
  };
}

/**
 * 可選的認證中間件（會嘗試驗證但不強制）
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifySessionToken(token) || verifyMockToken(token);

    if (decoded) {
      req.user = {
        userId: decoded.userId || decoded.sub,
        googleSub: decoded.googleSub || decoded.sub
      };
    }
  }

  next();
}

/**
 * 驗證 return_to 參數是否安全
 * 只允許站內相對路徑
 */
export function validateReturnTo(returnTo) {
  if (!returnTo) return '/';

  // 禁止：完整 URL、外部域名、協議
  if (returnTo.includes('://') || returnTo.startsWith('//') || returnTo.startsWith('javascript:')) {
    return '/';
  }

  // 只允許相對路徑
  if (!returnTo.startsWith('/')) {
    return '/';
  }

  // 基本的路徑驗證
  if (returnTo.includes('..')) {
    return '/';
  }

  return returnTo;
}

/**
 * 附加用戶信息到請求對象
 */
export function attachUserInfo(req, res, next) {
  if (req.user) {
    const { user: userRepo } = req.app.locals.repositories;
    
    userRepo.findById(req.user.userId).then(user => {
      if (user) {
        req.userInfo = user;
      }
      next();
    }).catch(error => {
      console.error('Error fetching user info:', error);
      next();
    });
  } else {
    next();
  }
}
