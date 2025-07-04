import express from 'express';
import {
  createPayment,
  verifyPayment,
  getPendingPayments,
  getUserPayments,
  getPaymentById,
  getBankInfo
} from '../controllers/paymentController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// Public route - get bank info
router.get('/bank-info', getBankInfo);

// Protect all other routes
router.use(authenticateToken);

// Customer routes
router.post('/', upload.single('transfer_proof'), restrictTo('customer'), createPayment);
router.get('/my-payments', restrictTo('customer'), getUserPayments);

// Admin/Cashier routes
router.get('/pending', restrictTo('admin', 'cashier'), getPendingPayments);
router.patch('/:paymentId/verify', restrictTo('admin', 'cashier'), verifyPayment);

// Shared routes (with authorization check inside controller)
router.get('/:paymentId', getPaymentById);

export default router;