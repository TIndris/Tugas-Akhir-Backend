import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import moment from 'moment-timezone';
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

  static async validateFieldForBooking(lapanganId) {
    const field = await Field.findById(lapanganId).lean();
    
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }
    
    if (field.status !== 'tersedia') {
      throw new Error(`Lapangan sedang ${field.status}`);
    }
    
    if (!field.jenis_lapangan) {
      throw new Error('Jenis lapangan tidak valid');
    }
    
    return field;
  }
  
  // ✅ MOVE: Operating hours validation from controller
  static validateOperatingHours(field, jamBooking, durasi) {
    const bookingHour = parseInt(jamBooking.split(':')[0]);
    const closeHour = parseInt(field.jam_tutup.split(':')[0]);
    const openHour = parseInt(field.jam_buka.split(':')[0]);

    if (bookingHour >= closeHour || bookingHour < openHour) {
      throw new Error(`Jam booking harus antara ${field.jam_buka} - ${field.jam_tutup}`);
    }

    if (bookingHour + durasi > closeHour) {
      throw new Error(`Durasi melebihi jam tutup lapangan (${field.jam_tutup})`);
    }
  }
  
  // ✅ MOVE: Availability check from controller
  static async checkSlotAvailability(lapanganId, tanggalBooking, jamBooking, excludeBookingId = null) {
    const filter = {
      lapangan: lapanganId,
      tanggal_booking: tanggalBooking,
      jam_booking: jamBooking,
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    };
    
    if (excludeBookingId) {
      filter._id = { $ne: excludeBookingId };
    }
    
    const existingBooking = await Booking.findOne(filter);
    return !existingBooking;
  }
  
  // ✅ MOVE: Price calculation from controller
  static calculateBookingPrice(field, durasi) {
    return field.harga * durasi;
  }
  
  // ✅ MOVE: Complete booking creation logic
  static async createBooking(bookingData) {
    const { userId, lapanganId, tanggalBooking, jamBooking, durasi } = bookingData;
    
    // Validate field
    const field = await this.validateFieldForBooking(lapanganId);
    
    // Validate operating hours
    this.validateOperatingHours(field, jamBooking, durasi);
    
    // Check availability
    const isAvailable = await this.checkSlotAvailability(lapanganId, tanggalBooking, jamBooking);
    if (!isAvailable) {
      throw new Error('Slot waktu tidak tersedia');
    }
    
    // Calculate price
    const totalHarga = this.calculateBookingPrice(field, durasi);
    
    // Create booking
    const booking = await Booking.create({
      pelanggan: userId,
      lapangan: lapanganId,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking: tanggalBooking,
      jam_booking: jamBooking,
      durasi,
      harga: totalHarga
    });
    
    return { booking, field };
  }
  
  // ✅ MOVE: Booking update validation
  static async validateBookingUpdate(bookingId, userId, updateData) {
    const booking = await Booking.findOne({
      _id: bookingId,
      pelanggan: userId
    }).populate('lapangan');

    if (!booking) {
      throw new Error('Booking tidak ditemukan');
    }

    if (booking.status_pemesanan !== 'pending') {
      throw new Error('Booking yang sudah dikonfirmasi tidak dapat diubah');
    }

    return booking;
  }
  
  // ✅ MOVE: Cancellation validation
  static async validateBookingCancellation(booking) {
    if (booking.status_pemesanan === 'confirmed') {
      const bookingDateTime = new Date(`${booking.tanggal_booking}T${booking.jam_booking}`);
      const now = new Date();
      const hoursDiff = (bookingDateTime - now) / (1000 * 60 * 60);

      if (hoursDiff < 24) {
        throw new Error('Booking terkonfirmasi hanya bisa dibatalkan minimal 24 jam sebelum jadwal');
      }
    }
  }
}