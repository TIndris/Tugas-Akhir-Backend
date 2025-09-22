// import express from 'express';
// import dotenv from 'dotenv';
// import cors from 'cors';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize';
// import moment from 'moment-timezone';
// import session from 'express-session';
// import MongoStore from 'connect-mongo';
// import passport from './config/passport.js';

// import connectDB from './config/db.js';
// import { connectRedis } from './config/redis.js'; 
// import logger from './config/logger.js';
// import { initAdmin } from './config/initAdmin.js';

// import authRoutes from './routes/authRoutes.js';
// import adminRoutes from './routes/adminRoutes.js';
// import bookingRoutes from './routes/bookingRoutes.js';
// import fieldRoutes from './routes/fieldRoutes.js';
// import paymentRoutes from './routes/paymentRoutes.js';
// import analyticsRoutes from './routes/analyticsRoutes.js';

// dotenv.config();

// const app = express();

// app.set('trust proxy', 1);

// // ✅ Rate limiter - relaxed for CORS debugging
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 1000, // ✅ Increased for debugging
//   message: 'Too many requests from this IP',
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip: (req) => {
//     if (req.method === 'OPTIONS') return true;
//     const origin = req.get('Origin');
//     const isLocalhost = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
//     return isLocalhost || process.env.NODE_ENV !== 'production';
//   }
// });
// app.use(limiter);

// // ✅ Helmet - relaxed for CORS
// app.use(helmet({
//   crossOriginResourcePolicy: { policy: "cross-origin" },
//   crossOriginEmbedderPolicy: false,
//   crossOriginOpenerPolicy: { policy: "unsafe-none" }, // ✅ Changed for better CORS support
//   contentSecurityPolicy: false // ✅ Disabled for debugging
// }));

// app.use(mongoSanitize());

// // ✅ Get allowed origins from CLIENT_URL
// const getAllowedOrigins = () => {
//   const origins = [
//     process.env.CLIENT_URL,
//     'http://localhost:3000',
//     'http://localhost:3001', 
//     'http://127.0.0.1:3000'
//   ].filter(Boolean);

//   return origins;
// };

// // ✅ ENHANCED CORS Configuration
// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow no origin (mobile apps, Postman, etc.)
//     if (!origin) {
//       return callback(null, true);
//     }

//     const allowedOrigins = getAllowedOrigins();
    
//     // Check specific origins first
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
    
//     // Allow development domains
//     if (origin.includes('localhost') || 
//         origin.includes('127.0.0.1') ||
//         origin.includes('vercel.app')) {
//       return callback(null, true);
//     }
    
//     // Allow all for debugging CORS issues
//     callback(null, true);
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   allowedHeaders: [
//     'Content-Type', 
//     'Authorization', 
//     'X-Requested-With',
//     'Accept',
//     'Origin',
//     'Access-Control-Request-Method',
//     'Access-Control-Request-Headers',
//     'Cache-Control',
//     'Pragma'
//   ],
//   exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie'],
//   optionsSuccessStatus: 200,
//   preflightContinue: false
// }));

// // ✅ Handle preflight OPTIONS requests
// app.options('*', cors());

// // ✅ Manual CORS headers as backup
// app.use((req, res, next) => {
//   const origin = req.get('Origin');
  
//   if (origin) {
//     res.header('Access-Control-Allow-Origin', origin);
//     res.header('Access-Control-Allow-Credentials', 'true');
//     res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
//     res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control,Pragma');
//   }
  
//   if (req.method === 'OPTIONS') {
//     return res.status(200).end();
//   }
  
//   next();
// });

// // ✅ Session configuration
// app.use(session({
//   secret: process.env.SESSION_SECRET || 'your-session-secret',
//   resave: false,
//   saveUninitialized: false,
//   store: MongoStore.create({
//     mongoUrl: process.env.MONGODB_URI,
//     touchAfter: 24 * 3600,
//     ttl: 24 * 60 * 60
//   }),
//   cookie: {
//     secure: process.env.NODE_ENV === 'production',
//     httpOnly: true,
//     maxAge: 24 * 60 * 60 * 1000,
//     sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
//   },
//   name: 'dsc.session'
// }));

// app.use(passport.initialize());
// app.use(passport.session());

// // ✅ Body parsing middleware
// app.use(express.json({ 
//   limit: '50mb',
//   strict: false 
// }));

// app.use(express.urlencoded({ 
//   extended: true, 
//   limit: '50mb',
//   parameterLimit: 50000
// }));

// // ✅ Error handling for JSON parsing
// app.use((error, req, res, next) => {
//   if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
//     logger.error('Bad JSON syntax:', error);
//     return res.status(400).json({
//       status: 'error',
//       message: 'Invalid JSON format',
//       error_code: 'BAD_JSON'
//     });
//   }
  
//   next(error);
// });

// // ✅ Request logging middleware (only in development)
// if (process.env.NODE_ENV !== 'production') {
//   app.use((req, res, next) => {
//     const start = Date.now();
//     res.on('finish', () => {
//       const duration = Date.now() - start;
//       logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
//     });
//     next();
//   });
// }

// // ✅ Root endpoint
// app.get('/', (req, res) => {
//   const now = moment().tz('Asia/Jakarta');
  
//   res.json({ 
//     status: 'success',
//     message: 'Tugas Akhir Backend API is running!',
//     version: '1.0.0',
//     timestamp: {
//       iso: new Date().toISOString(),
//       wib: now.format('DD/MM/YYYY HH:mm:ss'),
//       wib_readable: now.format('dddd, DD MMMM YYYY [pukul] HH:mm:ss [WIB]'),
//       unix: now.unix()
//     },
//     server: {
//       environment: process.env.NODE_ENV || 'development',
//       uptime_seconds: Math.floor(process.uptime()),
//       uptime_readable: moment.duration(process.uptime(), 'seconds').humanize(),
//       node_version: process.version,
//       timezone: 'Asia/Jakarta (WIB)'
//     },
//     api: {
//       endpoints: [
//         '/auth - Authentication routes (including Google OAuth)',
//         '/admin - Admin management routes', 
//         '/fields - Field management routes',
//         '/bookings - Booking management routes',
//         '/payments - Payment management routes'
//       ],
//       auth_methods: [
//         'POST /auth/register - Regular registration',
//         'POST /auth/login - Email/password login',
//         'GET /auth/google - Google OAuth initiate',
//         'GET /auth/google/callback - Google OAuth callback',
//         'POST /auth/set-password - Set password for Google users',
//         'POST /auth/refresh-token - Refresh JWT token',
//         'POST /auth/forgot-password - Password reset request',
//         'POST /auth/reset-password - Password reset confirmation'
//       ],
//       google_oauth: {
//         enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
//         callback_url: `${process.env.BACKEND_URL}/auth/google/callback`,
//         frontend_callback: `${process.env.CLIENT_URL}/dashboard`,
//         test_endpoint: '/auth/google/test'
//       },
//       features: [
//         'Public API - Accessible from any origin',
//         'Google OAuth integration',
//         'JWT authentication for all users',
//         'Multi-role support (customer/kasir/admin)',
//         'Redis caching & session management',
//         'Cross-origin cookie support',
//         'Comprehensive error handling'
//       ]
//     },
//     cors: {
//       allowed_origins: getAllowedOrigins(),
//       client_url: process.env.CLIENT_URL,
//       backend_url: process.env.BACKEND_URL,
//       mongo_store: 'Connected'
//     }
//   });
// });

// app.get('/favicon.ico', (req, res) => res.status(204).end());

// // ✅ API Routes
// app.use('/auth', authRoutes);
// app.use('/admin', adminRoutes);
// app.use('/bookings', bookingRoutes);
// app.use('/fields', fieldRoutes);
// app.use('/payments', paymentRoutes); 
// app.use('/analytics', analyticsRoutes);  

// // ✅ 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     status: 'error',
//     message: 'API endpoint not found',
//     path: req.originalUrl,
//     method: req.method
//   });
// });

// // ✅ Global error handler with CORS
// app.use((err, req, res, next) => {
//   // Set CORS headers for error responses
//   const origin = req.get('Origin');
//   if (origin) {
//     res.header('Access-Control-Allow-Origin', origin);
//     res.header('Access-Control-Allow-Credentials', 'true');
//   }
  
//   logger.error('Global error handler:', {
//     error: err.message,
//     stack: err.stack,
//     url: req.url,
//     method: req.method
//   });

//   if (err.message === 'Not allowed by CORS') {
//     return res.status(403).json({
//       status: 'error',
//       message: 'CORS policy violation',
//       origin: req.get('Origin'),
//       allowed_origins: getAllowedOrigins()
//     });
//   }
  
//   const errorResponse = {
//     status: 'error',
//     message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
//   };

//   if (process.env.NODE_ENV === 'development') {
//     errorResponse.stack = err.stack;
//   }
  
//   res.status(err.status || 500).json(errorResponse);
// });

// // ✅ Initialize app
// const initializeApp = async () => {
//   try {
//     await connectDB();
    
//     try {
//       await connectRedis();
//     } catch (redisError) {
//       logger.warn('Redis connection failed, continuing without cache');
//     }
    
//     try {
//       await initAdmin();
//     } catch (adminError) {
//       logger.warn('Admin initialization warning:', adminError.message);
//     }

//     // ✅ Minimal logging for production
//     logger.info('DSC Backend Started Successfully!', {
//       environment: process.env.NODE_ENV,
//       backend_url: process.env.BACKEND_URL,
//       client_url: process.env.CLIENT_URL,
//       google_oauth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
//       cors_origins: getAllowedOrigins()
//     });
    
//   } catch (error) {
//     logger.error('App initialization failed:', error);
//     process.exit(1);
//   }
// };

// initializeApp();

// export default app;

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
    'http://127.0.0.1:3000'
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
    cors: {
      allowed_origins: getAllowedOrigins(),
      client_url: process.env.CLIENT_URL,
      backend_url: process.env.BACKEND_URL
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
