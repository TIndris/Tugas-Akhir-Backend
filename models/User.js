import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nama wajib diisi'],
    trim: true,
    minlength: [2, 'Nama minimal 2 karakter'],
    maxlength: [50, 'Nama maksimal 50 karakter']
  },
  email: {
    type: String,
    required: [true, 'Email wajib diisi'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Format email tidak valid']
  },
  password: {
    type: String,
    minlength: [6, 'Password minimal 6 karakter'],
    select: false // Hide by default
  },
  role: {
    type: String,
    enum: ['customer', 'cashier', 'admin'],
    default: 'customer'
  },
  // ✅ REMOVED: picture field completely
  phone: {
    type: String,
    match: [/^(\+62|62|0)[0-9]{8,13}$/, 'Format nomor telepon tidak valid']
  },
  // ✅ Google OAuth fields
  googleId: {
    type: String,
    sparse: true // Allow multiple null values
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ Pre-save middleware
userSchema.pre('save', async function(next) {
  try {
    // Update timestamp
    this.updatedAt = new Date();

    // Only hash password if it's modified and exists
    if (!this.isModified('password') || !this.password) {
      return next();
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) {
    return false; // No password set (Google user)
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// ✅ JSON transform to hide sensitive fields
userSchema.set('toJSON', {
  transform: function(doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('User', userSchema);