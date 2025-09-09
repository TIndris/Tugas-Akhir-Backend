import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import moment from 'moment-timezone';
import session from 'express-session';
import MongoStore from 'connect-mongo';  // ADD: Missing import for session store
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

// ✅ ENHANCED: Rate limiting dengan skip untuk production (existing logic)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip for localhost origins and production environment
    const origin = req.get('Origin');
    const isLocalhost = origin && origin.includes('localhost');
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction || isLocalhost;
  }
});
app.use(limiter);

// ✅ ENHANCED: Security middleware with better cross-origin support
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'", "https:", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http://localhost:*"],
      frameSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  }
}));
app.use(mongoSanitize());

// ✅ ENHANCED: CORS (keeping existing logic but adding debug)
const getAllowedOrigins = () => {
  const origins = [
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL,
    process.env.BACKEND_URL
  ].filter(Boolean);

  console.log('🌐 Allowed CORS origins:', origins);
  return origins;
};

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ Request with no origin allowed');
      return callback(null, true);
    }

    const allowedOrigins = getAllowedOrigins();
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin) || origin.includes('localhost')) {
      console.log('✅ CORS allowed for origin:', origin);
      callback(null, true);
    } else {
      // Log for debugging but still allow (for flexibility)
      console.log('⚠️ CORS origin not in whitelist (but allowing):', origin);
      callback(null, true); // Allow all for now
    }
  },
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
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie']
}));

app.options('*', cors());

// ✅ ENHANCED: Session configuration with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600, // lazy session update
    ttl: 24 * 60 * 60 // 24 hours
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  name: 'dsc.session'
}));

// ✅ EXISTING: Passport middleware
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

// ✅ ADD: CORS debug middleware
app.use((req, res, next) => {
  const origin = req.get('Origin');
  console.log(`${req.method} ${req.path} - Origin: ${origin || 'No Origin'}`);
  
  // Add CORS headers manually as backup
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  next();
});

// ✅ EXISTING: Logging middleware
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

// ✅ ENHANCED: Health check dengan Google OAuth info (keeping existing structure)
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
        'POST /auth/set-password - Set password for Google users',
        'POST /auth/refresh-token - Refresh JWT token',
        'POST /auth/forgot-password - Password reset request',
        'POST /auth/reset-password - Password reset confirmation'
      ],
      google_oauth: {
        enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        callback_url: `${process.env.BACKEND_URL || 'https://dsc-backend-ashy.vercel.app'}/auth/google/callback`,
        frontend_callback: `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard`,
        test_endpoint: '/auth/google/test'
      },
      features: [
        '✅ Public API - Accessible from any origin',
        '✅ Google OAuth integration',
        '✅ JWT authentication for all users',
        '✅ Multi-role support (customer/kasir/admin)',
        '✅ Redis caching & session management',
        '✅ Form Data Support - File uploads enabled',
        '✅ Cross-origin cookie support',
        '✅ Comprehensive error handling'
      ]
    },
    cors: {
      allowed_origins: getAllowedOrigins(),
      client_url: process.env.CLIENT_URL,
      backend_url: process.env.BACKEND_URL
    }
  });
});

// ✅ EXISTING: Handle favicon requests silently
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ✅ EXISTING: API Routes (tetap sama)
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/bookings', bookingRoutes);
app.use('/fields', fieldRoutes);
app.use('/payments', paymentRoutes); 
app.use('/analytics', analyticsRoutes);  

// ✅ EXISTING: 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    origin: req.get('Origin')
  });
});

// ✅ ENHANCED: Global error handler
app.use((err, req, res, next) => {
  // Log error details
  logger.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    origin: req.get('Origin')
  });

  if (process.env.NODE_ENV !== 'production') {
    logger.error(err.stack);
  }

  // Handle CORS errors specifically
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      status: 'error',
      message: 'CORS policy violation',
      origin: req.get('Origin'),
      allowed_origins: getAllowedOrigins()
    });
  }
  
  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      origin: req.get('Origin')
    })
  });
});

// ✅ EXISTING: Database initialization
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

    // Log startup info
    console.log('🚀 DSC Backend Started Successfully!');
    console.log('📊 Environment:', process.env.NODE_ENV);
    console.log('🌐 Backend URL:', process.env.BACKEND_URL);
    console.log('💻 Client URL:', process.env.CLIENT_URL);
    console.log('🔑 Google OAuth:', !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET));
    console.log('🍪 CORS Origins:', getAllowedOrigins());
    
  } catch (error) {
    logger.error('App initialization failed:', error);
    process.exit(1);
  }
};

initializeApp();

export default app;