import BookingService from '../services/bookingService.js';
import BookingAnalyticsService from '../services/bookingAnalyticsService.js';
import BookingStatusService from '../services/bookingStatusService.js';
import CacheService from '../services/cacheService.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Field from '../models/Field.js';
import moment from 'moment-timezone';

// ✅ COMPLETELY CLEANED: createBooking without any SMS references
export const createBooking = async (req, res) => {
  let newBooking = null;
  let user = null;
  
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;
    
    if (!lapangan_id || !tanggal_booking || !jam_booking || !durasi) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field harus diisi'
      });
    }

    // Get user for logging purposes
    user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan'
      });
    }

    logger.info('Starting booking creation:', {
      userId: req.user._id,
      userName: user.name,
      lapanganId: lapangan_id,
      tanggal: tanggal_booking,
      jam: jam_booking
    });

    // Validate field exists
    const field = await Field.findById(lapangan_id);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan',
        error_code: 'FIELD_NOT_FOUND'
      });
    }

    // Check field availability
    if (field.status && field.status !== 'tersedia' && field.isAvailable === false) {
      return res.status(400).json({
        status: 'error',
        message: 'Lapangan tidak tersedia',
        error_code: 'FIELD_UNAVAILABLE'
      });
    }

    // Manual conflict check
    const bookingDate = moment(tanggal_booking).format('YYYY-MM-DD');
    const startTime = moment(jam_booking, 'HH:mm');
    const endTime = startTime.clone().add(durasi, 'hours');

    const conflictingBookings = await Booking.find({
      lapangan: lapangan_id,
      tanggal_booking: {
        $gte: moment(bookingDate).startOf('day').toDate(),
        $lte: moment(bookingDate).endOf('day').toDate()
      },
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });

    // Check for time conflicts
    for (const existingBooking of conflictingBookings) {
      const existingStart = moment(existingBooking.jam_booking, 'HH:mm');
      const existingEnd = existingStart.clone().add(existingBooking.durasi, 'hours');
      
      const hasOverlap = (
        (startTime.isBefore(existingEnd) && endTime.isAfter(existingStart)) ||
        (existingStart.isBefore(endTime) && existingEnd.isAfter(startTime))
      );

      if (hasOverlap) {
        return res.status(409).json({
          status: 'error',
          message: 'Slot waktu tidak tersedia atau bertabrakan dengan booking lain',
          error_code: 'SLOT_CONFLICT',
          debug_info: {
            new_booking: {
              time_range: `${jam_booking} - ${endTime.format('HH:mm')}`,
              date: bookingDate
            },
            conflicting_booking: {
              id: existingBooking._id,
              time_range: `${existingBooking.jam_booking} - ${existingEnd.format('HH:mm')}`,
              status: existingBooking.status_pemesanan,
              customer: existingBooking.pelanggan
            }
          }
        });
      }
    }

    // Calculate total amount
    const totalAmount = (field.harga || field.pricePerHour || 0) * durasi;

    // Generate bookingId
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    const bookingId = `DSC-${timestamp}-${random}`.toUpperCase();

    // ✅ CLEAN: Create booking without SMS tracking fields
    const bookingData = {
      pelanggan: req.user._id,
      lapangan: lapangan_id,
      jenis_lapangan: field.jenis_lapangan || field.type || 'futsal',
      tanggal_booking: new Date(tanggal_booking),
      jam_booking: jam_booking,
      durasi: parseInt(durasi),
      harga: totalAmount,
      status_pemesanan: 'pending',
      payment_status: 'no_payment',
      bookingId: bookingId
    };

    newBooking = await Booking.create(bookingData);

    // Populate references
    await newBooking.populate([
      { path: 'lapangan', select: 'nama harga pricePerHour images location' },
      { path: 'pelanggan', select: 'name email phoneNumber phone' }
    ]);

    logger.info('Booking created successfully:', {
      bookingId: newBooking.bookingId,
      userId: req.user._id,
      fieldId: lapangan_id,
      date: bookingDate,
      timeSlot: `${jam_booking} - ${endTime.format('HH:mm')}`,
      amount: totalAmount
    });

    // Clear cache
    try {
      await CacheService.clearUserBookingsCache(req.user._id);
      await CacheService.clearFieldAvailabilityCache(lapangan_id, bookingDate);
    } catch (cacheError) {
      logger.warn('Cache clear failed:', cacheError.message);
    }

    // ✅ CLEAN: Response without any SMS references
    res.status(201).json({
      status: 'success',
      message: 'Booking berhasil dibuat. Silakan lakukan pembayaran dalam 24 jam.',
      data: {
        booking: {
          id: newBooking._id,
          bookingId: newBooking.bookingId,
          field: {
            id: newBooking.lapangan._id,
            name: newBooking.lapangan.nama,
            pricePerHour: newBooking.lapangan.harga || newBooking.lapangan.pricePerHour
          },
          user: {
            id: newBooking.pelanggan._id,
            name: newBooking.pelanggan.name,
            email: newBooking.pelanggan.email,
            phone: newBooking.pelanggan.phone || newBooking.pelanggan.phoneNumber
          },
          tanggal_booking: bookingDate,
          jam_booking: newBooking.jam_booking,
          durasi: newBooking.durasi,
          harga: newBooking.harga,
          status_pemesanan: newBooking.status_pemesanan,
          payment_status: newBooking.payment_status,
          createdAt: newBooking.createdAt,
          payment_deadline: moment(newBooking.createdAt).add(24, 'hours').format('DD/MM/YYYY HH:mm')
        }
      }
    });

  } catch (error) {
    logger.error('Booking creation error:', {
      error: error.message,
      stack: error.stack,
      requestBody: req.body,
      user: req.user?._id,
      timestamp: new Date().toISOString()
    });

    // Cleanup on error
    if (newBooking && newBooking._id) {
      try {
        await Booking.findByIdAndDelete(newBooking._id);
        logger.info('Cleaned up partial booking on error:', newBooking.bookingId);
      } catch (cleanupError) {
        logger.error('Failed to cleanup partial booking:', cleanupError.message);
      }
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membuat booking',
      error_code: 'BOOKING_CREATION_FAILED',
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          error: error.message,
          stack: error.stack
        }
      })
    });
  }
};

