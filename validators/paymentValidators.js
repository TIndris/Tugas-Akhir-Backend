import moment from 'moment-timezone';

// Payment type validation
export const PAYMENT_TYPES = ['full_payment', 'dp_payment'];
export const PAYMENT_STATUSES = ['pending', 'verified', 'rejected'];
export const DP_AMOUNT = 50000;

export const validatePaymentType = (paymentType) => {
  return PAYMENT_TYPES.includes(paymentType);
};

export const validatePaymentStatus = (status) => {
  return PAYMENT_STATUSES.includes(status);
};

// Transfer amount validation
export const validateTransferAmount = (amount) => {
  return amount > 0 && amount <= 100000000; // Max 100 juta
};

// Transfer date validation
export const validateTransferDate = (date) => {
  const transferDate = moment(date);
  const now = moment();
  const maxPastDays = 7; // Max 7 days in the past
  
  return transferDate.isValid() && 
         transferDate.isBefore(now) &&
         transferDate.isAfter(now.clone().subtract(maxPastDays, 'days'));
};

// Sender name validation
export const validateSenderName = (name) => {
  return name && name.trim().length >= 2 && name.trim().length <= 100;
};

// DP amount validation
export const validateDPAmount = (amount) => {
  return amount === DP_AMOUNT;
};

// Full payment amount validation
export const validateFullPaymentAmount = (amount, totalBookingAmount) => {
  return amount === totalBookingAmount;
};

// Bank account number validation (BSI format)
export const validateBSIAccountNumber = (accountNumber) => {
  // BSI account numbers are typically 10-13 digits
  const bsiAccountRegex = /^\d{10,13}$/;
  return bsiAccountRegex.test(accountNumber);
};

// Transfer reference validation
export const validateTransferReference = (reference) => {
  // Optional field, but if provided should be 6-20 characters
  if (!reference) return true;
  return reference.trim().length >= 6 && reference.trim().length <= 20;
};

// Pre-save validation functions for model
export const validatePaymentAmountForType = function(next) {
  if (this.payment_type === 'dp_payment') {
    if (this.amount !== DP_AMOUNT) {
      return next(new Error(`DP harus tepat Rp ${DP_AMOUNT.toLocaleString('id-ID')}`));
    }
  } else if (this.payment_type === 'full_payment') {
    if (this.amount !== this.total_booking_amount) {
      return next(new Error('Pembayaran penuh harus sama dengan total booking'));
    }
  }
  next();
};

export const validateTransferAmountField = function(next) {
  if (!validateTransferAmount(this.transfer_details.transfer_amount)) {
    return next(new Error('Jumlah transfer tidak valid'));
  }
  next();
};

export const validateTransferDateField = function(next) {
  if (!validateTransferDate(this.transfer_details.transfer_date)) {
    return next(new Error('Tanggal transfer tidak valid (maksimal 7 hari yang lalu)'));
  }
  next();
};

export const validateSenderNameField = function(next) {
  if (!validateSenderName(this.transfer_details.sender_name)) {
    return next(new Error('Nama pengirim harus 2-100 karakter'));
  }
  next();
};