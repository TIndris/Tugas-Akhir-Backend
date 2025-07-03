import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import moment from 'moment-timezone';

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

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://tugas-akhir-backend-ashy.vercel.app'] 
    : '*',
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
        '/bookings - Booking management routes'
      ]
    }
  });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/bookings', bookingRoutes);
app.use('/fields', fieldRoutes);

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