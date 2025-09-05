import BookingService from '../services/bookingService.js';
import BookingAnalyticsService from '../services/bookingAnalyticsService.js';
import BookingStatusService from '../services/bookingStatusService.js';
import CacheService from '../services/cacheService.js';
import logger from '../config/logger.js';


export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;
    
    // Basic HTTP validation only
    if (!lapangan_id || !tanggal_booking || !jam_booking || !durasi) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field harus diisi'
      });
    }

    // Delegate ALL logic to service
    const booking = await BookingService.createBookingWithFullValidation({
      userId: req.user._id,
      lapanganId: lapangan_id,
      tanggalBooking: tanggal_booking,
      jamBooking: jam_booking,
      durasi
    });

    // Cache invalidation
    await CacheService.invalidateBookingCache(req.user._id, lapangan_id, tanggal_booking);

    // Logging
    logger.info(`Booking created: ${booking._id}`, {
      user: req.user._id,
      field: lapangan_id,
      timeSlot: `${jam_booking} (${durasi}h)`,
      action: 'CREATE_BOOKING'
    });

    res.status(201).json({
      status: 'success',
      message: 'Booking berhasil dibuat',
      data: { booking }
    });

  } catch (error) {
    logger.error(`Booking creation error: ${error.message}`, {
      user: req.user._id,
      requestBody: req.body,
      stack: error.stack
    });
    
    // Handle specific error types
    if (error.errorCode === 'SLOT_CONFLICT') {
      return res.status(409).json({
        status: 'error',
        message: error.message,
        error_code: error.errorCode,
        debug_info: error.conflictDetails
      });
    }
    
    if (error.message.includes('Cast to ObjectId failed')) {
      return res.status(400).json({
        status: 'error',
        message: 'ID lapangan tidak valid',
        error_code: 'INVALID_OBJECT_ID'
      });
    }
    
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};


export const getAvailability = async (req, res) => {
  try {
    const { lapangan, tanggal, jam, durasi } = req.query;
    
    if (!lapangan || !tanggal || !jam) {
      return res.status(400).json({
        status: 'error',
        message: 'Parameter lapangan, tanggal, jam, dan durasi harus diisi'
      });
    }

    const field = await BookingService.validateFieldForBooking(lapangan);
    const isAvailable = await BookingService.checkSlotAvailability(
      lapangan, 
      tanggal, 
      jam,
      durasi || 1
    );

    res.status(200).json({
      status: 'success',
      message: isAvailable ? 'Slot tersedia' : 'Slot sudah dibooking atau bertabrakan',
      data: {
        is_available: isAvailable,
        field: {
          id: field._id,
          name: field.nama,
          type: field.jenis_lapangan,
          price: field.harga,
          status: field.status
        },
        slot: {
          date: tanggal,
          time: jam,
          duration: durasi || 1
        }
      }
    });

  } catch (error) {
    logger.error(`Availability check error: ${error.message}`, {
      params: req.query,
      stack: error.stack
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};


export const checkAvailability = getAvailability;


export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const { bookings, fromCache } = await BookingService.getUserBookingsWithCache(userId);

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings },
      cached: fromCache
    });

  } catch (error) {
    logger.error(`Get user bookings error: ${error.message}`, {
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};

export const getUserBookings = getMyBookings;


export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await BookingService.getBookingByIdForUser(id, userId);

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil diambil',
      data: { booking }
    });

  } catch (error) {
    logger.error(`Get booking by ID error: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user._id,
      stack: error.stack
    });
    
    const statusCode = error.message.includes('tidak ditemukan') ? 404 : 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message
    });
  }
};


export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await BookingService.updateBookingWithValidation(id, userId, req.body);

  
    await CacheService.invalidateBookingCache(userId, booking.lapangan._id, booking.tanggal_booking);

    logger.info(`Booking updated: ${booking._id}`, {
      user: userId,
      changes: req.body
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil diperbarui',
      data: { booking }
    });

  } catch (error) {
    logger.error(`Update booking error: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};


export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const { booking, action } = await BookingService.deleteBookingWithPaymentCheck(id, userId);


    await CacheService.invalidateBookingCache(userId, booking.lapangan._id, booking.tanggal_booking);

    logger.info(`Booking ${action}: ${booking._id}`, {
      user: userId,
      reason: 'Customer cancellation'
    });

    res.status(200).json({
      status: 'success',
      message: `Booking berhasil ${action === 'cancelled' ? 'dibatalkan' : 'dihapus'}`,
      data: { booking }
    });

  } catch (error) {
    logger.error(`Delete booking error: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus booking'
    });
  }
};


export const getBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const statusData = await BookingStatusService.getBookingStatusDetail(id, userId);

    res.status(200).json({
      status: 'success',
      message: 'Status booking berhasil diambil',
      data: statusData
    });

  } catch (error) {
    logger.error(`Get booking status error: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil status booking'
    });
  }
};


export const getBookingStatusSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const summaryData = await BookingAnalyticsService.getBookingStatusSummary(userId);

    res.status(200).json({
      status: 'success',
      message: 'Ringkasan status booking berhasil diambil',
      data: summaryData
    });

  } catch (error) {
    logger.error(`Get booking status summary error: ${error.message}`, {
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil ringkasan status'
    });
  }
};


export const getAllBookingsForCashier = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      payment_status: req.query.payment_status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      field_type: req.query.field_type
    };

    const data = await BookingAnalyticsService.getAllBookingsForCashier(filters);

    // Log activity
    logger.info(`Kasir ${req.user.email} viewed all bookings`, {
      role: req.user.role,
      filters: filters,
      search_term: filters.search || 'none',
      total_results: data.bookings.length,
      action: 'VIEW_ALL_BOOKINGS'
    });

    res.status(200).json({
      status: 'success',
      message: 'Data booking berhasil diambil',
      data
    });

  } catch (error) {
    logger.error(`Error getting all bookings for kasir: ${error.message}`, {
      userId: req.user._id,
      role: req.user.role,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};


export const getAllBookings = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      payment_status: req.query.payment_status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      field_type: req.query.field_type
    };

    const bookings = await BookingAnalyticsService.getAllBookingsForAdmin(filters);

    logger.info(`Admin ${req.user.email} viewed all bookings`, {
      role: req.user.role,
      filters: filters,
      search_term: filters.search || 'none',
      total_results: bookings.length,
      action: 'ADMIN_VIEW_ALL_BOOKINGS'
    });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });

  } catch (error) {
    logger.error(`Admin get all bookings error: ${error.message}`, {
      userId: req.user._id,
      role: req.user.role,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};


export const getBookings = getAllBookings;
export const getCashierBookings = getAllBookingsForCashier;