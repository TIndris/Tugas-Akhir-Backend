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
  upload.single('gambar'), 
  createField
);

// UPDATE routes
// 1. JSON update tanpa file
router.patch('/:id/json', updateFieldJSON);

// 2. Form-data update dengan file optional (SAMA SEPERTI CREATE)
router.patch('/:id', 
  debugMulter,
  upload.single('gambar'), 
  updateField
);

// DELETE field
router.delete('/:id', deleteField);

export default router;
