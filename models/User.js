import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import {
  validateUserEmail,
  validateUserName,
  validateUserPassword,
  validateUserRoleField,
  validateAdminCashierCreation,
  validateEmail,
  validatePictureUrl,
  USER_ROLES
} from '../validators/userValidators.js';

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  name: {
    type: String,
    required: [true, 'Nama harus diisi'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email harus diisi'],
    unique: true,
    lowercase: true,
    validate: {
      validator: validateEmail,
      message: 'Format email tidak valid'
    }
  },
  
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function(phone) {
        if (!phone) return true; // Optional field
        return /^(\+62|62|0)8[1-9][0-9]{6,9}$/.test(phone);
      },
      message: 'Format nomor telepon tidak valid (08xxxxxxxxx)'
    }
  },
  password: {
    type: String,
    select: false,
    required: function() {
      return !this.googleId; // Password tidak required jika ada googleId
    }
  },
  role: {
    type: String,
    enum: {
      values: USER_ROLES,
      message: 'Role tidak valid'
    },
    default: 'customer'
  },
  picture: {
    type: String,
    validate: {
      validator: validatePictureUrl,
      message: 'URL gambar tidak valid'
    }
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  lastLogin: {
    type: Date
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields untuk format Indonesia
userSchema.virtual('createdAtWIB').get(function() {
  return moment(this.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

userSchema.virtual('updatedAtWIB').get(function() {
  return moment(this.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
});

// Prevent Google OAuth users from being admin/cashier
userSchema.pre('save', function(next) {
  if (this.googleId && ['admin', 'cashier'].includes(this.role)) {
    throw new Error('OAuth users can only be customers');
  }
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Skip jika password tidak dimodifikasi
  if (!this.isModified('password')) return next();
  
  // Skip jika Google user tanpa password
  if (this.googleId && !this.password) return next();
  
  // Hash password jika ada
  if (this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  
  next();
});

// Method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) {
    throw new Error('User does not have a password');
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Helper methods untuk Google OAuth
userSchema.methods.isGoogleUser = function() {
  return !!this.googleId;
};

userSchema.methods.canLoginWithPassword = function() {
  return !!this.password;
};

// Pre-save validations
userSchema.pre('save', validateUserEmail);
userSchema.pre('save', validateUserName);

// Password validation - skip untuk Google users
userSchema.pre('save', function(next) {
  // Skip password validation untuk Google users
  if (this.googleId && !this.password) {
    return next();
  }
  // Jalankan validasi password normal
  return validateUserPassword.call(this, next);
});

userSchema.pre('save', validateUserRoleField);
userSchema.pre('save', validateAdminCashierCreation);

// Index untuk performance
userSchema.index({ role: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ authProvider: 1 });

export default mongoose.model('User', userSchema);