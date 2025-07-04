import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import logger from '../config/logger.js';
import {
  validatePaymentAmountLogic,
  validateTransferMatchesPayment,
  validateTransferNotFuture,
  validateTransferNotTooOld,
  validateStatusTransition,
  PAYMENT_TYPES,
  PAYMENT_STATUSES,
  DP_AMOUNT
} from '../validators/paymentValidators.js';

export class PaymentService {
  
  // ============= CONSTANTS =============
  static PAYMENT_TYPES = {
    FULL: 'full_payment',
    DP: 'dp_payment'
  };

  static DP_AMOUNT = DP_AMOUNT;

  static PAYMENT_STATUS = {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected'
  };

  // ============= VALIDATION METHODS =============
  static validatePaymentData(paymentData) {
    const { paymentType, amount, transferDetails } = paymentData;

    // Validate transfer details
    validateTransferNotFuture(transferDetails.transfer_date);
    validateTransferNotTooOld(transferDetails.transfer_date);
    validateTransferMatchesPayment(transferDetails.transfer_amount, amount);
  }

  static validatePaymentAmount(paymentType, amount, totalBookingAmount) {
    validatePaymentAmountLogic(paymentType, amount, totalBookingAmount);
  }

  // ============= BUSINESS LOGIC METHODS =============
  static getBankDetails() {
    return {
      bank_name: 'Bank Syariah Indonesia (BSI)',
      account_number: '1234567890',
      account_name: 'PT Lapangan Olahraga Indonesia',
      account_type: 'Tabungan'
    };
  }

  static calculatePaymentSummary(totalBookingAmount, paymentType) {
    if (paymentType === this.PAYMENT_TYPES.DP) {
      return {
        total_booking: totalBookingAmount,
        dp_amount: this.DP_AMOUNT,
        remaining_amount: totalBookingAmount - this.DP_AMOUNT,
        payment_type: 'DP Payment'
      };
    } else {
      return {
        total_booking: totalBookingAmount,
        full_payment: totalBookingAmount,
        remaining_amount: 0,
        payment_type: 'Full Payment'
      };
    }
  }

  // ============= CRUD OPERATIONS =============
  static async createPayment(paymentData) {
    const {
      bookingId,
      userId,
      paymentType,
      amount,
      transferProof,
      transferDetails
    } = paymentData;

    // Get and validate booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      throw new Error('Booking tidak ditemukan');
    }

    if (booking.pelanggan.toString() !== userId.toString()) {
      throw new Error('Booking tidak ditemukan untuk user ini');
    }

    // Check existing payment
    const existingPayment = await Payment.findOne({ 
      booking: bookingId,
      status: { $in: [this.PAYMENT_STATUS.PENDING, this.PAYMENT_STATUS.VERIFIED] }
    });

    if (existingPayment) {
      throw new Error('Booking ini sudah memiliki pembayaran');
    }

    // Validate payment data
    this.validatePaymentAmount(paymentType, amount, booking.harga);
    this.validatePaymentData({ paymentType, amount, transferDetails });

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

    // Update booking payment status
    booking.payment_status = 'pending_payment';
    await booking.save();

    logger.info(`Payment created: ${payment._id}`, {
      user: userId,
      booking: bookingId,
      amount: amount,
      type: paymentType
    });

    return payment;
  }

  static async approvePayment(paymentId, kasirId, notes = '') {
    const payment = await Payment.findById(paymentId).populate('booking');
    
    if (!payment) {
      throw new Error('Payment tidak ditemukan');
    }

    // Validate status transition
    if (!validateStatusTransition(payment.status, 'verified', 'cashier')) {
      throw new Error('Payment tidak dapat diverifikasi');
    }

    // Update payment
    payment.status = this.PAYMENT_STATUS.VERIFIED;
    payment.verified_by = kasirId;
    payment.verified_at = new Date();
    payment.notes = notes;

    // Update booking - auto confirmation
    const booking = payment.booking;
    booking.status_pemesanan = 'confirmed';
    booking.payment_status = payment.payment_type === this.PAYMENT_TYPES.FULL 
      ? 'fully_paid' 
      : 'dp_confirmed';
    booking.kasir = kasirId;
    booking.konfirmasi_at = new Date();

    // Save changes
    await payment.save();
    await booking.save();

    logger.info(`Payment APPROVED & Booking CONFIRMED: ${payment._id}`, {
      kasir: kasirId,
      customer: payment.user,
      booking: booking._id,
      amount: payment.amount,
      type: payment.payment_type
    });

    return payment;
  }

  static async rejectPayment(paymentId, kasirId, reason) {
    const payment = await Payment.findById(paymentId).populate('booking');
    
    if (!payment) {
      throw new Error('Payment tidak ditemukan');
    }

    // Validate status transition
    if (!validateStatusTransition(payment.status, 'rejected', 'cashier')) {
      throw new Error('Payment tidak dapat ditolak');
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('Alasan penolakan harus diisi minimal 5 karakter');
    }

    // Update payment
    payment.status = this.PAYMENT_STATUS.REJECTED;
    payment.verified_by = kasirId;
    payment.verified_at = new Date();
    payment.rejection_reason = reason;

    // Reset booking
    const booking = payment.booking;
    booking.status_pemesanan = 'pending';
    booking.payment_status = 'no_payment';
    booking.kasir = undefined;
    booking.konfirmasi_at = undefined;

    // Save changes
    await payment.save();
    await booking.save();

    logger.info(`Payment REJECTED & Booking RESET: ${payment._id}`, {
      kasir: kasirId,
      customer: payment.user,
      booking: booking._id,
      reason: reason
    });

    return payment;
  }

  // ============= QUERY METHODS =============
  static async getPendingPayments() {
    return await Payment.find({ status: this.PAYMENT_STATUS.PENDING })
      .populate('booking', 'tanggal_booking jam_booking durasi harga jenis_lapangan')
      .populate('booking.lapangan', 'nama')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
  }

  static async getUserPayments(userId) {
    return await Payment.find({ user: userId })
      .populate('booking', 'tanggal_booking jam_booking durasi harga jenis_lapangan')
      .populate('booking.lapangan', 'nama')
      .sort({ createdAt: -1 });
  }

  static async getPaymentById(paymentId) {
    return await Payment.findById(paymentId)
      .populate('booking')
      .populate('user', 'name email')
      .populate('verified_by', 'name');
  }
}