// ✅ KEEP: All other functions unchanged
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

// ✅ CLEAN: getBookingById without SMS references
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
        user = await User.findById(bookingUserId).select('name email phone phoneNumber');
      }
      
      let field = null;
      if (booking.lapangan) {
        field = await Field.findById(booking.lapangan).select('nama harga');
      }
      
      let kasir = null;
      if (booking.kasir) {
        kasir = await User.findById(booking.kasir).select('name email');
      }

      // ✅ CLEAN: Populate booking without SMS notification fields
      populatedBooking = {
        id: booking._id,
        bookingId: booking.bookingId,
        customer: user ? {
          name: user.name || 'Unknown',
          email: user.email || 'Unknown',
          phone: user.phone || user.phoneNumber || 'Unknown'
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
        // ❌ REMOVED: notifications field
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at,
          expired: booking.expiredAt
        }
      };

    } catch (populateError) {
      populatedBooking = {
        id: booking._id,
        bookingId: booking.bookingId,
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
        // ❌ REMOVED: notifications field
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at,
          expired: booking.expiredAt
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

// ✅ CLEAN: updateBooking without SMS logic
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

    const booking = await Booking.findById(id)
      .populate('pelanggan', 'name email phoneNumber')
      .populate('lapangan', 'nama');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan._id || booking.pelanggan;
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

    // ❌ REMOVED: SMS notification logic for status changes

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('pelanggan', 'name email phoneNumber');

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

// ✅ FIXED: updateBookingStatus - Add 'rejected' to valid statuses
export const updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, notes } = req.body;

    // ✅ FIXED: Include 'rejected' status
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'expired', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Status tidak valid',
        error_code: 'INVALID_STATUS',
        valid_statuses: validStatuses,
        provided_status: status
      });
    }

    const booking = await Booking.findByBookingId(bookingId);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan',
        error_code: 'BOOKING_NOT_FOUND'
      });
    }

    const oldStatus = booking.status_pemesanan;
    booking.status_pemesanan = status;
    booking.updatedBy = req.user._id;
    booking.lastUpdated = new Date();

    if (notes) {
      booking.catatan = notes;
    }

    // ✅ Add rejection tracking
    if (status === 'rejected') {
      booking.rejected_by = req.user._id;
      booking.rejected_at = new Date();
      if (notes) {
        booking.rejection_reason = notes;
      }
    }

    await booking.save();

    // Clear cache
    try {
      await CacheService.clearUserBookingsCache(booking.pelanggan);
      await CacheService.clearFieldAvailabilityCache(booking.lapangan, booking.tanggal_booking);
    } catch (cacheError) {
      logger.warn('Cache clear failed:', cacheError.message);
    }

    logger.info('Booking status updated:', {
      bookingId: booking.bookingId,
      oldStatus,
      newStatus: status,
      updatedBy: req.user._id
    });

    res.json({
      status: 'success',
      message: 'Status booking berhasil diupdate',
      data: {
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status_pemesanan,
          oldStatus,
          updatedAt: booking.lastUpdated,
          ...(status === 'rejected' && {
            rejected_by: req.user._id,
            rejected_at: booking.rejected_at,
            rejection_reason: booking.rejection_reason
          })
        }
      }
    });

  } catch (error) {
    logger.error('Update booking status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengupdate status booking',
      error_code: 'UPDATE_BOOKING_STATUS_FAILED'
    });
  }
};

