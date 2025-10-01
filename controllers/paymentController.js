import { PaymentService } from '../services/paymentService.js';
import Payment from '../models/Payment.js'; 
import Booking from '../models/Booking.js'; 
import { client } from '../config/redis.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import moment from 'moment-timezone';

export const createPayment = async (req, res) => {
  try {
    console.log('=== PAYMENT CREATE DEBUG ===');
    console.log('User:', req.user ? { id: req.user._id, role: req.user.role } : 'No user');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body:', req.body);
    console.log('Request file:', req.file ? {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    } : 'No file');

    // FIXED: Add role check
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'customer') {
      return res.status(403).json({
        status: 'error',
        message: 'Hanya customer yang dapat membuat pembayaran',
        current_role: req.user.role
      });
    }

    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Request body kosong. Pastikan menggunakan form-data dengan field yang benar.',
        error_code: 'EMPTY_REQUEST_BODY',
        required_fields: ['booking_id', 'payment_type', 'sender_name', 'transfer_amount', 'transfer_date']
      });
    }

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

    // Validate required fields
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
        }
      });
    }

    // Validate transfer date
    const validateTransferDate = (dateString) => {
      try {
        if (!dateString || typeof dateString !== 'string') {
          throw new Error('Tanggal transfer harus diisi');
        }

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

    let transferDateValid;
    try {
      transferDateValid = validateTransferDate(transfer_date);
    } catch (dateError) {
      return res.status(400).json({
        status: 'error',
        message: dateError.message,
        example_format: '2025-09-05',
        received: transfer_date
      });
    }

    // Validate payment type
    const VALID_PAYMENT_TYPES = ['dp_payment', 'full_payment'];
    if (!VALID_PAYMENT_TYPES.includes(payment_type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Tipe pembayaran tidak valid',
        valid_types: VALID_PAYMENT_TYPES,
        received: payment_type
      });
    }

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(booking_id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Format ID booking tidak valid',
        received: booking_id
      });
    }

    // Find and validate booking
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

    console.log('Booking found:', {
      id: booking._id,
      status: booking.status_pemesanan,
      payment_status: booking.payment_status,
      harga: booking.harga
    });

    // Validate payment amount
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

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'Bukti transfer harus diupload',
        supported_formats: ['JPG', 'PNG', 'PDF'],
        max_size: '10MB'
      });
    }

    console.log('File upload details:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    });

    // Check for existing active payment
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

    // Handle rejected payments
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
      console.log(`Replaced ${rejectedPayments.length} rejected payments`);
    }

    // FIXED: Direct payment creation instead of service
    const paymentData = {
      user: req.user._id,
      booking: booking_id,
      payment_type: payment_type,
      amount: paymentAmount,
      total_booking_amount: booking.harga,
      transfer_proof: req.file.path,
      transfer_details: {
        sender_name: sender_name.trim(),
        transfer_amount: parseInt(transfer_amount),
        transfer_date: transferDateValid,
        transfer_date_string: transfer_date,
        transfer_reference: transfer_reference || ''
      },
      status: 'pending'
    };

    console.log('Creating payment with data:', paymentData);

    const payment = new Payment(paymentData);
    await payment.save();

    console.log('Payment created successfully:', payment._id);

    // ✅ NEW: Update booking payment_status setelah payment dibuat
    await Booking.findByIdAndUpdate(booking_id, {
      payment_status: 'pending', // Update dari 'no_payment' ke 'pending'
      updated_at: new Date()
    });

    console.log('Booking payment_status updated to pending');

    // Clear cache
    try {
      if (client && client.isOpen) {
        await client.del('payments:pending');
        await client.del(`payments:user:${req.user._id}`);
        await client.del(`bookings:${req.user._id}`); // ✅ Clear booking cache
      }
    } catch (redisError) {
      console.warn('Redis cache clear error:', redisError);
    }

    // Log success
    logger.info(`Payment created successfully: ${payment._id}`, {
      user: req.user._id,
      booking: booking_id,
      amount: paymentAmount,
      type: payment_type,
      replaced_rejected: rejectedPayments.length
    });

    // Get bank info for response
    let bankDetails = null;
    try {
      if (PaymentService && PaymentService.getBankDetails) {
        bankDetails = await PaymentService.getBankDetails();
      }
    } catch (bankError) {
      console.warn('Bank details unavailable:', bankError.message);
    }

    // Response
    res.status(201).json({
      status: 'success',
      message: rejectedPayments.length > 0 
        ? 'Pembayaran baru berhasil diupload menggantikan yang sebelumnya ditolak'
        : `Pembayaran berhasil dibuat. Menunggu verifikasi.`,
      data: {
        payment: {
          _id: payment._id,
          booking: payment.booking,
          payment_type: payment.payment_type,
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
        bank_details: bankDetails,
        next_steps: [
          'Pembayaran Anda sedang diproses',
          'Tim kasir akan memverifikasi dalam 1x24 jam',
          'Anda akan mendapat notifikasi setelah verifikasi',
          'Status dapat dicek di halaman "Booking Saya"'
        ]
      }
    });

  } catch (error) {
    console.error('=== PAYMENT CREATE ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Request details:', {
      user: req.user ? { id: req.user._id, role: req.user.role } : 'No user',
      body: req.body,
      file: req.file ? 'File present' : 'No file',
      contentType: req.headers['content-type']
    });

    logger.error('Create payment error:', {
      error: error.message,
      stack: error.stack,
      user: req.user?._id,
      body: req.body
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membuat pembayaran',
      error_code: 'PAYMENT_CREATE_ERROR',
      error_details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        request_info: {
          contentType: req.headers['content-type'],
          bodyKeys: req.body ? Object.keys(req.body) : 'No body',
          hasFile: !!req.file,
          hasUser: !!req.user
        }
      } : 'Contact support'
    });
  }
};

