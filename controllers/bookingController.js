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

    // Log untuk debugging
    logger.info('Get booking by ID attempt', {
      bookingId: id,
      requestUserId: userId.toString(),
      userRole,
      action: 'GET_BOOKING_DETAIL'
    });

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

    // Debug booking data
    logger.info('Booking found for access check', {
      bookingId: id,
      bookingData: {
        pelanggan: booking.pelanggan?.toString() || 'null',
        kasir: booking.kasir?.toString() || 'null',
        status_pemesanan: booking.status_pemesanan,
        payment_status: booking.payment_status
      }
    });

    const bookingUserId = booking.pelanggan;
    
    // Enhanced authorization check dengan detailed logging
    const isOwner = bookingUserId && bookingUserId.toString() === userId.toString();
    const isCashierRole = userRole === 'kasir';
    const isAdminRole = userRole === 'admin';
    const isCashierOrAdmin = isCashierRole || isAdminRole;

    // Log detailed access check
    logger.info('Access control check', {
      bookingId: id,
      requestUserId: userId.toString(),
      bookingUserId: bookingUserId?.toString() || 'null',
      userRole,
      checks: {
        isOwner,
        isCashierRole,
        isAdminRole,
        isCashierOrAdmin
      }
    });

    // FIXED: Allow kasir and admin to access ALL bookings
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      logger.warn('Access denied to booking', {
        bookingId: id,
        requestUserId: userId.toString(),
        userRole,
        reason: 'Insufficient permissions'
      });
      
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke booking ini'
      });
    }

    // Manual populate dengan error handling yang lebih baik
    let populatedBooking = {};
    
    try {
      const User = mongoose.model('User');
      const Field = mongoose.model('Field');

      // Populate customer
      let user = null;
      if (bookingUserId) {
        user = await User.findById(bookingUserId).select('name email phone');
      }
      
      // Populate field
      let field = null;
      if (booking.lapangan) {
        field = await Field.findById(booking.lapangan).select('nama harga');
      }
      
      // Populate kasir if exists
      let kasir = null;
      if (booking.kasir) {
        kasir = await User.findById(booking.kasir).select('name email');
      }

      // Build response
      populatedBooking = {
        id: booking._id,
        customer: user ? {
          name: user.name || 'Unknown',
          email: user.email || 'Unknown',
          phone: user.phone || 'Unknown'
        } : {
          name: 'Data not available',
          email: 'Data not available',
          phone: 'Data not available'
        },
        field: field ? {
          name: field.nama || 'Unknown',
          price: field.harga || 0
        } : {
          name: 'Data not available',
          price: 0
        },
        kasir: kasir ? {
          name: kasir.name,
          email: kasir.email
        } : null,
        booking_details: {
          date: booking.tanggal_booking,
          time: booking.jam_booking,
          duration: booking.durasi,
          total_price: booking.harga
        },
        status: {
          booking: booking.status_pemesanan,
          payment: booking.payment_status
        },
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at
        }
      };

    } catch (populateError) {
      logger.error('Populate error in getBookingById', {
        error: populateError.message,
        bookingId: id,
        stack: populateError.stack
      });
      
      // Fallback response
      populatedBooking = {
        id: booking._id,
        customer: { 
          name: 'Data not available',
          email: 'Data not available', 
          phone: 'Data not available'
        },
        field: { 
          name: 'Data not available',
          price: 0
        },
        kasir: null,
        booking_details: {
          date: booking.tanggal_booking,
          time: booking.jam_booking,
          duration: booking.durasi,
          total_price: booking.harga
        },
        status: {
          booking: booking.status_pemesanan,
          payment: booking.payment_status
        },
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at
        }
      };
    }

    logger.info('Booking detail access successful', {
      bookingId: id,
      accessedBy: userId.toString(),
      userRole,
      accessType: isOwner ? 'owner' : 'staff'
    });

    res.status(200).json({
      status: 'success',
      message: 'Detail booking berhasil diambil',
      data: {
        booking: populatedBooking
      }
    });

  } catch (error) {
    logger.error('Get booking by ID error:', {
      error: error.message,
      stack: error.stack,
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

    // FIXED: Consistent authorization logic
    const bookingUserId = booking.pelanggan;
    
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    // FIXED: Kasir dan Admin bisa akses SEMUA booking
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
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

    // Add kasir assignment if kasir is updating and not assigned yet
    if (userRole === 'kasir' && !booking.kasir) {
      updateData.kasir = userId;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    logger.info('Booking updated', {
      bookingId: id,
      updatedBy: userId,
      userRole,
      kasirAssigned: !booking.kasir && userRole === 'kasir',
      action: 'UPDATE_BOOKING'
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil diperbarui',
      data: {
        booking: updatedBooking
      }
    });

  } catch (error) {
    logger.error('Update booking error:', {
      error: error.message,
      stack: error.stack,
      bookingId: req.params.id
    });
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

    // FIXED: Consistent authorization logic
    const bookingUserId = booking.pelanggan;
    
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    // FIXED: Kasir dan Admin bisa akses SEMUA booking
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk menghapus booking ini'
      });
    }

    // Check if booking can be deleted (not completed or paid)
    if (booking.status_pemesanan === 'completed') {
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
    logger.error('Delete booking error:', {
      error: error.message,
      stack: error.stack,
      bookingId: req.params.id
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

// Tambahkan di bookingController.js untuk debug schema
export const debugBookingSchema = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id);
    
    if (!booking) {
      return res.json({
        status: 'debug',
        message: 'Booking not found',
        bookingId: id
      });
    }

    const bookingObj = booking.toObject();
    
    res.json({
      status: 'debug',
      message: 'Booking schema analysis',
      data: {
        bookingId: id,
        availableFields: Object.keys(bookingObj),
        userField: {
          user_id: bookingObj.user_id || 'not found',
          userId: bookingObj.userId || 'not found'
        },
        fieldField: {
          lapangan_id: bookingObj.lapangan_id || 'not found',
          lapanganId: bookingObj.lapanganId || 'not found'
        },
        rawBooking: bookingObj
      }
    });

  } catch (error) {
    res.json({
      status: 'debug_error',
      message: error.message,
      stack: error.stack
    });
  }
};

// Add this to bookingController.js untuk debug access
export const debugBookingAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const booking = await Booking.findById(id);
    
    if (!booking) {
      return res.json({
        status: 'debug',
        message: 'Booking not found',
        bookingId: id,
        requestUser: {
          id: userId.toString(),
          role: userRole
        }
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId && bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'admin'].includes(userRole);

    res.json({
      status: 'debug',
      message: 'Booking access debug info',
      data: {
        bookingId: id,
        requestUser: {
          id: userId.toString(),
          role: userRole
        },
        booking: {
          pelanggan: bookingUserId?.toString() || 'null',
          kasir: booking.kasir?.toString() || 'null',
          status: booking.status_pemesanan,
          payment: booking.payment_status
        },
        accessCheck: {
          isOwner,
          isCashierRole: userRole === 'kasir',
          isAdminRole: userRole === 'admin', 
          isCashierOrAdmin,
          hasAccess: isOwner || isCashierOrAdmin
        }
      }
    });

  } catch (error) {
    res.json({
      status: 'debug_error',
      message: error.message,
      requestUser: {
        id: req.user?._id?.toString(),
        role: req.user?.role
      }
    });
  }
};