// ✅ KEEP: All other existing functions unchanged
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

    // ✅ FIXED: Allow cancellation of REJECTED bookings
    const canCancelStatuses = ['pending', 'waiting_payment', 'dp_required', 'rejected'];
    
    if (!canCancelStatuses.includes(booking.status_pemesanan)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat dibatalkan karena sudah dikonfirmasi atau selesai',
        current_status: booking.status_pemesanan,
        allowed_statuses: canCancelStatuses
      });
    }

    // ✅ SIMPLIFIED: Only prevent cancellation if payment is already confirmed
    const hasConfirmedPayment = ['dp_confirmed', 'fully_paid', 'verified'].includes(booking.payment_status);

    // ✅ Special handling for admin-approved bookings
    if (hasConfirmedPayment && booking.approved_by_admin && userRole === 'customer') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking yang telah disetujui admin hanya dapat dibatalkan oleh kasir/admin'
      });
    }

    // ✅ Allow regular payment confirmed bookings to be cancelled by admin/kasir
    if (hasConfirmedPayment && !booking.approved_by_admin && userRole === 'customer') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking tidak dapat dibatalkan karena pembayaran sudah dikonfirmasi'
      });
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

    logger.info('Booking cancelled successfully:', {
      bookingId: booking.bookingId,
      originalStatus: booking.status_pemesanan,
      cancelledBy: userId,
      userRole: userRole,
      reason: cancel_reason
    });

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dibatalkan dan dihapus',
      data: {
        deleted_booking: {
          id: id,
          original_status: booking.status_pemesanan,
          was_rejected: booking.status_pemesanan === 'rejected',
          cancel_reason: cancel_reason || 'Dibatalkan oleh customer',
          cancelled_at: new Date(),
          cancelled_by: userRole
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

// ✅ FIXED: approveBookingByAdmin - Allow kasir dan cashier
export const approveBookingByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    // ✅ FIXED: Allow admin, kasir, AND cashier
    if (!['admin', 'kasir', 'cashier'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Hanya admin atau kasir yang dapat menyetujui booking',
        current_role: req.user.role,
        allowed_roles: ['admin', 'kasir', 'cashier']
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'nama');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // Only allow pending bookings with no payment
    if (booking.status_pemesanan !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'Hanya booking dengan status pending yang dapat disetujui',
        current_status: booking.status_pemesanan
      });
    }

    if (booking.payment_status !== 'no_payment') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini sudah memiliki pembayaran, gunakan verifikasi payment',
        current_payment_status: booking.payment_status
      });
    }

    // ✅ Update booking status - APPROVED WITHOUT PAYMENT
    booking.status_pemesanan = 'confirmed';
    booking.payment_status = 'verified'; 
    booking.kasir = req.user._id;
    booking.konfirmasi_at = new Date();
    booking.approved_by_admin = true;
    booking.approved_by = req.user._id;
    booking.approved_at = new Date();
    
    if (notes) {
      booking.catatan = notes;
    }

    await booking.save();

    // Clear cache
    try {
      await CacheService.clearUserBookingsCache(booking.pelanggan._id);
      await CacheService.clearFieldAvailabilityCache(booking.lapangan._id, booking.tanggal_booking);
    } catch (cacheError) {
      logger.warn('Cache clear failed:', cacheError.message);
    }

    logger.info('Booking approved by admin/kasir without payment:', {
      bookingId: booking.bookingId,
      approvedBy: req.user._id,
      userRole: req.user.role,
      customerId: booking.pelanggan._id
    });

    res.status(200).json({
      status: 'success',
      message: `Booking berhasil disetujui tanpa pembayaran oleh ${req.user.role}`,
      data: {
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status_pemesanan,
          payment_status: booking.payment_status,
          approved_without_payment: booking.approved_by_admin,
          approved_by: req.user.name,
          approved_at: booking.konfirmasi_at,
          customer: {
            name: booking.pelanggan.name,
            email: booking.pelanggan.email
          },
          field: {
            name: booking.lapangan.nama
          },
          notes: booking.catatan
        }
      }
    });

  } catch (error) {
    logger.error('Admin/Kasir approve booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id,
      userRole: req.user?.role
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menyetujui booking'
    });
  }
};

