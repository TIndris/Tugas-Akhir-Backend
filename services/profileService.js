// services/profileService.js - NEW FILE
import User from '../models/User.js';

export class ProfileService {
  
  // ✅ MOVE: Profile validation logic from controller
  static validateProfileUpdate(profileData) {
    const { name, email, phone } = profileData;
    const errors = [];

    // Validate name
    if (!name || !name.trim()) {
      errors.push({ field: 'name', message: 'Nama harus diisi' });
    } else if (name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Nama minimal 2 karakter' });
    } else if (name.trim().length > 50) {
      errors.push({ field: 'name', message: 'Nama maksimal 50 karakter' });
    }

    // Validate email
    if (!email || !email.trim()) {
      errors.push({ field: 'email', message: 'Email harus diisi' });
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.push({ field: 'email', message: 'Format email tidak valid' });
      }
    }

    // Validate phone (optional)
    if (phone && phone.trim()) {
      const phoneRegex = /^[0-9+\-\s()]+$/;
      if (!phoneRegex.test(phone.trim())) {
        errors.push({ field: 'phone', message: 'Format nomor telepon tidak valid' });
      }
    }

    return errors;
  }

  // ✅ MOVE: Email uniqueness check from controller  
  static async checkEmailUniqueness(email, userId) {
    const existingUser = await User.findOne({ 
      email: email.trim().toLowerCase(),
      _id: { $ne: userId }
    });
    
    return !existingUser;
  }

  // ✅ MOVE: Update profile logic
  static async updateUserProfile(userId, profileData) {
    const { name, email, phone } = profileData;
    
    const updateData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone && phone.trim() ? phone.trim() : null
    };

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { 
        new: true, 
        runValidators: true,
        select: '-password'
      }
    );

    if (!updatedUser) {
      throw new Error('User tidak ditemukan');
    }

    return updatedUser;
  }
}