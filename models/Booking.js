import mongoose from 'mongoose';
import moment from 'moment-timezone';
import {
  validateBookingDateRange,
  validateBookingTimeFormat,
  validateBookingDurationRange,
  validateFieldTypeForBooking,
  validateBookingPrice,
  BOOKING_STATUSES,
  DURATION_LIMITS
} from '../validators/bookingValidators.js';

const bookingSchema = new mongoose.Schema({
  pelanggan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Pelanggan harus diisi']
  },
  lapangan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: [true, 'Lapangan harus diisi']
  },
  jenis_lapangan: {
    type: String,
    required: [true, 'Jenis lapangan harus diisi'],
    validate: {
      validator: validateFieldTypeForBooking,
      message: 'Jenis lapangan tidak valid'
    }
  },
  tanggal_booking: {
    type: Date,
    required: [true, 'Tanggal booking harus diisi']
  },
  jam_booking: {
    type: String,
    required: [true, 'Jam booking harus diisi']
  },
  durasi: {
    type: Number,
    required: [true, 'Durasi harus diisi'],
    min: [DURATION_LIMITS.MIN, `Durasi minimal ${DURATION_LIMITS.MIN} jam`],
    max: [DURATION_LIMITS.MAX, `Durasi maksimal ${DURATION_LIMITS.MAX} jam`]
  },
  harga: {
    type: Number,
    required: [true, 'Harga harus diisi'],
    validate: {
      validator: validateBookingPrice,
      message: 'Harga booking tidak valid'
    }
  },
  status_pemesanan: {
    type: String,
    enum: {
      values: BOOKING_STATUSES,
      message: 'Status pemesanan tidak valid'
    },
    default: 'pending'
  },
  kasir: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  konfirmasi_at: {
    type: Date
  },
  // Payment integration fields
  payment_status: {
    type: String,
    enum: [
      'no_payment',
      'pending_verification', 
      'dp_confirmed',
      'fully_paid',
      'expired',
      'refunded' // Tambahkan ini jika perlu
    ],
    default: 'no_payment'
  },
  payment_deadline: {
    type: Date,
    default: function() {
      // Payment deadline 24 hours after booking creation
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields untuk format Indonesia
bookingSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

bookingSchema.virtual('updatedAtWIB').get(function() {
  return moment(this.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

bookingSchema.virtual('tanggal_bookingWIB').get(function() {
  return moment(this.tanggal_booking).tz('Asia/Jakarta').format('DD/MM/YYYY');
});

// Add virtual for payment status text
bookingSchema.virtual('payment_status_text').get(function() {
  const statusMap = {
    'no_payment': 'Belum Bayar',
    'pending_payment': 'Menunggu Verifikasi Pembayaran',
    'dp_confirmed': 'DP Terkonfirmasi',
    'fully_paid': 'Lunas'
  };
  return statusMap[this.payment_status];
});

// Pre-save validations
bookingSchema.pre('save', validateBookingDateRange);
bookingSchema.pre('save', validateBookingTimeFormat);
bookingSchema.pre('save', validateBookingDurationRange);

// Middleware untuk mengecek ketersediaan lapangan
bookingSchema.pre('save', async function(next) {
  // Get field details for operational hours check
  const field = await mongoose.model('Field').findById(this.lapangan);
  if (!field) {
    throw new Error('Lapangan tidak ditemukan');
  }

  
  if (field.status !== 'tersedia') {
    throw new Error(`Lapangan sedang ${field.status} dan tidak dapat dibooking`);
  }

  // Parse booking time and operational hours
  const bookingHour = parseInt(this.jam_booking.split(':')[0]);
  const closeHour = parseInt(field.jam_tutup.split(':')[0]);
  const openHour = parseInt(field.jam_buka.split(':')[0]);

  // Check if booking time is within operational hours
  if (bookingHour >= closeHour || bookingHour < openHour) {
    throw new Error(`Jam booking harus antara ${field.jam_buka} - ${field.jam_tutup}`);
  }

  // Check if booking duration exceeds closing time
  if (bookingHour + this.durasi > closeHour) {
    throw new Error(`Durasi melebihi jam tutup lapangan (${field.jam_tutup})`);
  }

  // Check slot availability
  if (this.isNew || this.isModified('tanggal_booking') || this.isModified('jam_booking')) {
    const existingBooking = await this.constructor.findOne({
      lapangan: this.lapangan,
      tanggal_booking: this.tanggal_booking,
      jam_booking: this.jam_booking,
      _id: { $ne: this._id },
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });

    if (existingBooking) {
      throw new Error('Lapangan sudah dibooking pada waktu tersebut');
    }
  }

  next();
});

// Index untuk performance
bookingSchema.index({ lapangan: 1, tanggal_booking: 1 });
bookingSchema.index({ pelanggan: 1 });
bookingSchema.index({ status_pemesanan: 1 });


bookingSchema.statics.checkAvailability = async function(fieldId, date, time) {
  const existingBooking = await this.findOne({
    lapangan: fieldId,
    tanggal_booking: date,
    jam_booking: time,
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  });
  return !existingBooking;
};


bookingSchema.statics.getBookedSlots = async function(fieldId, date) {
  return await this.find({
    lapangan: fieldId,
    tanggal_booking: date,
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  }).select('jam_booking pelanggan');
};

export default mongoose.model('Booking', bookingSchema);

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

export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const showCancelled = req.query.show_cancelled === 'true'; // Optional parameter
    
    // Build filter - exclude cancelled bookings by default
    const filter = { pelanggan: userId };
    
    if (!showCancelled) {
      filter.status_pemesanan = { $ne: 'cancelled' };
    }

    // Get bookings with filter
    const bookings = await Booking.find(filter)
      .populate('lapangan', 'nama jenis_lapangan harga gambar jam_buka jam_tutup status')
      .sort({ createdAt: -1 })
      .lean();

    // Format response
    const formattedBookings = bookings.map(booking => ({
      ...booking,
      lapangan: {
        ...booking.lapangan,
        jamOperasional: booking.lapangan?.jam_buka && booking.lapangan?.jam_tutup 
          ? `${booking.lapangan.jam_buka} - ${booking.lapangan.jam_tutup}`
          : 'undefined - undefined'
      }
    }));

    logger.info('User bookings retrieved', {
      userId: userId.toString(),
      totalBookings: formattedBookings.length,
      showCancelled,
      action: 'GET_MY_BOOKINGS'
    });

    res.status(200).json({
      status: 'success',
      results: formattedBookings.length,
      data: { 
        bookings: formattedBookings 
      },
      cached: false,
      filters: {
        show_cancelled: showCancelled,
        total_active: formattedBookings.length
      }
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

export const getMyBookingHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, limit = 50, page = 1 } = req.query;
    
    // Build filter
    const filter = { pelanggan: userId };
    
    if (status) {
      filter.status_pemesanan = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get bookings with filter and pagination
    const [bookings, totalCount] = await Promise.all([
      Booking.find(filter)
        .populate('lapangan', 'nama jenis_lapangan harga gambar jam_buka jam_tutup status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Booking.countDocuments(filter)
    ]);

    // Format response
    const formattedBookings = bookings.map(booking => ({
      ...booking,
      lapangan: {
        ...booking.lapangan,
        jamOperasional: booking.lapangan?.jam_buka && booking.lapangan?.jam_tutup 
          ? `${booking.lapangan.jam_buka} - ${booking.lapangan.jam_tutup}`
          : 'undefined - undefined'
      }
    }));

    // Group by status for summary
    const statusSummary = await Booking.aggregate([
      { $match: { pelanggan: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$status_pemesanan', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    logger.info('User booking history retrieved', {
      userId: userId.toString(),
      totalBookings: formattedBookings.length,
      totalCount,
      page: parseInt(page),
      limit: parseInt(limit),
      status: status || 'all',
      action: 'GET_MY_BOOKING_HISTORY'
    });

    res.status(200).json({
      status: 'success',
      results: formattedBookings.length,
      data: { 
        bookings: formattedBookings,
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_items: totalCount,
          total_pages: Math.ceil(totalCount / parseInt(limit))
        },
        summary: {
          by_status: statusSummary.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
          total_all: totalCount
        }
      }
    });

  } catch (error) {
    logger.error(`Get user booking history error: ${error.message}`, {
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil riwayat booking'
    });
  }
};

export { getMyBookingHistory };