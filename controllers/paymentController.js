import { PaymentService } from '../services/paymentService.js';
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

// Simplify verifyPayment untuk kasir
export const verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { action, notes } = req.body;

    // Simple validation - hanya verify atau reject
    if (!action || !['verify', 'reject'].includes(action)) {
      return res.status(400).json({
        status: 'error',
        message: 'Action harus "verify" atau "reject"',
        example: {
          verify: { action: "verify", notes: "Pembayaran valid" },
          reject: { action: "reject", notes: "Bukti transfer tidak jelas" }
        }
      });
    }

    const payment = await PaymentService.verifyPayment(
      paymentId,
      req.user._id,
      action,
      notes || ''
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
      message: action === 'verify' 
        ? '✅ Pembayaran disetujui' 
        : '❌ Pembayaran ditolak',
      data: { 
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.amount,
          payment_type: payment.payment_type_text,
          verified_at: payment.verifiedAtWIB,
          notes: payment.notes || payment.rejection_reason
        }
      }
    });

  } catch (error) {
    logger.error(`Payment verification error: ${error.message}`, {
      kasir: req.user?._id,
      paymentId: req.params.paymentId,
      action: req.body?.action
    });

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