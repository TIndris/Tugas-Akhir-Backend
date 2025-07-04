import { PaymentService } from '../services/paymentService.js';
import Payment from '../models/Payment.js';  // ← ADD THIS IMPORT
import Booking from '../models/Booking.js';  // ← ADD THIS IMPORT (if not exists)
import { client } from '../config/redis.js';
import logger from '../config/logger.js';

export const createPayment = async (req, res) => {
  try {
    const {
      booking_id,
      payment_type,
      sender_name,
      transfer_amount,
      transfer_date,
      transfer_reference
    } = req.body;

    // Validate required fields
    if (!booking_id || !payment_type || !sender_name || !transfer_amount || !transfer_date) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field wajib diisi',
        required_fields: ['booking_id', 'payment_type', 'sender_name', 'transfer_amount', 'transfer_date']
      });
    }

    // Validate file upload
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        status: 'error',
        message: 'Bukti transfer harus diupload',
        error: {
          code: 'TRANSFER_PROOF_REQUIRED',
          field: 'transfer_proof'
        }
      });
    }

    // Determine payment amount based on type
    let paymentAmount;
    if (payment_type === PaymentService.PAYMENT_TYPES.DP) {
      paymentAmount = PaymentService.DP_AMOUNT;
    } else if (payment_type === PaymentService.PAYMENT_TYPES.FULL) {
      paymentAmount = parseInt(transfer_amount);
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'Tipe pembayaran tidak valid',
        valid_types: ['full_payment', 'dp_payment']
      });
    }

    // Validate transfer amount matches payment type
    if (parseInt(transfer_amount) !== paymentAmount) {
      return res.status(400).json({
        status: 'error',
        message: payment_type === PaymentService.PAYMENT_TYPES.DP 
          ? `DP harus tepat Rp ${PaymentService.DP_AMOUNT.toLocaleString('id-ID')}`
          : 'Jumlah transfer harus sesuai dengan total booking'
      });
    }

    const paymentData = {
      bookingId: booking_id,
      userId: req.user._id,
      paymentType: payment_type,
      amount: paymentAmount,
      transferProof: req.file.path,
      transferDetails: {
        sender_name,
        transfer_amount: parseInt(transfer_amount),
        transfer_date: new Date(transfer_date),
        transfer_reference: transfer_reference || ''
      }
    };

    const payment = await PaymentService.createPayment(paymentData);

    // Clear relevant caches
    try {
      if (client && client.isOpen) {
        await client.del(`bookings:${req.user._id}`);
        await client.del('payments:pending');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    const paymentSummary = PaymentService.calculatePaymentSummary(
      payment.total_booking_amount, 
      payment.payment_type
    );

    res.status(201).json({
      status: 'success',
      message: `Pembayaran ${payment.payment_type_text} berhasil dibuat. Menunggu verifikasi.`,
      data: {
        payment,
        payment_summary: paymentSummary,
        bank_details: PaymentService.getBankDetails()
      }
    });

  } catch (error) {
    logger.error(`Payment creation error: ${error.message}`, {
      user: req.user?._id,
      action: 'CREATE_PAYMENT_ERROR'
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// ✅ APPROVE PAYMENT - Simple endpoint
export const approvePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { notes } = req.body; // Optional notes

    const payment = await PaymentService.approvePayment(
      paymentId,
      req.user._id,
      notes || 'Pembayaran disetujui oleh kasir'
    );

    // Clear cache
    try {
      if (client && client.isOpen) {
        await client.del('payments:pending');
        await client.del(`payments:user:${payment.user}`);
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      message: '✅ Pembayaran berhasil disetujui',
      data: { 
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.amount,
          payment_type: payment.payment_type_text,
          approved_at: payment.verifiedAtWIB,
          approved_by: req.user.name,
          notes: payment.notes
        }
      }
    });

  } catch (error) {
    logger.error(`Payment approval error: ${error.message}`, {
      kasir: req.user?._id,
      paymentId: req.params.paymentId
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// ❌ REJECT PAYMENT - Fixed version
export const rejectPayment = async (req, res) => {
  try {
    console.log('=== PAYMENT REJECTION DEBUG ===');
    console.log('Payment ID:', req.params.paymentId || req.params.id);
    console.log('Request body:', req.body);

    const paymentId = req.params.paymentId || req.params.id;
    const { reason, rejection_reason } = req.body;
    const finalReason = reason || rejection_reason;

    if (!finalReason || finalReason.trim().length < 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Alasan penolakan harus diisi minimal 5 karakter'
      });
    }

    // Use PaymentService if available, otherwise direct logic
    if (PaymentService && PaymentService.rejectPayment) {
      // ✅ Use Service (Recommended)
      const payment = await PaymentService.rejectPayment(
        paymentId,
        req.user._id,
        finalReason.trim()
      );

      // Clear cache
      try {
        if (client && client.isOpen) {
          await client.del('payments:pending');
          await client.del(`payments:user:${payment.user}`);
        }
      } catch (redisError) {
        logger.warn('Redis cache clear error:', redisError);
      }

      res.status(200).json({
        status: 'success',
        message: '❌ Pembayaran ditolak dan booking direset',
        data: {
          payment: {
            id: payment._id,
            status: 'Ditolak',
            rejection_reason: payment.rejection_reason,
            rejected_by: req.user.name,
            rejected_at: payment.verifiedAtWIB
          }
        }
      });

    } else {
      // ✅ Fallback Direct Logic (with proper imports)
      const payment = await Payment.findById(paymentId).populate('booking');
      
      if (!payment) {
        return res.status(404).json({
          status: 'error',
          message: 'Payment tidak ditemukan'
        });
      }

      if (payment.status !== 'pending') {
        return res.status(400).json({
          status: 'error',
          message: 'Payment sudah diproses sebelumnya',
          current_status: payment.status
        });
      }

      // Update payment
      payment.status = 'rejected';
      payment.verified_by = req.user._id;
      payment.verified_at = new Date();
      payment.rejection_reason = finalReason.trim();

      // Reset booking
      const booking = payment.booking;
      booking.status_pemesanan = 'pending';
      booking.payment_status = 'no_payment';
      booking.kasir = undefined;
      booking.konfirmasi_at = undefined;

      // Save both documents
      await payment.save();
      await booking.save();

      // Clear cache
      try {
        if (client && client.isOpen) {
          await client.del('payments:pending');
          await client.del(`payments:user:${payment.user}`);
        }
      } catch (redisError) {
        logger.warn('Redis cache clear error:', redisError);
      }

      res.status(200).json({
        status: 'success',
        message: '❌ Pembayaran ditolak dan booking direset',
        data: {
          payment: {
            id: payment._id,
            status: 'Ditolak',
            rejection_reason: payment.rejection_reason,
            rejected_by: req.user.name,
            rejected_at: payment.verifiedAtWIB
          }
        }
      });
    }

  } catch (error) {
    console.error('Payment rejection error:', error);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

export const getPendingPayments = async (req, res) => {
  try {
    const cacheKey = 'payments:pending';
    
    // Check cache first
    let cachedPayments = null;
    try {
      if (client && client.isOpen) {
        cachedPayments = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis cache read error:', redisError);
    }

    if (cachedPayments) {
      const payments = JSON.parse(cachedPayments);
      return res.json({
        status: 'success',
        results: payments.length,
        data: { payments }
      });
    }

    const payments = await PaymentService.getPendingPayments();

    // Cache for 2 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 120, JSON.stringify(payments));
      }
    } catch (redisError) {
      logger.warn('Redis cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      results: payments.length,
      data: { payments }
    });

  } catch (error) {
    logger.error(`Get pending payments error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data pembayaran pending'
    });
  }
};

export const getUserPayments = async (req, res) => {
  try {
    const userId = req.user._id;
    const cacheKey = `payments:user:${userId}`;
    
    // Check cache first
    let cachedPayments = null;
    try {
      if (client && client.isOpen) {
        cachedPayments = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis cache read error:', redisError);
    }

    if (cachedPayments) {
      const payments = JSON.parse(cachedPayments);
      return res.json({
        status: 'success',
        results: payments.length,
        data: { payments }
      });
    }

    const payments = await PaymentService.getUserPayments(userId);

    // Cache for 3 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 180, JSON.stringify(payments));
      }
    } catch (redisError) {
      logger.warn('Redis cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      results: payments.length,
      data: { payments }
    });

  } catch (error) {
    logger.error(`Get user payments error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data pembayaran'
    });
  }
};

export const getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await PaymentService.getPaymentById(paymentId);

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Pembayaran tidak ditemukan'
      });
    }

    // Check authorization - user can only see their own payments
    if (req.user.role === 'customer' && payment.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke pembayaran ini'
      });
    }

    const paymentSummary = PaymentService.calculatePaymentSummary(
      payment.total_booking_amount,
      payment.payment_type
    );

    res.status(200).json({
      status: 'success',
      data: {
        payment,
        payment_summary: paymentSummary,
        bank_details: PaymentService.getBankDetails()
      }
    });

  } catch (error) {
    logger.error(`Get payment by ID error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data pembayaran'
    });
  }
};

export const getBankInfo = async (req, res) => {
  try {
    const bankDetails = PaymentService.getBankDetails();
    
    res.status(200).json({
      status: 'success',
      message: 'Silakan transfer ke rekening berikut',
      data: {
        bank_details: bankDetails,
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
          'Transfer sesuai nominal yang dipilih',
          'Upload bukti transfer yang jelas',
          'Sertakan nama pengirim yang sesuai',
          'Pembayaran akan diverifikasi dalam 1x24 jam'
        ]
      }
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil informasi bank'
    });
  }
};