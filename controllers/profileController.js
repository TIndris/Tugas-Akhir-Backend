import User from '../models/User.js';
import logger from '../config/logger.js';
import { ProfileService } from '../services/profileService.js';

// ============= GET USER PROFILE =============
export const getProfile = async (req, res) => {
  try {
    // Get user from token (sudah tersedia dari authenticateToken middleware)
    const user = await User.findById(req.user._id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan'
      });
    }

    logger.info(`Profile accessed: ${user._id}`, {
      email: user.email,
      action: 'GET_PROFILE'
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile berhasil diambil',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          picture: user.picture || null,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAtWIB,
          updatedAt: user.updatedAtWIB
        }
      }
    });

  } catch (error) {
    logger.error(`Get profile error: ${error.message}`, {
      userId: req.user?._id,
      action: 'GET_PROFILE_ERROR'
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil profile'
    });
  }
};

// ============= UPDATE USER PROFILE =============
export const updateProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user._id;

    logger.info(`Profile update attempt: ${userId}`, {
      requestData: { name, email, phone: phone ? 'provided' : 'not provided' },
      action: 'UPDATE_PROFILE_ATTEMPT'
    });

    // ✅ MOVED TO SERVICE: Validation logic
    const validationErrors = ProfileService.validateProfileUpdate({ name, email, phone });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid',
        errors: validationErrors
      });
    }

    // ✅ KEEP: Get current user (Controller responsibility)
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan'
      });
    }

    // ✅ MOVED TO SERVICE: Email uniqueness check
    if (email.trim().toLowerCase() !== currentUser.email.toLowerCase()) {
      const isEmailUnique = await ProfileService.checkEmailUniqueness(email, userId);
      if (!isEmailUnique) {
        return res.status(400).json({
          status: 'error',
          message: 'Email sudah digunakan oleh user lain',
          errors: [{ field: 'email', message: 'Email sudah terdaftar' }]
        });
      }
    }

    // ✅ MOVED TO SERVICE: Update operation
    const updatedUser = await ProfileService.updateUserProfile(userId, { name, email, phone });

    // ✅ KEEP: Logging and response (Controller responsibility)
    logger.info(`Profile updated successfully: ${userId}`, {
      updatedFields: ['name', 'email', phone ? 'phone' : null].filter(Boolean),
      action: 'UPDATE_PROFILE_SUCCESS'
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile berhasil diperbarui',
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          picture: updatedUser.picture,
          role: updatedUser.role,
          isEmailVerified: updatedUser.isEmailVerified,
          createdAt: updatedUser.createdAtWIB,
          updatedAt: updatedUser.updatedAtWIB
        }
      }
    });

  } catch (error) {
    logger.error(`Update profile error: ${error.message}`, {
      userId: req.user?._id,
      action: 'UPDATE_PROFILE_ERROR',
      stack: error.stack
    });

    // ✅ KEEP: Error handling
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid',
        errors: validationErrors
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        status: 'error',
        message: `${field} sudah digunakan`,
        errors: [{ field, message: `${field} sudah terdaftar` }]
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui profile'
    });
  }
};