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

router.get('/', getAllFields);
router.get('/:id', getField);

router.use(authenticateToken, restrictTo('admin'));

router.post('/', parseFormData, createField);
router.patch('/:id/json', updateFieldJSON);
router.patch('/:id', parseFormData, updateField);
router.delete('/:id', deleteField);

export default router;
