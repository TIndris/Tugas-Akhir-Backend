// Email validation
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Password validation
export const validatePassword = (password) => {
  // At least 8 characters, contains number and letter
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;
  return passwordRegex.test(password);
};

// Strong password validation (optional)
export const validateStrongPassword = (password) => {
  // At least 8 characters, uppercase, lowercase, number, special char
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password);
};

// Name validation
export const validateName = (name) => {
  // Only letters, spaces, minimum 2 characters, maximum 50
  const nameRegex = /^[a-zA-Z\s]{2,50}$/;
  return nameRegex.test(name.trim());
};

// Indonesian phone number validation
export const validatePhoneNumber = (phone) => {
  // Indonesian phone format: +62, 08, 62
  const phoneRegex = /^(\+62|62|0)8[1-9][0-9]{6,9}$/;
  return phoneRegex.test(phone);
};

// Role validation
export const USER_ROLES = ['customer', 'cashier', 'admin'];

export const validateRole = (role) => {  // ← RENAMED dari validateUserRole
  return USER_ROLES.includes(role);
};

// Google ID validation
export const validateGoogleId = (googleId) => {
  return googleId && typeof googleId === 'string' && googleId.length > 0;
};

// Picture URL validation
export const validatePictureUrl = (url) => {
  if (!url) return true; // Optional field
  const urlRegex = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i;
  return urlRegex.test(url);
};

// Age validation (if needed)
export const validateAge = (birthDate) => {
  const today = new Date();
  const birth = new Date(birthDate);
  const age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age >= 13 && age <= 100; // Minimum 13 years old
};

// Password confirmation validation
export const validatePasswordConfirmation = (password, confirmPassword) => {
  return password === confirmPassword;
};

// Pre-save validation functions for model
export const validateUserEmail = function(next) {
  if (!validateEmail(this.email)) {
    return next(new Error('Format email tidak valid'));
  }
  next();
};

export const validateUserName = function(next) {
  if (!validateName(this.name)) {
    return next(new Error('Nama harus terdiri dari 2-50 karakter huruf'));
  }
  next();
};

export const validateUserPassword = function(next) {
  // Only validate if password is being modified and not from Google OAuth
  if (this.isModified('password') && !this.googleId) {
    if (!validatePassword(this.password)) {
      return next(new Error('Password minimal 8 karakter, harus mengandung huruf dan angka'));
    }
  }
  next();
};

export const validateUserRoleField = function(next) {  // ← RENAMED dari validateUserRole
  if (!validateRole(this.role)) {  // ← Updated to use validateRole
    return next(new Error('Role user tidak valid'));
  }
  next();
};

// Admin/Cashier creation validation
export const validateAdminCashierCreation = function(next) {
  // Admin and cashier must have password (not OAuth)
  if (['admin', 'cashier'].includes(this.role) && this.googleId) {
    return next(new Error('Admin dan kasir tidak boleh menggunakan OAuth'));
  }
  
  // Admin and cashier must have strong password
  if (['admin', 'cashier'].includes(this.role) && this.isModified('password')) {
    if (!validateStrongPassword(this.password)) {
      return next(new Error('Admin dan kasir harus menggunakan password yang kuat'));
    }
  }
  
  next();
};

// Email domain validation (optional, for company emails)
export const validateEmailDomain = (email, allowedDomains = []) => {
  if (allowedDomains.length === 0) return true;
  
  const domain = email.split('@')[1];
  return allowedDomains.includes(domain);
};

// Check if user can be deleted
export const validateUserDeletion = async function(userId) {
  // Check if user has active bookings
  const mongoose = await import('mongoose');
  const Booking = mongoose.default.model('Booking');
  const activeBookings = await Booking.countDocuments({
    pelanggan: userId,
    status_pemesanan: { $in: ['pending', 'confirmed'] }
  });
  
  return activeBookings === 0;
};

// Username validation (if needed)
export const validateUsername = (username) => {
  // 3-20 characters, alphanumeric and underscore only
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

// Profile completeness validation
export const validateProfileCompleteness = (user) => {
  const requiredFields = ['name', 'email'];
  const optionalFields = ['phone', 'picture'];
  
  const completed = requiredFields.every(field => 
    user[field] && user[field].toString().trim().length > 0
  );
  
  const completeness = {
    isComplete: completed,
    missingFields: requiredFields.filter(field => 
      !user[field] || user[field].toString().trim().length === 0
    ),
    score: (requiredFields.length + optionalFields.filter(field => 
      user[field] && user[field].toString().trim().length > 0
    ).length) / (requiredFields.length + optionalFields.length) * 100
  };
  
  return completeness;
};