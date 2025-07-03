import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();

// CRITICAL: Set trust proxy untuk Vercel
app.set('trust proxy', 1);

// Rate limiting dengan konfigurasi yang benar untuk production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Terlalu banyak request dari IP ini',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip trust proxy validation
  skip: (req) => {
    // Skip rate limiting untuk development
    return process.env.NODE_ENV === 'development';
  }
});

// Apply rate limiting
app.use(limiter);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.vercel.app'] 
    : '*',
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Skip express body parsing untuk multipart
app.use((req, res, next) => {
  if (req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }
  next();
});

// Import routes dan middleware lainnya
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import fieldRoutes from './routes/fieldRoutes.js';

// Routes
app.use('/auth', authRoutes);
app.use('/admin/fields', fieldRoutes);
app.use('/admin/bookings', bookingRoutes);

// Error handlers
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received. Closing HTTP server');
  app.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;