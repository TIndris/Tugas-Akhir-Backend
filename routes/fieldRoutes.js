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

// Middleware ini membatasi route di bawahnya hanya untuk admin
router.use(authenticateToken, restrictTo('admin'));

// Admin-only routes
router.post('/', upload.single('gambar'), createField);
router.patch('/:id', updateField);
router.delete('/:id', deleteField);

export default router;
