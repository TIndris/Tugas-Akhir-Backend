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
      'refunded'
    ],
    default: 'no_payment'
  },
  payment_deadline: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  },
  catatan: {
    type: String
  },
  special_request: {
    type: String
  },
  cancel_reason: {
    type: String
  },
  rescheduled_at: {
    type: Date
  },
  rescheduled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // ❌ REMOVE: SMS tracking fields (karena tidak digunakan lagi)
  // paymentReminderSent: {
  //   type: Boolean,
  //   default: false
  // },
  // preparationReminderSent: {
  //   type: Boolean,
  //   default: false
  // },
  // confirmationSent: {
  //   type: Boolean,
  //   default: false
  // },
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ KEEP: Virtual fields untuk format Indonesia
bookingSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

bookingSchema.virtual('updatedAtWIB').get(function() {
  return moment(this.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

bookingSchema.virtual('tanggal_bookingWIB').get(function() {
  return moment(this.tanggal_booking).tz('Asia/Jakarta').format('DD/MM/YYYY');
});

// Payment status text virtual
bookingSchema.virtual('payment_status_text').get(function() {
  const statusMap = {
    'no_payment': 'Belum Bayar',
    'pending_verification': 'Menunggu Verifikasi Pembayaran',
    'dp_confirmed': 'DP Terkonfirmasi',
    'fully_paid': 'Lunas',
    'expired': 'Kadaluarsa',
    'refunded': 'Dikembalikan'
  };
  return statusMap[this.payment_status] || this.payment_status;
});

// Virtual for controller compatibility
bookingSchema.virtual('fieldName').get(function() {
  return this.lapangan?.name || this.fieldId?.name;
});

bookingSchema.virtual('customerName').get(function() {
  return this.pelanggan?.name || this.userId?.name;
});

// Pre-save validations
bookingSchema.pre('save', validateBookingDateRange);
bookingSchema.pre('save', validateBookingTimeFormat);
bookingSchema.pre('save', validateBookingDurationRange);

// Middleware untuk mengecek ketersediaan lapangan
bookingSchema.pre('save', async function(next) {
  try {
    // Skip validation for updates that don't change booking details
    if (!this.isNew && !this.isModified('tanggal_booking') && !this.isModified('jam_booking') && !this.isModified('lapangan')) {
      return next();
    }

    // Get field details for operational hours check
    const fieldId = this.lapangan;
    const field = await mongoose.model('Field').findById(fieldId);
    
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }

    // Check field availability
    if (field.status && field.status !== 'tersedia' && field.isAvailable === false) {
      throw new Error(`Lapangan sedang ${field.status} dan tidak dapat dibooking`);
    }

    // Parse booking time and operational hours
    const bookingTime = this.jam_booking;
    const bookingHour = parseInt(bookingTime.split(':')[0]);
    const bookingDuration = this.durasi;
    
    // Handle different field hour formats
    const closeHour = field.jam_tutup ? 
      parseInt(field.jam_tutup.split(':')[0]) : 
      parseInt(field.operatingHours?.close?.split(':')[0] || '22');
      
    const openHour = field.jam_buka ? 
      parseInt(field.jam_buka.split(':')[0]) : 
      parseInt(field.operatingHours?.open?.split(':')[0] || '08');

    // Check if booking time is within operational hours
    if (bookingHour >= closeHour || bookingHour < openHour) {
      const openTime = field.jam_buka || field.operatingHours?.open || '08:00';
      const closeTime = field.jam_tutup || field.operatingHours?.close || '22:00';
      throw new Error(`Jam booking harus antara ${openTime} - ${closeTime}`);
    }

    // Check if booking duration exceeds closing time
    if (bookingHour + bookingDuration > closeHour) {
      const closeTime = field.jam_tutup || field.operatingHours?.close || '22:00';
      throw new Error(`Durasi melebihi jam tutup lapangan (${closeTime})`);
    }

    // Simplified slot availability check
    if (this.isNew || this.isModified('tanggal_booking') || this.isModified('jam_booking')) {
      // Calculate end time
      const startMoment = moment(bookingTime, 'HH:mm');
      const endMoment = startMoment.clone().add(bookingDuration, 'hours');
      const endTime = endMoment.format('HH:mm');

      // Format booking date consistently
      const bookingDate = moment(this.tanggal_booking).format('YYYY-MM-DD');
      
      // Simplified conflict check - Only check exact matches and overlaps
      const conflictingBookings = await this.constructor.find({
        lapangan: fieldId,
        tanggal_booking: {
          $gte: moment(bookingDate).startOf('day').toDate(),
          $lte: moment(bookingDate).endOf('day').toDate()
        },
        _id: { $ne: this._id },
        status_pemesanan: { $in: ['pending', 'confirmed'] }
      });

      // Check for time conflicts manually
      for (const existingBooking of conflictingBookings) {
        const existingStart = moment(existingBooking.jam_booking, 'HH:mm');
        const existingEnd = existingStart.clone().add(existingBooking.durasi, 'hours');
        
        const newStart = moment(bookingTime, 'HH:mm');
        const newEnd = moment(endTime, 'HH:mm');

        // Check if times overlap
        const hasOverlap = (
          (newStart.isBefore(existingEnd) && newEnd.isAfter(existingStart)) ||
          (existingStart.isBefore(newEnd) && existingEnd.isAfter(newStart))
        );

        if (hasOverlap) {
          throw new Error(`Lapangan sudah dibooking pada waktu ${existingBooking.jam_booking} - ${existingEnd.format('HH:mm')}`);
        }
      }
    }

    // Generate bookingId if not exists
    if (!this.bookingId) {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substr(2, 5);
      this.bookingId = `DSC-${timestamp}-${random}`.toUpperCase();
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Indexes untuk performance
bookingSchema.index({ lapangan: 1, tanggal_booking: 1 });
bookingSchema.index({ fieldId: 1, date: 1 });
bookingSchema.index({ pelanggan: 1 });
bookingSchema.index({ userId: 1 });
bookingSchema.index({ status_pemesanan: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ payment_status: 1, createdAt: 1 });

// Static methods with better conflict detection
bookingSchema.statics.checkAvailability = async function(fieldId, date, time, duration = 1) {
  try {
    // Calculate end time
    const startMoment = moment(time, 'HH:mm');
    const endMoment = startMoment.clone().add(duration, 'hours');
    
    // Format date consistently
    const bookingDate = moment(date).format('YYYY-MM-DD');
    
    const conflictingBookings = await this.find({
      lapangan: fieldId,
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
      
      const newStart = moment(time, 'HH:mm');
      const newEnd = endMoment;

      // Check if times overlap
      const hasOverlap = (
        (newStart.isBefore(existingEnd) && newEnd.isAfter(existingStart)) ||
        (existingStart.isBefore(newEnd) && existingEnd.isAfter(newStart))
      );

      if (hasOverlap) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error checking availability:', error);
    return false;
  }
};

bookingSchema.statics.getBookedSlots = async function(fieldId, date) {
  const bookingDate = moment(date).format('YYYY-MM-DD');
  
  return await this.find({
    lapangan: fieldId,
    tanggal_booking: {
      $gte: moment(bookingDate).startOf('day').toDate(),
      $lte: moment(bookingDate).endOf('day').toDate()
    },
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  }).select('jam_booking durasi pelanggan status_pemesanan');
};

// Additional static methods for controller compatibility
bookingSchema.statics.findByBookingId = async function(bookingId) {
  return await this.findOne({
    $or: [
      { _id: mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null },
      { bookingId: bookingId }
    ]
  }).populate([
    { path: 'pelanggan', select: 'name email phoneNumber' },
    { path: 'lapangan', select: 'nama harga images location' }
  ]);
};

// Manual pagination method (replace mongoose-paginate-v2)
bookingSchema.statics.paginate = function(query = {}, options = {}) {
  const { page = 1, limit = 10, sort = { createdAt: -1 }, populate = [] } = options;
  const skip = (page - 1) * limit;
  
  return Promise.all([
    this.find(query)
      .populate(populate)
      .sort(sort)
      .skip(skip)
      .limit(limit),
    this.countDocuments(query)
  ]).then(([docs, totalDocs]) => ({
    docs,
    totalDocs,
    limit,
    page,
    totalPages: Math.ceil(totalDocs / limit),
    hasNextPage: page < Math.ceil(totalDocs / limit),
    hasPrevPage: page > 1,
    nextPage: page < Math.ceil(totalDocs / limit) ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null
  }));
};

export default mongoose.model('Booking', bookingSchema);