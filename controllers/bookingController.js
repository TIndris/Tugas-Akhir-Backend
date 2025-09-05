import BookingService from '../services/bookingService.js';
import BookingAnalyticsService from '../services/bookingAnalyticsService.js';
import BookingStatusService from '../services/bookingStatusService.js';
import CacheService from '../services/cacheService.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';

export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;
    
    if (!lapangan_id || !tanggal_booking || !jam_booking || !durasi) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field harus diisi'
      });
    }

    const booking = await BookingService.createBookingWithFullValidation({
      userId: req.user._id,
      lapanganId: lapangan_id,
      tanggalBooking: tanggal_booking,
      jamBooking: jam_booking,
      durasi
    });

    await CacheService.invalidateBookingCache(req.user._id, lapangan_id, tanggal_booking);

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

export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const bookings = await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'nama jenis_lapangan harga gambar jam_buka jam_tutup status')
      .sort({ createdAt: -1 })
      .lean();

    const formattedBookings = bookings.map(booking => ({
      ...booking,
      lapangan: {
        ...booking.lapangan,
        jamOperasional: booking.lapangan?.jam_buka && booking.lapangan?.jam_tutup 
          ? `${booking.lapangan.jam_buka} - ${booking.lapangan.jam_tutup}`
          : 'undefined - undefined'
      }
    }));

    const statusSummary = formattedBookings.reduce((acc, booking) => {
      const status = booking.status_pemesanan;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json({
      status: 'success',
      results: formattedBookings.length,
      data: { 
        bookings: formattedBookings,
        summary: {
          total_bookings: formattedBookings.length,
          by_status: statusSummary
        }
      },
      cached: false
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

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId && bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke booking ini'
      });
    }

    let populatedBooking = {};
    
    try {
      const User = mongoose.model('User');
      const Field = mongoose.model('Field');

      let user = null;
      if (bookingUserId) {
        user = await User.findById(bookingUserId).select('name email phone');
      }
      
      let field = null;
      if (booking.lapangan) {
        field = await Field.findById(booking.lapangan).select('nama harga');
      }
      
      let kasir = null;
      if (booking.kasir) {
        kasir = await User.findById(booking.kasir).select('name email');
      }

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

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk mengubah booking ini'
      });
    }

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

    if (['kasir', 'cashier'].includes(userRole) && !booking.kasir) {
      updateData.kasir = userId;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

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
      bookingId: req.params.id
    });
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui booking'
    });
  }
};

