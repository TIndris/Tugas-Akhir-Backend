import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import moment from 'moment-timezone';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import { client } from '../config/redis.js';

// Create booking dengan cache invalidation
export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;

    // Cache key untuk availability
    const availabilityCacheKey = `availability:${lapangan_id}:${tanggal_booking}`;
    
    // Get field data (existing code)
    let field = null;
    const fieldCacheKey = `field:${lapangan_id}`;
    
    try {
      if (client.isOpen) {
        const cachedField = await client.get(fieldCacheKey);
        if (cachedField) {
          field = JSON.parse(cachedField);
        }
      }
    } catch (redisError) {
      logger.warn('Redis field cache read error:', redisError);
    }

    // If not in cache, get from database
    if (!field) {
      field = await Field.findById(lapangan_id).lean();
      if (!field) {
        return res.status(404).json({
          status: 'error',
          message: 'Lapangan tidak ditemukan'
        });
      }
      
      // Cache field for 10 minutes
      try {
        if (client.isOpen) {
          await client.setEx(fieldCacheKey, 600, JSON.stringify(field));
        }
      } catch (redisError) {
        logger.warn('Redis field cache save error:', redisError);
      }
    }

    // ✅ TAMBAHKAN VALIDASI STATUS DI SINI
    if (field.status !== 'tersedia') {
      return res.status(400).json({
        status: 'error',
        message: 'Lapangan sedang tidak tersedia untuk booking',
        error: {
          code: 'FIELD_NOT_AVAILABLE',
          current_status: field.status,
          field_name: field.nama
        }
      });
    }

    // ✅ TAMBAHAN: Validasi jenis lapangan aktif
    if (!field.jenis_lapangan) {
      return res.status(400).json({
        status: 'error',
        message: 'Jenis lapangan tidak valid'
      });
    }

    // Existing validations continue...
    const bookingHour = parseInt(jam_booking.split(':')[0]);
    const closeHour = parseInt(field.jam_tutup.split(':')[0]);
    const openHour = parseInt(field.jam_buka.split(':')[0]);

    if (bookingHour >= closeHour || bookingHour < openHour) {
      return res.status(400).json({
        status: 'error',
        message: `Jam booking harus antara ${field.jam_buka} - ${field.jam_tutup}`
      });
    }

    if (bookingHour + durasi > closeHour) {
      return res.status(400).json({
        status: 'error',
        message: `Durasi melebihi jam tutup lapangan (${field.jam_tutup})`
      });
    }

    // Check availability
    const isAvailable = await Booking.checkAvailability(
      lapangan_id, 
      tanggal_booking, 
      jam_booking
    );

    if (!isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: 'Slot waktu tidak tersedia'
      });
    }

    // Calculate price
    const totalHarga = field.harga * durasi;

    const booking = await Booking.create({
      pelanggan: req.user._id,
      lapangan: lapangan_id,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking,
      jam_booking,
      durasi,
      harga: totalHarga
    });

    // Clear availability cache after booking
    try {
      if (client.isOpen) {
        await client.del(availabilityCacheKey);
        await client.del(`bookings:${req.user._id}`);
        logger.info('Availability cache cleared after booking');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Booking created: ${booking._id}`, {
      user: req.user._id,
      action: 'CREATE_BOOKING'
    });

    res.status(201).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    logger.error(`Booking creation error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Keep confirmBooking function but DON'T export (untuk backward compatibility)
const confirmBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    booking.status_pemesanan = 'confirmed';
    booking.kasir = req.user._id;
    booking.konfirmasi_at = new Date();
    await booking.save();

    logger.info(`Booking confirmed: ${booking._id}`, {
      kasir: req.user._id,
      action: 'CONFIRM_BOOKING'
    });

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    logger.error(`Booking confirmation error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Mendapatkan semua booking (untuk admin/kasir) - FIXED untuk WIB format
export const getAllBookings = async (req, res) => {
  try {
    // HAPUS .lean() agar virtual fields WIB aktif
    const bookings = await Booking.find()
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Mendapatkan booking by ID - FIXED untuk WIB format
export const getBooking = async (req, res) => {
  try {
    // HAPUS .lean() agar virtual fields WIB aktif
    const booking = await Booking.findById(req.params.id)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// ✅ ADD: Export checkAvailability function
export const checkAvailability = async (req, res) => {
  try {
    const { lapangan, tanggal, jam } = req.query;

    if (!lapangan || !tanggal || !jam) {
      return res.status(400).json({
        status: 'error',
        message: 'Parameter lapangan, tanggal, dan jam harus diisi',
        required_params: ['lapangan', 'tanggal', 'jam']
      });
    }

    // Validate field exists
    const field = await Field.findById(lapangan);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Check if field is available
    if (field.status !== 'tersedia') {
      return res.status(400).json({
        status: 'error',
        message: `Lapangan sedang ${field.status}`,
        is_available: false,
        field_status: field.status
      });
    }

    // Check time slot availability
    const existingBooking = await Booking.findOne({
      lapangan: lapangan,
      tanggal_booking: tanggal,
      jam_booking: jam,
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });

    const isAvailable = !existingBooking;

    res.status(200).json({
      status: 'success',
      message: isAvailable ? 'Slot tersedia' : 'Slot sudah dibooking',
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
          booked_by: existingBooking ? 'User lain' : null
        }
      }
    });

  } catch (error) {
    logger.error(`Check availability error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengecek ketersediaan'
    });
  }
};

