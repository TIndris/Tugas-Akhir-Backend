import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import fieldRoutes from './routes/fieldRoutes.js';
import logger from './utils/logger.js';
import './config/passport.js';
import { initAdmin } from './config/initAdmin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB and initialize admin
const initialize = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Initialize admin account
    const adminInitialized = await initAdmin();
    if (!adminInitialized) {
      throw new Error('Failed to initialize admin account');
    }
    
    // Start server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Initialization failed:', err);
    process.exit(1);
  }
};

initialize();

// Security middleware
app.use(helmet()); // Add security headers
app.use(mongoSanitize()); // Prevent NoSQL injection

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// PASANG ROUTE UPLOAD SEBELUM express.json()
app.use('/admin/fields', fieldRoutes);

// Middleware lain yang tidak mengganggu multer
app.use(cors({
  origin: '*', // izinkan semua origin
  credentials: true
}));
app.use(cookieParser()); // <-- PASTIKAN INI SEBELUM ROUTE YANG BUTUH TOKEN

// Body parser SETELAH route upload
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) }}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'strict'
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/bookings', bookingRoutes);
app.use('/fields', fieldRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Global error handler
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