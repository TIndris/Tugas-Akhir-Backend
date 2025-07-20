import { PaymentService } from '../services/paymentService.js';
import Payment from '../models/Payment.js'; 
import Booking from '../models/Booking.js'; // ✅ ADD: Missing import
import { client } from '../config/redis.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import moment from 'moment-timezone';

export const createPayment = async (req, res) => {
  try {
    console.log('=== PAYMENT CREATE DEBUG ===');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Content-Length:', req.headers['content-length']);
    console.log('Request body keys:', req.body ? Object.keys(req.body) : 'No body');
    console.log('Request file:', req.file ? {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    } : 'No file');
    console.log('User:', req.user?._id);

    // ✅ Validate request structure first
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Request body kosong. Pastikan menggunakan form-data dengan field yang benar.',
        error_code: 'EMPTY_REQUEST_BODY',
        required_fields: ['booking_id', 'payment_type', 'sender_name', 'transfer_amount', 'transfer_date']
      });
    }

    // ✅ Extract fields with better error handling
    const { 
      booking_id, 
      payment_type, 
      sender_name, 
      transfer_amount, 
      transfer_date,
      transfer_reference 
    } = req.body;

    console.log('Extracted fields:', {
      booking_id: booking_id || 'missing',
      payment_type: payment_type || 'missing', 
      sender_name: sender_name || 'missing',
      transfer_amount: transfer_amount || 'missing',
      transfer_date: transfer_date || 'missing'
    });

    // ✅ Enhanced validation with detailed error messages
    const validateTransferDate = (dateString) => {
      try {
        if (!dateString || typeof dateString !== 'string') {
          throw new Error('Tanggal transfer harus diisi');
        }

        // Parse YYYY-MM-DD format
        const [year, month, day] = dateString.split('-').map(num => parseInt(num));
        if (!year || !month || !day || year < 2020 || month < 1 || month > 12 || day < 1 || day > 31) {
          throw new Error('Format tanggal tidak valid (gunakan YYYY-MM-DD)');
        }

        const transferDate = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (isNaN(transferDate.getTime())) {
          throw new Error('Tanggal tidak valid');
        }
        
        if (transferDate > today) {
          throw new Error('Tanggal transfer tidak boleh di masa depan');
        }
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        
        if (transferDate < thirtyDaysAgo) {
          throw new Error('Tanggal transfer terlalu lama (maksimal 30 hari)');
        }
        
        return transferDate;
        
      } catch (error) {
        throw new Error(`Validasi tanggal transfer: ${error.message}`);
      }
    };

    // ✅ Validate required fields with better error messages
    if (!booking_id || !payment_type || !sender_name || !transfer_amount || !transfer_date) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field wajib diisi',
        missing_fields: {
          booking_id: !booking_id ? 'ID booking harus diisi' : null,
          payment_type: !payment_type ? 'Jenis pembayaran harus dipilih' : null,
          sender_name: !sender_name ? 'Nama pengirim harus diisi' : null,
          transfer_amount: !transfer_amount ? 'Jumlah transfer harus diisi' : null,
          transfer_date: !transfer_date ? 'Tanggal transfer harus diisi' : null
        },
        example: {
          booking_id: "ObjectId dari booking",
          payment_type: "dp_payment atau full_payment",
          sender_name: "John Doe",
          transfer_amount: "250000",
          transfer_date: "2025-07-20"
        }
      });
    }

    // ✅ Validate transfer date
    let transferDateValid;
    try {
      transferDateValid = validateTransferDate(transfer_date);
    } catch (dateError) {
      return res.status(400).json({
        status: 'error',
        message: dateError.message,
        example_format: '2025-07-20',
        received: transfer_date
      });
    }

    // ✅ Validate payment type
    const VALID_PAYMENT_TYPES = ['dp_payment', 'full_payment'];
    if (!VALID_PAYMENT_TYPES.includes(payment_type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Tipe pembayaran tidak valid',
        valid_types: VALID_PAYMENT_TYPES,
        received: payment_type
      });
    }

    // ✅ Validate booking exists and ownership
    if (!mongoose.Types.ObjectId.isValid(booking_id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Format ID booking tidak valid',
        received: booking_id
      });
    }

    const booking = await Booking.findOne({
      _id: booking_id,
      pelanggan: req.user._id
    }).populate('lapangan');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan atau bukan milik Anda',
        booking_id: booking_id,
        user_id: req.user._id
      });
    }

    // ✅ Determine payment amount with better validation
    let paymentAmount;
    if (payment_type === 'dp_payment') {
      paymentAmount = 50000; // Fixed DP amount
      if (parseInt(transfer_amount) !== paymentAmount) {
        return res.status(400).json({
          status: 'error',
          message: `DP harus tepat Rp ${paymentAmount.toLocaleString('id-ID')}`,
          expected: paymentAmount,
          received: parseInt(transfer_amount)
        });
      }
    } else if (payment_type === 'full_payment') {
      paymentAmount = parseInt(transfer_amount);
      if (paymentAmount !== booking.harga) {
        return res.status(400).json({
          status: 'error',
          message: 'Jumlah pembayaran penuh harus sesuai total booking',
          booking_total: booking.harga,
          received: paymentAmount
        });
      }
    }

    // ✅ Validate file upload with better error handling
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        status: 'error',
        message: 'Bukti transfer harus diupload',
        supported_formats: ['JPG', 'PNG', 'PDF'],
        max_size: '10MB'
      });
    }

    // ✅ Check for existing payment
    const existingPayment = await Payment.findOne({
      booking: booking_id,
      status: { $in: ['pending', 'verified'] }
    });

    if (existingPayment) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini sudah memiliki pembayaran aktif',
        existing_payment: {
          id: existingPayment._id,
          status: existingPayment.status,
          amount: existingPayment.amount,
          created_at: existingPayment.createdAt
        }
      });
    }

    // ✅ Handle rejected payments - mark as replaced
    const rejectedPayments = await Payment.find({
      booking: booking_id,
      status: 'rejected'
    });

    if (rejectedPayments.length > 0) {
      await Payment.updateMany(
        { booking: booking_id, status: 'rejected' },
        { 
          status: 'replaced',
          replaced_at: new Date(),
          replaced_by: req.user._id
        }
      );
    }

    // ✅ Get bank details with error handling
    let bankDetails = null;
    let availableBanks = [];
    try {
      bankDetails = await PaymentService.getBankDetails();
      availableBanks = await PaymentService.getAllActiveBanks();
    } catch (bankError) {
      logger.warn('Bank details unavailable during payment creation:', bankError.message);
    }

    // ✅ Prepare payment data for service
    const paymentData = {
      bookingId: booking_id,
      userId: req.user._id,
      paymentType: payment_type,
      amount: paymentAmount,
      transferProof: req.file.path,
      transferDetails: {
        sender_name: sender_name.trim(),
        transfer_amount: parseInt(transfer_amount),
        transfer_date: transferDateValid,  // Date object
        transfer_date_string: transfer_date, // Original string format
        transfer_reference: transfer_reference || ''
      }
    };

    // ✅ Create payment using service
    const payment = await PaymentService.createPayment(paymentData);
    
    // ✅ Get payment summary
    const paymentSummary = PaymentService.calculatePaymentSummary(
      payment.total_booking_amount, 
      payment.payment_type
    );

    // ✅ Clear caches
    try {
      if (client && client.isOpen) {
        await client.del('payments:pending');
        await client.del(`payments:user:${req.user._id}`);
        await client.del(`bookings:${req.user._id}`);
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    // ✅ Log successful payment creation
    logger.info(`Payment created successfully: ${payment._id}`, {
      user: req.user._id,
      booking: booking_id,
      amount: paymentAmount,
      type: payment_type,
      replaced_rejected: rejectedPayments.length
    });

    // ✅ Enhanced response
    res.status(201).json({
      status: 'success',
      message: rejectedPayments.length > 0 
        ? 'Pembayaran baru berhasil diupload menggantikan yang sebelumnya ditolak'
        : `Pembayaran ${payment.payment_type_text} berhasil dibuat. Menunggu verifikasi.`,
      data: {
        payment: {
          _id: payment._id,
          booking: payment.booking,
          payment_type: payment.payment_type,
          payment_type_text: payment.payment_type_text,
          amount: payment.amount,
          status: payment.status,
          transfer_details: {
            sender_name: payment.transfer_details.sender_name,
            transfer_amount: payment.transfer_details.transfer_amount,
            transfer_date: transfer_date, 
            transfer_date_display: moment(transferDateValid).format('DD MMMM YYYY'),
            transfer_reference: payment.transfer_details.transfer_reference
          },
          transfer_proof: payment.transfer_proof,
          submittedAtWIB: moment(payment.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
        },
        payment_summary: paymentSummary,
        bank_details: bankDetails,
        available_banks: availableBanks,
        note: !bankDetails ? 'Info rekening tidak tersedia, silakan hubungi admin' : null,
        next_steps: [
          'Pembayaran Anda sedang diproses',
          'Tim kasir akan memverifikasi dalam 1x24 jam',
          'Anda akan mendapat notifikasi setelah verifikasi',
          'Status dapat dicek di halaman "Booking Saya"'
        ]
      }
    });

  } catch (error) {
    logger.error('Create payment error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error_code: 'PAYMENT_CREATE_ERROR',
      error_details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        request_info: {
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
          bodyKeys: req.body ? Object.keys(req.body) : 'No body',
          hasFile: !!req.file
        }
      } : 'Contact support'
    });
  }
};

