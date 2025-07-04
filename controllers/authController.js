import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';  // ← FIXED PATH
import { blacklistToken } from '../utils/tokenManager.js';

const loginAttempts = new Map();

export const getProfile = async (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          picture: user.picture
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error fetching profile'
    });
  }
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
          role: user.role
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
      isEmailVerified: false
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
          role: user.role
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
