import multer from 'multer';
import path from 'path';
import fs from 'fs';
import logger from '../config/logger.js';

// ✅ FIXED: Production-compatible storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // ✅ Use /tmp for serverless environments (Vercel/Lambda)
    const uploadPath = process.env.NODE_ENV === 'production' 
      ? '/tmp/payments'  // Serverless temp directory
      : './uploads/payments';  // Local development

    try {
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    } catch (error) {
      logger.error('Failed to create upload directory:', error);
      // ✅ Fallback to memory storage if directory creation fails
      cb(null, '/tmp');
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `payment-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// ✅ ALTERNATIVE: Use memory storage for production
const memoryStorage = multer.memoryStorage();

// ✅ PRODUCTION-SAFE: Choose storage based on environment
const selectedStorage = process.env.NODE_ENV === 'production' ? memoryStorage : storage;

// ✅ Simple file filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file tidak diizinkan: ${file.mimetype}. Gunakan JPG, PNG, atau PDF`), false);
  }
};

// ✅ PRODUCTION-SAFE: Upload configuration
const upload = multer({
  storage: selectedStorage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    fieldSize: 2 * 1024 * 1024,  // 2MB for text fields
    fields: 20,                   // Max number of text fields
    files: 1                      // Max number of files
  }
});

// ✅ PRODUCTION-SAFE: uploadPaymentProof
export const uploadPaymentProof = (req, res, next) => {
  upload.single('transfer_proof')(req, res, (error) => {
    if (error) {
      logger.error('Payment proof upload error:', error);
      
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            status: 'error',
            message: 'File terlalu besar (maksimal 10MB)',
            error_code: 'FILE_TOO_LARGE'
          });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            status: 'error',
            message: 'Field file tidak sesuai. Gunakan field name "transfer_proof"',
            error_code: 'WRONG_FIELD_NAME'
          });
        }
      }
      
      return res.status(400).json({
        status: 'error',
        message: 'Error saat upload file',
        error: error.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File bukti transfer harus diupload',
        accepted_formats: ['image/jpeg', 'image/png', 'application/pdf']
      });
    }

    // ✅ PRODUCTION: Handle memory storage vs disk storage
    if (process.env.NODE_ENV === 'production') {
      // Memory storage - file is in req.file.buffer
      req.file.path = `memory-storage-${Date.now()}`;
      logger.info('File stored in memory for production');
    } else {
      // Disk storage - file is saved to disk
      logger.info('File stored to disk:', req.file.path);
    }

    next();
  });
};

export default upload;