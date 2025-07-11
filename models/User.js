import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import {
  validateUserEmail,
  validateUserName,
  validateUserPassword,
  validateUserRoleField,  // ← UPDATED nama import
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
    select: false
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
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Pre-save validations
userSchema.pre('save', validateUserEmail);
userSchema.pre('save', validateUserName);
userSchema.pre('save', validateUserPassword);
userSchema.pre('save', validateUserRoleField);  // ← UPDATED nama function
userSchema.pre('save', validateAdminCashierCreation);

// Index untuk performance
userSchema.index({ role: 1 });

export default mongoose.model('User', userSchema);