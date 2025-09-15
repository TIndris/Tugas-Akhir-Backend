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
  // ✅ KEEP: Original fields dengan field names Indonesia
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
  
  // ✅ KEEP: Payment integration fields
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
  
  // ✅ KEEP: SMS Notification tracking fields
  paymentReminderSent: {
    type: Boolean,
    default: false
  },
  preparationReminderSent: {
    type: Boolean,
    default: false
  },
  confirmationSent: {
    type: Boolean,
    default: false
  },
  expiredAt: {
    type: Date
  },

  // ✅ ADD: Controller compatibility fields (alias/virtual mapping)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    get: function() { return this.pelanggan; },
    set: function(value) { this.pelanggan = value; }
  },
  fieldId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    get: function() { return this.lapangan; },
    set: function(value) { this.lapangan = value; }
  },
  bookingId: {
    type: String,
    unique: true,
    sparse: true // Allow null values but enforce uniqueness when present
  },
  date: {
    type: String,
    get: function() { 
      return moment(this.tanggal_booking).format('YYYY-MM-DD'); 
    },
    set: function(value) { 
      this.tanggal_booking = new Date(value); 
    }
  },
  startTime: {
    type: String,
    get: function() { return this.jam_booking; },
    set: function(value) { this.jam_booking = value; }
  },
  endTime: {
    type: String,
    get: function() {
      if (this.jam_booking && this.durasi) {
        const startMoment = moment(this.jam_booking, 'HH:mm');
        const endMoment = startMoment.clone().add(this.durasi, 'hours');
        return endMoment.format('HH:mm');
      }
      return null;
    }
  },
  duration: {
    type: Number,
    get: function() { return this.durasi; },
    set: function(value) { this.durasi = value; }
  },
  totalAmount: {
    type: Number,
    get: function() { return this.harga; },
    set: function(value) { this.harga = value; }
  },
  status: {
    type: String,
    get: function() { return this.status_pemesanan; },
    set: function(value) { this.status_pemesanan = value; }
  },
  paymentStatus: {
    type: String,
    get: function() { return this.payment_status; },
    set: function(value) { this.payment_status = value; }
  },
  notes: {
    type: String,
    get: function() { return this.catatan; },
    set: function(value) { this.catatan = value; }
  },

  // ✅ ADD: Additional tracking fields for SMS system
  cancelledAt: Date,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastUpdated: Date

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

// ✅ KEEP: Payment status text virtual
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

// ✅ ADD: Virtual for controller compatibility
bookingSchema.virtual('fieldName').get(function() {
  return this.lapangan?.name || this.fieldId?.name;
});

bookingSchema.virtual('customerName').get(function() {
  return this.pelanggan?.name || this.userId?.name;
});

// ✅ KEEP: Pre-save validations
bookingSchema.pre('save', validateBookingDateRange);
bookingSchema.pre('save', validateBookingTimeFormat);
bookingSchema.pre('save', validateBookingDurationRange);

// ✅ ENHANCE: Middleware untuk mengecek ketersediaan lapangan
bookingSchema.pre('save', async function(next) {
  try {
    // Get field details for operational hours check
    const fieldId = this.lapangan || this.fieldId;
    const field = await mongoose.model('Field').findById(fieldId);
    
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }

    if (field.status !== 'tersedia' && field.isAvailable !== true) {
      throw new Error(`Lapangan sedang ${field.status} dan tidak dapat dibooking`);
    }

    // Parse booking time and operational hours
    const bookingTime = this.jam_booking || this.startTime;
    const bookingHour = parseInt(bookingTime.split(':')[0]);
    const bookingDuration = this.durasi || this.duration;
    
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

    // Check slot availability
    if (this.isNew || this.isModified('tanggal_booking') || this.isModified('jam_booking')) {
      const bookingDate = this.tanggal_booking || new Date(this.date);
      
      const existingBooking = await this.constructor.findOne({
        $or: [
          { lapangan: fieldId },
          { fieldId: fieldId }
        ],
        $or: [
          { tanggal_booking: bookingDate },
          { date: moment(bookingDate).format('YYYY-MM-DD') }
        ],
        $or: [
          { jam_booking: bookingTime },
          { startTime: bookingTime }
        ],
        _id: { $ne: this._id },
        $or: [
          { status_pemesanan: { $in: ['pending', 'confirmed'] } },
          { status: { $in: ['pending', 'confirmed'] } }
        ]
      });

      if (existingBooking) {
        throw new Error('Lapangan sudah dibooking pada waktu tersebut');
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

// ✅ ENHANCE: Indexes untuk performance
bookingSchema.index({ lapangan: 1, tanggal_booking: 1 });
bookingSchema.index({ fieldId: 1, date: 1 });
bookingSchema.index({ pelanggan: 1 });
bookingSchema.index({ userId: 1 });
bookingSchema.index({ status_pemesanan: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ payment_status: 1, createdAt: 1 });

// ✅ KEEP: Static methods
bookingSchema.statics.checkAvailability = async function(fieldId, date, time) {
  const existingBooking = await this.findOne({
    $or: [
      { lapangan: fieldId },
      { fieldId: fieldId }
    ],
    $or: [
      { tanggal_booking: new Date(date) },
      { date: date }
    ],
    $or: [
      { jam_booking: time },
      { startTime: time }
    ],
    $or: [
      { status_pemesanan: { $in: ['pending', 'confirmed'] } },
      { status: { $in: ['pending', 'confirmed'] } }
    ]
  });
  return !existingBooking;
};

bookingSchema.statics.getBookedSlots = async function(fieldId, date) {
  return await this.find({
    $or: [
      { lapangan: fieldId },
      { fieldId: fieldId }
    ],
    $or: [
      { tanggal_booking: new Date(date) },
      { date: date }
    ],
    $or: [
      { status_pemesanan: { $in: ['pending', 'confirmed'] } },
      { status: { $in: ['pending', 'confirmed'] } }
    ]
  }).select('jam_booking startTime pelanggan userId');
};

// ✅ ADD: Additional static methods for controller compatibility
bookingSchema.statics.findByBookingId = async function(bookingId) {
  return await this.findOne({
    $or: [
      { _id: bookingId },
      { bookingId: bookingId }
    ]
  }).populate([
    { path: 'pelanggan', select: 'name email phoneNumber' },
    { path: 'userId', select: 'name email phoneNumber' },
    { path: 'lapangan', select: 'name pricePerHour images location facilities' },
    { path: 'fieldId', select: 'name pricePerHour images location facilities' }
  ]);
};

// ✅ KEEP: Export model only
export default mongoose.model('Booking', bookingSchema);