import express from 'express';
import passport from 'passport';
import { 
  logout, 
  login, 
  register, 
  logoutAllSessions,
  setPassword,
  getAuthInfo,
  refreshToken,        // ADD: Missing function
  forgotPassword,      // ADD: Missing function
  resetPassword        // ADD: Missing function
} from '../controllers/authController.js';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { authenticateToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/adminAuth.js';
import { generateToken } from '../utils/tokenManager.js';  // ADD: Missing import
import logger from '../config/logger.js';                   // ADD: Missing import

const router = express.Router();

// Helper function to get frontend URL
const getFrontendURL = () => {
  return process.env.CLIENT_URL || 'http://localhost:3000';
};

// ✅ EXISTING: Local auth route with rate limiting
router.post('/login', loginLimiter(), login);

// ✅ EXISTING: Register route
router.post('/register', register);

// ✅ ADD: Missing auth routes
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// ✅ ENHANCED: Google OAuth routes with better error handling
router.get('/google', (req, res, next) => {
  console.log('=== GOOGLE AUTH INITIATION ===');
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Client URL:', process.env.CLIENT_URL);
  console.log('Backend URL:', process.env.BACKEND_URL);
  
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' // Force account selection
  })(req, res, next);
});

// ✅ ENHANCED: Google callback with comprehensive error handling
router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: '/auth/google/failure',
    session: false // Use JWT instead of sessions
  }),
  async (req, res) => {
    try {
      console.log('=== GOOGLE CALLBACK SUCCESS ===');
      console.log('User from passport:', req.user ? { 
        id: req.user._id, 
        email: req.user.email, 
        name: req.user.name,
        authProvider: req.user.authProvider
      } : 'No user');

      if (!req.user) {
        logger.error('No user in Google callback');
        const frontendUrl = getFrontendURL();
        return res.redirect(`${frontendUrl}/login?error=auth_failed&message=No user data received`);
      }

      // Generate JWT tokens
      const token = generateToken(req.user);
      const refreshTokenValue = generateToken(req.user, '7d');

      logger.info('Google login successful, tokens generated', { 
        userId: req.user._id,
        email: req.user.email,
        name: req.user.name,
        authProvider: req.user.authProvider
      });

      // Set secure cookies for token storage
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/'
      };

      res.cookie('token', token, cookieOptions);
      res.cookie('refreshToken', refreshTokenValue, cookieOptions);

      // Redirect to frontend with success parameters
      const frontendUrl = getFrontendURL();
      const redirectUrl = `${frontendUrl}/dashboard?login=success&provider=google&token=${encodeURIComponent(token)}`;
      
      logger.info('Redirecting to frontend', {
        frontendUrl,
        userId: req.user._id
      });

      res.redirect(redirectUrl);

    } catch (error) {
      console.error('=== GOOGLE CALLBACK ERROR ===');
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);

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

// ✅ ADD: Google auth failure handler
router.get('/google/failure', (req, res) => {
  logger.error('Google authentication failed');
  console.log('=== GOOGLE AUTH FAILURE ===');
  
  const frontendUrl = getFrontendURL();
  res.redirect(`${frontendUrl}/login?error=google_auth_failed&message=Authentication failed`);
});

// ✅ ADD: Test endpoint for Google auth configuration
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
    timestamp: new Date().toISOString()
  });
});

// ✅ EXISTING: Profile routes
router.get('/profile', authenticateToken, getProfile);
router.patch('/profile', authenticateToken, updateProfile);

// ✅ EXISTING: Google user specific routes
router.post('/set-password', authenticateToken, setPassword);
router.get('/auth-info', authenticateToken, getAuthInfo);

// ✅ EXISTING: Protected routes
router.get('/status', authenticateToken, (req, res) => {
  res.json({
    isAuthenticated: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      picture: req.user.picture,
      authProvider: req.user.authProvider,
      isEmailVerified: req.user.isEmailVerified,
      role: req.user.role
    }
  });
});

// ✅ EXISTING: Logout routes
router.post('/logout', authenticateToken, logout);
router.post('/logout-all', authenticateToken, logoutAllSessions);

export default router;
