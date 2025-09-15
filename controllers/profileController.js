import User from '../models/User.js';
import logger from '../config/logger.js';
import { ProfileService } from '../services/profileService.js';


export const getProfile = async (req, res) => {
  try {
    const user = req.user;
    
    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          authProvider: user.authProvider,
          isEmailVerified: user.isEmailVerified,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error getting profile'
    });
  }
};


export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updateData = req.body;

    // ✅ ALLOW PHONE FIELD UPDATES
    const allowedFields = ['name', 'email', 'phone', 'phoneNumber', 'dateOfBirth', 'address'];
    const filteredData = {};
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    });

    // ✅ SYNC PHONE FIELDS
    if (filteredData.phone) {
      filteredData.phoneNumber = filteredData.phone;
    }
    if (filteredData.phoneNumber) {
      filteredData.phone = filteredData.phoneNumber;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      filteredData,
      { new: true, runValidators: true }
    ).select('-password');

    // ✅ ENHANCED RESPONSE WITH PHONE
    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone || updatedUser.phoneNumber, // ✅ INCLUDE PHONE
          phoneNumber: updatedUser.phoneNumber || updatedUser.phone, // ✅ INCLUDE ALIAS
          role: updatedUser.role,
          authProvider: updatedUser.authProvider,
          isEmailVerified: updatedUser.isEmailVerified,
          lastLogin: updatedUser.lastLogin,
          updatedAt: updatedUser.updatedAt
        }
      }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal memperbarui profil'
    });
  }
};