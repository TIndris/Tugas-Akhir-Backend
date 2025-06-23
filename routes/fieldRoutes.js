import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Protected routes - Only admin can manage fields
router.use(authenticateToken, restrictTo('admin'));
router.post('/', createField);
router.patch('/:id', updateField);
router.delete('/:id', deleteField);

export default router;
