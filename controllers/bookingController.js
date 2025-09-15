import BookingService from '../services/bookingService.js';
import BookingAnalyticsService from '../services/bookingAnalyticsService.js';
import BookingStatusService from '../services/bookingStatusService.js';
import CacheService from '../services/cacheService.js';
import NotificationService from '../services/notificationService.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Field from '../models/Field.js';
import moment from 'moment-timezone';

// ✅ ENHANCED: createBooking with better SMS integration
export const createBooking = async (req, res) => {
  let newBooking = null;
  
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;
    
    if (!lapangan_id || !tanggal_booking || !jam_booking || !durasi) {
      return res.status(400).json({
        status: 'error',
        message: 'Semua field harus diisi'
      });
    }

    // Validate field exists
    const field = await Field.findById(lapangan_id);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan',
        error_code: 'FIELD_NOT_FOUND'
      });
    }

    // Check field availability
    if (field.status && field.status !== 'tersedia' && field.isAvailable === false) {
      return res.status(400).json({
        status: 'error',
        message: 'Lapangan tidak tersedia',
        error_code: 'FIELD_UNAVAILABLE'
      });
    }

    // Manual conflict check
    const bookingDate = moment(tanggal_booking).format('YYYY-MM-DD');
    const startTime = moment(jam_booking, 'HH:mm');
    const endTime = startTime.clone().add(durasi, 'hours');

    const conflictingBookings = await Booking.find({
      lapangan: lapangan_id,
      tanggal_booking: {
        $gte: moment(bookingDate).startOf('day').toDate(),
        $lte: moment(bookingDate).endOf('day').toDate()
      },
      status_pemesanan: { $in: ['pending', 'confirmed'] }
    });

    // Check for time conflicts
    for (const existingBooking of conflictingBookings) {
      const existingStart = moment(existingBooking.jam_booking, 'HH:mm');
      const existingEnd = existingStart.clone().add(existingBooking.durasi, 'hours');
      
      const hasOverlap = (
        (startTime.isBefore(existingEnd) && endTime.isAfter(existingStart)) ||
        (existingStart.isBefore(endTime) && existingEnd.isAfter(startTime))
      );

      if (hasOverlap) {
        return res.status(409).json({
          status: 'error',
          message: 'Slot waktu tidak tersedia atau bertabrakan dengan booking lain',
          error_code: 'SLOT_CONFLICT',
          debug_info: {
            new_booking: {
              time_range: `${jam_booking} - ${endTime.format('HH:mm')}`,
              date: bookingDate
            },
            conflicting_booking: {
              id: existingBooking._id,
              time_range: `${existingBooking.jam_booking} - ${existingEnd.format('HH:mm')}`,
              status: existingBooking.status_pemesanan,
              customer: existingBooking.pelanggan
            }
          }
        });
      }
    }

    // Calculate total amount
    const totalAmount = (field.harga || field.pricePerHour || 0) * durasi;

    // Generate bookingId
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    const bookingId = `DSC-${timestamp}-${random}`.toUpperCase();

    // Create booking
    const bookingData = {
      pelanggan: req.user._id,
      lapangan: lapangan_id,
      jenis_lapangan: field.jenis_lapangan || field.type || 'futsal',
      tanggal_booking: new Date(tanggal_booking),
      jam_booking: jam_booking,
      durasi: parseInt(durasi),
      harga: totalAmount,
      status_pemesanan: 'pending',
      payment_status: 'no_payment',
      bookingId: bookingId,
      paymentReminderSent: false,
      preparationReminderSent: false,
      confirmationSent: false
    };

    newBooking = await Booking.create(bookingData);

    // Populate references
    await newBooking.populate([
      { path: 'lapangan', select: 'nama harga pricePerHour images location' },
      { path: 'pelanggan', select: 'name email phoneNumber phone' }
    ]);

    logger.info('Booking created successfully:', {
      bookingId: newBooking.bookingId,
      userId: req.user._id,
      fieldId: lapangan_id,
      date: bookingDate,
      timeSlot: `${jam_booking} - ${endTime.format('HH:mm')}`,
      amount: totalAmount
    });

    // ✅ ENHANCED SMS NOTIFICATION WITH DETAILED ERROR HANDLING
    let smsResult = null;
    let smsError = null;

    try {
      const user = await User.findById(req.user._id);
      
      logger.info('Attempting to send SMS notification:', {
        userId: req.user._id,
        userName: user?.name,
        userPhone: user?.phoneNumber || user?.phone,
        bookingId: newBooking.bookingId
      });

      if (!user) {
        throw new Error('User not found');
      }

      const userPhone = user.phoneNumber || user.phone;
      if (!userPhone) {
        throw new Error('User has no phone number');
      }

      // ✅ CREATE COMPATIBLE BOOKING OBJECT FOR SMS
      const bookingForSMS = {
        bookingId: newBooking.bookingId,
        date: newBooking.tanggal_booking,
        startTime: newBooking.jam_booking,
        endTime: endTime.format('HH:mm'),
        totalAmount: newBooking.harga,
        status: newBooking.status_pemesanan,
        fieldId: {
          name: newBooking.lapangan?.nama || field.nama
        }
      };

      // Send payment reminder
      smsResult = await NotificationService.sendPaymentReminder(bookingForSMS, user);
      
      if (smsResult.success) {
        newBooking.paymentReminderSent = true;
        await newBooking.save({ validateBeforeSave: false });
        
        logger.info('Payment reminder SMS sent successfully:', {
          bookingId: newBooking.bookingId,
          userId: req.user._id,
          phone: userPhone,
          messageSid: smsResult.messageSid
        });
      } else {
        throw new Error(smsResult.error || 'SMS sending failed');
      }

    } catch (error) {
      smsError = error;
      logger.error('Failed to send payment reminder SMS:', {
        error: error.message,
        bookingId: newBooking.bookingId,
        userId: req.user._id,
        userPhone: user?.phoneNumber || user?.phone
      });
    }

    // Clear cache
    try {
      await CacheService.clearUserBookingsCache(req.user._id);
      await CacheService.clearFieldAvailabilityCache(lapangan_id, bookingDate);
    } catch (cacheError) {
      logger.warn('Cache clear failed:', cacheError.message);
    }

    // ✅ ENHANCED RESPONSE WITH SMS STATUS
    res.status(201).json({
      status: 'success',
      message: smsResult?.success ? 
        'Booking berhasil dibuat. SMS pengingat pembayaran telah dikirim.' :
        'Booking berhasil dibuat. SMS tidak dapat dikirim, silakan cek nomor telepon Anda.',
      data: {
        booking: {
          id: newBooking._id,
          bookingId: newBooking.bookingId,
          field: {
            id: newBooking.lapangan._id,
            name: newBooking.lapangan.nama,
            pricePerHour: newBooking.lapangan.harga || newBooking.lapangan.pricePerHour
          },
          user: {
            id: newBooking.pelanggan._id,
            name: newBooking.pelanggan.name,
            email: newBooking.pelanggan.email,
            phone: newBooking.pelanggan.phoneNumber || newBooking.pelanggan.phone
          },
          tanggal_booking: bookingDate,
          jam_booking: newBooking.jam_booking,
          durasi: newBooking.durasi,
          harga: newBooking.harga,
          status_pemesanan: newBooking.status_pemesanan,
          payment_status: newBooking.payment_status,
          createdAt: newBooking.createdAt
        },
        // ✅ ADD: SMS notification status
        notification: {
          sms_sent: !!smsResult?.success,
          sms_status: smsResult?.status || 'failed',
          sms_error: smsError?.message || null,
          message_sid: smsResult?.messageSid || null
        }
      }
    });

  } catch (error) {
    logger.error('Booking creation error:', {
      error: error.message,
      stack: error.stack,
      requestBody: req.body,
      user: req.user?._id,
      timestamp: new Date().toISOString()
    });

    // Cleanup on error
    if (newBooking && newBooking._id) {
      try {
        await Booking.findByIdAndDelete(newBooking._id);
        logger.info('Cleaned up partial booking on error:', newBooking.bookingId);
      } catch (cleanupError) {
        logger.error('Failed to cleanup partial booking:', cleanupError.message);
      }
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membuat booking',
      error_code: 'BOOKING_CREATION_FAILED',
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          error: error.message,
          stack: error.stack
        }
      })
    });
  }
};

