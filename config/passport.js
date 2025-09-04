import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import User from '../models/User.js';
import logger from './logger.js';
import dotenv from 'dotenv';

dotenv.config();

// ✅ FIX: Dynamic callback URL untuk production
const getCallbackURL = () => {
  // ✅ PRODUCTION: Gunakan BACKEND_URL dari environment
  if (process.env.NODE_ENV === 'production') {
    return `${process.env.BACKEND_URL}/auth/google/callback`;
  }
  // ✅ DEVELOPMENT: Gunakan localhost
  return 'http://localhost:5000/auth/google/callback';
};

// ✅ JWT Strategy (untuk existing system)
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.SESSION_SECRET // ✅ FIX: Use SESSION_SECRET untuk konsistensi
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

// ✅ Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: getCallbackURL(), // ✅ FIXED: Akan return production URL
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    logger.info('Google OAuth attempt', {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      callbackURL: getCallbackURL() // ✅ ADD: Log callback URL untuk debugging
    });

    // ✅ Cek user berdasarkan Google ID
    let existingUser = await User.findOne({ googleId: profile.id });
    
    if (existingUser) {
      // Update last login dan authProvider
      existingUser.lastLogin = new Date();
      existingUser.authProvider = 'google'; // ✅ Ensure authProvider set
      await existingUser.save();
      
      logger.info('Existing Google user logged in', {
        userId: existingUser._id,
        email: existingUser.email
      });
      
      return done(null, existingUser);
    }

    // ✅ Cek user berdasarkan email (untuk link existing account)
    const emailUser = await User.findOne({ 
      email: profile.emails[0].value 
    });

    if (emailUser) {
      // ✅ Link existing account dengan Google
      emailUser.googleId = profile.id;
      emailUser.picture = profile.photos?.[0]?.value;
      emailUser.isEmailVerified = true;
      emailUser.authProvider = 'google';
      emailUser.lastLogin = new Date();
      await emailUser.save();

      logger.info('Existing account linked with Google', {
        userId: emailUser._id,
        email: emailUser.email
      });

      return done(null, emailUser);
    }

    // ✅ Buat user baru dari Google
    const newUser = await User.create({
      googleId: profile.id,
      name: profile.displayName,
      email: profile.emails[0].value,
      picture: profile.photos?.[0]?.value,
      isEmailVerified: true,
      authProvider: 'google',
      role: 'customer', // Default role sesuai schema
      lastLogin: new Date()
      // ✅ REMOVE: tokenVersion (tidak ada di schema existing)
    });

    logger.info('New user created via Google OAuth', {
      userId: newUser._id,
      email: newUser.email,
      name: newUser.name
    });

    return done(null, newUser);

  } catch (error) {
    logger.error('Google OAuth Strategy error:', error);
    return done(error, null);
  }
}));

// ✅ Serialize/Deserialize
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;