import BookingService from '../services/bookingService.js';
import Booking from '../models/Booking.js';
import moment from 'moment-timezone';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import { client } from '../config/redis.js';

// Create booking dengan cache invalidation
export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;
    
    if (!lapangan_id || !tanggal_booking || !jam_booking || !durasi) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field harus diisi'
      });
    }

    // ✅ FIXED: Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(lapangan_id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Format ID lapangan tidak valid',
        error_code: 'INVALID_FIELD_ID'
      });
    }

    // ✅ FIXED: Manual overlap check BEFORE service call
    const newStart = parseInt(jam_booking.split(':')[0]);
    const newEnd = newStart + parseInt(durasi);
    
    const existingBookings = await Booking.find({
      lapangan: lapangan_id,
      tanggal_booking: new Date(tanggal_booking),
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });
    
    for (const existing of existingBookings) {
      const existingStart = parseInt(existing.jam_booking.split(':')[0]);
      const existingEnd = existingStart + existing.durasi;
      
      const hasOverlap = (newStart < existingEnd) && (newEnd > existingStart);
      
      if (hasOverlap) {
        return res.status(409).json({
          status: 'error',
          message: 'Slot waktu tidak tersedia atau bertabrakan dengan booking lain',
          error_code: 'SLOT_CONFLICT',
          conflicting_booking: {
            time_range: `${existingStart}:00 - ${existingEnd}:00`,
            status: existing.status_pemesanan
          },
          requested_booking: {
            time_range: `${newStart}:00 - ${newEnd}:00`
          }
        });
      }
    }

    // ✅ If no overlap, proceed with service call
    const { booking, field } = await BookingService.createBooking({
      userId: req.user._id,
      lapanganId: lapangan_id,
      tanggalBooking: tanggal_booking,
      jamBooking: jam_booking,
      durasi
    });

    const availabilityCacheKey = `availability:${lapangan_id}:${tanggal_booking}`;
    try {
      if (client && client.isOpen) {
        await client.del(availabilityCacheKey);
        await client.del(`bookings:${req.user._id}`);
      }
    } catch (redisError) {
      // Silent fail for cache
    }

    logger.info(`Booking created: ${booking._id}`, {
      user: req.user._id,
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
      stack: error.stack
    });
    
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

