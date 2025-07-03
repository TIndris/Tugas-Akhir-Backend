import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

// Create cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'lapangan',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }]
  }
});

// Configure multer with better error handling
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    fieldSize: 1024 * 1024, // 1MB per field
    fields: 20, // Allow more fields
    parts: 25 // Allow more parts
  },
  fileFilter: (req, file, cb) => {
    if (!file) {
      return cb(null, false);
    }
    
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('File harus berupa gambar'), false);
    }
  }
});

// Create middleware function that handles both file and fields
const parseFormData = (req, res, next) => {
  // Handle multer processing
  upload.single('gambar')(req, res, (err) => {
    if (err) {
      // Handle multer errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'error',
          message: 'File terlalu besar. Maksimal 5MB'
        });
      }
      
      if (err.message === 'File harus berupa gambar') {
        return res.status(400).json({
          status: 'error',
          message: 'File harus berupa gambar (jpg, png, jpeg, webp)'
        });
      }
      
      // For form-data without file, continue without error
      if (err.message.includes('Unexpected field')) {
        req.body = req.body || {};
        return next();
      }
      
      return res.status(400).json({
        status: 'error',
        message: 'Error memproses form data',
        error: err.message
      });
    }
    
    // Multer processed successfully
    next();
  });
};

export default parseFormData;