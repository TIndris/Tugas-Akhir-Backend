import multer from 'multer';
import path from 'path';
import fs from 'fs';
import logger from '../config/logger.js';

// ✅ Enhanced storage configuration
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

// ✅ Enhanced file filter
const fileFilter = (req, file, cb) => {
  console.log('🔍 File filter check:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file tidak diizinkan: ${file.mimetype}. Gunakan JPG, PNG, atau PDF`), false);
  }
};

// ✅ Enhanced upload configuration with better error handling
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    fieldSize: 2 * 1024 * 1024,  // 2MB for text fields
    fields: 20,                   // Max number of text fields
    files: 1                      // Max number of files
  },
  // ✅ Add error handling for busboy
  onError: (error, next) => {
    logger.error('Multer onError:', error);
    next(error);
  }
});

// ✅ FIXED: Better error handling for payment uploads
export const uploadPaymentProof = (req, res, next) => {
  console.log('🚀 Upload started for:', req.headers['content-type']);
  console.log('📊 Content-Length:', req.headers['content-length']);
  
  // ✅ Add request timeout handling
  const timeout = setTimeout(() => {
    logger.error('Upload timeout after 30 seconds');
    if (!res.headersSent) {
      return res.status(408).json({
        status: 'error',
        message: 'Upload timeout. File terlalu besar atau koneksi lambat.',
        error_code: 'UPLOAD_TIMEOUT'
      });
    }
  }, 30000); // 30 second timeout

  upload.single('transfer_proof')(req, res, (error) => {
    clearTimeout(timeout); // Clear timeout on completion
    
    if (error) {
      console.error('💥 Upload error:', error);
      logger.error('Payment proof upload error:', error);
      
      // ✅ Enhanced error handling
      if (error instanceof multer.MulterError) {
        switch (error.code) {
          case 'LIMIT_FILE_SIZE':
            return res.status(413).json({
              status: 'error',
              message: 'File terlalu besar (maksimal 10MB)',
              error_code: 'FILE_TOO_LARGE',
              max_size: '10MB'
            });
          
          case 'LIMIT_UNEXPECTED_FILE':
            return res.status(400).json({
              status: 'error', 
              message: 'Field file tidak sesuai. Gunakan field name "transfer_proof"',
              error_code: 'WRONG_FIELD_NAME',
              expected_field: 'transfer_proof'
            });
            
          case 'LIMIT_FIELD_COUNT':
            return res.status(400).json({
              status: 'error',
              message: 'Terlalu banyak field dalam form',
              error_code: 'TOO_MANY_FIELDS'
            });
            
          default:
            logger.error('Multer error:', error);
            return res.status(400).json({
              status: 'error',
              message: `Upload error: ${error.message}`,
              error_code: error.code
            });
        }
      }
      
      // ✅ Handle "Unexpected end of form" specifically
      if (error.message.includes('Unexpected end of form')) {
        return res.status(400).json({
          status: 'error',
          message: 'Data form tidak lengkap. Pastikan semua field terisi dan file tidak corrupt.',
          error_code: 'INCOMPLETE_FORM_DATA',
          suggestions: [
            'Periksa koneksi internet',
            'Pastikan file tidak rusak/corrupt', 
            'Coba upload ulang dengan file yang berbeda',
            'Gunakan file dengan ukuran lebih kecil'
          ]
        });
      }
      
      // ✅ Handle other busboy/form parsing errors
      if (error.message.includes('Part terminated early') || 
          error.message.includes('Unexpected end') ||
          error.message.includes('Parse error')) {
        return res.status(400).json({
          status: 'error',
          message: 'Error parsing form data. File mungkin corrupt atau koneksi terputus.',
          error_code: 'FORM_PARSE_ERROR',
          original_error: error.message
        });
      }
      
      // ✅ Generic error handler
      return res.status(500).json({
        status: 'error',
        message: 'Error saat upload file',
        error: error.message,
        error_code: 'UPLOAD_ERROR'
      });
    }

    // ✅ Validate file existence with detailed info
    if (!req.file) {
      console.log('❌ No file received');
      console.log('📝 Request body fields:', Object.keys(req.body));
      
      return res.status(400).json({
        status: 'error',
        message: 'File bukti transfer harus diupload',
        error_code: 'NO_FILE_UPLOADED',
        accepted_formats: ['image/jpeg', 'image/png', 'application/pdf'],
        field_name: 'transfer_proof',
        debug_info: {
          received_fields: Object.keys(req.body),
          content_type: req.headers['content-type']
        }
      });
    }

    console.log('✅ File uploaded successfully:', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    next();
  });
};

// ✅ Keep existing export
export default upload;