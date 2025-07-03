import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  updateFieldJSON, // ← TAMBAH IMPORT INI
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import upload, { debugMulter } from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes dengan proper middleware order
// 1. JSON update tanpa file (lebih reliable)
router.patch('/:id/json', 
  authenticateToken, 
  restrictTo('admin'),
  updateFieldJSON // ← TAMBAH ROUTE INI
);

// 2. Form-data update dengan file
router.patch('/:id', 
  authenticateToken, 
  restrictTo('admin'),
  debugMulter,
  upload.single('gambar'), 
  updateField
);

router.post('/', 
  authenticateToken, 
  restrictTo('admin'),
  debugMulter,
  upload.single('gambar'),
  createField
);

router.delete('/:id', 
  authenticateToken, 
  restrictTo('admin'), 
  deleteField
);

export default router;
