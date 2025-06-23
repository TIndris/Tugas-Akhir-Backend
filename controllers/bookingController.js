import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import logger from '../utils/logger.js';

// Membuat booking baru (untuk customer)
export const createBooking = async (req, res) => {
  try {
    const { lapangan_id, tanggal_booking, jam_booking, durasi } = req.body;

    // Cek ketersediaan lapangan
    const field = await Field.findById(lapangan_id);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
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

    // Check if slot is available
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

    // Hitung total harga
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

// Mendapatkan semua booking (untuk admin/kasir)
export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan')
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

// Mendapatkan booking by ID
export const getBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('pelanggan', 'name email')
      .populate('lapangan', 'jenis_lapangan')
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

// Mendapatkan booking milik customer tertentu
export const getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ pelanggan: req.user._id })
      .populate('lapangan', 'jenis_lapangan')
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

// Add new function to get available slots
export const getAvailableSlots = async (req, res) => {
  try {
    const { fieldId, date } = req.query;
    
    // Validate field exists
    const field = await Field.findById(fieldId);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Get all booked slots for the date
    const bookedSlots = await Booking.getBookedSlots(fieldId, date);
    
    // Generate all possible time slots (07:00 - 24:00)
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

    res.status(200).json({
      status: 'success',
      data: {
        fieldName: field.nama,
        fieldType: field.jenis_lapangan,
        date: date,
        slots: availabilityMap
      }
    });

  } catch (error) {
    logger.error(`Error getting available slots: ${error.message}`);
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