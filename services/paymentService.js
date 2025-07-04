import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import logger from '../config/logger.js';

export class PaymentService {
  
  // Konstanta untuk payment
  static PAYMENT_TYPES = {
    FULL: 'full_payment',
    DP: 'dp_payment'
  };

  static DP_AMOUNT = 50000; // Fixed DP amount

  static PAYMENT_STATUS = {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected'
  };

  /**
   * Validate payment amount based on payment type
   */
  static validatePaymentAmount(paymentType, amount, totalBookingAmount) {
    if (paymentType === this.PAYMENT_TYPES.DP) {
      if (amount !== this.DP_AMOUNT) {
        throw new Error(`DP harus tepat Rp ${this.DP_AMOUNT.toLocaleString('id-ID')}`);
      }
      if (totalBookingAmount < this.DP_AMOUNT) {
        throw new Error(`Total booking minimal Rp ${this.DP_AMOUNT.toLocaleString('id-ID')} untuk DP`);
      }
    } else if (paymentType === this.PAYMENT_TYPES.FULL) {
      if (amount !== totalBookingAmount) {
        throw new Error('Jumlah pembayaran harus sama dengan total booking');
      }
    } else {
      throw new Error('Tipe pembayaran tidak valid');
    }
  }

  /**
   * Get bank account details for BSI
   */
  static getBankDetails() {
    return {
      bank_name: 'Bank Syariah Indonesia (BSI)',
      account_number: '1234567890123',
      account_name: 'PT Lapangan Olahraga Indonesia',
      bank_code: 'BSI',
      swift_code: 'BSININID'
    };
  }

  /**
   * Create new payment
   */
  static async createPayment(paymentData) {
    const {
      bookingId,
      userId,
      paymentType,
      amount,
      transferProof,
      transferDetails
    } = paymentData;

    // Get booking details
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      throw new Error('Booking tidak ditemukan');
    }

    // Check if booking belongs to user
    if (booking.pelanggan.toString() !== userId.toString()) {
      throw new Error('Booking tidak ditemukan untuk user ini');
    }

    // Check if booking already has payment
    const existingPayment = await Payment.findOne({ 
      booking: bookingId,
      status: { $in: [this.PAYMENT_STATUS.PENDING, this.PAYMENT_STATUS.VERIFIED] }
    });

    if (existingPayment) {
      throw new Error('Booking ini sudah memiliki pembayaran');
    }

    // Validate payment amount
    this.validatePaymentAmount(paymentType, amount, booking.harga);

    // Create payment
    const payment = await Payment.create({
      booking: bookingId,
      user: userId,
      payment_type: paymentType,
      amount: amount,
      total_booking_amount: booking.harga,
      transfer_proof: transferProof,
      transfer_details: transferDetails,
      bank_details: this.getBankDetails()
    });

    // Update booking - gunakan status yang sudah ada
    booking.payment_status = 'pending_payment';  // ← Payment status
    // booking.status_pemesanan tetap 'pending'   // ← Keep original booking status
    await booking.save();

    logger.info(`Payment created: ${payment._id}`, {
      user: userId,
      booking: bookingId,
      amount: amount,
      type: paymentType,
      action: 'CREATE_PAYMENT'
    });

    return payment;
  }

  /**
   * Verify payment (for cashier/admin)
   */
  static async verifyPayment(paymentId, verifierId, action, notes = '') {
    const payment = await Payment.findById(paymentId).populate('booking');
    
    if (!payment) {
      throw new Error('Payment tidak ditemukan');
    }

    if (payment.status !== this.PAYMENT_STATUS.PENDING) {
      throw new Error('Payment sudah diproses sebelumnya');
    }

    if (action === 'verify') {
      payment.status = this.PAYMENT_STATUS.VERIFIED;
      payment.verified_by = verifierId;
      payment.verified_at = new Date();
      payment.notes = notes || 'Pembayaran telah diverifikasi';

      const booking = payment.booking;
      if (payment.payment_type === this.PAYMENT_TYPES.FULL) {
        booking.status_pemesanan = 'confirmed';   // ← Use existing status
        booking.payment_status = 'fully_paid';
      } else {
        booking.status_pemesanan = 'confirmed';   // ← Use existing status  
        booking.payment_status = 'dp_confirmed';
      }
      booking.kasir = verifierId;
      booking.konfirmasi_at = new Date();
      await booking.save();
      
      logger.info(`Payment verified: ${payment._id}`, {
        verifier: verifierId,
        booking: payment.booking._id,
        amount: payment.amount,
        action: 'VERIFY_PAYMENT'
      });

    } else if (action === 'reject') {
      payment.status = this.PAYMENT_STATUS.REJECTED;
      payment.verified_by = verifierId;
      payment.verified_at = new Date();
      payment.rejection_reason = notes || 'Bukti transfer tidak valid';

      // Update booking status back to pending
      const booking = payment.booking;
      booking.status_pemesanan = 'pending';
      await booking.save();

      logger.info(`Payment rejected: ${payment._id}`, {
        verifier: verifierId,
        booking: payment.booking._id,
        reason: notes,
        action: 'REJECT_PAYMENT'
      });

    } else {
      throw new Error('Action harus verify atau reject');
    }

    await payment.save();
    return payment;
  }

  /**
   * Get pending payments for cashier/admin
   */
  static async getPendingPayments() {
    return await Payment.find({ status: this.PAYMENT_STATUS.PENDING })
      .populate('user', 'name email phone')
      .populate('booking', 'tanggal_booking jam_booking durasi')
      .populate({
        path: 'booking',
        populate: {
          path: 'lapangan',
          select: 'nama jenis_lapangan'
        }
      })
      .sort({ createdAt: -1 });
  }

  /**
   * Get user payments
   */
  static async getUserPayments(userId) {
    return await Payment.find({ user: userId })
      .populate('booking', 'tanggal_booking jam_booking durasi')
      .populate({
        path: 'booking',
        populate: {
          path: 'lapangan',
          select: 'nama jenis_lapangan'
        }
      })
      .sort({ createdAt: -1 });
  }

  /**
   * Get payment details
   */
  static async getPaymentById(paymentId) {
    return await Payment.findById(paymentId)
      .populate('user', 'name email phone')
      .populate('verified_by', 'name')
      .populate('booking', 'tanggal_booking jam_booking durasi harga')
      .populate({
        path: 'booking',
        populate: {
          path: 'lapangan',
          select: 'nama jenis_lapangan'
        }
      });
  }

  /**
   * Calculate payment summary for booking
   */
  static calculatePaymentSummary(totalAmount, paymentType) {
    if (paymentType === this.PAYMENT_TYPES.DP) {
      return {
        total_amount: totalAmount,
        dp_amount: this.DP_AMOUNT,
        remaining_amount: totalAmount - this.DP_AMOUNT,
        payment_type: 'DP',
        next_payment_due: totalAmount - this.DP_AMOUNT
      };
    } else {
      return {
        total_amount: totalAmount,
        dp_amount: 0,
        remaining_amount: 0,
        payment_type: 'Full Payment',
        next_payment_due: 0
      };
    }
  }
}