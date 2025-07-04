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

// Public route
router.get('/bank-info', getBankInfo);

// Protect all other routes
router.use(authenticateToken);

// Customer routes
router.post('/', upload.single('transfer_proof'), restrictTo('customer'), createPayment);
router.get('/my-payments', restrictTo('customer'), getUserPayments);

// Kasir routes - HANYA VERIFY/REJECT
router.get('/pending', restrictTo('cashier', 'admin'), getPendingPayments);
router.patch('/:paymentId/verify', restrictTo('cashier', 'admin'), verifyPayment); // ← KASIR ACTION

// Shared routes
router.get('/:paymentId', getPaymentById);

export default router;