// ✅ FIXED: rejectBookingByAdmin - Allow kasir dan cashier
export const rejectBookingByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    // ✅ FIXED: Allow admin, kasir, AND cashier
    if (!['admin', 'kasir', 'cashier'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Hanya admin atau kasir yang dapat menolak booking',
        current_role: req.user.role,
        allowed_roles: ['admin', 'kasir', 'cashier']
      });
    }

    if (!rejection_reason) {
      return res.status(400).json({
        status: 'error',
        message: 'Alasan penolakan harus diisi'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'nama');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // Only allow pending bookings
    if (booking.status_pemesanan !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'Hanya booking dengan status pending yang dapat ditolak',
        current_status: booking.status_pemesanan
      });
    }

    // Update booking status - REJECTED
    booking.status_pemesanan = 'rejected';
    booking.rejected_by = req.user._id;
    booking.rejected_at = new Date();
    booking.rejection_reason = rejection_reason;

    await booking.save();

    logger.info('Booking rejected by admin/kasir:', {
      bookingId: booking.bookingId,
      rejectedBy: req.user._id,
      userRole: req.user.role,
      customerId: booking.pelanggan._id,
      reason: rejection_reason
    });

    res.status(200).json({
      status: 'success',
      message: `Booking berhasil ditolak oleh ${req.user.role}`,
      data: {
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status_pemesanan,
          rejected_by: req.user.name,
          rejected_at: booking.rejected_at,
          rejection_reason: booking.rejection_reason,
          customer: {
            name: booking.pelanggan.name,
            email: booking.pelanggan.email
          },
          field: {
            name: booking.lapangan.nama
          }
        }
      }
    });

  } catch (error) {
    logger.error('Admin/Kasir reject booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id,
      userRole: req.user?.role
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menolak booking'
    });
  }
};