import mongoose from 'mongoose';
import moment from 'moment-timezone';
import {
  validatePaymentAmountForType,
  validateTransferAmountField,
  validateTransferDateField,
  validateSenderNameField,
  PAYMENT_TYPES,
  PAYMENT_STATUSES
} from '../validators/paymentValidators.js';

const paymentSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  payment_type: {
    type: String,
    enum: {
      values: PAYMENT_TYPES,
      message: 'Tipe pembayaran tidak valid'
    },
    required: [true, 'Tipe pembayaran harus diisi']
  },
  amount: {
    type: Number,
    required: [true, 'Jumlah pembayaran harus diisi'],
    min: [50000, 'Minimal pembayaran Rp 50.000'] // Updated minimum
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
      required: true,
      trim: true
    },
    transfer_amount: {
      type: Number,
      required: true,
      min: 0
    },
    transfer_date: {
      type: Date,  // ← Store as Date object
      required: true
    },
    transfer_date_string: {
      type: String,  // ← Store original string "2025-07-06"
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/  // ← Validate YYYY-MM-DD format
    },
    transfer_reference: {
      type: String,
      trim: true
    }
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'verified', 'rejected', 'replaced'],
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
  previous_rejection_reason: {
    type: String
  },
  replaced_at: {
    type: Date
  },
  replaced_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============= VIRTUAL FIELDS ONLY =============
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

// ✅ Virtual for Indonesian date display
paymentSchema.virtual('transfer_details.transfer_date_display').get(function() {
  if (this.transfer_details.transfer_date_string) {
    const date = new Date(this.transfer_details.transfer_date_string + 'T00:00:00.000Z');
    return date.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  return null;
});

// ============= VALIDATION MIDDLEWARE =============
paymentSchema.pre('save', validatePaymentAmountForType);
paymentSchema.pre('save', validateTransferAmountField);
paymentSchema.pre('save', validateTransferDateField);
paymentSchema.pre('save', validateSenderNameField);

// ============= BUSINESS LOGIC MIDDLEWARE =============
paymentSchema.pre('save', function(next) {
  // Calculate remaining amount
  if (this.payment_type === 'dp_payment') {
    this.remaining_amount = this.total_booking_amount - this.amount;
  } else {
    this.remaining_amount = 0;
  }
  next();
});

// ============= INDEXES =============
paymentSchema.index({ booking: 1 });
paymentSchema.index({ user: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ payment_type: 1 });
paymentSchema.index({ verified_by: 1 });

export default mongoose.model('Payment', paymentSchema);