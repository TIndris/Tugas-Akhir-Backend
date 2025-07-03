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
import upload from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes
router.use(authenticateToken, restrictTo('admin'));

// Form-data routes dengan upload middleware
router.post('/', upload.single('gambar'), createField);
router.patch('/:id', upload.single('gambar'), updateField);

// JSON routes (backup)
router.patch('/:id/json', updateFieldJSON);
router.delete('/:id', deleteField);

export default router;
