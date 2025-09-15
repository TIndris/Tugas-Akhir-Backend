import cron from 'node-cron';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import NotificationService from './notificationService.js';
import logger from '../config/logger.js';
import moment from 'moment-timezone';

class SchedulerService {
  
  static init() {
    // Check every minute for preparation reminders (1 hour before booking)
    cron.schedule('* * * * *', this.checkPreparationReminders, {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });

    // Check every minute for expired bookings (payment timeout)
    cron.schedule('* * * * *', this.checkExpiredBookings, {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });

    logger.info('Scheduler service initialized');
  }

  // Check for bookings that need preparation reminder (1 hour before)
  static async checkPreparationReminders() {
    try {
      const now = moment().tz('Asia/Jakarta');
      const oneHourLater = now.clone().add(1, 'hour');
      
      // Find bookings that start in 1 hour and haven't been reminded
      const bookings = await Booking.find({
        status: 'confirmed',
        date: oneHourLater.format('YYYY-MM-DD'),
        startTime: oneHourLater.format('HH:mm'),
        preparationReminderSent: { $ne: true }
      }).populate('userId fieldId');

      for (const booking of bookings) {
        if (booking.userId && booking.userId.phoneNumber) {
          await NotificationService.sendPreparationReminder(booking, booking.userId);
          
          // Mark as reminded
          booking.preparationReminderSent = true;
          await booking.save();
        }
      }

      if (bookings.length > 0) {
        logger.info(`Sent ${bookings.length} preparation reminder(s)`);
      }

    } catch (error) {
      logger.error('Error in checkPreparationReminders:', error);
    }
  }

  // Check for expired bookings (not paid within 10 minutes)
  static async checkExpiredBookings() {
    try {
      const tenMinutesAgo = moment().tz('Asia/Jakarta').subtract(10, 'minutes').toDate();
      
      // Find pending bookings older than 10 minutes
      const expiredBookings = await Booking.find({
        status: 'pending',
        createdAt: { $lt: tenMinutesAgo }
      }).populate('userId fieldId');

      for (const booking of expiredBookings) {
        // Update status to expired
        booking.status = 'expired';
        booking.expiredAt = new Date();
        await booking.save();

        logger.info('Booking expired due to payment timeout:', {
          bookingId: booking.bookingId,
          userId: booking.userId?._id,
          createdAt: booking.createdAt
        });

        // Optional: Send expiration notification
        if (booking.userId?.phoneNumber) {
          await this.sendExpirationNotification(booking, booking.userId);
        }
      }

      if (expiredBookings.length > 0) {
        logger.info(`Expired ${expiredBookings.length} booking(s) due to payment timeout`);
      }

    } catch (error) {
      logger.error('Error in checkExpiredBookings:', error);
    }
  }

  // Send expiration notification
  static async sendExpirationNotification(booking, user) {
    try {
      const phoneNumber = formatPhoneNumber(user.phoneNumber);
      const bookingDate = moment(booking.date).tz('Asia/Jakarta').format('DD/MM/YYYY');
      const timeSlot = `${booking.startTime} - ${booking.endTime}`;

      const message = `🏟️ DIAZ SPORT CENTER

⚠️ BOOKING EXPIRED

📋 Detail Booking:
• ID: ${booking.bookingId}
• Lapangan: ${booking.fieldId?.name || 'N/A'}
• Tanggal: ${bookingDate}
• Waktu: ${timeSlot}

Booking Anda telah expired karena pembayaran tidak dilakukan dalam 10 menit.

Silakan buat booking baru jika masih ingin bermain.

Terima kasih! 🙏`;

      await sendSMS(phoneNumber, message);

    } catch (error) {
      logger.error('Error sending expiration notification:', error);
    }
  }
}

export default SchedulerService;