// ✅ ADD: Test SMS endpoint
export const testSMS = async (req, res) => {
  try {
    const { phone, message, testType = 'basic' } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        status: 'error',
        message: 'Phone number is required'
      });
    }

    let testMessage = message;
    
    if (!testMessage) {
      switch (testType) {
        case 'booking':
          testMessage = `🏟️ DIAZ SPORT CENTER - TEST

📋 Test Booking:
• ID: TEST-${Date.now()}
• Lapangan: Test Court
• Tanggal: ${new Date().toLocaleDateString('id-ID')}
• Waktu: 20:00 - 21:00
• Total: Rp 100.000

⚠️ INI ADALAH PESAN TEST
Status: TESTING

Terima kasih! 🙏`;
          break;
        default:
          testMessage = `🏟️ DIAZ SPORT CENTER

Test SMS dari sistem booking DSC.
Waktu: ${new Date().toLocaleString('id-ID')}

Jika Anda menerima pesan ini, konfigurasi SMS berfungsi dengan baik! ✅

Terima kasih! 🙏`;
      }
    }

    // Import the SMS function directly
    const { sendSMS, formatPhoneNumber } = await import('../config/twilio.js');
    const formattedPhone = formatPhoneNumber(phone);
    
    logger.info('Sending test SMS:', {
      to: formattedPhone,
      testType: testType,
      userId: req.user?._id
    });

    const result = await sendSMS(formattedPhone, testMessage);
    
    if (result.success) {
      res.json({
        status: 'success',
        message: 'Test SMS sent successfully',
        data: {
          phone: formattedPhone,
          messageSid: result.messageSid,
          status: result.status,
          testType: testType
        }
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Failed to send test SMS',
        error: result.error,
        code: result.code
      });
    }

  } catch (error) {
    logger.error('Test SMS error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to send test SMS',
      error: error.message
    });
  }
};

