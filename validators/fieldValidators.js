// Field-specific validation functions
export const validateTimeFormat = (time) => {
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return false;
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

export const validateTimeOrder = function() {
  if (!this.jam_buka || !this.jam_tutup) return true;
  
  const [openHour, openMin] = this.jam_buka.split(':').map(Number);
  const [closeHour, closeMin] = this.jam_tutup.split(':').map(Number);
  
  const openTime = openHour * 60 + openMin;
  const closeTime = closeHour * 60 + closeMin;
  
  return openTime < closeTime;
};

export const validateMinimumOperatingHours = function() {
  if (!this.jam_buka || !this.jam_tutup) return true;
  
  const [openHour, openMin] = this.jam_buka.split(':').map(Number);
  const [closeHour, closeMin] = this.jam_tutup.split(':').map(Number);
  
  const openTime = openHour * 60 + openMin;
  const closeTime = closeHour * 60 + closeMin;
  const diffMinutes = closeTime - openTime;
  
  return diffMinutes >= 60;
};

export const validateImageUrl = (url) => {
  return !url || /^https?:\/\/.+/.test(url);
};

export const FIELD_TYPES = ['Badminton', 'Futsal', 'Tenis', 'Basket', 'Voli'];

export const PRICE_LIMITS = {
  MIN: 1000,
  MAX: 10000000
};

// Pre-save validation functions
export const validateFieldTimeOrder = function(next) {
  if (!validateTimeOrder.call(this)) {
    return next(new Error('Jam buka harus lebih awal dari jam tutup'));
  }
  next();
};

export const validateFieldOperatingHours = function(next) {
  if (!validateMinimumOperatingHours.call(this)) {
    return next(new Error('Jam operasional minimal 1 jam'));
  }
  next();
};