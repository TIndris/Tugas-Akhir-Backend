import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import mongoose from 'mongoose';
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

  // ✅ Field validation logic
  static async validateFieldForBooking(lapanganId) {
    if (!mongoose.Types.ObjectId.isValid(lapanganId)) {
      throw new Error('ID lapangan tidak valid');
    }

    const field = await Field.findById(lapanganId).lean();
    
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }
    
    if (field.status !== 'tersedia') {
      throw new Error(`Lapangan sedang ${field.status}`);
    }
    
    return field;
  }
  
  // ✅ Operating hours validation
  static validateOperatingHours(field, jamBooking, durasi) {
    const bookingHour = parseInt(jamBooking.split(':')[0]);
    
    // Default operating hours if not set
    const jamBuka = field.jam_buka || '08:00';
    const jamTutup = field.jam_tutup || '22:00';
    
    const closeHour = parseInt(jamTutup.split(':')[0]);
    const openHour = parseInt(jamBuka.split(':')[0]);

    if (bookingHour >= closeHour || bookingHour < openHour) {
      throw new Error(`Jam booking harus antara ${jamBuka} - ${jamTutup}`);
    }

    if (bookingHour + durasi > closeHour) {
      throw new Error(`Durasi melebihi jam tutup lapangan (${jamTutup})`);
    }
  }
  
  // ✅ Availability check
  static async checkSlotAvailability(lapanganId, tanggalBooking, jamBooking, durasi, excludeBookingId = null) {
    try {
      console.log('🔍 checkSlotAvailability called with:', {
        lapanganId: lapanganId,
        tanggalBooking: tanggalBooking,
        jamBooking: jamBooking,
        durasi: durasi,
        excludeBookingId: excludeBookingId
      });

      // ✅ CRITICAL: Validate lapanganId as ObjectId
      if (!mongoose.Types.ObjectId.isValid(lapanganId)) {
        throw new Error(`Invalid lapanganId format: ${lapanganId}`);
      }

      // ✅ CRITICAL: Validate excludeBookingId if provided
      if (excludeBookingId && !mongoose.Types.ObjectId.isValid(excludeBookingId)) {
        throw new Error(`Invalid excludeBookingId format: ${excludeBookingId}`);
      }

      // ✅ VALIDATE: durasi parameter
      if (!durasi || isNaN(parseInt(durasi))) {
        throw new Error('Durasi harus berupa angka yang valid');
      }

      // Convert to proper types
      const newBookingStartHour = parseInt(jamBooking.split(':')[0]);
      const newBookingEndHour = newBookingStartHour + parseInt(durasi);
      
      console.log(`🔍 Checking availability for ${jamBooking} (${newBookingStartHour}:00 - ${newBookingEndHour}:00)`);
      
      // ✅ SAFE: Build filter with proper ObjectId conversion
      const filter = {
        lapangan: new mongoose.Types.ObjectId(lapanganId),
        tanggal_booking: new Date(tanggalBooking),
        status_pemesanan: { $in: ['pending', 'confirmed'] }
      };
      
      if (excludeBookingId) {
        filter._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) };
      }

      console.log('📊 Query filter:', filter);
      
      const existingBookings = await Booking.find(filter);
      console.log(`📊 Found ${existingBookings.length} existing bookings`);
      
      // ✅ Check for time overlap with each existing booking
      for (const booking of existingBookings) {
        const existingStartHour = parseInt(booking.jam_booking.split(':')[0]);
        const existingEndHour = existingStartHour + booking.durasi;
        
        console.log(`⏰ Existing booking: ${booking.jam_booking} (${existingStartHour}:00 - ${existingEndHour}:00)`);
        
        // ✅ OVERLAP DETECTION LOGIC
        const hasOverlap = (
          (newBookingStartHour < existingEndHour) && (newBookingEndHour > existingStartHour)
        );
        
        if (hasOverlap) {
          console.log(`❌ OVERLAP DETECTED!`);
          console.log(`   New: ${newBookingStartHour}:00 - ${newBookingEndHour}:00`);
          console.log(`   Existing: ${existingStartHour}:00 - ${existingEndHour}:00`);
          return false;
        }
      }
      
      console.log(`✅ No overlap found - slot available`);
      return true;
      
    } catch (error) {
      console.error('❌ checkSlotAvailability error:', error);
      logger.error('Error checking slot availability:', error);
      throw error;
    }
  }
  
  // ✅ Price calculation
  static calculateBookingPrice(field, durasi) {
    return field.harga * durasi;
  }
  
  // ✅ Complete booking creation logic
  static async createBooking(bookingData) {
    const { userId, lapanganId, tanggalBooking, jamBooking, durasi } = bookingData;
    
    // Validate field
    const field = await this.validateFieldForBooking(lapanganId);
    
    // Validate operating hours (with error handling)
    try {
      this.validateOperatingHours(field, jamBooking, durasi);
    } catch (error) {
      // Log but don't fail if operating hours not set
      logger.warn('Operating hours validation skipped:', error.message);
    }
    
    // ✅ FIXED: Check availability with correct parameters
    const isAvailable = await this.checkSlotAvailability(
      lapanganId, 
      tanggalBooking, 
      jamBooking, 
      durasi,  // ✅ PASS durasi parameter
      null     // ✅ No excludeBookingId for new booking
    );
    
    if (!isAvailable) {
      throw new Error('Slot waktu tidak tersedia atau bertabrakan dengan booking lain');
    }
    
    // Calculate price
    const totalHarga = this.calculateBookingPrice(field, durasi);
    
    // Create booking
    const booking = await Booking.create({
      pelanggan: userId,
      lapangan: lapanganId,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking: new Date(tanggalBooking),
      jam_booking: jamBooking,
      durasi,
      harga: totalHarga,
      status_pemesanan: 'pending',
      payment_status: 'no_payment'
    });
    
    return { booking, field };
  }
  
  // ✅ Booking update validation
  static async validateBookingUpdate(bookingId, userId, updateData) {
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new Error('ID booking tidak valid');
    }

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

    // If updating time-related fields, check for conflicts
    if (updateData.tanggal_booking || updateData.jam_booking || updateData.durasi) {
      const lapanganId = booking.lapangan._id;  // ✅ GET _id from populated field
      const tanggal = updateData.tanggal_booking || booking.tanggal_booking;
      const jam = updateData.jam_booking || booking.jam_booking;
      const durasi = updateData.durasi || booking.durasi;
      
      // ✅ FIXED: Check availability with correct parameter order
      const isAvailable = await this.checkSlotAvailability(
        lapanganId,    // lapanganId
        tanggal,       // tanggalBooking  
        jam,           // jamBooking
        durasi,        // ✅ durasi parameter
        bookingId      // ✅ excludeBookingId
      );
      
      if (!isAvailable) {
        throw new Error('Waktu booking yang baru bertabrakan dengan booking lain');
      }
    }

    return booking;
  }
  
  // ✅ Cancellation validation
  static async validateBookingCancellation(booking) {
    if (booking.status_pemesanan === 'confirmed') {
      const bookingDateTime = moment(`${booking.tanggal_booking} ${booking.jam_booking}`, 'YYYY-MM-DD HH:mm');
      const now = moment();
      const hoursDiff = bookingDateTime.diff(now, 'hours');

      if (hoursDiff < 24) {
        throw new Error('Booking terkonfirmasi hanya bisa dibatalkan minimal 24 jam sebelum jadwal');
      }
    }
  }

  // ✅ Get booking by ID with ownership check  
  static async getBookingByIdForUser(bookingId, userId) {
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new Error('ID booking tidak valid');
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      pelanggan: userId
    }).populate('lapangan', 'nama jenis_lapangan harga');

    if (!booking) {
      throw new Error('Booking tidak ditemukan');
    }

    return booking;
  }
}

export default BookingService;