// ✅ ADD: Check SMS configuration
export const checkSMSConfig = async (req, res) => {
  try {
    const hasAccountSid = !!process.env.TWILIO_ACCOUNT_SID;
    const hasAuthToken = !!process.env.TWILIO_AUTH_TOKEN;
    const hasPhoneNumber = !!process.env.TWILIO_PHONE_NUMBER;
    
    const configStatus = {
      configured: hasAccountSid && hasAuthToken && hasPhoneNumber,
      details: {
        account_sid: hasAccountSid ? 'Configured' : 'Missing',
        auth_token: hasAuthToken ? 'Configured' : 'Missing',
        phone_number: hasPhoneNumber ? process.env.TWILIO_PHONE_NUMBER : 'Missing'
      }
    };

    res.json({
      status: 'success',
      message: 'SMS configuration status',
      data: configStatus
    });

  } catch (error) {
    logger.error('Check SMS config error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check SMS configuration'
    });
  }
};

// ✅ KEEP: All existing functions...
export const getAvailability = async (req, res) => {
  try {
    const { lapangan, tanggal, jam, durasi } = req.query;
    
    if (!lapangan || !tanggal || !jam) {
      return res.status(400).json({
        status: 'error',
        message: 'Parameter lapangan, tanggal, jam, dan durasi harus diisi'
      });
    }

    const field = await BookingService.validateFieldForBooking(lapangan);
    const isAvailable = await BookingService.checkSlotAvailability(
      lapangan, 
      tanggal, 
      jam,
      durasi || 1
    );

    res.status(200).json({
      status: 'success',
      message: isAvailable ? 'Slot tersedia' : 'Slot sudah dibooking atau bertabrakan',
      data: {
        is_available: isAvailable,
        field: {
          id: field._id,
          name: field.nama,
          type: field.jenis_lapangan,
          price: field.harga,
          status: field.status
        },
        slot: {
          date: tanggal,
          time: jam,
          duration: durasi || 1
        }
      }
    });

  } catch (error) {
    logger.error(`Availability check error: ${error.message}`, {
      params: req.query,
      stack: error.stack
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

export const checkAvailability = getAvailability;

export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const bookings = await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'nama jenis_lapangan harga gambar jam_buka jam_tutup status')
      .sort({ createdAt: -1 })
      .lean();

    const formattedBookings = bookings.map(booking => ({
      ...booking,
      lapangan: {
        ...booking.lapangan,
        jamOperasional: booking.lapangan?.jam_buka && booking.lapangan?.jam_tutup 
          ? `${booking.lapangan.jam_buka} - ${booking.lapangan.jam_tutup}`
          : 'undefined - undefined'
      }
    }));

    const statusSummary = formattedBookings.reduce((acc, booking) => {
      const status = booking.status_pemesanan;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json({
      status: 'success',
      results: formattedBookings.length,
      data: { 
        bookings: formattedBookings,
        summary: {
          total_bookings: formattedBookings.length,
          by_status: statusSummary
        }
      },
      cached: false
    });

  } catch (error) {
    logger.error(`Get user bookings error: ${error.message}`, {
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId && bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses ke booking ini'
      });
    }

    let populatedBooking = {};
    
    try {
      const User = mongoose.model('User');
      const Field = mongoose.model('Field');

      let user = null;
      if (bookingUserId) {
        user = await User.findById(bookingUserId).select('name email phone phoneNumber');
      }
      
      let field = null;
      if (booking.lapangan) {
        field = await Field.findById(booking.lapangan).select('nama harga');
      }
      
      let kasir = null;
      if (booking.kasir) {
        kasir = await User.findById(booking.kasir).select('name email');
      }

      populatedBooking = {
        id: booking._id,
        bookingId: booking.bookingId, // ✅ ADD: Include bookingId for SMS system
        customer: user ? {
          name: user.name || 'Unknown',
          email: user.email || 'Unknown',
          phone: user.phone || user.phoneNumber || 'Unknown'
        } : {
          name: 'Data not available',
          email: 'Data not available',
          phone: 'Data not available'
        },
        field: field ? {
          name: field.nama || 'Unknown',
          price: field.harga || 0
        } : {
          name: 'Data not available',
          price: 0
        },
        kasir: kasir ? {
          name: kasir.name,
          email: kasir.email
        } : null,
        booking_details: {
          date: booking.tanggal_booking,
          time: booking.jam_booking,
          duration: booking.durasi,
          total_price: booking.harga
        },
        status: {
          booking: booking.status_pemesanan,
          payment: booking.payment_status
        },
        notifications: { // ✅ ADD: SMS notification status
          paymentReminderSent: booking.paymentReminderSent || false,
          preparationReminderSent: booking.preparationReminderSent || false,
          confirmationSent: booking.confirmationSent || false
        },
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at,
          expired: booking.expiredAt
        }
      };

    } catch (populateError) {
      populatedBooking = {
        id: booking._id,
        bookingId: booking.bookingId,
        customer: { 
          name: 'Data not available',
          email: 'Data not available', 
          phone: 'Data not available'
        },
        field: { 
          name: 'Data not available',
          price: 0
        },
        kasir: null,
        booking_details: {
          date: booking.tanggal_booking,
          time: booking.jam_booking,
          duration: booking.durasi,
          total_price: booking.harga
        },
        status: {
          booking: booking.status_pemesanan,
          payment: booking.payment_status
        },
        notifications: {
          paymentReminderSent: booking.paymentReminderSent || false,
          preparationReminderSent: booking.preparationReminderSent || false,
          confirmationSent: booking.confirmationSent || false
        },
        timestamps: {
          created: booking.createdAt,
          updated: booking.updatedAt,
          confirmed: booking.konfirmasi_at,
          expired: booking.expiredAt
        }
      };
    }

    res.status(200).json({
      status: 'success',
      message: 'Detail booking berhasil diambil',
      data: {
        booking: populatedBooking
      }
    });

  } catch (error) {
    logger.error('Get booking by ID error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      userRole: req.user?.role
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil detail booking'
    });
  }
};

