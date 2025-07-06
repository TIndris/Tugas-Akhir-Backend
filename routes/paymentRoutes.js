import express from 'express';
import {
  createPayment,
  approvePayment,
  rejectPayment,
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

// Kasir routes
router.get('/pending', restrictTo('cashier', 'admin'), getPendingPayments);
router.patch('/:paymentId/approve', restrictTo('cashier', 'admin'), approvePayment);
router.patch('/:paymentId/reject', restrictTo('cashier', 'admin'), rejectPayment);

// Shared routes
router.get('/:paymentId', getPaymentById);

export default router;