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
    const { name, phone } = req.body;
    const userId = req.user._id;

    const updateData = {};
    
    if (name !== undefined) {
      updateData.name = name;
    }
    
    if (phone !== undefined) {
      updateData.phone = phone;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    logger.info('Profile updated successfully', {
      userId: updatedUser._id,
      email: updatedUser.email,
      changes: updateData
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
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
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Error updating profile'
    });
  }
};