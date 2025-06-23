import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { getProfile, logout, login, register } from '../controllers/authController.js';
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
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    try {
      const token = jwt.sign(
        { id: req.user._id },
        process.env.SESSION_SECRET,
        { expiresIn: '24h' }
      );

      res.cookie('jwt', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.redirect(`${process.env.CLIENT_URL}/dashboard`);
    } catch (error) {
      console.error('Callback Error:', error);
      res.redirect('/login?error=authentication_failed');
    }
  }
);

// Protected routes
router.get('/profile', authenticateToken, getProfile);
router.get('/status', authenticateToken, (req, res) => {
  res.json({
    isAuthenticated: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      picture: req.user.picture
    }
  });
});
router.post('/logout', authenticateToken, logout);

export default router;
