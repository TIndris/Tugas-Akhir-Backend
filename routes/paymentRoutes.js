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

// Kasir routes - Check parameter names
router.get('/pending', restrictTo('cashier', 'admin'), getPendingPayments);
router.patch('/:paymentId/approve', restrictTo('cashier', 'admin'), approvePayment);
router.patch('/:paymentId/reject', restrictTo('cashier', 'admin'), rejectPayment);  // ← paymentId

// OR if using different parameter name:
// router.patch('/:id/reject', restrictTo('cashier', 'admin'), rejectPayment);  // ← id

// Shared routes
router.get('/:paymentId', getPaymentById);

export default router;

// Update existing getBankInfo function in paymentController.js
export const getBankInfo = async (req, res) => {
  try {
    // Get all active bank accounts for customer choice
    const bankAccounts = await PaymentService.getAllActiveBanks();
    
    // Get primary bank details
    const primaryBank = await PaymentService.getBankDetails();

    res.status(200).json({
      status: 'success',
      message: 'Silakan transfer ke salah satu rekening berikut',
      data: {
        primary_bank: primaryBank,
        available_banks: bankAccounts,
        payment_options: [
          {
            type: 'dp_payment',
            name: 'Pembayaran DP',
            amount: PaymentService.DP_AMOUNT,
            description: `DP tetap Rp ${PaymentService.DP_AMOUNT.toLocaleString('id-ID')}`
          },
          {
            type: 'full_payment',
            name: 'Pembayaran Penuh',
            amount: 'Sesuai total booking',
            description: 'Bayar langsung sesuai total harga booking'
          }
        ],
        instructions: [
          'Pilih salah satu rekening bank yang tersedia',
          'Transfer sesuai nominal yang dipilih',
          'Upload bukti transfer yang jelas',
          'Sertakan nama pengirim yang sesuai',
          'Pembayaran akan diverifikasi dalam 1x24 jam'
        ]
      }
    });

  } catch (error) {
    logger.error('Get bank info error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil informasi bank'
    });
  }
};