// ✅ RENAME: getAvailableSlots menjadi getAvailability untuk konsistensi
export const getAvailability = async (req, res) => {
  try {
    const { fieldId, date } = req.query;
    const cacheKey = `availability:${fieldId}:${date}`;
    
    // Check cache first
    let cachedAvailability = null;
    try {
      if (client && client.isOpen) {
        cachedAvailability = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis availability cache read error:', redisError);
    }

    if (cachedAvailability) {
      logger.info('Serving availability from cache');
      return res.json({
        status: 'success',
        data: JSON.parse(cachedAvailability)
      });
    }
    
    // Validate field exists
    const field = await Field.findById(fieldId).lean();
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Check field availability
    if (field.status !== 'tersedia') {
      return res.status(400).json({
        status: 'error',
        message: `Lapangan sedang ${field.status} dan tidak tersedia untuk booking`,
        data: {
          fieldName: field.nama,
          fieldType: field.jenis_lapangan,
          status: field.status,
          date: date,
          slots: []
        }
      });
    }

    // Get all booked slots for the date
    const bookedSlots = await Booking.find({
      lapangan: fieldId,
      tanggal_booking: date,
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    }).select('jam_booking');
    
    // Generate all possible time slots
    const allSlots = generateTimeSlots();
    
    // Mark slots as available or booked
    const availabilityMap = allSlots.map(slot => {
      const isBooked = bookedSlots.some(booking => 
        booking.jam_booking === slot.time
      );

      return {
        time: slot.time,
        isAvailable: !isBooked,
        price: field.harga
      };
    });

    const responseData = {
      fieldName: field.nama,
      fieldType: field.jenis_lapangan,
      date: date,
      slots: availabilityMap
    };

    // Cache for 2 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 120, JSON.stringify(responseData));
        logger.info('Availability cached successfully');
      }
    } catch (redisError) {
      logger.warn('Redis availability cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      data: responseData
    });

  } catch (error) {
    logger.error(`Error getting availability: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Get user bookings dengan cache - FIXED untuk WIB format
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
    res.status(500).json({
      status: 'error',
      message: error.message
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

// Helper function to generate time slots
const generateTimeSlots = () => {
  const slots = [];
  const startHour = 7;  // 07:00
  const endHour = 23;   // 23:00
  
  for (let hour = startHour; hour <= endHour; hour++) {
    slots.push({
      time: `${hour.toString().padStart(2, '0')}:00`,
      displayTime: `${hour}:00`
    });
  }
  
  return slots;
};