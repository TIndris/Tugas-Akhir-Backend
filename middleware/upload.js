import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

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
    fieldSize: 2 * 1024 * 1024  // 2MB for text fields
  },
  fileFilter: (req, file, cb) => {
    console.log('File received in multer:', file);
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Debug middleware untuk cek multer parsing
const debugMulter = (req, res, next) => {
  console.log('=== MULTER DEBUG ===');
  console.log('Headers:', req.headers);
  console.log('Content-Type:', req.get('content-type'));
  console.log('Body before multer:', req.body);
  console.log('File before multer:', req.file);
  next();
};

export default upload;
export { debugMulter };