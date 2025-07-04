import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';

export class UserService {
  
  // ============= CONSTANTS =============
  static USER_ROLES = {
    CUSTOMER: 'customer',
    CASHIER: 'cashier',
    ADMIN: 'admin'
  };

  // ============= AUTHENTICATION METHODS =============
  static generateToken(userId) {
    return jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
  }

  static verifyToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
  }

  // ============= USER MANAGEMENT =============
  static async createUser(userData) {
    const { name, email, password, role = 'customer' } = userData;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('Email sudah terdaftar');
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role
    });

    logger.info(`User created: ${user._id}`, {
      email: user.email,
      role: user.role
    });

    return user;
  }

  static async loginUser(email, password) {
    // Find user with password field
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new Error('Email atau password tidak valid');
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new Error('Email atau password tidak valid');
    }

    // Generate token
    const token = this.generateToken(user._id);

    logger.info(`User logged in: ${user._id}`, {
      email: user.email,
      role: user.role
    });

    // Remove password from response
    user.password = undefined;

    return { user, token };
  }

  static async getUserById(userId) {
    return await User.findById(userId);
  }

  static async getUserByEmail(email) {
    return await User.findOne({ email });
  }

  static async updateUserProfile(userId, updateData) {
    const allowedFields = ['name', 'picture'];
    const filteredData = {};

    allowedFields.forEach(field => {
      if (updateData[field]) {
        filteredData[field] = updateData[field];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      throw new Error('Tidak ada data valid untuk diupdate');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      filteredData,
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User tidak ditemukan');
    }

    logger.info(`User profile updated: ${user._id}`, {
      updatedFields: Object.keys(filteredData)
    });

    return user;
  }

  static async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw new Error('User tidak ditemukan');
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      throw new Error('Password saat ini tidak valid');
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user: ${user._id}`);

    return true;
  }

  // ============= ADMIN METHODS =============
  static async createCashier(adminId, userData) {
    const { name, email, password } = userData;

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('Email sudah terdaftar');
    }

    // Create cashier
    const cashier = await User.create({
      name,
      email,
      password,
      role: this.USER_ROLES.CASHIER,
      createdBy: adminId
    });

    logger.info(`Cashier created: ${cashier._id}`, {
      email: cashier.email,
      createdBy: adminId
    });

    return cashier;
  }

  static async getAllCashiers() {
    return await User.find({ role: this.USER_ROLES.CASHIER })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
  }

  static async getAllCustomers() {
    return await User.find({ role: this.USER_ROLES.CUSTOMER })
      .sort({ createdAt: -1 });
  }

  static async getUserStatistics() {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    return stats;
  }

  // ============= OAUTH METHODS =============
  static async findOrCreateGoogleUser(googleProfile) {
    const { id: googleId, emails, name, photos } = googleProfile;
    const email = emails[0].value;
    const displayName = name.displayName;
    const picture = photos[0]?.value;

    // Try to find existing user
    let user = await User.findOne({
      $or: [
        { googleId },
        { email }
      ]
    });

    if (user) {
      // Update Google ID if user exists but doesn't have it
      if (!user.googleId) {
        user.googleId = googleId;
        user.picture = picture;
        await user.save();
      }
    } else {
      // Create new user
      user = await User.create({
        googleId,
        name: displayName,
        email,
        picture,
        role: this.USER_ROLES.CUSTOMER,
        isEmailVerified: true
      });

      logger.info(`Google user created: ${user._id}`, {
        email: user.email
      });
    }

    return user;
  }

  // ============= VALIDATION METHODS =============
  static async validateUserExists(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User tidak ditemukan');
    }
    return user;
  }

  static async validateAdminPermission(userId) {
    const user = await this.validateUserExists(userId);
    if (user.role !== this.USER_ROLES.ADMIN) {
      throw new Error('Akses ditolak: hanya admin yang diizinkan');
    }
    return user;
  }

  static async validateCashierOrAdminPermission(userId) {
    const user = await this.validateUserExists(userId);
    if (!['admin', 'cashier'].includes(user.role)) {
      throw new Error('Akses ditolak: hanya admin atau kasir yang diizinkan');
    }
    return user;
  }
}