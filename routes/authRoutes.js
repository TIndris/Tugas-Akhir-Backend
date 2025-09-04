import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
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

// ✅ ADD: Debug endpoint untuk create Google user (testing only)
router.post('/debug/create-google-user', async (req, res) => {
  try {
    // ✅ WARNING: Only for testing - remove in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        status: 'error',
        message: 'Debug endpoint disabled in production'
      });
    }

    const { name, email, googleId } = req.body;

    // Check if user exists
    let existingUser = await User.findOne({ 
      $or: [{ email }, { googleId }] 
    });

    if (existingUser) {
      // Generate token for existing user
      const token = jwt.sign(
        { id: existingUser._id },
        process.env.SESSION_SECRET,
        { expiresIn: '24h' }
      );

      return res.json({
        status: 'success',
        message: 'Existing Google user',
        token,
        user: {
          id: existingUser._id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
          authProvider: existingUser.authProvider,
          googleId: existingUser.googleId
        }
      });
    }

    // Create new Google user
    const newUser = await User.create({
      googleId: googleId || `google_${Date.now()}`,
      name,
      email,
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`,
      isEmailVerified: true,
      authProvider: 'google',
      role: 'customer',
      lastLogin: new Date()
    });

    // Generate token
    const token = jwt.sign(
      { id: newUser._id },
      process.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      status: 'success',
      message: 'Google user created for testing',
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        authProvider: newUser.authProvider,
        googleId: newUser.googleId
      }
    });

  } catch (error) {
    logger.error('Debug create Google user error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

export default router;
