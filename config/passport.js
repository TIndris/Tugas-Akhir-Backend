import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import User from '../models/User.js';
import logger from './logger.js';
import dotenv from 'dotenv';

dotenv.config();

// FIXED: Always use production backend URL for callback
const getCallbackURL = () => {
  return `${process.env.BACKEND_URL || 'https://dsc-backend-ashy.vercel.app'}/auth/google/callback`;
};

// FIXED: Get frontend URL from CLIENT_URL
const getFrontendURL = () => {
  return process.env.CLIENT_URL || 'http://localhost:3000';
};

// FIXED: Use JWT_SECRET instead of SESSION_SECRET for JWT
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET // FIXED: Changed from SESSION_SECRET to JWT_SECRET
}, async (payload, done) => {
  try {
    const user = await User.findById(payload.id);
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    logger.error('JWT Strategy error:', error);
    return done(error, false);
  }
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: getCallbackURL(),
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('=== GOOGLE OAUTH DEBUG ===');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Backend URL:', process.env.BACKEND_URL);
    console.log('Client URL:', process.env.CLIENT_URL);
    console.log('Callback URL:', getCallbackURL());
    console.log('Frontend URL:', getFrontendURL());
    console.log('Profile ID:', profile.id);
    console.log('Profile Email:', profile.emails?.[0]?.value);

    logger.info('Google OAuth attempt', {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      callbackURL: getCallbackURL(),
      frontendURL: getFrontendURL(),
      environment: process.env.NODE_ENV
    });

    // Extract email safely
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    
    if (!email) {
      logger.error('No email found in Google profile', { profileId: profile.id });
      return done(new Error('Email tidak ditemukan di profil Google'), null);
    }

    // Check if user already exists with Google ID
    let existingUser = await User.findOne({ googleId: profile.id });
    
    if (existingUser) {
      // Update existing Google user
      existingUser.lastLogin = new Date();
      existingUser.authProvider = 'google';
      existingUser.isEmailVerified = true;
      
      // Update profile picture if available
      if (profile.photos && profile.photos[0] && profile.photos[0].value) {
        existingUser.picture = profile.photos[0].value;
      }
      
      await existingUser.save();
      
      logger.info('Existing Google user logged in', {
        userId: existingUser._id,
        email: existingUser.email,
        name: existingUser.name
      });
      
      return done(null, existingUser);
    }

    // Check if user exists with same email (link accounts)
    const emailUser = await User.findOne({ email: email });

    if (emailUser) {
      // Link existing email account with Google
      emailUser.googleId = profile.id;
      emailUser.picture = profile.photos?.[0]?.value || emailUser.picture;
      emailUser.isEmailVerified = true;
      emailUser.authProvider = 'google';
      emailUser.lastLogin = new Date();
      
      await emailUser.save();

      logger.info('Existing email account linked with Google', {
        userId: emailUser._id,
        email: emailUser.email,
        name: emailUser.name
      });

      return done(null, emailUser);
    }

    // Create new user with Google account
    const newUserData = {
      googleId: profile.id,
      name: profile.displayName || 'Google User',
      email: email,
      picture: profile.photos?.[0]?.value || null,
      isEmailVerified: true,
      authProvider: 'google',
      role: 'customer',
      lastLogin: new Date()
    };

    const newUser = await User.create(newUserData);

    logger.info('New user created via Google OAuth', {
      userId: newUser._id,
      email: newUser.email,
      name: newUser.name,
      frontendURL: getFrontendURL()
    });

    return done(null, newUser);

  } catch (error) {
    logger.error('Google OAuth Strategy error:', {
      error: error.message,
      stack: error.stack,
      profileId: profile?.id,
      profileEmail: profile?.emails?.[0]?.value,
      frontendURL: getFrontendURL()
    });
    
    return done(error, null);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  console.log('Serializing user:', user._id);
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    console.log('Deserializing user:', id);
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    logger.error('Deserialize user error:', error);
    done(error, null);
  }
});

export default passport;