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

// Middleware untuk admin only
router.use(authenticateToken, restrictTo('admin'));

// Admin routes dengan upload support
router.post('/', upload.single('gambar'), createField);           // ← Upload required
router.patch('/:id', upload.single('gambar'), updateField);       // ← Upload optional  
router.delete('/:id', deleteField);

export default router;
