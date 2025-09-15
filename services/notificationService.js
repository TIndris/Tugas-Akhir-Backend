import { sendSMS, formatPhoneNumber } from '../config/twilio.js';
import logger from '../config/logger.js';
import moment from 'moment-timezone';

class NotificationService {
  
  // ✅ ENHANCED: sendPaymentReminder
  static async sendPaymentReminder(booking, user) {
    try {
      const formattedPhone = formatPhoneNumber(user.phone || user.phoneNumber);
      
      if (!formattedPhone) {
        throw new Error(`Nomor telepon tidak valid: ${user.phone || user.phoneNumber}`);
      }

      // Get booking details with flexible field access
      const fieldName = booking.lapangan?.nama || booking.fieldId?.name || 'Lapangan';
      const bookingDate = moment(booking.tanggal_booking || booking.date).format('DD/MM/YYYY');
      const bookingTime = booking.jam_booking || booking.startTime;
      const duration = booking.durasi || booking.duration;
      const amount = new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR' 
      }).format(booking.harga || booking.totalAmount);

      const message = `🏟️ DIAZ SPORT CENTER
Booking Confirmation

Halo ${user.name}! 👋

✅ Booking Anda berhasil dibuat:
📍 Lapangan: ${fieldName}
📅 Tanggal: ${bookingDate}
⏰ Waktu: ${bookingTime} (${duration} jam)
💰 Total: ${amount}
🆔 ID Booking: ${booking.bookingId}

⚠️ Status: PENDING PAYMENT
⏰ Batas Pembayaran: 24 jam dari sekarang

Silakan lakukan pembayaran untuk mengkonfirmasi booking Anda. 

Terima kasih telah memilih DSC! 🙏

---
DIAZ SPORT CENTER
"Your Sports, Our Priority"`;

      logger.info('Sending payment reminder SMS/WhatsApp:', {
        to: formattedPhone,
        bookingId: booking.bookingId,
        userName: user.name,
        fieldName,
        bookingDate,
        bookingTime
      });

      const result = await sendSMS(formattedPhone, message);

      if (result.success) {
        logger.info('Payment reminder sent successfully:', {
          messageSid: result.messageSid,
          status: result.status,
          to: formattedPhone,
          bookingId: booking.bookingId
        });

        return {
          success: true,
          messageSid: result.messageSid,
          status: result.status,
          phone: formattedPhone
        };
      } else {
        throw new Error(result.error || 'Failed to send SMS');
      }

    } catch (error) {
      logger.error('Payment reminder SMS failed:', {
        error: error.message,
        bookingId: booking.bookingId || booking._id,
        userPhone: user.phone || user.phoneNumber,
        userId: user._id
      });

      throw error;
    }
  }

  // ✅ ADD: Test message function
  static async sendTestMessage(phone, message) {
    try {
      const formattedPhone = formatPhoneNumber(phone);
      
      if (!formattedPhone) {
        throw new Error(`Nomor telepon tidak valid: ${phone}`);
      }

      logger.info('Sending test message:', {
        to: formattedPhone,
        messageLength: message.length
      });

      const result = await sendSMS(formattedPhone, message);

      if (result.success) {
        logger.info('Test message sent successfully:', {
          messageSid: result.messageSid,
          status: result.status,
          to: formattedPhone
        });

        return {
          success: true,
          messageSid: result.messageSid,
          status: result.status,
          formattedPhone: formattedPhone
        };
      } else {
        throw new Error(result.error || 'Failed to send test message');
      }

    } catch (error) {
      logger.error('Test message failed:', {
        error: error.message,
        phone: phone
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ ENHANCED: sendBookingConfirmation
  static async sendBookingConfirmation(booking, user) {
    try {
      const formattedPhone = formatPhoneNumber(user.phone || user.phoneNumber);
      
      if (!formattedPhone) {
        throw new Error(`Nomor telepon tidak valid: ${user.phone || user.phoneNumber}`);
      }

      const fieldName = booking.lapangan?.nama || booking.fieldId?.name || 'Lapangan';
      const bookingDate = moment(booking.tanggal_booking || booking.date).format('DD/MM/YYYY');
      const bookingTime = booking.jam_booking || booking.startTime;

      const message = `✅ BOOKING DIKONFIRMASI
DIAZ SPORT CENTER

Halo ${user.name}! 🎉

Booking Anda telah DIKONFIRMASI:
📍 ${fieldName}
📅 ${bookingDate}
⏰ ${bookingTime}
🆔 ${booking.bookingId}

Status: CONFIRMED ✅

📝 Catatan Penting:
• Datang 15 menit sebelum jadwal
• Bawa sepatu olahraga
• Patuhi protokol kesehatan

Selamat bermain! 🏟️⚽

---
DIAZ SPORT CENTER
"Your Sports, Our Priority"`;

      const result = await sendSMS(formattedPhone, message);

      if (result.success) {
        logger.info('Booking confirmation sent:', {
          messageSid: result.messageSid,
          to: formattedPhone,
          bookingId: booking.bookingId
        });

        return {
          success: true,
          messageSid: result.messageSid,
          status: result.status
        };
      } else {
        throw new Error(result.error || 'Failed to send confirmation');
      }

    } catch (error) {
      logger.error('Booking confirmation SMS failed:', {
        error: error.message,
        bookingId: booking.bookingId
      });

      throw error;
    }
  }

  // ✅ ENHANCED: sendPreparationReminder
  static async sendPreparationReminder(booking, user) {
    try {
      const formattedPhone = formatPhoneNumber(user.phone || user.phoneNumber);
      
      if (!formattedPhone) {
        throw new Error(`Nomor telepon tidak valid: ${user.phone || user.phoneNumber}`);
      }

      const fieldName = booking.lapangan?.nama || booking.fieldId?.name || 'Lapangan';
      const bookingTime = booking.jam_booking || booking.startTime;

      const message = `⏰ PENGINGAT BERMAIN
DIAZ SPORT CENTER

Halo ${user.name}! 

🚨 Booking Anda 1 jam lagi!
📍 ${fieldName}
⏰ ${bookingTime}
🆔 ${booking.bookingId}

Bersiap-siaplah! 🏃‍♂️⚽

Sampai jumpa di lapangan! 🏟️

---
DIAZ SPORT CENTER`;

      const result = await sendSMS(formattedPhone, message);

      if (result.success) {
        logger.info('Preparation reminder sent:', {
          messageSid: result.messageSid,
          to: formattedPhone,
          bookingId: booking.bookingId
        });

        return result;
      } else {
        throw new Error(result.error || 'Failed to send reminder');
      }

    } catch (error) {
      logger.error('Preparation reminder SMS failed:', error);
      throw error;
    }
  }
}

export default NotificationService;