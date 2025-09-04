import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import moment from 'moment-timezone';
import multer from 'multer';
import session from 'express-session';
import passport from './config/passport.js';

// Import configurations
import connectDB from './config/db.js';
import { connectRedis } from './config/redis.js'; 
import logger from './config/logger.js';
import { initAdmin } from './config/initAdmin.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import fieldRoutes from './routes/fieldRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

dotenv.config();

const app = express();

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Rate limiting dengan skip untuk production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return process.env.NODE_ENV === 'production';
  }
});
app.use(limiter);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(mongoSanitize());

// ✅ EXISTING CORS (sudah cocok)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

app.options('*', cors());

// ✅ Session configuration untuk Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ✅ Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// ✅ EXISTING: Body parsing
app.use(express.json({ 
  limit: '50mb',
  strict: false 
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb',
  parameterLimit: 50000
}));

// ✅ EXISTING: Payment debugging middleware
app.use((req, res, next) => {
  if (req.path.includes('/payments') && req.method === 'POST') {
    console.log('🔍 Payment request debug:', {
      method: req.method,
      path: req.path,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      userAgent: req.headers['user-agent'],
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      timestamp: new Date().toISOString()
    });
  }
  next();
});

// ✅ EXISTING: Error handling
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    logger.error('Bad JSON syntax:', error);
    return res.status(400).json({
      status: 'error',
      message: 'Invalid JSON format',
      error_code: 'BAD_JSON'
    });
  }
  
  next(error);
});

// Logging middleware
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// ✅ UPDATE: Health check dengan Google OAuth info
app.get('/', (req, res) => {
  const now = moment().tz('Asia/Jakarta');
  
  res.json({ 
    status: 'success',
    message: 'Tugas Akhir Backend API is running!',
    version: '1.0.0',
    timestamp: {
      iso: new Date().toISOString(),
      wib: now.format('DD/MM/YYYY HH:mm:ss'),
      wib_readable: now.format('dddd, DD MMMM YYYY [pukul] HH:mm:ss [WIB]'),
      unix: now.unix()
    },
    server: {
      environment: process.env.NODE_ENV || 'development',
      uptime_seconds: Math.floor(process.uptime()),
      uptime_readable: moment.duration(process.uptime(), 'seconds').humanize(),
      node_version: process.version,
      timezone: 'Asia/Jakarta (WIB)'
    },
    api: {
      endpoints: [
        '/auth - Authentication routes (including Google OAuth)',
        '/admin - Admin management routes', 
        '/fields - Field management routes',
        '/bookings - Booking management routes',
        '/payments - Payment management routes (includes booking confirmation)'
      ],
      auth_methods: [
        'POST /auth/register - Regular registration',
        'POST /auth/login - Email/password login',
        'GET /auth/google - Google OAuth initiate',
        'GET /auth/google/callback - Google OAuth callback',
        'POST /auth/set-password - Set password for Google users'
      ],
      google_oauth: {
        enabled: true,
        callback_url: process.env.NODE_ENV === 'production' 
          ? `${process.env.BACKEND_URL}/auth/google/callback`
          : 'http://localhost:5000/auth/google/callback',
        frontend_callback: `${process.env.CLIENT_URL}/auth/callback`
      },
      features: [
        '✅ Public API - Accessible from any origin',
        '✅ Google OAuth integration',
        '✅ JWT authentication for all users',
        '✅ Multi-role support (customer/kasir/admin)',
        '✅ Redis caching & session management',
        '✅ Form Data Support - File uploads enabled'
      ]
    }
  });
});

// Handle favicon requests silently
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ✅ API Routes (tetap sama)
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/bookings', bookingRoutes);
app.use('/fields', fieldRoutes);
app.use('/payments', paymentRoutes); 
app.use('/analytics', analyticsRoutes);  

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.error(err.stack);
  }
  
  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Database initialization
const initializeApp = async () => {
  try {
    await connectDB();
    
    try {
      await connectRedis();
    } catch (redisError) {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis connection failed, continuing without cache');
      }
    }
    
    try {
      await initAdmin();
    } catch (adminError) {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Admin initialization warning:', adminError.message);
      }
    }
    
  } catch (error) {
    logger.error('App initialization failed:', error);
    process.exit(1);
  }
};

initializeApp();

export default app;