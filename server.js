import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import moment from 'moment-timezone';
import multer from 'multer';  // ✅ ADD multer import

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
    // Skip rate limiting untuk Vercel production
    return process.env.NODE_ENV === 'production';
  }
});
app.use(limiter);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(mongoSanitize());

// ✅ UPDATED CORS - Public API (allow all origins)
app.use(cors({
  origin: true,  // Allow any origin/domain
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

// Handle preflight requests
app.options('*', cors());

// ✅ UPDATED Body parser - Support JSON, URL-encoded, and Form Data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ ADD Form Data Support with Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file limit
    fieldSize: 1024 * 1024,     // 1MB per field
    fields: 20,                 // Max 20 fields
    files: 5                    // Max 5 files per request
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'image/svg+xml'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

// ✅ ADD Form data middleware (auto-detect content type)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'];
  
  // Check if request has multipart/form-data
  if (contentType && contentType.includes('multipart/form-data')) {
    upload.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          status: 'error',
          message: `Form data error: ${err.message}`,
          code: 'FORM_DATA_ERROR'
        });
      }
      next();
    });
  } else {
    // Continue normally for JSON/URL-encoded requests
    next();
  }
});

// Logging middleware (simplified for production)
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

// Health check
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
        '/auth - Authentication routes',
        '/admin - Admin management routes', 
        '/fields - Field management routes',
        '/bookings - Booking management routes',
        '/payments - Payment management routes (includes booking confirmation)'
      ],
      kasir_workflow: [
        'GET /payments/pending - View pending payments',
        'PATCH /payments/:id/approve - Approve payment & auto-confirm booking',
        'PATCH /payments/:id/reject - Reject payment & reset booking'
      ],
      features: [
        '✅ Public API - Accessible from any origin',
        '✅ Form Data Support - File uploads enabled',
        '✅ JSON & URL-encoded support',
        '✅ Multi-role authentication',
        '✅ Rate limiting & security middleware'
      ]
    }
  });
});

// Handle favicon requests silently
app.get('/favicon.ico', (req, res) => res.status(204).end());

// API Routes
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
  // Silent error logging untuk production
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
    // Connect to MongoDB
    await connectDB();
    
    // Connect to Redis (optional, silent fail)
    try {
      await connectRedis();
    } catch (redisError) {
      // Silent Redis failure
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Redis connection failed, continuing without cache');
      }
    }
    
    // Initialize admin user (silent fail)
    try {
      await initAdmin();
    } catch (adminError) {
      // Silent admin init failure
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Admin initialization warning:', adminError.message);
      }
    }
    
  } catch (error) {
    logger.error('App initialization failed:', error);
    process.exit(1);
  }
};

// Initialize app
initializeApp();

// Export for Vercel
export default app;