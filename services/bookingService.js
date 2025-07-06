import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../config/logger.js';

export class BookingService {
  
  // ============= CONSTANTS =============
  static BOOKING_STATUSES = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed'
  };

  static PAYMENT_STATUSES = {
    NO_PAYMENT: 'no_payment',
    PENDING_PAYMENT: 'pending_payment',
    DP_CONFIRMED: 'dp_confirmed',
    FULLY_PAID: 'fully_paid'
  };

  // ============= VALIDATION METHODS =============
  static validateBookingTime(fieldId, bookingDate, bookingTime, duration) {
    return Field.findById(fieldId).then(field => {
      if (!field) {
        throw new Error('Lapangan tidak ditemukan');
      }

      // ✅ TAMBAHKAN: Validasi status lapangan
      if (field.status !== 'tersedia') {
        throw new Error(`Lapangan sedang ${field.status} dan tidak dapat dibooking`);
      }

      const bookingHour = parseInt(bookingTime.split(':')[0]);
      const closeHour = parseInt(field.jam_tutup.split(':')[0]);
      const openHour = parseInt(field.jam_buka.split(':')[0]);

      if (bookingHour >= closeHour || bookingHour < openHour) {
        throw new Error(`Jam booking harus antara ${field.jam_buka} - ${field.jam_tutup}`);
      }

      if (bookingHour + duration > closeHour) {
        throw new Error(`Durasi melebihi jam tutup lapangan (${field.jam_tutup})`);
      }

      return field;
    });
  }

  // ============= BUSINESS LOGIC METHODS =============
  static async checkAvailability(fieldId, date, time) {
    return await Booking.checkAvailability(fieldId, date, time);
  }

  static async getBookedSlots(fieldId, date) {
    return await Booking.getBookedSlots(fieldId, date);
  }

  static calculatePrice(pricePerHour, duration) {
    return pricePerHour * duration;
  }

  static generateTimeSlots(openTime = '06:00', closeTime = '22:00') {
    const slots = [];
    const [openHour] = openTime.split(':').map(Number);
    const [closeHour] = closeTime.split(':').map(Number);

    for (let hour = openHour; hour < closeHour; hour++) {
      slots.push({
        time: `${hour.toString().padStart(2, '0')}:00`,
        display: `${hour.toString().padStart(2, '0')}:00 - ${(hour + 1).toString().padStart(2, '0')}:00`
      });
    }

    return slots;
  }

  // ============= CRUD OPERATIONS =============
  static async createBooking(bookingData) {
    const { userId, fieldId, date, time, duration } = bookingData;

    // Validate field and time
    const field = await this.validateBookingTime(fieldId, date, time, duration);

    // Check availability
    const isAvailable = await this.checkAvailability(fieldId, date, time);
    if (!isAvailable) {
      throw new Error('Slot waktu tidak tersedia');
    }

    // Calculate price
    const totalPrice = this.calculatePrice(field.harga, duration);

    // Create booking
    const booking = await Booking.create({
      pelanggan: userId,
      lapangan: fieldId,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking: date,
      jam_booking: time,
      durasi: duration,
      harga: totalPrice
    });

    logger.info(`Booking created: ${booking._id}`, {
      user: userId,
      field: fieldId,
      date,
      time,
      total: totalPrice
    });

    return booking;
  }

  static async getBookingsByUser(userId) {
    return await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name')
      .sort({ createdAt: -1 });
  }

  static async getAllBookings(filters = {}) {
    const query = {};
    if (filters.status) query.status_pemesanan = filters.status;
    if (filters.paymentStatus) query.payment_status = filters.paymentStatus;
    if (filters.date) query.tanggal_booking = filters.date;

    return await Booking.find(query)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name')
      .sort({ createdAt: -1 });
  }

  static async getBookingById(bookingId) {
    return await Booking.findById(bookingId)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');
  }

  // ============= AVAILABILITY METHODS =============
  static async getAvailableSlots(fieldId, date) {
    const field = await Field.findById(fieldId);
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }

    const allSlots = this.generateTimeSlots(field.jam_buka, field.jam_tutup);
    const bookedSlots = await this.getBookedSlots(fieldId, date);

    return allSlots.map(slot => {
      const isBooked = bookedSlots.some(booking => 
        booking.jam_booking === slot.time
      );

      return {
        time: slot.time,
        display: slot.display,
        isAvailable: !isBooked,
        price: field.harga
      };
    });
  }

  // ============= STATISTICS METHODS =============
  static async getBookingStatistics(startDate, endDate) {
    const match = {};
    if (startDate && endDate) {
      match.tanggal_booking = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const stats = await Booking.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status_pemesanan',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$harga' }
        }
      }
    ]);

    return stats;
  }

  // ============= CACHE METHODS =============
  static async clearBookingCache(userId) {
    try {
      if (client && client.isOpen) {
        await client.del(`bookings:${userId}`);
        // Clear availability caches that might be affected
        const keys = await client.keys('availability:*');
        if (keys.length > 0) {
          await client.del(keys);
        }
      }
    } catch (error) {
      logger.warn('Cache clear error:', error.message);
    }
  }
}