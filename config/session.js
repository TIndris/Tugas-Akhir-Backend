import session from 'express-session';

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

// Untuk production, gunakan external store atau skip session
if (process.env.NODE_ENV === 'production') {
  // Skip session untuk serverless environment
  sessionConfig.cookie.secure = false; // Karena Vercel handles HTTPS
}

export default session(sessionConfig);