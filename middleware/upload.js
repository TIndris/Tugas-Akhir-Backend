import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';
import fs from 'fs';
import logger from '../config/logger.js';

// ✅ Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Check if Cloudinary is configured
const isCloudinaryConfigured = () => {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && 
           process.env.CLOUDINARY_API_KEY && 
           process.env.CLOUDINARY_API_SECRET);
};

// ✅ Cloudinary storage configuration
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'transfer-proofs',
    format: async (req, file) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        return ext.substring(1); // Remove the dot
      }
      return 'jpg'; // Default format
    },
    public_id: (req, file) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      return `transfer-proof-${timestamp}-${random}`;
    },
    resource_type: 'auto',
    transformation: [
      { 
        width: 1500, 
        height: 1500, 
        crop: 'limit', 
        quality: 'auto:good'
      }
    ]
  },
});

// ✅ FALLBACK: Disk storage (existing code)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.NODE_ENV === 'production' 
      ? '/tmp/payments'
      : './uploads/payments';

    try {
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    } catch (error) {
      logger.error('Failed to create upload directory:', error);
      cb(null, '/tmp');
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `payment-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// ✅ Memory storage (existing code)
const memoryStorage = multer.memoryStorage();

// ✅ SMART STORAGE SELECTION: Cloudinary first, then fallback
const getStorage = () => {
  if (isCloudinaryConfigured()) {
    console.log('☁️ Using Cloudinary storage');
    return cloudinaryStorage;
  } else {
    console.log('💾 Cloudinary not configured, using fallback storage');
    return process.env.NODE_ENV === 'production' ? memoryStorage : storage;
  }
};

// ✅ Keep existing file filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file tidak diizinkan: ${file.mimetype}. Gunakan JPG, PNG, atau PDF`), false);
  }
};

// ✅ UPDATED: Upload configuration with smart storage
const upload = multer({
  storage: getStorage(), // ✅ Use smart storage selection
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    fieldSize: 2 * 1024 * 1024,  // 2MB for text fields
    fields: 20,                   // Max number of text fields
    files: 1                      // Max number of files
  }
});

// ✅ ENHANCED: uploadPaymentProof with Cloudinary support
export const uploadPaymentProof = (req, res, next) => {
  console.log('🚀 Starting upload with storage type:', isCloudinaryConfigured() ? 'Cloudinary' : 'Fallback');
  
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

    // ✅ ENHANCED: Handle different storage types
    if (isCloudinaryConfigured() && req.file.path && req.file.path.includes('cloudinary')) {
      // Cloudinary upload successful
      console.log('✅ Cloudinary upload successful:', {
        filename: req.file.filename,
        size: req.file.size,
        cloudinary_url: req.file.path,
        public_id: req.file.public_id
      });
      logger.info('File uploaded to Cloudinary:', req.file.path);
    } else if (process.env.NODE_ENV === 'production') {
      // Memory storage fallback
      req.file.path = `memory-storage-${Date.now()}`;
      console.log('💾 File stored in memory (fallback)');
      logger.info('File stored in memory for production');
    } else {
      // Disk storage fallback
      console.log('💾 File stored to disk (fallback):', req.file.path);
      logger.info('File stored to disk:', req.file.path);
    }

    next();
  });
};

// ✅ Test Cloudinary connection
export const testCloudinaryConnection = async () => {
  if (!isCloudinaryConfigured()) {
    return { success: false, error: 'Cloudinary not configured' };
  }
  
  try {
    const result = await cloudinary.api.ping();
    console.log('☁️ Cloudinary connection test successful');
    return { success: true, result };
  } catch (error) {
    console.error('❌ Cloudinary connection test failed:', error.message);
    return { success: false, error: error.message };
  }
};

export default upload;