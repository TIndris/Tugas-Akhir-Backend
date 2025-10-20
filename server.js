import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import moment from 'moment-timezone';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from './config/passport.js';

import connectDB from './config/db.js';
import { connectRedis } from './config/redis.js'; 
import logger from './config/logger.js';
import { initAdmin } from './config/initAdmin.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import fieldRoutes from './routes/fieldRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// ✅ Get allowed origins from CLIENT_URL
const getAllowedOrigins = () => {
  const origins = [
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://127.0.0.1:3000',
    'https://tugasakhir-chi.vercel.app',
  ].filter(Boolean);

  return origins;
};

// ✅ Put CORS middleware at the very top
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowedOrigins = getAllowedOrigins();

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('vercel.app')) {
      return callback(null, true);
    }

    // Default: allow all for debugging
    callback(null, true);
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
    'Access-Control-Request-Headers',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie'],
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// ✅ Preflight must be handled first
app.options('*', cors());

// ✅ Helmet AFTER CORS (supaya header tidak di-overwrite)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  contentSecurityPolicy: false
}));

app.use(mongoSanitize());

// ✅ Rate limiter AFTER CORS (skip OPTIONS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV !== 'production'
});
app.use(limiter);

// ✅ Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600,
    ttl: 24 * 60 * 60
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  name: 'dsc.session'
}));

app.use(passport.initialize());
app.use(passport.session());

// ✅ Body parsing middleware
app.use(express.json({ limit: '50mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));

// ✅ Error handling for JSON parsing
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

// ✅ Request logging middleware (only in development)
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

// ✅ Root endpoint
app.get('/', (req, res) => {
  const now = moment().tz('Asia/Jakarta');
  res.json({ 
    message: 'DSC Backend API',
    status: 'active',
    timestamp: now.format('YYYY-MM-DD HH:mm:ss'),
    timezone: 'Asia/Jakarta',
    documentation: 'https://documenter.getpostman.com/view/33492358/2sB3QQHSbi',
    endpoints: {
      auth: '/auth',
      admin: '/admin', 
      bookings: '/bookings',
      fields: '/fields',
      payments: '/payments',
      analytics: '/analytics'
    }
  });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ✅ API Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/bookings', bookingRoutes);
app.use('/fields', fieldRoutes);
app.use('/payments', paymentRoutes); 
app.use('/analytics', analyticsRoutes);  

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// ✅ Global error handler with CORS headers
app.use((err, req, res, next) => {
  const origin = req.get('Origin');
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  logger.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ✅ Initialize app
const initializeApp = async () => {
  try {
    await connectDB();

    try {
      await connectRedis();
    } catch (redisError) {
      logger.warn('Redis connection failed, continuing without cache');
    }

    try {
      await initAdmin();
    } catch (adminError) {
      logger.warn('Admin initialization warning:', adminError.message);
    }

    logger.info('DSC Backend Started Successfully!', {
      environment: process.env.NODE_ENV,
      backend_url: process.env.BACKEND_URL,
      client_url: process.env.CLIENT_URL,
      google_oauth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      cors_origins: getAllowedOrigins()
    });
  } catch (error) {
    logger.error('App initialization failed:', error);
    process.exit(1);
  }
};

initializeApp();

export default app;
