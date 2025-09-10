import express from 'express';
import passport from 'passport';
import { 
  logout, 
  login, 
  register, 
  logoutAllSessions,
  setPassword,
  getAuthInfo,
  refreshToken,
  forgotPassword,
  resetPassword
} from '../controllers/authController.js';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { authenticateToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/adminAuth.js';
import { generateToken } from '../utils/tokenManager.js';
import logger from '../config/logger.js';

const router = express.Router();

const getFrontendURL = () => {
  return process.env.CLIENT_URL || 'http://localhost:3000';
};

router.post('/login', loginLimiter(), login);
router.post('/register', register);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/google', (req, res, next) => {
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: '/auth/google/failure',
    session: false
  }),
  async (req, res) => {
    try {
      if (!req.user) {
        logger.error('No user in Google callback');
        const frontendUrl = getFrontendURL();
        return res.redirect(`${frontendUrl}/login?error=auth_failed&message=No user data received`);
      }

      const token = generateToken(req.user);
      const refreshTokenValue = generateToken(req.user, '7d');

      req.user.lastLogin = new Date();
      await req.user.save();

      logger.info('Google login successful, tokens generated', { 
        userId: req.user._id,
        email: req.user.email,
        name: req.user.name,
        authProvider: req.user.authProvider
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      };

      res.cookie('token', token, cookieOptions);
      res.cookie('refreshToken', refreshTokenValue, cookieOptions);

      const frontendUrl = getFrontendURL();
      const userInfo = {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        authProvider: req.user.authProvider,
        token: token,
        refreshToken: refreshTokenValue
      };
      
      const params = new URLSearchParams({
        login: 'success',
        provider: 'google',
        user: JSON.stringify(userInfo),
        timestamp: Date.now()
      });
      
      const redirectUrl = `${frontendUrl}/dashboard?${params.toString()}`;
      
      logger.info('Redirecting to frontend', {
        frontendUrl,
        userId: req.user._id
      });

      res.redirect(redirectUrl);

    } catch (error) {
      logger.error('Google callback error:', {
        error: error.message,
        stack: error.stack,
        user: req.user ? req.user._id : 'No user'
      });

      const frontendUrl = getFrontendURL();
      const errorMessage = encodeURIComponent(error.message || 'Authentication failed');
      res.redirect(`${frontendUrl}/login?error=callback_error&message=${errorMessage}`);
    }
  }
);

router.get('/google/failure', (req, res) => {
  logger.error('Google authentication failed');
  
  const frontendUrl = getFrontendURL();
  res.redirect(`${frontendUrl}/login?error=google_auth_failed&message=Authentication failed`);
});

router.get('/google/test', (req, res) => {
  const backendUrl = process.env.BACKEND_URL || 'https://dsc-backend-ashy.vercel.app';
  const frontendUrl = getFrontendURL();
  const callbackURL = `${backendUrl}/auth/google/callback`;

  res.json({
    message: 'Google auth configuration test',
    environment: process.env.NODE_ENV || 'production',
    backend_url: backendUrl,
    frontend_url: frontendUrl,
    client_url: process.env.CLIENT_URL,
    callback_url: callbackURL,
    google_client_id: process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Missing',
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET ? 'Configured' : 'Missing',
    jwt_secret: process.env.JWT_SECRET ? 'Configured' : 'Missing',
    session_secret: process.env.SESSION_SECRET ? 'Configured' : 'Missing',
    cors_enabled: true,
    token_manager: {
      blacklist_active: true,
      cleanup_enabled: process.env.NODE_ENV !== 'production'
    },
    timestamp: new Date().toISOString()
  });
});

router.get('/cookies-test', (req, res) => {
  res.json({
    cookies: req.cookies,
    headers: {
      origin: req.get('Origin'),
      authorization: req.headers.authorization ? 'Present' : 'Missing'
    },
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

router.get('/test-auth', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    message: 'Authentication working!',
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      authProvider: req.user.authProvider
    },
    tokenSource: req.headers.authorization ? 'header' : 'cookie',
    timestamp: new Date().toISOString()
  });
});

router.get('/profile', authenticateToken, getProfile);
router.patch('/profile', authenticateToken, updateProfile);
router.post('/set-password', authenticateToken, setPassword);
router.get('/auth-info', authenticateToken, getAuthInfo);

router.get('/status', authenticateToken, (req, res) => {
  res.json({
    isAuthenticated: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      authProvider: req.user.authProvider,
      isEmailVerified: req.user.isEmailVerified,
      role: req.user.role
    }
  });
});

router.post('/logout', authenticateToken, logout);
router.post('/logout-all', authenticateToken, logoutAllSessions);

export default router;
