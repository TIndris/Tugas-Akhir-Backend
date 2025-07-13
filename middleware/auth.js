import { isTokenBlacklisted } from '../utils/tokenManager.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    const cookieToken = req.cookies ? req.cookies.jwt : null;
    
    if (!token && !cookieToken) {
      return res.status(401).json({
        status: 'error',
        message: 'Please login first'
      });
    }

    // Verify token
    const actualToken = token || cookieToken;
    const decoded = jwt.verify(actualToken, process.env.SESSION_SECRET);
    
    // Check if token is blacklisted
    if (isTokenBlacklisted(actualToken)) {
      return res.status(401).json({
        status: 'error',
        message: 'Token is no longer valid, please login again'
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    req.user = user;
    req.token = actualToken;
    next();
  } catch (error) {
    console.error('JWT error:', error);
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
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

// ADD: Enhanced middleware for cashier operations
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