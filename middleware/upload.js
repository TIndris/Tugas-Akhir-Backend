import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';
import path from 'path';
import fs from 'fs';
import logger from '../config/logger.js';

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'lapangan',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }]
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    fieldSize: 2 * 1024 * 1024, // 2MB for text fields
    fields: 10 // Allow up to 10 text fields
  },
  fileFilter: (req, file, cb) => {
    console.log('File received in multer:', file);
    if (file && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Debug middleware yang lebih detail
const debugMulter = (req, res, next) => {
  console.log('=== BEFORE MULTER ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('Content-Length:', req.get('Content-Length'));
  console.log('Raw body exists:', !!req.body);
  
  // Store original next
  const originalNext = next;
  
  // Override next to log after multer
  const wrappedNext = (error) => {
    console.log('=== AFTER MULTER ===');
    console.log('Multer Error:', error);
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    console.log('Body keys:', Object.keys(req.body || {}));
    console.log('Body type:', typeof req.body);
    
    if (error) {
      console.log('Multer processing failed:', error.message);
    }
    
    originalNext(error);
  };
  
  wrappedNext();
};

// ✅ ADD: Better error handling for payment uploads
export const uploadPaymentProof = (req, res, next) => {
  upload.single('transfer_proof')(req, res, (error) => {
    if (error) {
      logger.error('Payment proof upload error:', error);
      
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            status: 'error',
            message: 'Ukuran file terlalu besar (maksimal 10MB)',
            error_code: 'FILE_TOO_LARGE'
          });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            status: 'error',
            message: 'Field file tidak sesuai (gunakan "transfer_proof")',
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

    // ✅ Validate file existence
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File bukti transfer harus diupload',
        accepted_formats: ['image/jpeg', 'image/png', 'application/pdf']
      });
    }

    next();
  });
};

export default upload;
export { debugMulter };