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
    enum: {
      values: ['no_payment', 'pending_payment', 'dp_confirmed', 'fully_paid'],
      message: 'Status pembayaran tidak valid'
    },
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

  // ✅ TAMBAHKAN: Validasi status lapangan
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

// Add static method to check availability
bookingSchema.statics.checkAvailability = async function(fieldId, date, time) {
  const existingBooking = await this.findOne({
    lapangan: fieldId,
    tanggal_booking: date,
    jam_booking: time,
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  });
  return !existingBooking;
};

// Get all bookings for a specific date and field
bookingSchema.statics.getBookedSlots = async function(fieldId, date) {
  return await this.find({
    lapangan: fieldId,
    tanggal_booking: date,
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  }).select('jam_booking durasi');
};

export default mongoose.model('Booking', bookingSchema);