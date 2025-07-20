import multer from 'multer';
import path from 'path';
import fs from 'fs';
import logger from '../config/logger.js';

// ✅ REVERT: Simple storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = './uploads/payments';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `payment-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// ✅ REVERT: Simple file filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file tidak diizinkan: ${file.mimetype}. Gunakan JPG, PNG, atau PDF`), false);
  }
};

// ✅ REVERT: Simple upload configuration
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    fieldSize: 2 * 1024 * 1024,  // 2MB for text fields
    fields: 20,                   // Max number of text fields
    files: 1                      // Max number of files
  }
});

// ✅ REVERT: Simple uploadPaymentProof
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

    next();
  });
};

// ✅ Keep existing export
export default upload;