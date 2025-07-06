import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import {
  validatePaymentAmountLogic,
  validateTransferMatchesPayment,
  validateTransferNotFuture,
  validateTransferNotTooOld
} from '../validators/paymentValidators.js';
import BankAccount from '../models/BankAccount.js';

export class PaymentService {
  
  // ============= CONSTANTS =============
  static PAYMENT_TYPES = {
    FULL: 'full_payment',
    DP: 'dp_payment'
  };

  static DP_AMOUNT = 50000; // Hardcode value instead of import

  static PAYMENT_STATUS = {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
    REPLACED: 'replaced'  // ← ADD THIS
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
  static async getBankDetails() {
    try {
      // Get primary active bank account
      const primaryBank = await BankAccount.findOne({ 
        is_active: true, 
        is_primary: true 
      });

      if (primaryBank) {
        return {
          bank_name: primaryBank.bank_name,
          account_number: primaryBank.account_number,
          account_name: primaryBank.account_name,
          account_type: primaryBank.account_type,
          description: primaryBank.description
        };
      }

      // Fallback: get any active bank account
      const fallbackBank = await BankAccount.findOne({ is_active: true });
      if (fallbackBank) {
        return {
          bank_name: fallbackBank.bank_name,
          account_number: fallbackBank.account_number,
          account_name: fallbackBank.account_name,
          account_type: fallbackBank.account_type,
          description: fallbackBank.description
        };
      }

      // ✅ NO HARDCODED FALLBACK - Clear error message
      throw new Error('Belum ada rekening bank aktif. Admin perlu menambahkan rekening pembayaran melalui dashboard admin.');

    } catch (error) {
      logger.error('Error getting bank details:', error);
      
      // ✅ Specific error handling
      if (error.message.includes('rekening bank')) {
        throw error; // Re-throw custom message
      }
      
      throw new Error('Sistem pembayaran bermasalah. Silakan hubungi admin atau coba lagi nanti.');
    }
  }

  // ✅ NEW: Get all active bank accounts for customer choice
  static async getAllActiveBanks() {
    try {
      const banks = await BankAccount.find({ is_active: true })
        .select('bank_name account_number account_name account_type description is_primary')
        .sort({ is_primary: -1, bank_name: 1 });

      return banks.map(bank => ({
        id: bank._id,
        bank_name: bank.bank_name,
        account_number: bank.account_number,
        account_name: bank.account_name,
        account_type: bank.account_type,
        description: bank.description,
        is_primary: bank.is_primary
      }));

    } catch (error) {
      logger.error('Error getting active banks:', error);
      return [];
    }
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
      throw new Error('Booking ini sudah memiliki pembayaran aktif');
    }

    // Handle existing rejected payments
    const rejectedPayments = await Payment.find({
      booking: bookingId,
      status: this.PAYMENT_STATUS.REJECTED
    });

    if (rejectedPayments.length > 0) {
      console.log(`Found ${rejectedPayments.length} rejected payments for booking ${bookingId}`);
      await Payment.updateMany(
        { booking: bookingId, status: this.PAYMENT_STATUS.REJECTED },
        { 
          status: this.PAYMENT_STATUS.REPLACED,
          replaced_at: new Date(),
          replaced_by: userId
        }
      );
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

    // Allow both pending and rejected to be approved
    if (!['pending', 'rejected'].includes(payment.status)) {
      throw new Error(`Payment tidak bisa diapprove (status: ${payment.status})`);
    }

    // Update payment
    payment.status = this.PAYMENT_STATUS.VERIFIED;
    payment.verified_by = kasirId;
    payment.verified_at = new Date();
    payment.notes = notes;

    // Handle previous rejection
    if (payment.rejection_reason) {
      payment.previous_rejection_reason = payment.rejection_reason;
      payment.rejection_reason = undefined;
    }

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
      type: payment.payment_type,
      was_previously_rejected: !!payment.previous_rejection_reason
    });

    return payment;
  }

  static async rejectPayment(paymentId, kasirId, reason) {
    const payment = await Payment.findById(paymentId).populate('booking');
    
    if (!payment) {
      throw new Error('Payment tidak ditemukan');
    }

    if (payment.status !== this.PAYMENT_STATUS.PENDING) {
      throw new Error(`Payment sudah diproses sebelumnya (status: ${payment.status})`);
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('Alasan penolakan harus diisi minimal 5 karakter');
    }

    // Update payment
    payment.status = this.PAYMENT_STATUS.REJECTED;
    payment.verified_by = kasirId;
    payment.verified_at = new Date();
    payment.rejection_reason = reason.trim();

    // ✅ COMPLETE BOOKING RESET
    const booking = payment.booking;
    booking.status_pemesanan = 'pending';        // Reset to initial state
    booking.payment_status = 'no_payment';       // Reset payment status
    booking.kasir = undefined;                   // Remove kasir assignment
    booking.konfirmasi_at = undefined;           // Remove confirmation timestamp

    // Save both documents in transaction
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await payment.save({ session });
        await booking.save({ session });
      });
    } finally {
      await session.endSession();
    }

    logger.info(`Payment REJECTED & Booking COMPLETELY RESET: ${payment._id}`, {
      kasir: kasirId,
      customer: payment.user,
      booking: booking._id,
      reason: reason.trim(),
      booking_reset: {
        status: booking.status_pemesanan,
        payment_status: booking.payment_status,
        kasir_removed: booking.kasir === undefined
      }
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