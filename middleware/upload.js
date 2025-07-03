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
    fieldSize: 2 * 1024 * 1024, // 2MB for text fields
    fields: 10 // Allow up to 10 text fields
  }
});

// Debug middleware untuk troubleshooting
const debugMulter = (req, res, next) => {
  console.log('=== BEFORE MULTER ===');
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('Content-Length:', req.get('Content-Length'));
  console.log('Headers:', req.headers);
  
  // Log after multer processes
  const originalNext = next;
  next = () => {
    console.log('=== AFTER MULTER ===');
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    console.log('Body keys:', Object.keys(req.body || {}));
    originalNext();
  };
  
  next();
};

export default upload;
export { debugMulter };