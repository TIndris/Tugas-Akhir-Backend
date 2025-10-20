import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import logger from './logger.js';

// ✅ JWT Strategy (existing)
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
}, async (payload, done) => {
  try {
    const user = await User.findById(payload.id);
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    return done(error, false);
  }
}));

// ✅ SIMPLIFIED: Google OAuth Strategy without picture handling
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://tugasakhir-chi.vercel.app/api/auth/google/callback',
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('=== GOOGLE OAUTH DEBUG ===');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Backend URL:', process.env.BACKEND_URL);
    console.log('Client URL:', process.env.CLIENT_URL);
    console.log('Callback URL:', `${process.env.BACKEND_URL}/auth/google/callback`);
    console.log('Frontend URL:', process.env.CLIENT_URL);
    console.log('Profile ID:', profile.id);
    console.log('Profile Email:', profile.emails?.[0]?.value);

    const email = profile.emails?.[0]?.value;
    if (!email) {
      logger.error('No email provided by Google', { profileId: profile.id });
      return done(new Error('No email provided by Google'), null);
    }

    // Check if user already exists
    let user = await User.findOne({ email });

    if (user) {
      // ✅ SIMPLIFIED: Update existing user with Google info (no picture)
      let updated = false;

      if (!user.googleId) {
        user.googleId = profile.id;
        user.authProvider = 'google';
        updated = true;
      }

      if (!user.isEmailVerified) {
        user.isEmailVerified = true; // Google emails are verified
        updated = true;
      }

      user.lastLogin = new Date();
      
      if (updated) {
        await user.save();
        logger.info('Updated existing user with Google info', {
          userId: user._id,
          email: user.email,
          hadGoogleId: !!user.googleId
        });
      }

      return done(null, user);
    } else {
      // ✅ SIMPLIFIED: Create new user without picture
      const userData = {
        name: profile.displayName || profile.name?.givenName || 'Google User',
        email: email,
        googleId: profile.id,
        authProvider: 'google',
        role: 'customer',
        isEmailVerified: true,
        lastLogin: new Date()
      };

      try {
        user = await User.create(userData);
        
        logger.info('Created new Google user', {
          userId: user._id,
          email: user.email,
          name: user.name
        });

        return done(null, user);
      } catch (createError) {
        logger.error('Failed to create Google user', {
          error: createError.message,
          email: email,
          profileId: profile.id
        });
        return done(createError, null);
      }
    }

  } catch (error) {
    logger.error('Google OAuth Strategy error:', {
      error: error.message,
      stack: error.stack,
      profileId: profile?.id,
      profileEmail: profile?.emails?.[0]?.value,
      frontendURL: process.env.CLIENT_URL
    });
    return done(error, null);
  }
}));

// ✅ Serialize/Deserialize for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;