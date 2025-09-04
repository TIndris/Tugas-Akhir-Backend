import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isTokenBlacklisted } from '../utils/tokenManager.js';
import { checkLogoutTimestamp } from '../controllers/authController.js';

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

    // Verify token
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);

    // Check logout timestamp for "logout all sessions"
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
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired! Please log in again.'
      });
    }
    
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token. Please log in again!'
    });
  }
};

// Role based access control
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to perform this action'
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
      user_role: userRole
    });
  }

  next();
};