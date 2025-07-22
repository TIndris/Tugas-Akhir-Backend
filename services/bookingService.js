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
      // Strict parameter validation
      if (!mongoose.Types.ObjectId.isValid(lapanganId)) {
        throw new Error(`Invalid lapanganId: ${lapanganId}`);
      }

      const durasiInt = parseInt(durasi);
      if (isNaN(durasiInt) || durasiInt <= 0) {
        throw new Error(`Invalid durasi: ${durasi}`);
      }

      if (excludeBookingId && !mongoose.Types.ObjectId.isValid(excludeBookingId)) {
        throw new Error(`Invalid excludeBookingId: ${excludeBookingId}`);
      }

      // Time range calculation
      const newBookingStartHour = parseInt(jamBooking.split(':')[0]);
      const newBookingEndHour = newBookingStartHour + durasiInt;
      
      // ✅ NORMALIZE: Date consistency
      const searchDate = new Date(tanggalBooking);
      searchDate.setUTCHours(0, 0, 0, 0);
      
      // Build filter with explicit ObjectId
      const filter = {
        lapangan: new mongoose.Types.ObjectId(lapanganId),
        tanggal_booking: searchDate,
        status_pemesanan: { $in: ['pending', 'confirmed'] }
      };
      
      if (excludeBookingId) {
        filter._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) };
      }

      const existingBookings = await Booking.find(filter);
      
      // Overlap detection
      for (const booking of existingBookings) {
        const existingStartHour = parseInt(booking.jam_booking.split(':')[0]);
        const existingEndHour = existingStartHour + booking.durasi;
        
        // ✅ OVERLAP LOGIC: (Start1 < End2) AND (End1 > Start2)
        const hasOverlap = (newBookingStartHour < existingEndHour) && (newBookingEndHour > existingStartHour);
        
        if (hasOverlap) {
          return false; // Overlap detected
        }
      }
      
      return true; // No overlap
    
    } catch (error) {
      logger.error('Slot availability check error:', error);
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
    
    // Validate field exists and available
    const field = await this.validateFieldForBooking(lapanganId);
    
    // ✅ DOUBLE CHECK: Availability via service (backup check)
    const isAvailable = await this.checkSlotAvailability(
      lapanganId, 
      tanggalBooking, 
      jamBooking, 
      durasi
    );
    
    if (!isAvailable) {
      throw new Error('Slot waktu tidak tersedia atau bertabrakan dengan booking lain');
    }
    
    // Calculate price
    const totalHarga = this.calculateBookingPrice(field, durasi);
    
    // ✅ NORMALIZE: Date untuk consistency
    const normalizedDate = new Date(tanggalBooking);
    normalizedDate.setUTCHours(0, 0, 0, 0);
    
    // Create booking with normalized date
    const booking = await Booking.create({
      pelanggan: userId,
      lapangan: lapanganId,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking: normalizedDate, // ✅ Use normalized date
      jam_booking: jamBooking,
      durasi: parseInt(durasi), // ✅ Ensure integer
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

  // ✅ NEW: Complete booking creation dengan full validation dan overlap check
  static async createBookingWithFullValidation(bookingData) {
    const { userId, lapanganId, tanggalBooking, jamBooking, durasi } = bookingData;
    
    // 1. Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(lapanganId)) {
      throw new Error('Format ID lapangan tidak valid');
    }

    // 2. Validate durasi
    const durasiInt = parseInt(durasi);
    if (isNaN(durasiInt) || durasiInt <= 0 || durasiInt > 8) {
      throw new Error('Durasi harus berupa angka positif antara 1-8 jam');
    }

    // 3. Manual overlap check
    const isAvailable = await this.checkManualOverlap(lapanganId, tanggalBooking, jamBooking, durasiInt);
    
    if (!isAvailable.available) {
      const error = new Error('Slot waktu tidak tersedia atau bertabrakan dengan booking lain');
      error.conflictDetails = isAvailable.conflictDetails;
      error.errorCode = 'SLOT_CONFLICT';
      throw error;
    }

    // 4. Create booking via existing service
    const result = await this.createBooking({
      userId,
      lapanganId,
      tanggalBooking,
      jamBooking,
      durasi: durasiInt
    });

    return result.booking;
  }

  // ✅ NEW: Manual overlap check dengan detailed conflict info
  static async checkManualOverlap(lapanganId, tanggalBooking, jamBooking, durasi) {
    try {
      const newStart = parseInt(jamBooking.split(':')[0]);
      const newEnd = newStart + durasi;
      
      // Normalize date
      const bookingDate = new Date(tanggalBooking);
      bookingDate.setUTCHours(0, 0, 0, 0);
      
      const existingBookings = await Booking.find({
        lapangan: new mongoose.Types.ObjectId(lapanganId),
        tanggal_booking: bookingDate,
        status_pemesanan: { $in: ['pending', 'confirmed'] }
      });
      
      // Check for overlaps
      for (const existing of existingBookings) {
        const existingStart = parseInt(existing.jam_booking.split(':')[0]);
        const existingEnd = existingStart + existing.durasi;
        
        const hasOverlap = (newStart < existingEnd) && (newEnd > existingStart);
        
        if (hasOverlap) {
          return {
            available: false,
            conflictDetails: {
              new_booking: {
                time_range: `${newStart}:00 - ${newEnd}:00`,
                date: tanggalBooking
              },
              conflicting_booking: {
                id: existing._id,
                time_range: `${existingStart}:00 - ${existingEnd}:00`,
                status: existing.status_pemesanan,
                customer: existing.pelanggan
              },
              total_existing_bookings: existingBookings.length
            }
          };
        }
      }
      
      return { available: true };
      
    } catch (error) {
      logger.error('Error in manual overlap check:', error);
      throw error;
    }
  }

  // ✅ NEW: Get user bookings dengan cache handling
  static async getUserBookingsWithCache(userId) {
    try {
      // Import CacheService
      const { default: CacheService } = await import('./cacheService.js');
      
      // Try cache first
      const cachedBookings = await CacheService.getBookingsFromCache(userId);
      if (cachedBookings) {
        return { bookings: cachedBookings, fromCache: true };
      }

      // Get from database
      const bookings = await Booking.find({ pelanggan: userId })
        .populate('lapangan', 'jenis_lapangan nama')
        .populate('kasir', 'name');

      // Cache result
      await CacheService.setBookingsCache(userId, bookings, 180);

      return { bookings, fromCache: false };

    } catch (error) {
      logger.error('Error getting user bookings with cache:', error);
      throw error;
    }
  }

  // ✅ NEW: Delete booking dengan payment check
  static async deleteBookingWithPaymentCheck(bookingId, userId) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        pelanggan: userId
      }).populate('lapangan');

      if (!booking) {
        throw new Error('Booking tidak ditemukan');
      }

      // Validate cancellation
      await this.validateBookingCancellation(booking);

      // Check for payments
      let hasPayments = false;
      try {
        const { default: Payment } = await import('../models/Payment.js');
        const payments = await Payment.find({ booking: bookingId });
        hasPayments = payments.length > 0;
      } catch (importError) {
        logger.warn('Payment model import error:', importError.message);
      }

      // Handle deletion or cancellation
      if (hasPayments && booking.status_pemesanan !== 'pending') {
        booking.status_pemesanan = 'cancelled';
        booking.cancelled_at = new Date();
        booking.cancellation_reason = 'Dibatalkan oleh customer';
        await booking.save();
        return { booking, action: 'cancelled' };
      } else {
        await Booking.findByIdAndDelete(bookingId);
        return { booking, action: 'deleted' };
      }

    } catch (error) {
      logger.error('Error deleting booking:', error);
      throw error;
    }
  }

  // ✅ NEW: Update booking dengan full validation
  static async updateBookingWithValidation(bookingId, userId, updateData) {
    try {
      // Validate and get booking
      const booking = await this.validateBookingUpdate(bookingId, userId, updateData);
      
      // Apply updates
      const { tanggal_booking, jam_booking, durasi, catatan } = updateData;
      
      if (tanggal_booking) booking.tanggal_booking = new Date(tanggal_booking);
      if (jam_booking) booking.jam_booking = jam_booking;
      if (durasi) {
        booking.durasi = durasi;
        booking.harga = this.calculateBookingPrice(booking.lapangan, durasi);
      }
      if (catatan !== undefined) booking.catatan = catatan;

      await booking.save();
      
      return booking;

    } catch (error) {
      logger.error('Error updating booking with validation:', error);
      throw error;
    }
  }
}

export default BookingService;