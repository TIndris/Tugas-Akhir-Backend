import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  updateFieldJSON,
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import upload, { debugMulter } from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin middleware - apply to all routes below
router.use(authenticateToken, restrictTo('admin'));

// CREATE field (form-data dengan file REQUIRED)
router.post('/', 
  debugMulter,
  (req, res, next) => {
    upload.single('gambar')(req, res, (err) => {
      if (err) {
        console.log('Multer error in POST:', err);
        return res.status(400).json({
          status: 'error',
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  },
  createField
);

// UPDATE routes
// 1. JSON update tanpa file
router.patch('/:id/json', updateFieldJSON);

// 2. Form-data update dengan file optional
router.patch('/:id', 
  debugMulter,
  (req, res, next) => {
    upload.single('gambar')(req, res, (err) => {
      if (err) {
        console.log('Multer error in PATCH:', err);
        return res.status(400).json({
          status: 'error',
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  },
  updateField
);

// DELETE field
router.delete('/:id', deleteField);

export default router;