// ✅ ENHANCE: updateBooking with SMS notification for status changes
export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    let updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id)
      .populate('pelanggan', 'name email phoneNumber')
      .populate('lapangan', 'nama');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan._id || booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk mengubah booking ini'
      });
    }

    if (userRole === 'customer') {
      const allowedFields = ['catatan'];
      const filteredData = {};
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });
      updateData = filteredData;
    }

    if (['kasir', 'cashier'].includes(userRole) && !booking.kasir) {
      updateData.kasir = userId;
    }

    // ✅ TRACK STATUS CHANGES FOR SMS NOTIFICATIONS
    const oldStatus = booking.status_pemesanan;
    const newStatus = updateData.status_pemesanan || oldStatus;

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('pelanggan', 'name email phoneNumber');

    // ✅ SEND SMS NOTIFICATION FOR STATUS CHANGES
    if (oldStatus !== newStatus && booking.pelanggan?.phoneNumber) {
      try {
        if (newStatus === 'confirmed') {
          await NotificationService.sendBookingConfirmation(updatedBooking, booking.pelanggan);
          updatedBooking.confirmationSent = true;
          await updatedBooking.save();
        }
      } catch (smsError) {
        logger.warn('Failed to send status change SMS:', {
          error: smsError.message,
          bookingId: booking.bookingId || booking._id,
          oldStatus,
          newStatus
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil diperbarui',
      data: {
        booking: updatedBooking
      }
    });

  } catch (error) {
    logger.error('Update booking error:', {
      error: error.message,
      bookingId: req.params.id
    });
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui booking'
    });
  }
};

