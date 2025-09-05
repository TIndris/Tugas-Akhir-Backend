import express from 'express';
import passport from 'passport';
import { 
  logout, 
  login, 
  register, 
  logoutAllSessions,
  googleCallbackHandler,
  setPassword,
  getAuthInfo
} from '../controllers/authController.js';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { authenticateToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/adminAuth.js';

const router = express.Router();

// Local auth route with rate limiting
router.post('/login', loginLimiter(), login);

// Add register route
router.post('/register', register);

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })
);

router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.CLIENT_URL}/login?error=oauth_failed`,
    session: false
  }),
  googleCallbackHandler
);

// Profile routes
router.get('/profile', authenticateToken, getProfile);
router.patch('/profile', authenticateToken, updateProfile);

// Google user specific routes
router.post('/set-password', authenticateToken, setPassword);
router.get('/auth-info', authenticateToken, getAuthInfo);

// Existing protected routes
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
router.post('/logout', authenticateToken, logout);
router.post('/logout-all', authenticateToken, logoutAllSessions);

export default router;
