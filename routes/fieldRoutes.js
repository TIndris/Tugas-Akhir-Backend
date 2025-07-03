import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes dengan middleware yang benar
router.patch('/:id', 
  authenticateToken, 
  restrictTo('admin'), 
  upload.single('gambar'), // ← Pastikan ini ada
  updateField
);

router.post('/', 
  authenticateToken, 
  restrictTo('admin'), 
  upload.single('gambar'),
  createField
);

router.delete('/:id', 
  authenticateToken, 
  restrictTo('admin'), 
  deleteField
);

export default router;
