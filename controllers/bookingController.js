import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../config/logger.js';  // ← FIXED PATH

// Create booking dengan cache invalidation
export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;

    // Cache key untuk availability
    const availabilityCacheKey = `availability:${lapangan_id}:${tanggal_booking}`;

    // Check field cache first
    let field = null;
    const fieldCacheKey = `field:${lapangan_id}`;
    
    try {
      if (client.isOpen) {
        const cachedField = await client.get(fieldCacheKey);
        if (cachedField) {
          field = JSON.parse(cachedField);
        }
      }
    } catch (redisError) {
      logger.warn('Redis field cache read error:', redisError);
    }

    // If not in cache, get from database
    if (!field) {
      field = await Field.findById(lapangan_id).lean();
      if (!field) {
        return res.status(404).json({
          status: 'error',
          message: 'Lapangan tidak ditemukan'
        });
      }
      
      // Cache field for 10 minutes
      try {
        if (client.isOpen) {
          await client.setEx(fieldCacheKey, 600, JSON.stringify(field));
        }
      } catch (redisError) {
        logger.warn('Redis field cache save error:', redisError);
      }
    }

    // Validasi jam operasional
    const bookingHour = parseInt(jam_booking.split(':')[0]);
    const closeHour = parseInt(field.jam_tutup.split(':')[0]);
    const openHour = parseInt(field.jam_buka.split(':')[0]);

    if (bookingHour >= closeHour || bookingHour < openHour) {
      return res.status(400).json({
        status: 'error',
        message: `Jam booking harus antara ${field.jam_buka} - ${field.jam_tutup}`
      });
    }

    if (bookingHour + durasi > closeHour) {
      return res.status(400).json({
        status: 'error',
        message: `Durasi melebihi jam tutup lapangan (${field.jam_tutup})`
      });
    }

    // Check availability
    const isAvailable = await Booking.checkAvailability(
      lapangan_id, 
      tanggal_booking, 
      jam_booking
    );

    if (!isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: 'Slot waktu tidak tersedia'
      });
    }

    // Calculate price
    const totalHarga = field.harga * durasi;

    const booking = await Booking.create({
      pelanggan: req.user._id,
      lapangan: lapangan_id,
      jenis_lapangan: field.jenis_lapangan,
      tanggal_booking,
      jam_booking,
      durasi,
      harga: totalHarga
    });

    // Clear availability cache after booking
    try {
      if (client.isOpen) {
        await client.del(availabilityCacheKey);
        await client.del(`bookings:${req.user._id}`);
        logger.info('Availability cache cleared after booking');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Booking created: ${booking._id}`, {
      user: req.user._id,
      action: 'CREATE_BOOKING'
    });

    res.status(201).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    logger.error(`Booking creation error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Konfirmasi booking (untuk kasir)
export const confirmBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    booking.status_pemesanan = 'confirmed';
    booking.kasir = req.user._id;
    booking.konfirmasi_at = new Date();
    await booking.save();

    logger.info(`Booking confirmed: ${booking._id}`, {
      kasir: req.user._id,
      action: 'CONFIRM_BOOKING'
    });

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    logger.error(`Booking confirmation error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Mendapatkan semua booking (untuk admin/kasir) - FIXED untuk WIB format
export const getAllBookings = async (req, res) => {
  try {
    // HAPUS .lean() agar virtual fields WIB aktif
    const bookings = await Booking.find()
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Mendapatkan booking by ID - FIXED untuk WIB format
export const getBooking = async (req, res) => {
  try {
    // HAPUS .lean() agar virtual fields WIB aktif
    const booking = await Booking.findById(req.params.id)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking tidak ditemukan'
      });
    }

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Get available slots dengan cache
export const getAvailableSlots = async (req, res) => {
  try {
    const { fieldId, date } = req.query;
    const cacheKey = `availability:${fieldId}:${date}`;
    
    // Check cache first
    let cachedAvailability = null;
    try {
      if (client.isOpen) {
        cachedAvailability = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis availability cache read error:', redisError);
    }

    if (cachedAvailability) {
      logger.info('Serving availability from cache');
      return res.json({
        status: 'success',
        data: JSON.parse(cachedAvailability)
      });
    }
    
    // Validate field exists
    const field = await Field.findById(fieldId).lean();
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Get all booked slots for the date
    const bookedSlots = await Booking.getBookedSlots(fieldId, date);
    
    // Generate all possible time slots
    const allSlots = generateTimeSlots();
    
    // Mark slots as available or booked
    const availabilityMap = allSlots.map(slot => {
      const isBooked = bookedSlots.some(booking => 
        booking.jam_booking === slot.time
      );

      return {
        time: slot.time,
        isAvailable: !isBooked,
        price: field.harga
      };
    });

    const responseData = {
      fieldName: field.nama,
      fieldType: field.jenis_lapangan,
      date: date,
      slots: availabilityMap
    };

    // Cache for 2 minutes (short cache for real-time availability)
    try {
      if (client.isOpen) {
        await client.setEx(cacheKey, 120, JSON.stringify(responseData));
        logger.info('Availability cached successfully');
      }
    } catch (redisError) {
      logger.warn('Redis availability cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      data: responseData
    });

  } catch (error) {
    logger.error(`Error getting available slots: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Get user bookings dengan cache - FIXED untuk WIB format
export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const cacheKey = `bookings:${userId}`;
    
    // Check cache first
    let cachedBookings = null;
    try {
      if (client && client.isOpen) {
        cachedBookings = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis bookings cache read error:', redisError);
    }

    if (cachedBookings) {
      logger.info('Serving user bookings from cache');
      const bookings = JSON.parse(cachedBookings);
      return res.json({
        status: 'success',
        results: bookings.length,
        data: { bookings }
      });
    }

    // HAPUS .lean() agar virtual fields WIB aktif
    const bookings = await Booking.find({ pelanggan: userId })
      .populate('lapangan', 'jenis_lapangan nama')
      .populate('kasir', 'name');

    // Cache for 3 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 180, JSON.stringify(bookings));
        logger.info('User bookings cached successfully');
      }
    } catch (redisError) {
      logger.warn('Redis bookings cache save error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Helper function to generate time slots
const generateTimeSlots = () => {
  const slots = [];
  const startHour = 7;  // 07:00
  const endHour = 24;   // 24:00
  
  for (let hour = startHour; hour <= endHour; hour++) {
    slots.push({
      time: `${hour.toString().padStart(2, '0')}:00`,
      displayTime: `${hour}:00`
    });
  }
  
  return slots;
};