export const updateBookingByCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();

    if (!isOwner) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda hanya dapat mengubah booking sendiri'
      });
    }

    const canUpdateStatuses = ['pending', 'waiting_payment'];
    const canUpdatePaymentStatuses = ['no_payment', 'pending_verification'];

    if (!canUpdateStatuses.includes(booking.status_pemesanan)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat diubah karena sudah dikonfirmasi'
      });
    }

    if (!canUpdatePaymentStatuses.includes(booking.payment_status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat diubah karena pembayaran sudah diproses'
      });
    }

    const allowedFields = ['catatan', 'special_request', 'tanggal_booking', 'jam_booking', 'durasi'];
    const filteredData = {};
    
    const isRescheduling = updateData.tanggal_booking || updateData.jam_booking || updateData.durasi;
    
    if (isRescheduling) {
      const newDate = updateData.tanggal_booking || booking.tanggal_booking;
      const newTime = updateData.jam_booking || booking.jam_booking;
      const newDuration = updateData.durasi || booking.durasi;
      
      try {
        const isAvailable = await BookingService.checkSlotAvailability(
          booking.lapangan,
          newDate,
          newTime,
          newDuration,
          id
        );
        
        if (!isAvailable) {
          return res.status(409).json({
            status: 'error',
            message: 'Slot waktu yang dipilih sudah tidak tersedia',
            error_code: 'SLOT_CONFLICT'
          });
        }
      } catch (availabilityError) {
        return res.status(400).json({
          status: 'error',
          message: 'Gagal memvalidasi jadwal baru: ' + availabilityError.message
        });
      }
      
      if (updateData.durasi && updateData.durasi !== booking.durasi) {
        try {
          const Field = mongoose.model('Field');
          const field = await Field.findById(booking.lapangan);
          
          if (field) {
            filteredData.harga = field.harga * updateData.durasi;
          }
        } catch (priceError) {
          logger.warn('Price recalculation failed:', {
            error: priceError.message,
            bookingId: id
          });
        }
      }
    }
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada field yang dapat diubah atau data tidak valid'
      });
    }

    filteredData.updatedAt = new Date();
    if (isRescheduling) {
      filteredData.rescheduled_at = new Date();
      filteredData.rescheduled_by = userId;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      filteredData,
      { new: true, runValidators: true }
    );

    if (isRescheduling) {
      try {
        await CacheService.invalidateBookingCache(userId, booking.lapangan, booking.tanggal_booking);
        await CacheService.invalidateBookingCache(userId, booking.lapangan, filteredData.tanggal_booking || booking.tanggal_booking);
      } catch (cacheError) {
        logger.warn('Cache invalidation failed during reschedule', {
          error: cacheError.message,
          bookingId: id
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: isRescheduling ? 'Booking berhasil dijadwal ulang' : 'Booking berhasil diperbarui',
      data: {
        booking: {
          id: updatedBooking._id,
          tanggal_booking: updatedBooking.tanggal_booking,
          jam_booking: updatedBooking.jam_booking,
          durasi: updatedBooking.durasi,
          harga: updatedBooking.harga,
          catatan: updatedBooking.catatan,
          special_request: updatedBooking.special_request,
          updatedAt: updatedBooking.updatedAt,
          rescheduled_at: updatedBooking.rescheduled_at
        }
      }
    });

  } catch (error) {
    logger.error('Customer update booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      stack: error.stack
    });

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid: ' + validationErrors.join(', '),
        validation_errors: validationErrors
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui booking'
    });
  }
};

