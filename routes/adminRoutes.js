import express from 'express';
import { createCashier, getCashiers } from '../controllers/adminController.js';
import { 
  createField, 
  getAllFields, 
  getField, 
  updateField, 
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import { adminRouteLimit } from '../middleware/adminAuth.js';

const router = express.Router();

// Apply admin route limiting
router.use(adminRouteLimit);
router.use(authenticateToken, restrictTo('admin'));

// Cashier routes
router.post('/cashiers', createCashier);
router.get('/cashiers', getCashiers);

// Field routes
router.post('/fields', createField);
router.get('/fields', getAllFields);
router.get('/fields/:id', getField);
router.patch('/fields/:id', updateField);
router.delete('/fields/:id', deleteField);

export default router;