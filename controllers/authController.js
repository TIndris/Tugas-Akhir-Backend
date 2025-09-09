import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from '../config/logger.js';
import { blacklistToken } from '../utils/tokenManager.js';

const loginAttempts = new Map();
const logoutTimestamps = new Map(); 
const passwordResetTokens = new Map(); // For password reset functionality

// ✅ FIXED: Use JWT_SECRET instead of SESSION_SECRET
const generateToken = (user, expiresIn = '24h') => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET, // FIXED: Changed from SESSION_SECRET
    { expiresIn }
  );
};

export const logout = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in'
      });
    }

    const userEmail = req.user.email;
    const userRole = req.user.role;

    logger.info(`Logout attempt: ${userEmail}`, {
      role: userRole,
      action: 'LOGOUT_ATTEMPT'
    });

    // Blacklist the current token
    blacklistToken(req.token);

    logger.info(`Logout successful: ${userEmail}`, {
      role: userRole,
      action: 'LOGOUT_SUCCESS'
    });

    // ✅ ENHANCED: Clear multiple cookie names
    res.clearCookie('jwt');
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error(`Logout error: ${error.message}`, {
      action: 'LOGOUT_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: 'Error logging out'
    });
  }
};

export const logoutAllSessions = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;
    const userRole = req.user.role;

    logger.info(`Logout all sessions: ${userEmail}`, {
      role: userRole,
      action: 'LOGOUT_ALL_SESSIONS'
    });

    // Add user to logout timestamps to invalidate all existing tokens
    logoutTimestamps.set(userId.toString(), Date.now());

    // Also blacklist current token
    blacklistToken(req.token);

    // ✅ ENHANCED: Clear multiple cookie names
    res.clearCookie('jwt');
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    
    res.status(200).json({
      status: 'success',
      message: 'Logged out from all sessions successfully'
    });

  } catch (error) {
    logger.error(`Logout all sessions error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error logging out from all sessions'
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    logger.info(`Attempting login: ${email}`, { 
      action: 'LOGIN_ATTEMPT'
    });

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      logger.warn(`Failed login: User not found - ${email}`, {
        action: 'LOGIN_FAILED'
      });
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect email or password'
      });
    }

    if (user.googleId && !user.password) {
      logger.warn(`Google user attempting password login: ${email}`, {
        action: 'GOOGLE_USER_PASSWORD_ATTEMPT'
      });
      return res.status(400).json({
        status: 'error',
        message: 'This account is registered with Google. Please use Google Sign In.',
        authProvider: 'google'
      });
    }

    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      logger.warn(`Failed login: Invalid password - ${email}`, {
        action: 'LOGIN_FAILED'
      });
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect email or password'
      });
    }

    // Success - reset attempts
    loginAttempts.delete(email);

    // ✅ FIXED: Generate token with JWT_SECRET
    const token = generateToken(user);
    const refreshToken = generateToken(user, '7d');

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Remove password from response
    user.password = undefined;

    logger.info(`Successful login: ${email}`, {
      role: user.role,
      action: 'LOGIN_SUCCESS'
    });

    res.status(200).json({
      status: 'success',
      token,
      refreshToken, // ✅ ADD: Include refresh token
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          authProvider: user.authProvider || 'local',
          picture: user.picture,
          isEmailVerified: user.isEmailVerified,
          lastLogin: user.lastLogin
        }
      }
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`, {
      action: 'LOGIN_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    logger.info(`Registration attempt: ${email}`, {
      action: 'REGISTER_ATTEMPT'
    });

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.warn(`Registration failed - Email already exists: ${email}`);
      return res.status(400).json({
        status: 'error',
        message: 'Email already registered'
      });
    }

    // Create user with customer role
    const user = await User.create({
      name,
      email,
      password,
      role: 'customer',
      isEmailVerified: false,
      authProvider: 'local',
      lastLogin: new Date()
    });

    logger.info(`Registration successful: ${email}`, {
      role: 'customer',
      action: 'REGISTER_SUCCESS' 
    });

    // ✅ FIXED: Generate token with JWT_SECRET
    const token = generateToken(user);
    const refreshToken = generateToken(user, '7d');

    // Remove password from response
    user.password = undefined;

    res.status(201).json({
      status: 'success',
      token,
      refreshToken, // ✅ ADD: Include refresh token
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          authProvider: user.authProvider,
          isEmailVerified: user.isEmailVerified,
          lastLogin: user.lastLogin
        }
      }
    });
  } catch (error) {
    logger.error(`Registration error: ${error.message}`, {
      action: 'REGISTER_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// ✅ ADD: Missing refresh token function
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({
        status: 'error',
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid refresh token'
      });
    }

    // Check if user was logged out
    if (checkLogoutTimestamp(user._id, decoded.iat * 1000)) {
      return res.status(401).json({
        status: 'error',
        message: 'Token invalidated due to logout'
      });
    }

    // Generate new tokens
    const newToken = generateToken(user);
    const newRefreshToken = generateToken(user, '7d');

    logger.info(`Token refreshed for user: ${user.email}`, {
      action: 'TOKEN_REFRESH_SUCCESS'
    });

    res.status(200).json({
      status: 'success',
      token: newToken,
      refreshToken: newRefreshToken,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          authProvider: user.authProvider,
          picture: user.picture,
          isEmailVerified: user.isEmailVerified
        }
      }
    });

  } catch (error) {
    logger.error(`Refresh token error: ${error.message}`, {
      action: 'TOKEN_REFRESH_ERROR'
    });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid refresh token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Refresh token expired'
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

// ✅ ADD: Missing forgot password function
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email });
    
    if (!user) {
      // Don't reveal if email exists or not
      return res.status(200).json({
        status: 'success',
        message: 'If the email exists, a password reset link has been sent'
      });
    }

    if (user.googleId && !user.password) {
      return res.status(400).json({
        status: 'error',
        message: 'This account uses Google Sign In. No password to reset.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    // Store reset token (in production, store in database)
    passwordResetTokens.set(resetToken, {
      userId: user._id,
      email: user.email,
      expiry: resetTokenExpiry
    });

    logger.info(`Password reset requested for: ${email}`, {
      action: 'FORGOT_PASSWORD_REQUEST'
    });

    // In production, send email here
    // For now, just return the token (remove this in production)
    res.status(200).json({
      status: 'success',
      message: 'Password reset link has been sent to your email',
      // Remove this in production:
      resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
    });

  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`, {
      action: 'FORGOT_PASSWORD_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

// ✅ ADD: Missing reset password function
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;
    
    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'All fields are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Passwords do not match'
      });
    }

    // Check reset token
    const resetData = passwordResetTokens.get(token);
    
    if (!resetData || Date.now() > resetData.expiry) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired reset token'
      });
    }

    // Find user and update password
    const user = await User.findById(resetData.userId);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Remove used token
    passwordResetTokens.delete(token);

    // Invalidate all existing tokens for this user
    logoutTimestamps.set(user._id.toString(), Date.now());

    logger.info(`Password reset successful for: ${user.email}`, {
      action: 'RESET_PASSWORD_SUCCESS'
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset successfully. Please login with your new password.'
    });

  } catch (error) {
    logger.error(`Reset password error: ${error.message}`, {
      action: 'RESET_PASSWORD_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

export const setPassword = async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    const user = req.user;

    if (!user.googleId) {
      return res.status(400).json({
        status: 'error',
        message: 'This feature is only for Google users'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Passwords do not match'
      });
    }

    if (user.password) {
      return res.status(400).json({
        status: 'error',
        message: 'User already has a password. Use change password feature.'
      });
    }

    // Set password
    user.password = password;
    await user.save();

    logger.info(`Password set for Google user: ${user.email}`, {
      action: 'SET_PASSWORD_SUCCESS'
    });

    res.status(200).json({
      status: 'success',
      message: 'Password set successfully. You can now login with email and password.',
      data: {
        canLoginWithPassword: true
      }
    });

  } catch (error) {
    logger.error(`Set password error: ${error.message}`, {
      action: 'SET_PASSWORD_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: 'Error setting password'
    });
  }
};

export const getAuthInfo = async (req, res) => {
  try {
    const user = req.user;
    
    res.status(200).json({
      status: 'success',
      data: {
        authProvider: user.authProvider,
        hasPassword: !!user.password,
        hasGoogleAuth: !!user.googleId,
        isEmailVerified: user.isEmailVerified,
        canSetPassword: user.googleId && !user.password,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    logger.error(`Get auth info error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error getting auth info'
    });
  }
};

export const checkLogoutTimestamp = (userId, tokenIssuedAt) => {
  const userLogoutTime = logoutTimestamps.get(userId.toString());
  return userLogoutTime && tokenIssuedAt < userLogoutTime;
};