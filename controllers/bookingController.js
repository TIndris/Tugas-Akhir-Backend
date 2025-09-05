import BookingService from '../services/bookingService.js';
import BookingAnalyticsService from '../services/bookingAnalyticsService.js';
import BookingStatusService from '../services/bookingStatusService.js';
import CacheService from '../services/cacheService.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js'; // Assuming the Booking model is in models/Booking.js


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
    const userRole = req.user.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id)
      .populate('userId', 'name email phone')
      .populate('lapanganId', 'nama harga gambar');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const isOwner = booking.userId._id.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    if (!isOwner && !isCashierOrAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke booking ini'
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Detail booking berhasil diambil',
      data: {
        booking: {
          id: booking._id,
          userId: booking.userId,
          lapanganId: booking.lapanganId,
          tanggalBooking: booking.tanggalBooking,
          jamBooking: booking.jamBooking,
          durasi: booking.durasi,
          totalHarga: booking.totalHarga,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          catatan: booking.catatan,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt
        }
      }
    });

  } catch (error) {
    logger.error('Get booking by ID error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      userRole: req.user?.role
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil detail booking'
    });
  }
};


export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    let updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // Authorization check
    const isOwner = booking.user_id.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    if (!isOwner && !isCashierOrAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk mengubah booking ini'
      });
    }

    // Restrict certain fields based on role
    if (userRole === 'customer') {
      const allowedFields = ['catatan'];
      const filteredData = {};
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });
      updateData = filteredData;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('user_id', 'name email phone')
     .populate('lapangan_id', 'nama_lapangan harga_per_jam');

    logger.info('Booking updated', {
      bookingId: id,
      updatedBy: userId,
      userRole,
      action: 'UPDATE_BOOKING'
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil diperbarui',
      data: {
        booking: updatedBooking.toJSON()
      }
    });

  } catch (error) {
    logger.error('Update booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui booking'
    });
  }
};


export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // Authorization check
    const isOwner = booking.user_id.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    if (!isOwner && !isCashierOrAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk menghapus booking ini'
      });
    }

    // Check if booking can be deleted (not completed or paid)
    if (booking.status === 'completed') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking yang sudah selesai tidak dapat dihapus'
      });
    }

    await Booking.findByIdAndDelete(id);

    logger.info('Booking deleted', {
      bookingId: id,
      deletedBy: userId,
      userRole,
      action: 'DELETE_BOOKING'
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dihapus'
    });

  } catch (error) {
    logger.error('Delete booking error:', error);
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