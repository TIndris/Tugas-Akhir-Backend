import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { 
  isTokenBlacklisted, 
  checkLogoutTimestamp 
} from '../utils/tokenManager.js';  // ✅ FIXED: Import from tokenManager

export const authenticateToken = async (req, res, next) => {
  try {
    let token;

    // Get token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Get token from cookie (for Google OAuth)
    else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }
    // ✅ ADD: Also check for 'token' cookie
    else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in! Please log in to get access.'
      });
    }

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({
        status: 'error',
        message: 'Token has been invalidated. Please log in again.'
      });
    }

    // ✅ FIXED: Verify token with JWT_SECRET instead of SESSION_SECRET
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ FIXED: Check logout timestamp using tokenManager function
    if (checkLogoutTimestamp(decoded.id, decoded.iat * 1000)) {
      return res.status(401).json({
        status: 'error',
        message: 'Session has been terminated. Please log in again.'
      });
    }

    // Get user
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token does no longer exist.'
      });
    }

    // Attach user and token to request
    req.user = currentUser;
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired! Please log in again.',
        error_code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again!',
        error_code: 'INVALID_TOKEN'
      });
    }
    
    return res.status(401).json({
      status: 'error',
      message: 'Authentication failed. Please log in again!',
      error_code: 'AUTH_FAILED'
    });
  }
};

// Role based access control
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to perform this action',
        required_roles: roles,
        user_role: req.user.role
      });
    }
    next();
  };
};

// Middleware for cashier operations
export const requireCashierOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Please login first'
    });
  }

  const userRole = req.user.role;
  
  if (userRole !== 'cashier' && userRole !== 'admin') {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Cashier or Admin role required',
      user_role: userRole,
      required_roles: ['cashier', 'admin']
    });
  }

  next();
};

// ✅ ADD: Optional token authentication (for public routes that can benefit from user info)
export const optionalAuth = async (req, res, next) => {
  try {
    let token;

    // Get token from various sources
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    } else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      // No token provided, continue without user
      return next();
    }

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      // Invalid token, continue without user
      return next();
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check logout timestamp
      if (checkLogoutTimestamp(decoded.id, decoded.iat * 1000)) {
        return next();
      }

      // Get user
      const currentUser = await User.findById(decoded.id);
      if (currentUser) {
        req.user = currentUser;
        req.token = token;
      }
    } catch (error) {
      // Token invalid, continue without user
      console.log('Optional auth failed (continuing):', error.message);
    }

    next();
  } catch (error) {
    // Any error in optional auth should not block the request
    console.error('Optional auth error:', error);
    next();
  }
};