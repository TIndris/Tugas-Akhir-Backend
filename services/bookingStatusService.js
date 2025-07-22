import Booking from '../models/Booking.js';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import logger from '../config/logger.js';

export class BookingStatusService {
  
  // ✅ Get detailed booking status dengan timeline
  static async getBookingStatusDetail(bookingId, userId) {
    try {
      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        throw new Error('ID booking tidak valid');
      }

      // Find booking and check ownership
      const booking = await Booking.findOne({
        _id: bookingId,
        pelanggan: userId
      })
      .populate('lapangan', 'nama jenis_lapangan')
      .populate('kasir', 'name');

      if (!booking) {
        throw new Error('Booking tidak ditemukan');
      }

      // Get payment info if exists
      let payment = null;
      try {
        const { default: Payment } = await import('../models/Payment.js');
        payment = await Payment.findOne({ 
          booking: bookingId 
        }).sort({ createdAt: -1 });
      } catch (importError) {
        logger.warn('Payment model import error:', importError.message);
      }

      // Calculate status timeline
      const statusTimeline = this.calculateStatusTimeline(booking, payment);
      
      // Calculate progress
      const completedSteps = statusTimeline.filter(step => step.completed).length;
      const currentStep = statusTimeline.findIndex(step => !step.completed);
      const completionPercentage = Math.round((completedSteps / statusTimeline.length) * 100);

      // Determine next action
      const nextAction = this.determineNextAction(booking, payment);

      return {
        booking: {
          id: booking._id,
          fieldName: booking.lapangan.nama,
          fieldType: booking.lapangan.jenis_lapangan,
          date: booking.tanggal_bookingWIB,
          time: booking.jam_booking,
          duration: booking.durasi,
          price: booking.harga,
          status: booking.status_pemesanan,
          paymentStatus: booking.payment_status,
          createdAt: booking.createdAtWIB
        },
        payment: payment ? {
          id: payment._id,
          type: payment.payment_type === 'dp_payment' ? 'Pembayaran DP' : 'Pembayaran Lunas',
          amount: payment.amount,
          status: payment.status === 'verified' ? 'Terverifikasi' : 
                  payment.status === 'rejected' ? 'Ditolak' : 'Menunggu Verifikasi',
          submittedAt: payment.createdAtWIB,
          verifiedAt: payment.verified_at ? 
            moment(payment.verified_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null
        } : null,
        statusTimeline,
        progress: {
          currentStep: currentStep === -1 ? statusTimeline.length : currentStep,
          totalSteps: statusTimeline.length,
          completionPercentage,
          isCompleted: booking.status_pemesanan === 'confirmed',
          nextAction
        }
      };

    } catch (error) {
      logger.error('Error getting booking status detail:', error);
      throw error;
    }
  }

  // ✅ Calculate status timeline
  static calculateStatusTimeline(booking, payment) {
    return [
      {
        status: 'pending',
        label: 'Booking Dibuat',
        completed: true,
        timestamp: booking.createdAtWIB,
        description: 'Booking berhasil dibuat, menunggu pembayaran'
      },
      {
        status: 'payment_uploaded',
        label: 'Pembayaran Diupload',
        completed: !!payment,
        timestamp: payment ? payment.createdAtWIB : null,
        description: payment ? 'Bukti pembayaran berhasil diupload' : 'Menunggu upload bukti pembayaran'
      },
      {
        status: 'payment_verified',
        label: 'Pembayaran Diverifikasi',
        completed: payment?.status === 'verified',
        timestamp: payment?.verified_at ? 
          moment(payment.verified_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null,
        description: payment?.status === 'verified' 
          ? `Pembayaran diverifikasi oleh ${booking.kasir?.name || 'Kasir'}`
          : 'Menunggu verifikasi pembayaran dari kasir'
      },
      {
        status: 'booking_confirmed',
        label: 'Booking Terkonfirmasi',
        completed: booking.status_pemesanan === 'confirmed',
        timestamp: booking.konfirmasi_at ? 
          moment(booking.konfirmasi_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null,
        description: booking.status_pemesanan === 'confirmed'
          ? 'Booking terkonfirmasi, siap untuk bermain'
          : 'Menunggu konfirmasi booking'
      }
    ];
  }

  // ✅ Determine next action untuk user
  static determineNextAction(booking, payment) {
    if (booking.status_pemesanan === 'cancelled') {
      return { action: 'none', message: 'Booking telah dibatalkan' };
    } 
    
    if (booking.status_pemesanan === 'confirmed') {
      return { action: 'none', message: 'Booking sudah terkonfirmasi, siap bermain!' };
    } 
    
    if (!payment) {
      return { 
        action: 'upload_payment', 
        message: 'Upload bukti pembayaran untuk melanjutkan',
        endpoint: 'POST /payments'
      };
    } 
    
    if (payment.status === 'pending') {
      return { 
        action: 'wait_verification', 
        message: 'Menunggu verifikasi pembayaran dari kasir' 
      };
    } 
    
    if (payment.status === 'rejected') {
      return { 
        action: 'reupload_payment', 
        message: `Pembayaran ditolak: ${payment.rejection_reason || 'Alasan tidak disebutkan'}. Silakan upload ulang.`,
        endpoint: 'POST /payments'
      };
    }

    return { action: 'wait', message: 'Proses sedang berlangsung' };
  }
}

export default BookingStatusService;