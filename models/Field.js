import mongoose from 'mongoose';
import moment from 'moment-timezone';
import {
  validateTimeFormat,
  validateImageUrl,
  validateFieldTimeOrder,
  validateFieldOperatingHours,
  FIELD_TYPES,
  PRICE_LIMITS
} from '../validators/fieldValidators.js';

const fieldSchema = new mongoose.Schema({
  nama: {
    type: String,
    required: [true, 'Nama lapangan harus diisi'],
    unique: true,
    trim: true
  },
  jenis_lapangan: {
    type: String,
    required: [true, 'Jenis lapangan harus diisi'],
    trim: true,
    enum: {
      values: FIELD_TYPES,
      message: 'Jenis lapangan tidak valid'
    }
  },
  jam_buka: {
    type: String,
    required: [true, 'Jam buka harus diisi'],
    validate: {
      validator: validateTimeFormat,
      message: 'Format jam buka tidak valid. Gunakan format HH:MM (00:00 - 23:59)'
    }
  },
  jam_tutup: {
    type: String,
    required: [true, 'Jam tutup harus diisi'],
    validate: {
      validator: validateTimeFormat,
      message: 'Format jam tutup tidak valid. Gunakan format HH:MM (00:00 - 23:59)'
    }
  },
  harga: {
    type: Number,
    required: [true, 'Harga harus diisi'],
    min: [PRICE_LIMITS.MIN, `Harga minimal Rp ${PRICE_LIMITS.MIN.toLocaleString('id-ID')}`],
    max: [PRICE_LIMITS.MAX, `Harga maksimal Rp ${PRICE_LIMITS.MAX.toLocaleString('id-ID')}`]
  },
  status: {
    type: String,
    enum: {
      values: ['tersedia', 'tidak tersedia'],
      message: 'Status harus tersedia atau tidak tersedia'
    },
    default: 'tersedia'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  gambar: {
    type: String,
    validate: {
      validator: validateImageUrl,
      message: 'URL gambar tidak valid'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Pre-save validations
fieldSchema.pre('save', validateFieldTimeOrder);
fieldSchema.pre('save', validateFieldOperatingHours);

// Virtual fields untuk format Indonesia
fieldSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

fieldSchema.virtual('updatedAtWIB').get(function() {
  return moment(this.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

fieldSchema.virtual('jamOperasional').get(function() {
  return `${this.jam_buka} - ${this.jam_tutup}`;
});

// Index untuk performance
fieldSchema.index({ jenis_lapangan: 1 });
fieldSchema.index({ status: 1 });

export default mongoose.model('Field', fieldSchema);