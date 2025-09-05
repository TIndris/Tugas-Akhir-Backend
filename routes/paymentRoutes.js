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
import { authenticateToken, requireCashierOrAdmin } from '../middleware/auth.js';
import { uploadPaymentProof } from '../middleware/upload.js'; 

const router = express.Router();

// Public route
router.get('/bank-info', getBankInfo);

// Protect all other routes
router.use(authenticateToken);

// Customer routes - FIXED: remove restrictTo, use role check in controller
router.post('/', uploadPaymentProof, createPayment);
router.get('/my-payments', getUserPayments);

// Kasir routes - FIXED: use requireCashierOrAdmin instead of restrictTo
router.get('/pending', requireCashierOrAdmin, getPendingPayments);
router.patch('/:paymentId/approve', requireCashierOrAdmin, approvePayment);
router.patch('/:paymentId/reject', requireCashierOrAdmin, rejectPayment);

// Shared routes
router.get('/:paymentId', getPaymentById);

export default router;