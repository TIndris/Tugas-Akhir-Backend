import moment from 'moment-timezone';

// ============= CONSTANTS =============
export const PAYMENT_TYPES = ['full_payment', 'dp_payment'];
export const PAYMENT_STATUSES = ['pending', 'verified', 'rejected'];
export const DP_AMOUNT = 50000;
export const MIN_TRANSFER_AMOUNT = 50000;
export const MAX_TRANSFER_AMOUNT = 100000000; // 100 juta
export const MAX_TRANSFER_DAYS_PAST = 7;

// ============= BASIC VALIDATORS =============
export const validatePaymentType = (paymentType) => {
  return PAYMENT_TYPES.includes(paymentType);
};

export const validatePaymentStatus = (status) => {
  return PAYMENT_STATUSES.includes(status);
};

export const validateTransferAmount = (amount) => {
  return amount >= MIN_TRANSFER_AMOUNT && amount <= MAX_TRANSFER_AMOUNT;
};

export const validateTransferDate = (date) => {
  const transferDate = moment(date);
  const now = moment();
  
  return transferDate.isValid() && 
         transferDate.isBefore(now) &&
         transferDate.isAfter(now.clone().subtract(MAX_TRANSFER_DAYS_PAST, 'days'));
};

export const validateSenderName = (name) => {
  return name && name.trim().length >= 2 && name.trim().length <= 100;
};

export const validateDPAmount = (amount) => {
  return amount === DP_AMOUNT;
};

export const validateFullPaymentAmount = (amount, totalBookingAmount) => {
  return amount === totalBookingAmount;
};

export const validateTransferReference = (reference) => {
  if (!reference) return true; // Optional field
  return reference.trim().length >= 3 && reference.trim().length <= 50;
};

// ============= BUSINESS LOGIC VALIDATORS =============
export const validatePaymentAmountLogic = (paymentType, amount, totalBookingAmount) => {
  if (paymentType === 'dp_payment') {
    if (!validateDPAmount(amount)) {
      throw new Error(`DP harus tepat Rp ${DP_AMOUNT.toLocaleString('id-ID')}`);
    }
    if (totalBookingAmount < DP_AMOUNT) {
      throw new Error(`Total booking minimal Rp ${DP_AMOUNT.toLocaleString('id-ID')} untuk DP`);
    }
  } else if (paymentType === 'full_payment') {
    if (!validateFullPaymentAmount(amount, totalBookingAmount)) {
      throw new Error('Jumlah pembayaran harus sama dengan total booking');
    }
  } else {
    throw new Error('Tipe pembayaran tidak valid');
  }
};

export const validateTransferMatchesPayment = (transferAmount, paymentAmount) => {
  if (transferAmount !== paymentAmount) {
    throw new Error('Jumlah transfer harus sama dengan jumlah pembayaran');
  }
};

export const validateTransferNotFuture = (transferDate) => {
  const today = new Date();
  const transferDateObj = new Date(transferDate);
  
  if (transferDateObj > today) {
    throw new Error('Tanggal transfer tidak boleh di masa depan');
  }
};

export const validateTransferNotTooOld = (transferDate) => {
  const today = new Date();
  const maxDaysAgo = new Date(today.getTime() - (MAX_TRANSFER_DAYS_PAST * 24 * 60 * 60 * 1000));
  const transferDateObj = new Date(transferDate);
  
  if (transferDateObj < maxDaysAgo) {
    throw new Error(`Bukti transfer tidak boleh lebih dari ${MAX_TRANSFER_DAYS_PAST} hari`);
  }
};

// ============= MODEL MIDDLEWARE VALIDATORS =============
export const validatePaymentAmountForType = function(next) {
  try {
    validatePaymentAmountLogic(this.payment_type, this.amount, this.total_booking_amount);
    next();
  } catch (error) {
    next(error);
  }
};

export const validateTransferAmountField = function(next) {
  try {
    if (!validateTransferAmount(this.transfer_details.transfer_amount)) {
      throw new Error(`Jumlah transfer harus antara Rp ${MIN_TRANSFER_AMOUNT.toLocaleString('id-ID')} - Rp ${MAX_TRANSFER_AMOUNT.toLocaleString('id-ID')}`);
    }
    
    validateTransferMatchesPayment(this.transfer_details.transfer_amount, this.amount);
    next();
  } catch (error) {
    next(error);
  }
};

export const validateTransferDateField = function(next) {
  try {
    if (!validateTransferDate(this.transfer_details.transfer_date)) {
      throw new Error(`Tanggal transfer tidak valid (maksimal ${MAX_TRANSFER_DAYS_PAST} hari yang lalu)`);
    }
    
    validateTransferNotFuture(this.transfer_details.transfer_date);
    validateTransferNotTooOld(this.transfer_details.transfer_date);
    next();
  } catch (error) {
    next(error);
  }
};

export const validateSenderNameField = function(next) {
  try {
    if (!validateSenderName(this.transfer_details.sender_name)) {
      throw new Error('Nama pengirim harus 2-100 karakter');
    }
    next();
  } catch (error) {
    next(error);
  }
};

// ============= BANK VALIDATION =============
export const validateBSIAccountNumber = (accountNumber) => {
  const bsiAccountRegex = /^\d{10,13}$/;
  return bsiAccountRegex.test(accountNumber);
};

// ============= PAYMENT STATUS VALIDATION =============
export const validateStatusTransition = (currentStatus, newStatus, userRole) => {
  const allowedTransitions = {
    'pending': {
      'verified': ['cashier', 'admin'],
      'rejected': ['cashier', 'admin']
    },
    'verified': {}, // No transitions allowed from verified
    'rejected': {}  // No transitions allowed from rejected
  };

  const transition = allowedTransitions[currentStatus];
  if (!transition || !transition[newStatus]) {
    return false;
  }

  return transition[newStatus].includes(userRole);
};