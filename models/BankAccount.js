import mongoose from 'mongoose';
import moment from 'moment-timezone';

const bankAccountSchema = new mongoose.Schema({
  bank_name: {
    type: String,
    required: [true, 'Nama bank harus diisi'],
    trim: true
  },
  account_number: {
    type: String,
    required: [true, 'Nomor rekening harus diisi'],
    trim: true,
    unique: true
  },
  account_name: {
    type: String,
    required: [true, 'Nama pemilik rekening harus diisi'],
    trim: true
  },
  account_type: {
    type: String,
    enum: ['Tabungan', 'Giro'],
    default: 'Tabungan'
  },
  is_active: {
    type: Boolean,
    default: true
  },
  is_primary: {
    type: Boolean,
    default: false
  },
  description: {
    type: String,
    trim: true
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for WIB format
bankAccountSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

// Ensure only one primary account
bankAccountSchema.pre('save', async function(next) {
  if (this.is_primary && this.isModified('is_primary')) {
    // Set other accounts as non-primary
    await this.constructor.updateMany(
      { _id: { $ne: this._id } },
      { is_primary: false }
    );
  }
  next();
});

// Index
bankAccountSchema.index({ is_active: 1, is_primary: 1 });

export default mongoose.model('BankAccount', bankAccountSchema);