import mongoose from 'mongoose';

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
    required: [true, 'Jenis lapangan harus diisi']
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
    min: [1, 'Durasi minimal 1 jam']
  },
  harga: {
    type: Number,
    required: [true, 'Harga harus diisi']
  },
  status_pemesanan: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  kasir: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // Opsional karena awalnya booking belum dikonfirmasi kasir
  },
  konfirmasi_at: {
    type: Date
  }
}, {
  timestamps: true
});

// Middleware untuk mengecek ketersediaan lapangan
bookingSchema.pre('save', async function(next) {
  // Get field details for operational hours check
  const field = await mongoose.model('Field').findById(this.lapangan);
  if (!field) {
    throw new Error('Lapangan tidak ditemukan');
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
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });

    if (existingBooking) {
      throw new Error('Lapangan sudah dibooking pada waktu tersebut');
    }
  }

  next();
});

// Tambahkan index untuk performance
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