export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { cancel_reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk membatalkan booking ini'
      });
    }

    const canCancelStatuses = ['pending', 'waiting_payment', 'dp_required'];
    const canCancelPaymentStatuses = ['no_payment', 'pending_verification', 'expired'];

    if (!canCancelStatuses.includes(booking.status_pemesanan)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat dibatalkan karena sudah dikonfirmasi atau selesai'
      });
    }

    if (!canCancelPaymentStatuses.includes(booking.payment_status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking ini tidak dapat dibatalkan karena pembayaran sudah diproses'
      });
    }

    if (userRole === 'customer' && booking.payment_deadline) {
      const now = new Date();
      const deadline = new Date(booking.payment_deadline);
      
      if (now > deadline) {
        return res.status(400).json({
          status: 'error',
          message: 'Booking sudah melewati batas waktu pembayaran dan tidak dapat dibatalkan'
        });
      }
    }

    await Booking.findByIdAndDelete(id);

    try {
      await CacheService.invalidateBookingCache(bookingUserId, booking.lapangan, booking.tanggal_booking);
    } catch (cacheError) {
      logger.warn('Cache invalidation failed during booking cancellation', {
        error: cacheError.message,
        bookingId: id
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dibatalkan dan dihapus',
      data: {
        deleted_booking: {
          id: id,
          cancel_reason: cancel_reason || 'Dibatalkan oleh customer',
          cancelled_at: new Date(),
          original_status: {
            booking: booking.status_pemesanan,
            payment: booking.payment_status
          }
        }
      }
    });

  } catch (error) {
    logger.error('Cancel booking error:', {
      error: error.message,
      bookingId: req.params.id,
      userId: req.user?._id?.toString(),
      userRole: req.user?.role,
      stack: error.stack
    });

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membatalkan booking'
    });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID booking tidak valid'
      });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    const bookingUserId = booking.pelanggan;
    const isOwner = bookingUserId.toString() === userId.toString();
    const isCashierOrAdmin = ['kasir', 'cashier', 'admin'].includes(userRole);
    const hasAccess = isOwner || isCashierOrAdmin;

    if (!hasAccess) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk menghapus booking ini'
      });
    }

    if (booking.status_pemesanan === 'completed') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking yang sudah selesai tidak dapat dihapus'
      });
    }

    await Booking.findByIdAndDelete(id);

    res.status(200).json({
      status: 'success',
      message: 'Booking berhasil dihapus'
    });

  } catch (error) {
    logger.error('Delete booking error:', {
      error: error.message,
      bookingId: req.params.id
    });
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus booking'
    });
  }
};

