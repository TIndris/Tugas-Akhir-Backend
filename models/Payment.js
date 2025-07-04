import mongoose from 'mongoose';
import moment from 'moment-timezone';

const paymentSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: [true, 'Booking ID harus diisi']
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID harus diisi']
  },
  payment_type: {
    type: String,
    enum: {
      values: ['full_payment', 'dp_payment'],
      message: 'Tipe pembayaran tidak valid'
    },
    required: [true, 'Tipe pembayaran harus diisi']
  },
  amount: {
    type: Number,
    required: [true, 'Jumlah pembayaran harus diisi'],
    min: [1000, 'Minimal pembayaran Rp 1.000']
  },
  total_booking_amount: {
    type: Number,
    required: [true, 'Total harga booking harus diisi']
  },
  remaining_amount: {
    type: Number,
    default: 0
  },
  payment_method: {
    type: String,
    enum: {
      values: ['bank_transfer_bsi'],
      message: 'Metode pembayaran tidak valid'
    },
    default: 'bank_transfer_bsi'
  },
  bank_details: {
    bank_name: {
      type: String,
      default: 'Bank Syariah Indonesia (BSI)'
    },
    account_number: {
      type: String,
      default: '1234567890'
    },
    account_name: {
      type: String,
      default: 'PT Lapangan Olahraga Indonesia'
    }
  },
  transfer_proof: {
    type: String, // Cloudinary URL
    required: [true, 'Bukti transfer harus diupload']
  },
  transfer_details: {
    sender_name: {
      type: String,
      required: [true, 'Nama pengirim harus diisi']
    },
    transfer_amount: {
      type: Number,
      required: [true, 'Jumlah transfer harus diisi']
    },
    transfer_date: {
      type: Date,
      required: [true, 'Tanggal transfer harus diisi']
    },
    transfer_reference: {
      type: String,
      trim: true
    }
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'verified', 'rejected'],
      message: 'Status pembayaran tidak valid'
    },
    default: 'pending'
  },
  verified_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verified_at: {
    type: Date
  },
  rejection_reason: {
    type: String
  },
  notes: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields
paymentSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

paymentSchema.virtual('verifiedAtWIB').get(function() {
  return this.verified_at ? moment(this.verified_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') : null;
});

paymentSchema.virtual('payment_type_text').get(function() {
  return this.payment_type === 'full_payment' ? 'Pembayaran Penuh' : 'Pembayaran DP';
});

paymentSchema.virtual('status_text').get(function() {
  const statusMap = {
    'pending': 'Menunggu Verifikasi',
    'verified': 'Terverifikasi',
    'rejected': 'Ditolak'
  };
  return statusMap[this.status];
});

// Middleware untuk menghitung remaining amount
paymentSchema.pre('save', function(next) {
  if (this.payment_type === 'dp_payment') {
    this.remaining_amount = this.total_booking_amount - this.amount;
  } else {
    this.remaining_amount = 0;
  }
  next();
});

// Index untuk performance
paymentSchema.index({ booking: 1 });
paymentSchema.index({ user: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ payment_type: 1 });

export default mongoose.model('Payment', paymentSchema);