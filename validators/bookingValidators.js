import moment from 'moment-timezone';

// Booking date validation
export const validateBookingDate = (date) => {
  const bookingDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Booking harus hari ini atau masa depan
  return bookingDate >= today;
};

// Booking time format validation
export const validateBookingTime = (time) => {
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return false;
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

// Validate booking time within field operational hours
export const validateBookingWithinOperationalHours = (bookingTime, openTime, closeTime) => {
  if (!validateBookingTime(bookingTime)) return false;
  
  const [bookingHour] = bookingTime.split(':').map(Number);
  const [openHour] = openTime.split(':').map(Number);
  const [closeHour] = closeTime.split(':').map(Number);
  
  return bookingHour >= openHour && bookingHour < closeHour;
};

// Validate booking duration
export const validateBookingDuration = (bookingTime, duration, closeTime) => {
  const [bookingHour] = bookingTime.split(':').map(Number);
  const [closeHour] = closeTime.split(':').map(Number);
  
  return (bookingHour + duration) <= closeHour;
};

// Validate booking not too far in future (max 30 days)
export const validateBookingNotTooFar = (date) => {
  const bookingDate = new Date(date);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30); // 30 days from now
  
  return bookingDate <= maxDate;
};

// Validate booking not in the past for same day
export const validateBookingNotInPast = (date, time) => {
  const bookingDateTime = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
  const now = moment.tz('Asia/Jakarta');
  
  // If booking is today, time must be in future (at least 1 hour from now)
  if (bookingDateTime.format('YYYY-MM-DD') === now.format('YYYY-MM-DD')) {
    return bookingDateTime.isAfter(now.add(1, 'hour'));
  }
  
  return true;
};

// Booking status validation
export const BOOKING_STATUSES = [
  'pending',
  'confirmed', 
  'cancelled',
  'completed',
  'pending_payment',
  'dp_confirmed',
  'rejected'
];

export const validateBookingStatus = (status) => {
  return BOOKING_STATUSES.includes(status);
};

// Duration limits
export const DURATION_LIMITS = {
  MIN: 1,
  MAX: 8
};

export const validateDurationRange = (duration) => {
  return duration >= DURATION_LIMITS.MIN && duration <= DURATION_LIMITS.MAX;
};

// Pre-save validation functions for model
export const validateBookingDateRange = function(next) {
  if (!validateBookingDate(this.tanggal_booking)) {
    return next(new Error('Tanggal booking tidak boleh di masa lalu'));
  }
  
  if (!validateBookingNotTooFar(this.tanggal_booking)) {
    return next(new Error('Booking maksimal 30 hari ke depan'));
  }
  
  next();
};

export const validateBookingTimeFormat = function(next) {
  if (!validateBookingTime(this.jam_booking)) {
    return next(new Error('Format jam booking tidak valid. Gunakan format HH:MM'));
  }
  next();
};

export const validateBookingDurationRange = function(next) {
  if (!validateDurationRange(this.durasi)) {
    return next(new Error(`Durasi booking harus antara ${DURATION_LIMITS.MIN}-${DURATION_LIMITS.MAX} jam`));
  }
  next();
};

// Field type validation for booking
export const FIELD_TYPES_FOR_BOOKING = ['Badminton', 'Futsal', 'Tenis', 'Basket', 'Voli'];

export const validateFieldTypeForBooking = (fieldType) => {
  return FIELD_TYPES_FOR_BOOKING.includes(fieldType);
};

// Price validation for booking
export const validateBookingPrice = (price) => {
  return price > 0 && price <= 50000000; // Max 50 juta per booking
};

// Validate ObjectId format
export const validateObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};