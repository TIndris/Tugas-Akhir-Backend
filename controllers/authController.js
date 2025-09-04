import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { blacklistToken } from '../utils/tokenManager.js';
import passport from 'passport';

const loginAttempts = new Map();
const logoutTimestamps = new Map(); // Track logout timestamps for users

// ✅ EXISTING: Logout function (tetap sama)
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

    res.clearCookie('jwt');
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

// ✅ EXISTING: Logout all sessions (tetap sama)
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

    res.clearCookie('jwt');
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

// ✅ EXISTING: Login function (tetap sama)
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

    // ✅ UPDATE: Check if Google user trying to login with password
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

    // Generate token
    const token = jwt.sign(
      { id: user._id },
      process.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    // Remove password from response
    user.password = undefined;

    logger.info(`Successful login: ${email}`, {
      role: user.role,
      action: 'LOGIN_SUCCESS'
    });

    // Send response
    res.status(200).json({
      status: 'success',
      token,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          // ✅ ADD: Google user info
          authProvider: user.authProvider || 'local',
          picture: user.picture,
          isEmailVerified: user.isEmailVerified
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

// ✅ EXISTING: Register function (tetap sama)
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
      authProvider: 'local' // ✅ ADD: Mark as local auth
    });

    logger.info(`Registration successful: ${email}`, {
      role: 'customer',
      action: 'REGISTER_SUCCESS' 
    });

    // Generate token
    const token = jwt.sign(
      { id: user._id },
      process.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    // Remove password from response
    user.password = undefined;

    res.status(201).json({
      status: 'success',
      token,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          authProvider: user.authProvider,
          isEmailVerified: user.isEmailVerified
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

// ✅ NEW: Google OAuth callback handler (untuk dipindahkan ke routes)
export const googleCallbackHandler = async (req, res) => {
  try {
    if (!req.user) {
      logger.error('Google OAuth: No user in request');
      return res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
    }

    const user = req.user;

    // Generate JWT token dengan payload yang sama seperti login biasa
    const token = jwt.sign(
      { id: user._id },
      process.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`Google OAuth successful: ${user.email}`, {
      role: user.role,
      action: 'GOOGLE_OAUTH_SUCCESS',
      isNewUser: user.isNewUser || false
    });

    // ✅ OPTION 1: Set cookie (same as existing callback)
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    // ✅ OPTION 2: Redirect with user data for frontend
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture,
      authProvider: user.authProvider,
      isEmailVerified: user.isEmailVerified
    };

    // Redirect with both cookie and query params for flexibility
    const redirectUrl = `${process.env.CLIENT_URL}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`;
    
    res.redirect(redirectUrl);

  } catch (error) {
    logger.error('Google OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/login?error=callback_error`);
  }
};

// ✅ NEW: Set password for Google users
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

// ✅ NEW: Get auth providers info
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
        canSetPassword: user.googleId && !user.password
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

// ✅ Export function untuk check logout timestamps (untuk middleware)
export const checkLogoutTimestamp = (userId, tokenIssuedAt) => {
  const userLogoutTime = logoutTimestamps.get(userId.toString());
  return userLogoutTime && tokenIssuedAt < userLogoutTime;
};
