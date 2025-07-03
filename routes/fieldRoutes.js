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
import parseFormData from '../middleware/formParser.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin middleware - apply to all routes below
router.use(authenticateToken, restrictTo('admin'));

// CREATE field (form-data dengan file REQUIRED)
router.post('/', 
  parseFormData, // ← Use manual parser instead of multer
  createField
);

// UPDATE routes
// 1. JSON update tanpa file
router.patch('/:id/json', updateFieldJSON);

// 2. Form-data update dengan file optional
router.patch('/:id', 
  parseFormData, // ← Use manual parser instead of multer
  updateField
);

// DELETE field
router.delete('/:id', deleteField);

export default router;
