import mongoose from 'mongoose';
import moment from 'moment-timezone';

const fieldSchema = new mongoose.Schema({
  nama: {
    type: String,
    required: [true, 'Nama lapangan harus diisi'],
    unique: true
  },
  jenis_lapangan: {
    type: String,
    required: [true, 'Jenis lapangan harus diisi'],
    trim: true
  },
  jam_buka: {
    type: String,
    required: [true, 'Jam buka harus diisi']
  },
  jam_tutup: {
    type: String,
    required: [true, 'Jam tutup harus diisi']
  },
  harga: {
    type: Number,
    required: [true, 'Harga harus diisi']
  },
  status: {
    type: String,
    enum: ['tersedia', 'tidak tersedia'],
    default: 'tersedia'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  gambar: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }, // Include virtuals when converting to JSON
  toObject: { virtuals: true }
});

// Virtual fields untuk format Indonesia
fieldSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

fieldSchema.virtual('updatedAtWIB').get(function() {
  return moment(this.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

// Index untuk performance
fieldSchema.index({ jenis_lapangan: 1 });
fieldSchema.index({ status: 1 });

export default mongoose.model('Field', fieldSchema);