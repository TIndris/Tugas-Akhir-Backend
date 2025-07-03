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
// import parseFormData from '../middleware/formParser.js';

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes
router.use(authenticateToken, restrictTo('admin'));

// Temporary: disable form-data routes untuk fix deployment
// router.post('/', parseFormData, createField);
// router.patch('/:id', parseFormData, updateFieldHybrid);

// Only JSON routes untuk sementara
router.post('/', createField);
router.patch('/:id/json', updateFieldJSON);
router.patch('/:id', updateFieldJSON); // Redirect to JSON update
router.delete('/:id', deleteField);

export default router;