export const approvePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { notes } = req.body;

    const payment = await Payment.findById(paymentId).populate('booking');
    
    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Payment tidak ditemukan'
      });
    }

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
          payment_type: payment.payment_type,
          approved_by: req.user.name,
          notes: payment.notes,
          was_previously_rejected: !!payment.previous_rejection_reason
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

export const rejectPayment = async (req, res) => {
  try {
    const paymentId = req.params.paymentId || req.params.id;
    const { reason, rejection_reason } = req.body;
    const finalReason = reason || rejection_reason;

    if (!finalReason || finalReason.trim().length < 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Alasan penolakan harus diisi minimal 5 karakter'
      });
    }

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
          rejected_by: req.user.name
        }
      }
    });

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
    const payments = await Payment.find({ 
      status: 'pending'
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
    
    // Direct query instead of service
    const payments = await Payment.find({ user: userId })
      .populate({
        path: 'booking',
        populate: {
          path: 'lapangan',
          select: 'nama jenis_lapangan'
        }
      })
      .sort({ createdAt: -1 });

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
    
    const payment = await Payment.findById(paymentId)
      .populate('user', 'name email')
      .populate({
        path: 'booking',
        populate: {
          path: 'lapangan',
          select: 'nama jenis_lapangan'
        }
      });

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Pembayaran tidak ditemukan'
      });
    }

    // Check authorization
    if (req.user.role === 'customer' && payment.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke pembayaran ini'
      });
    }

    res.status(200).json({
      status: 'success',
      data: { payment }
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
    // Simple bank info - adjust based on your needs
    const bankInfo = {
      bank_name: 'Bank BCA',
      account_number: '1234567890',
      account_name: 'DSC Sports Center',
      payment_options: [
        {
          type: 'dp_payment',
          name: 'Pembayaran DP',
          amount: 50000,
          description: 'DP tetap Rp 50.000'
        },
        {
          type: 'full_payment',
          name: 'Pembayaran Penuh',
          amount: 'Sesuai total booking',
          description: 'Bayar langsung sesuai total harga booking'
        }
      ]
    };
    
    res.status(200).json({
      status: 'success',
      message: 'Informasi pembayaran',
      data: bankInfo
    });

  } catch (error) {
    logger.error('Get bank info error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil informasi bank'
    });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Find payment and populate booking
    const payment = await Payment.findById(paymentId).populate('booking');

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Payment not found'
      });
    }

    // Only admin or the user who made the payment can verify
    if (req.user.role !== 'admin' && payment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to verify this payment'
      });
    }

    // Update payment status to verified
    payment.status = 'verified';
    payment.verified_by = req.user._id;
    payment.verified_at = new Date();

    await payment.save();

    // Update booking status
    const booking = payment.booking;
    booking.status_pemesanan = 'confirmed';
    booking.payment_status = payment.payment_type === 'full_payment' 
      ? 'fully_paid' 
      : 'dp_confirmed';
    booking.kasir = req.user._id;
    booking.konfirmasi_at = new Date();

    await booking.save();

    // Clear relevant caches
    try {
      if (client && client.isOpen) {
        await client.del('payments:pending');
        await client.del(`payments:user:${booking.pelanggan}`);
        await client.del(`bookings:${booking.pelanggan}`);
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info('Payment verified successfully:', {
      paymentId: payment._id,
      bookingId: booking.bookingId,
      verifiedBy: req.user._id
    });

    res.json({
      status: 'success',
      message: 'Payment verified successfully. Booking confirmed.',
      data: { 
        payment: {
          id: payment._id,
          status: payment.status,
          verified_at: payment.verified_at
        },
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status_pemesanan,
          payment_status: booking.payment_status
        }
      }
    });

  } catch (error) {
    logger.error(`Payment verification error: ${error.message}`, {
      paymentId: req.params.paymentId,
      user: req.user?._id
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat verifikasi pembayaran',
      error_code: 'PAYMENT_VERIFICATION_ERROR',
      error_details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : 'Contact support'
    });
  }
};