import { sendSMS, formatPhoneNumber } from '../config/twilio.js';
import logger from '../config/logger.js';
import moment from 'moment-timezone';

class NotificationService {
  
  // Format currency to IDR
  static formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(amount);
  }

  // Send payment reminder after booking creation
  static async sendPaymentReminder(booking, user) {
    try {
      if (!user.phoneNumber) {
        logger.warn('User has no phone number for SMS notification:', user._id);
        return { success: false, error: 'No phone number' };
      }

      const phoneNumber = formatPhoneNumber(user.phoneNumber);
      const bookingDate = moment(booking.date).tz('Asia/Jakarta').format('DD/MM/YYYY');
      const timeSlot = `${booking.startTime} - ${booking.endTime}`;
      const totalAmount = this.formatCurrency(booking.totalAmount);

      const message = `🏟️ DIAZ SPORT CENTER
      
Booking berhasil dibuat!

📋 Detail Booking:
• ID: ${booking.bookingId}
• Lapangan: ${booking.fieldId?.name || 'N/A'}
• Tanggal: ${bookingDate}
• Waktu: ${timeSlot}
• Total: ${totalAmount}

⚠️ PENTING: Silakan lakukan pembayaran dalam 10 MENIT
Status: ${booking.status}

Terima kasih telah memilih Diaz Sport Center! 🙏`;

      const result = await sendSMS(phoneNumber, message);
      
      if (result.success) {
        logger.info('Payment reminder SMS sent:', {
          bookingId: booking.bookingId,
          userId: user._id,
          phone: phoneNumber
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending payment reminder SMS:', {
        error: error.message,
        bookingId: booking.bookingId,
        userId: user._id
      });
      return { success: false, error: error.message };
    }
  }

  // Send preparation reminder 1 hour before booking start
  static async sendPreparationReminder(booking, user) {
    try {
      if (!user.phoneNumber) {
        logger.warn('User has no phone number for SMS notification:', user._id);
        return { success: false, error: 'No phone number' };
      }

      const phoneNumber = formatPhoneNumber(user.phoneNumber);
      const bookingDate = moment(booking.date).tz('Asia/Jakarta').format('DD/MM/YYYY');
      const timeSlot = `${booking.startTime} - ${booking.endTime}`;

      const message = `🏟️ DIAZ SPORT CENTER

⏰ REMINDER: Booking Anda dimulai 1 jam lagi!

📋 Detail Booking:
• ID: ${booking.bookingId}
• Lapangan: ${booking.fieldId?.name || 'N/A'}
• Tanggal: ${bookingDate}  
• Waktu: ${timeSlot}
• Status: ${booking.status}

🎯 Silakan bersiap-siap dan datang tepat waktu!
Alamat: [Alamat Diaz Sport Center]

Selamat bermain! 🏃‍♂️⚽`;

      const result = await sendSMS(phoneNumber, message);
      
      if (result.success) {
        logger.info('Preparation reminder SMS sent:', {
          bookingId: booking.bookingId,
          userId: user._id,
          phone: phoneNumber
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending preparation reminder SMS:', {
        error: error.message,
        bookingId: booking.bookingId,
        userId: user._id
      });
      return { success: false, error: error.message };
    }
  }

  // Send booking confirmation after payment verification
  static async sendBookingConfirmation(booking, user) {
    try {
      if (!user.phoneNumber) {
        logger.warn('User has no phone number for SMS notification:', user._id);
        return { success: false, error: 'No phone number' };
      }

      const phoneNumber = formatPhoneNumber(user.phoneNumber);
      const bookingDate = moment(booking.date).tz('Asia/Jakarta').format('DD/MM/YYYY');
      const timeSlot = `${booking.startTime} - ${booking.endTime}`;
      const totalAmount = this.formatCurrency(booking.totalAmount);

      const message = `🏟️ DIAZ SPORT CENTER

✅ PEMBAYARAN BERHASIL DIKONFIRMASI!

📋 Detail Booking:
• ID: ${booking.bookingId}
• Lapangan: ${booking.fieldId?.name || 'N/A'}
• Tanggal: ${bookingDate}
• Waktu: ${timeSlot}
• Total: ${totalAmount}
• Status: CONFIRMED

🎉 Booking Anda telah dikonfirmasi. Sampai jumpa di lapangan!

Terima kasih! 🙏`;

      const result = await sendSMS(phoneNumber, message);
      
      if (result.success) {
        logger.info('Booking confirmation SMS sent:', {
          bookingId: booking.bookingId,
          userId: user._id,
          phone: phoneNumber
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending booking confirmation SMS:', {
        error: error.message,
        bookingId: booking.bookingId,
        userId: user._id
      });
      return { success: false, error: error.message };
    }
  }
}

export default NotificationService;