export const updateBookingByCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

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

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();

    if (!isOwner) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda hanya dapat mengubah booking sendiri'
      });
    }

    const canUpdateStatuses = ['pending', 'waiting_payment'];
    const canUpdatePaymentStatuses = ['no_payment', 'pending_verification'];

    if (!canUpdateStatuses.includes(booking.status_pemesanan)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat diubah karena sudah dikonfirmasi'
      });
    }

    if (!canUpdatePaymentStatuses.includes(booking.payment_status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat diubah karena pembayaran sudah diproses'
      });
    }

    const allowedFields = ['catatan', 'special_request', 'tanggal_booking', 'jam_booking', 'durasi'];
    const filteredData = {};
    
    const isRescheduling = updateData.tanggal_booking || updateData.jam_booking || updateData.durasi;
    
    if (isRescheduling) {
      const newDate = updateData.tanggal_booking || booking.tanggal_booking;
      const newTime = updateData.jam_booking || booking.jam_booking;
      const newDuration = updateData.durasi || booking.durasi;
      
      try {
        const isAvailable = await BookingService.checkSlotAvailability(
          booking.lapangan,
          newDate,
          newTime,
          newDuration,
          id
        );
        
        if (!isAvailable) {
          return res.status(409).json({
            status: 'error',
            message: 'Slot waktu yang dipilih sudah tidak tersedia',
            error_code: 'SLOT_CONFLICT'
          });
        }
      } catch (availabilityError) {
        return res.status(400).json({
          status: 'error',
          message: 'Gagal memvalidasi jadwal baru: ' + availabilityError.message
        });
      }
      
      if (updateData.durasi && updateData.durasi !== booking.durasi) {
        try {
          const Field = mongoose.model('Field');
          const field = await Field.findById(booking.lapangan);
          
          if (field) {
            filteredData.harga = field.harga * updateData.durasi;
          }
        } catch (priceError) {
          logger.warn('Price recalculation failed:', {
            error: priceError.message,
            bookingId: id
          });
        }
      }
    }
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada field yang dapat diubah atau data tidak valid'
      });
    }

    filteredData.updatedAt = new Date();
    if (isRescheduling) {
      filteredData.rescheduled_at = new Date();
      filteredData.rescheduled_by = userId;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      filteredData,
      { new: true, runValidators: true }
    );

    if (isRescheduling) {
      try {
        await CacheService.invalidateBookingCache(userId, booking.lapangan, booking.tanggal_booking);
        await CacheService.invalidateBookingCache(userId, booking.lapangan, filteredData.tanggal_booking || booking.tanggal_booking);
      } catch (cacheError) {
        logger.warn('Cache invalidation failed during reschedule', {
          error: cacheError.message,
          bookingId: id
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: isRescheduling ? 'Booking berhasil dijadwal ulang' : 'Booking berhasil diperbarui',
      data: {
        booking: {
          id: updatedBooking._id,
          tanggal_booking: updatedBooking.tanggal_booking,
          jam_booking: updatedBooking.jam_booking,
          durasi: updatedBooking.durasi,
          harga: updatedBooking.harga,
          catatan: updatedBooking.catatan,
          special_request: updatedBooking.special_request,
          updatedAt: updatedBooking.updatedAt,
          rescheduled_at: updatedBooking.rescheduled_at
        }
      }
    });

  } catch (error) {
    logger.error('Customer update booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      stack: error.stack
    });

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid: ' + validationErrors.join(', '),
        validation_errors: validationErrors
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui booking'
    });
  }
};

export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { cancel_reason } = req.body;

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

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk membatalkan booking ini'
      });
    }

    const canCancelStatuses = ['pending', 'waiting_payment', 'dp_required'];
    const canCancelPaymentStatuses = ['no_payment', 'pending_verification', 'expired'];

    if (!canCancelStatuses.includes(booking.status_pemesanan)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat dibatalkan karena sudah dikonfirmasi atau selesai'
      });
    }

    if (!canCancelPaymentStatuses.includes(booking.payment_status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat dibatalkan karena pembayaran sudah diproses'
      });
    }

    if (userRole === 'customer' && booking.payment_deadline) {
      const now = new Date();
      const deadline = new Date(booking.payment_deadline);
      
      if (now > deadline) {
        return res.status(400).json({
          status: 'error',
          message: 'Booking sudah melewati batas waktu pembayaran dan tidak dapat dibatalkan'
        });
      }
    }

    await Booking.findByIdAndDelete(id);

    try {
      await CacheService.invalidateBookingCache(bookingUserId, booking.lapangan, booking.tanggal_booking);
    } catch (cacheError) {
      logger.warn('Cache invalidation failed during booking cancellation', {
        error: cacheError.message,
        bookingId: id
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dibatalkan dan dihapus',
      data: {
        deleted_booking: {
          id: id,
          cancel_reason: cancel_reason || 'Dibatalkan oleh customer',
          cancelled_at: new Date(),
          original_status: {
            booking: booking.status_pemesanan,
            payment: booking.payment_status
          }
        }
      }
    });

  } catch (error) {
    logger.error('Cancel booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      userRole: req.user?.role,
      stack: error.stack
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membatalkan booking'
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

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk menghapus booking ini'
      });
    }

    if (booking.status_pemesanan === 'completed') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking yang sudah selesai tidak dapat dihapus'
      });
    }

    await Booking.findByIdAndDelete(id);

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dihapus'
    });

  } catch (error) {
    logger.error('Delete booking error:', {
      error: error.message,
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

// ALIAS EXPORTS ONLY - NO DUPLICATES
export const checkAvailability = getAvailability;