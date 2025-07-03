import express from 'express';
import { 
  getAllFields, 
  getField, 
  createField, 
  updateField, 
  updateFieldJSON,
  updateFieldHybrid,
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import parseFormData from '../middleware/formParser.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes
router.use(authenticateToken, restrictTo('admin'));

router.post('/', parseFormData, createField);

// Multiple update endpoints
router.patch('/:id/json', updateFieldJSON);           // JSON only
router.patch('/:id/form', parseFormData, updateField); // Form-data only  
router.patch('/:id', parseFormData, updateFieldHybrid); // Hybrid (both)

router.delete('/:id', deleteField);

export default router;
