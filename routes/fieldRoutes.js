import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import upload, { debugMulter } from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes dengan proper middleware order
router.patch('/:id', 
  authenticateToken, 
  restrictTo('admin'),
  debugMulter, // ← Add debug middleware
  upload.single('gambar'), 
  updateField
);

router.post('/', 
  authenticateToken, 
  restrictTo('admin'),
  debugMulter, // ← Add debug middleware
  upload.single('gambar'),
  createField
);

router.delete('/:id', 
  authenticateToken, 
  restrictTo('admin'), 
  deleteField
);

export default router;