// ✅ REPLACE Line 66-78 getAvailability method
export const getAvailability = async (req, res) => {
  try {
    const { lapangan, tanggal, jam, durasi } = req.query;  // ✅ ADD durasi parameter
    
    if (!lapangan || !tanggal || !jam) {
      return res.status(400).json({
        status: 'error',
        message: 'Parameter lapangan, tanggal, jam, dan durasi harus diisi'  // ✅ UPDATE message
      });
    }

    const field = await BookingService.validateFieldForBooking(lapangan);
    
    // ✅ FIXED: Pass durasi parameter to checkSlotAvailability
    const isAvailable = await BookingService.checkSlotAvailability(
      lapangan, 
      tanggal, 
      jam,
      durasi || 1  // ✅ ADD durasi parameter (default 1 if not provided)
    );

    res.status(200).json({
      status: 'success',
      message: isAvailable ? 'Slot tersedia' : 'Slot sudah dibooking atau bertabrakan',  // ✅ UPDATE message
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
          duration: durasi || 1  // ✅ ADD duration in response
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

// ✅ Backward compatibility
export const checkAvailability = getAvailability;

// Get user bookings - RENAMED for clarity
export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const cacheKey = `bookings:${userId}`;
    
    // Check cache first
    let cachedBookings = null;
    try {
      if (client && client.isOpen) {
        cachedBookings = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis bookings cache read error:', redisError);
    }

    if (cachedBookings) {
      logger.info('Serving user bookings from cache');
      const bookings = JSON.parse(cachedBookings);
      return res.json({
        status: 'success',
        results: bookings.length,
        data: { bookings }
      });
    }

    // HAPUS .lean() agar virtual fields WIB aktif
    const bookings = await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    // Cache for 3 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 180, JSON.stringify(bookings));
        logger.info('User bookings cached successfully');
      }
    } catch (redisError) {
      logger.warn('Redis bookings cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
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

// ✅ ADD: Create alias for routes
export const getUserBookings = getMyBookings;

// Get single booking by ID
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

// ✅ SINGLE updateBooking function
export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { tanggal_booking, jam_booking, durasi, catatan } = req.body;
    const userId = req.user._id;

    // ✅ FIXED: Use service validation with proper error handling
    const booking = await BookingService.validateBookingUpdate(id, userId, req.body);
    
    // ✅ NOTE: validateBookingUpdate already handles slot availability check
    // No need to check again here as it's already done in the service
    
    // ✅ Update operation
    if (tanggal_booking) booking.tanggal_booking = new Date(tanggal_booking);
    if (jam_booking) booking.jam_booking = jam_booking;
    if (durasi) {
      booking.durasi = durasi;
      booking.harga = BookingService.calculateBookingPrice(booking.lapangan, durasi);
    }
    if (catatan !== undefined) booking.catatan = catatan;

    await booking.save();

    // ✅ Cache management
    try {
      if (client && client.isOpen) {
        await client.del(`bookings:${userId}`);
        await client.del(`availability:${booking.lapangan._id}:${booking.tanggal_booking}`);
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Booking updated: ${booking._id}`, {
      user: userId,
      changes: { tanggal_booking, jam_booking, durasi, catatan }
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

// ✅ SINGLE deleteBooking function
export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      pelanggan: userId
    }).populate('lapangan');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // ✅ Use service validation with error handling
    try {
      await BookingService.validateBookingCancellation(booking);
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: error.message
      });
    }

    // ✅ Rest of delete logic remains same...
    let hasPayments = false;
    try {
      const { default: Payment } = await import('../models/Payment.js');
      const payments = await Payment.find({ booking: id });
      hasPayments = payments.length > 0;
    } catch (importError) {
      logger.warn('Payment model import error:', importError.message);
    }

    if (hasPayments && booking.status_pemesanan !== 'pending') {
      booking.status_pemesanan = 'cancelled';
      booking.cancelled_at = new Date();
      booking.cancellation_reason = 'Dibatalkan oleh customer';
      await booking.save();
    } else {
      await Booking.findByIdAndDelete(id);
    }

    try {
      if (client && client.isOpen) {
        await client.del(`bookings:${userId}`);
        await client.del(`availability:${booking.lapangan._id}:${booking.tanggal_booking}`);
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Booking ${hasPayments ? 'cancelled' : 'deleted'}: ${booking._id}`, {
      user: userId,
      reason: 'Customer cancellation'
    });

    res.status(200).json({
      status: 'success',
      message: `Booking berhasil ${hasPayments ? 'dibatalkan' : 'dihapus'}`,
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

// ============= GET BOOKING STATUS =============
export const getBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    // Find booking and check ownership
    const booking = await Booking.findOne({
      _id: id,
      pelanggan: userId
    })
    .populate('lapangan', 'nama jenis_lapangan')
    .populate('kasir', 'name');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    // Get payment info if exists
    let payment = null;
    try {
      const { default: Payment } = await import('../models/Payment.js');
      payment = await Payment.findOne({ 
        booking: id 
      }).sort({ createdAt: -1 });
    } catch (importError) {
      logger.warn('Payment model import error:', importError.message);
    }

    // Calculate simple status timeline
    const statusTimeline = [
      {
        status: 'pending',
        label: 'Booking Dibuat',
        completed: true,
        timestamp: booking.createdAtWIB,
        description: 'Booking berhasil dibuat, menunggu pembayaran'
      },
      {
        status: 'payment_uploaded',
        label: 'Pembayaran Diupload',
        completed: !!payment,
        timestamp: payment ? payment.createdAtWIB : null,
        description: payment ? 'Bukti pembayaran berhasil diupload' : 'Menunggu upload bukti pembayaran'
      },
      {
        status: 'payment_verified',
        label: 'Pembayaran Diverifikasi',
        completed: payment?.status === 'verified',
        timestamp: payment?.verified_at ? 
          moment(payment.verified_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null,
        description: payment?.status === 'verified' 
          ? `Pembayaran diverifikasi oleh ${booking.kasir?.name || 'Kasir'}`
          : 'Menunggu verifikasi pembayaran dari kasir'
      },
      {
        status: 'booking_confirmed',
        label: 'Booking Terkonfirmasi',
        completed: booking.status_pemesanan === 'confirmed',
        timestamp: booking.konfirmasi_at ? 
          moment(booking.konfirmasi_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null,
        description: booking.status_pemesanan === 'confirmed'
          ? 'Booking terkonfirmasi, siap untuk bermain'
          : 'Menunggu konfirmasi booking'
      }
    ];

    // Calculate progress
    const completedSteps = statusTimeline.filter(step => step.completed).length;
    const currentStep = statusTimeline.findIndex(step => !step.completed);
    const completionPercentage = Math.round((completedSteps / statusTimeline.length) * 100);

    // Determine next action
    let nextAction = { action: 'wait', message: 'Proses sedang berlangsung' };
    
    if (booking.status_pemesanan === 'cancelled') {
      nextAction = { action: 'none', message: 'Booking telah dibatalkan' };
    } else if (booking.status_pemesanan === 'confirmed') {
      nextAction = { action: 'none', message: 'Booking sudah terkonfirmasi, siap bermain!' };
    } else if (!payment) {
      nextAction = { 
        action: 'upload_payment', 
        message: 'Upload bukti pembayaran untuk melanjutkan',
        endpoint: 'POST /payments'
      };
    } else if (payment.status === 'pending') {
      nextAction = { 
        action: 'wait_verification', 
        message: 'Menunggu verifikasi pembayaran dari kasir' 
      };
    } else if (payment.status === 'rejected') {
      nextAction = { 
        action: 'reupload_payment', 
        message: `Pembayaran ditolak: ${payment.rejection_reason || 'Alasan tidak disebutkan'}. Silakan upload ulang.`,
        endpoint: 'POST /payments'
      };
    }

    res.status(200).json({
      status: 'success',
      message: 'Status booking berhasil diambil',
      data: {
        booking: {
          id: booking._id,
          fieldName: booking.lapangan.nama,
          fieldType: booking.lapangan.jenis_lapangan,
          date: booking.tanggal_bookingWIB,
          time: booking.jam_booking,
          duration: booking.durasi,
          price: booking.harga,
          status: booking.status_pemesanan,
          paymentStatus: booking.payment_status,
          createdAt: booking.createdAtWIB
        },
        payment: payment ? {
          id: payment._id,
          type: payment.payment_type === 'dp_payment' ? 'Pembayaran DP' : 'Pembayaran Lunas',
          amount: payment.amount,
          status: payment.status === 'verified' ? 'Terverifikasi' : 
                  payment.status === 'rejected' ? 'Ditolak' : 'Menunggu Verifikasi',
          submittedAt: payment.createdAtWIB,
          verifiedAt: payment.verified_at ? 
            moment(payment.verified_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null
        } : null,
        statusTimeline,
        progress: {
          currentStep: currentStep === -1 ? statusTimeline.length : currentStep,
          totalSteps: statusTimeline.length,
          completionPercentage,
          isCompleted: booking.status_pemesanan === 'confirmed',
          nextAction
        }
      }
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

// ============= GET BOOKING STATUS SUMMARY =============
export const getBookingStatusSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get booking counts by status
    const statusCounts = await Booking.aggregate([
      { $match: { pelanggan: userId } },
      {
        $group: {
          _id: '$status_pemesanan',
          count: { $sum: 1 },
          totalAmount: { $sum: '$harga' }
        }
      }
    ]);

    // Get payment status counts
    const paymentCounts = await Booking.aggregate([
      { $match: { pelanggan: userId } },
      {
        $group: {
          _id: '$payment_status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent bookings (last 5)
    const recentBookings = await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'nama jenis_lapangan')
      .sort({ createdAt: -1 })
      .limit(5);

    // Format status summary
    const statusSummary = {
      pending: statusCounts.find(s => s._id === 'pending')?.count || 0,
      confirmed: statusCounts.find(s => s._id === 'confirmed')?.count || 0,
      completed: statusCounts.find(s => s._id === 'completed')?.count || 0,
      cancelled: statusCounts.find(s => s._id === 'cancelled')?.count || 0
    };

    const paymentSummary = {
      no_payment: paymentCounts.find(p => p._id === 'no_payment')?.count || 0,
      pending_payment: paymentCounts.find(p => p._id === 'pending_payment')?.count || 0,
      dp_confirmed: paymentCounts.find(p => p._id === 'dp_confirmed')?.count || 0,
      fully_paid: paymentCounts.find(p => p._id === 'fully_paid')?.count || 0
    };

    const totalBookings = Object.values(statusSummary).reduce((sum, count) => sum + count, 0);
    const totalSpent = statusCounts.reduce((sum, status) => sum + (status.totalAmount || 0), 0);

    res.status(200).json({
      status: 'success',
      message: 'Ringkasan status booking berhasil diambil',
      data: {
        summary: {
          totalBookings,
          totalSpent,
          activeBookings: statusSummary.pending + statusSummary.confirmed,
          completedBookings: statusSummary.completed
        },
        statusBreakdown: statusSummary,
        paymentBreakdown: paymentSummary,
        recentBookings: recentBookings.map(booking => ({
          id: booking._id,
          fieldName: booking.lapangan.nama,
          date: booking.tanggal_bookingWIB,
          time: booking.jam_booking,
          status: booking.status_pemesanan,
          paymentStatus: booking.payment_status,
          amount: booking.harga
        })),
        lastUpdated: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      }
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

// ============= KASIR FUNCTIONS =============
export const getAllBookingsForCashier = async (req, res) => {
  try {
    const { 
      status, 
      payment_status,
      date_from, 
      date_to,
      search,
      field_type 
    } = req.query;

    // Build filter
    const filter = {};
    
    if (status && status !== 'all') {
      filter.status_pemesanan = status;
    }
    
    if (payment_status && payment_status !== 'all') {
      filter.payment_status = payment_status;
    }

    if (date_from || date_to) {
      filter.tanggal_booking = {};
      if (date_from) {
        filter.tanggal_booking.$gte = new Date(date_from);
      }
      if (date_to) {
        filter.tanggal_booking.$lte = new Date(date_to);
      }
    }

    // Build aggregation pipeline
    let pipeline = [
      {
        $lookup: {
          from: 'users',
          localField: 'pelanggan',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: '$customer' },
      {
        $lookup: {
          from: 'fields',
          localField: 'lapangan',
          foreignField: '_id',
          as: 'field'
        }
      },
      { 
        $unwind: { 
          path: '$field', 
          preserveNullAndEmptyArrays: true 
        }
      },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'booking',
          as: 'payment'
        }
      }
    ];

    // Add search filter
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { 'customer.name': { $regex: search, $options: 'i' } },
            { 'customer.email': { $regex: search, $options: 'i' } },
            { 'field.nama': { $regex: search, $options: 'i' } },
            { 'field.jenis_lapangan': { $regex: search, $options: 'i' } },
            { 'jenis_lapangan': { $regex: search, $options: 'i' } }
          ]
        }
      });
    }

    // Add field type filter
    if (field_type && field_type !== 'all') {
      pipeline.push({
        $match: {
          $or: [
            { 'field.jenis_lapangan': field_type },
            { 'jenis_lapangan': field_type }
          ]
        }
      });
    }

    // Add main filters
    if (Object.keys(filter).length > 0) {
      pipeline.push({ $match: filter });
    }

    // Add sorting
    pipeline.push({ $sort: { createdAt: -1 } });

    // Execute aggregation
    const bookings = await Booking.aggregate(pipeline);

    // Format response
    const formattedBookings = bookings.map(booking => {
      const latestPayment = booking.payment.length > 0 
        ? booking.payment.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
        : null;

      return {
        id: booking._id,
        customer: {
          name: booking.customer.name,
          email: booking.customer.email,
          phone: booking.customer.phone || 'Tidak tersedia'
        },
        field: {
          name: booking.field?.nama || 'Lapangan tidak diketahui',
          type: booking.field?.jenis_lapangan || booking.jenis_lapangan || 'Jenis tidak diketahui',
          price: booking.field?.harga || 0
        },
        booking_details: {
          date: moment(booking.tanggal_booking).tz('Asia/Jakarta').format('DD/MM/YYYY'),
          time: booking.jam_booking,
          duration: booking.durasi,
          total_price: booking.harga
        },
        status: {
          booking: booking.status_pemesanan,
          payment: booking.payment_status
        },
        payment_info: latestPayment ? {
          id: latestPayment._id,
          type: latestPayment.payment_type,
          amount: latestPayment.amount,
          status: latestPayment.status,
          submitted_at: moment(latestPayment.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
          has_proof: !!latestPayment.payment_proof
        } : null,
        timestamps: {
          created: moment(booking.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
          updated: moment(booking.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
        }
      };
    });

    // Calculate summary stats
    const summary = {
      total_bookings: formattedBookings.length,
      pending_bookings: formattedBookings.filter(b => b.status.booking === 'pending').length,
      confirmed_bookings: formattedBookings.filter(b => b.status.booking === 'confirmed').length,
      cancelled_bookings: formattedBookings.filter(b => b.status.booking === 'cancelled').length,
      pending_payments: formattedBookings.filter(b => b.status.payment === 'pending_payment').length,
      approved_payments: formattedBookings.filter(b => b.status.payment === 'dp_confirmed' || b.status.payment === 'fully_paid').length
    };

    // Log kasir activity
    logger.info(`Kasir ${req.user.email} viewed all bookings`, {
      role: req.user.role,
      filters: filter,
      search_term: search || 'none',
      total_results: formattedBookings.length,
      action: 'VIEW_ALL_BOOKINGS'
    });

    res.status(200).json({
      status: 'success',
      message: 'Data booking berhasil diambil',
      data: {
        bookings: formattedBookings,
        filters_applied: {
          status: status || 'all',
          payment_status: payment_status || 'all',
          field_type: field_type || 'all',
          date_range: date_from && date_to ? `${date_from} to ${date_to}` : 'all',
          search: search || 'none'
        },
        summary
      }
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

// ============= ADMIN FUNCTIONS =============
export const getAllBookings = async (req, res) => {
  try {
    const { status, payment_status, date_from, date_to, search, field_type } = req.query;

    // Build filter
    const filter = {};
    
    if (status && status !== 'all') {
      filter.status_pemesanan = status;
    }
    
    if (payment_status && payment_status !== 'all') {
      filter.payment_status = payment_status;
    }

    if (date_from || date_to) {
      filter.tanggal_booking = {};
      if (date_from) {
        filter.tanggal_booking.$gte = new Date(date_from);
      }
      if (date_to) {
        filter.tanggal_booking.$lte = new Date(date_to);
      }
    }

    let query = Booking.find(filter)
      .populate('pelanggan', 'name email phone')
      .populate('lapangan', 'nama jenis_lapangan harga')
      .populate('kasir', 'name')
      .sort({ createdAt: -1 });

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query = query.where({
        $or: [
          { 'pelanggan.name': searchRegex },
          { 'pelanggan.email': searchRegex },
          { 'lapangan.nama': searchRegex }
        ]
      });
    }

    if (field_type && field_type !== 'all') {
      query = query.where('lapangan.jenis_lapangan', field_type);
    }

    const bookings = await query.exec();

    logger.info(`Admin ${req.user.email} viewed all bookings`, {
      role: req.user.role,
      filters: filter,
      search_term: search || 'none',
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

// ✅ ADD: Export for routes compatibility
export const getBookings = getAllBookings;
export const getCashierBookings = getAllBookingsForCashier;