export const getBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const statusData = await BookingStatusService.getBookingStatusDetail(id, userId);

    res.status(200).json({
      status: 'success',
      message: 'Status booking berhasil diambil',
      data: statusData
    });

  } catch (error) {
    logger.error(`Get booking status error: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil status booking'
    });
  }
};

export const getBookingStatusSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const summaryData = await BookingAnalyticsService.getBookingStatusSummary(userId);

    res.status(200).json({
      status: 'success',
      message: 'Ringkasan status booking berhasil diambil',
      data: summaryData
    });

  } catch (error) {
    logger.error(`Get booking status summary error: ${error.message}`, {
      userId: req.user._id,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil ringkasan status'
    });
  }
};

export const getAllBookingsForCashier = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      payment_status: req.query.payment_status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      field_type: req.query.field_type
    };

    const data = await BookingAnalyticsService.getAllBookingsForCashier(filters);

    res.status(200).json({
      status: 'success',
      message: 'Data booking berhasil diambil',
      data
    });

  } catch (error) {
    logger.error(`Error getting all bookings for kasir: ${error.message}`, {
      userId: req.user._id,
      role: req.user.role,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};

export const getAllBookings = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      payment_status: req.query.payment_status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      field_type: req.query.field_type
    };

    const bookings = await BookingAnalyticsService.getAllBookingsForAdmin(filters);

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });

  } catch (error) {
    logger.error(`Admin get all bookings error: ${error.message}`, {
      userId: req.user._id,
      role: req.user.role,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data booking'
    });
  }
};

// ✅ ADD: New method for booking details with controller compatibility
export const getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;

    const booking = await Booking.findByBookingId(bookingId);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan',
        error_code: 'BOOKING_NOT_FOUND'
      });
    }

    // Check access permissions
    const isOwner = booking.pelanggan._id.toString() === userId.toString();
    const isAdminOrCashier = ['admin', 'cashier', 'kasir'].includes(req.user.role);

    if (!isOwner && !isAdminOrCashier) {
      return res.status(403).json({
        status: 'error',
        message: 'Anda tidak memiliki akses untuk melihat booking ini',
        error_code: 'ACCESS_DENIED'
      });
    }

    res.json({
      status: 'success',
      data: {
        booking
      }
    });

  } catch (error) {
    logger.error('Get booking details error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil detail booking',
      error_code: 'FETCH_BOOKING_DETAILS_FAILED'
    });
  }
};

// ✅ ADD: New method for updating booking status (Admin/Cashier)
export const updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Status tidak valid',
        error_code: 'INVALID_STATUS'
      });
    }

    const booking = await Booking.findByBookingId(bookingId);

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan',
        error_code: 'BOOKING_NOT_FOUND'
      });
    }

    const oldStatus = booking.status_pemesanan;
    booking.status_pemesanan = status;
    booking.updatedBy = req.user._id;
    booking.lastUpdated = new Date();

    if (notes) {
      booking.catatan = notes;
    }

    await booking.save();

    // Clear cache
    try {
      await CacheService.clearUserBookingsCache(booking.pelanggan);
      await CacheService.clearFieldAvailabilityCache(booking.lapangan, booking.tanggal_booking);
    } catch (cacheError) {
      logger.warn('Cache clear failed:', cacheError.message);
    }

    // Send SMS notification for status changes
    if (oldStatus !== status && booking.pelanggan?.phoneNumber) {
      try {
        if (status === 'confirmed') {
          await NotificationService.sendBookingConfirmation(booking, booking.pelanggan);
          booking.confirmationSent = true;
          await booking.save();
        }
      } catch (smsError) {
        logger.warn('Failed to send status change SMS:', smsError.message);
      }
    }

    logger.info('Booking status updated:', {
      bookingId: booking.bookingId,
      oldStatus,
      newStatus: status,
      updatedBy: req.user._id
    });

    res.json({
      status: 'success',
      message: 'Status booking berhasil diupdate',
      data: {
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status_pemesanan,
          oldStatus,
          updatedAt: booking.lastUpdated
        }
      }
    });

  } catch (error) {
    logger.error('Update booking status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengupdate status booking',
      error_code: 'UPDATE_BOOKING_STATUS_FAILED'
    });
  }
};

// ✅ KEEP: Final exports with all aliases
export const getUserBookings = getMyBookings;
export const getBookings = getAllBookings;
export const getCashierBookings = getAllBookingsForCashier;