// ✅ APPROVE PAYMENT - Simple endpoint
export const approvePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { notes } = req.body;

    // Try PaymentService first
    try {
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

      const message = payment.previous_rejection_reason 
        ? 'Pembayaran berhasil di-approve setelah review ulang'
        : 'Pembayaran berhasil disetujui';

      res.status(200).json({
        status: 'success',
        message: message,
        data: { 
          payment: {
            id: payment._id,
            status: payment.status,
            amount: payment.amount,
            payment_type: payment.payment_type_text,
            approved_at: payment.verifiedAtWIB,
            approved_by: req.user.name,
            notes: payment.notes,
            was_previously_rejected: !!payment.previous_rejection_reason
          }
        }
      });

    } catch (serviceError) {
      // Fallback to direct logic if service fails
      console.log('PaymentService failed, using direct logic:', serviceError.message);
      
      const payment = await Payment.findById(paymentId).populate('booking');
      
      if (!payment) {
        return res.status(404).json({
          status: 'error',
          message: 'Payment tidak ditemukan'
        });
      }

      // Allow both pending and rejected
      if (!['pending', 'rejected'].includes(payment.status)) {
        return res.status(400).json({
          status: 'error',
          message: `Payment tidak bisa diapprove (status: ${payment.status})`
        });
      }

      const booking = payment.booking;
      if (!booking) {
        return res.status(404).json({
          status: 'error', 
          message: 'Booking tidak ditemukan'
        });
      }

      // Update payment
      payment.status = 'verified';
      payment.verified_by = req.user._id;
      payment.verified_at = new Date();
      payment.notes = notes || 'Pembayaran disetujui';

      // Handle previous rejection
      if (payment.rejection_reason) {
        payment.previous_rejection_reason = payment.rejection_reason;
        payment.rejection_reason = undefined;
      }

      // Update booking
      booking.status_pemesanan = 'confirmed';
      booking.payment_status = payment.payment_type === 'full_payment' 
        ? 'fully_paid' 
        : 'dp_confirmed';
      booking.kasir = req.user._id;
      booking.konfirmasi_at = new Date();

      // Save changes
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

      const message = payment.previous_rejection_reason 
        ? 'Pembayaran berhasil di-approve setelah review ulang'
        : 'Pembayaran berhasil disetujui';

      res.status(200).json({
        status: 'success',
        message: message,
        data: { 
          payment: {
            id: payment._id,
            status: 'Terverifikasi',
            amount: payment.amount,
            payment_type: payment.payment_type_text || payment.payment_type,
            approved_at: payment.verifiedAtWIB,
            approved_by: req.user.name,
            notes: payment.notes,
            was_previously_rejected: !!payment.previous_rejection_reason
          }
        }
      });
    }

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
        message: 'Pembayaran ditolak dan booking direset',
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
        message: 'Pembayaran ditolak dan booking direset',
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

    const payments = await Payment.find({ 
      status: 'pending'  // ← Hanya pending, tidak include replaced/rejected
    })
    .populate('user', 'name email')
    .populate({
      path: 'booking',
      populate: {
        path: 'lapangan',
        select: 'nama jenis_lapangan'
      }
    })
    .sort({ createdAt: -1 });

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
    // ✅ Handle bank details error gracefully
    let bankDetails = null;
    let availableBanks = [];
    
    try {
      bankDetails = await PaymentService.getBankDetails();
      availableBanks = await PaymentService.getAllActiveBanks();
    } catch (bankError) {
      logger.warn('Bank details unavailable:', bankError.message);
      
      // If no banks configured
      if (bankError.message.includes('rekening bank')) {
        return res.status(503).json({
          status: 'error',
          message: 'Sistem pembayaran sedang tidak tersedia',
          error: {
            code: 'NO_BANK_ACCOUNTS',
            description: 'Admin belum mengonfigurasi rekening pembayaran'
          }
        });
      }
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Informasi pembayaran',
      data: {
        primary_bank: bankDetails,
        available_banks: availableBanks,
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

// ✅ Helper function for date display
const formatDateDisplay = (dateString) => {
  const date = new Date(dateString + 'T00:00:00.000Z');
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const formatDateTimeWIB = (date) => {
  return new Date(date).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};