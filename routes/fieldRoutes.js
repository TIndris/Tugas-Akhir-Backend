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
import upload from '../middleware/upload.js'; // ← IMPORT UPLOAD MIDDLEWARE

const router = express.Router();

// Public routes
router.get('/', getAllFields);
router.get('/:id', getField);

// Admin routes
router.use(authenticateToken, restrictTo('admin'));

// Form-data routes dengan upload middleware
router.post('/', upload.single('gambar'), createField); // ← RE-ENABLE WITH UPLOAD
router.patch('/:id', upload.single('gambar'), updateField); // ← RE-ENABLE WITH UPLOAD

// JSON routes (backup)
router.patch('/:id/json', updateFieldJSON);
router.delete('/:id', deleteField);

export default router;
