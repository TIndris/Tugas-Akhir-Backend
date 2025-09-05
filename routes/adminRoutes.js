import express from 'express';
import { 
  createCashier, 
  getCashiers, 
  createBankAccount, 
  getAllBankAccounts, 
  updateBankAccount, 
  deleteBankAccount, 
  setPrimaryBankAccount 
} from '../controllers/adminController.js';
import { 
  createField, 
  getAllFields, 
  getField, 
  updateField, 
  deleteField 
} from '../controllers/fieldController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import { adminRouteLimit } from '../middleware/adminAuth.js';
import upload from '../middleware/upload.js'; 

const router = express.Router();

// Apply admin route limiting
router.use(adminRouteLimit);
router.use(authenticateToken, restrictTo('admin'));

// Cashier routes
router.post('/cashiers', createCashier);
router.get('/cashiers', getCashiers);

// Field routes dengan upload middleware
router.post('/fields', upload.single('gambar'), createField);
router.get('/fields', getAllFields);
router.get('/fields/:id', getField);
router.patch('/fields/:id', upload.single('gambar'), updateField); 
router.delete('/fields/:id', deleteField);

// Bank Account Management routes
router.post('/bank-accounts', createBankAccount);
router.get('/bank-accounts', getAllBankAccounts);
router.patch('/bank-accounts/:id', updateBankAccount);
router.delete('/bank-accounts/:id', deleteBankAccount);
router.patch('/bank-accounts/:id/set-primary', setPrimaryBankAccount);

export default router;