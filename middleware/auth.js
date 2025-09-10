import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { 
  isTokenBlacklisted, 
  checkLogoutTimestamp 
} from '../utils/tokenManager.js';

export const authenticateToken = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    if (isTokenBlacklisted(token)) {
      return res.status(401).json({
        status: 'error',
        message: 'Token has been invalidated. Please log in again.',
        code: 'TOKEN_BLACKLISTED'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (checkLogoutTimestamp(decoded.id, decoded.iat * 1000)) {
      return res.status(401).json({
        status: 'error',
        message: 'Session has been terminated. Please log in again.',
        code: 'SESSION_TERMINATED'
      });
    }

    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token no longer exists.',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = currentUser;
    req.token = token;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired! Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again!',
        code: 'INVALID_TOKEN'
      });
    }
    
    return res.status(500).json({
      status: 'error',
      message: 'Authentication failed. Internal server error.',
      code: 'AUTH_ERROR'
    });
  }
};

export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to perform this action',
        required_roles: roles,
        user_role: req.user.role,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }
    next();
  };
};

export const requireCashierOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Please login first',
      code: 'NOT_AUTHENTICATED'
    });
  }

  const userRole = req.user.role;
  
  if (userRole !== 'cashier' && userRole !== 'admin') {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Cashier or Admin role required',
      user_role: userRole,
      required_roles: ['cashier', 'admin'],
      code: 'ROLE_REQUIRED'
    });
  }

  next();
};

export const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return next();
    }

    if (isTokenBlacklisted(token)) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (checkLogoutTimestamp(decoded.id, decoded.iat * 1000)) {
        return next();
      }

      const currentUser = await User.findById(decoded.id);
      if (currentUser) {
        req.user = currentUser;
        req.token = token;
      }
    } catch (error) {
      // Continue without user
    }

    next();
  } catch (error) {
    next();
  }
};