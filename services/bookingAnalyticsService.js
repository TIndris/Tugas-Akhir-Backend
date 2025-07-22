import Booking from '../models/Booking.js';
import moment from 'moment-timezone';
import logger from '../config/logger.js';

export class BookingAnalyticsService {
  
  // ✅ Get booking status summary dengan aggregation
  static async getBookingStatusSummary(userId) {
    try {
      // Get booking counts by status
      const statusCounts = await Booking.aggregate([
        { $match: { pelanggan: userId } },
        {
          $group: {
            _id: '$status_pemesanan',
            count: { $sum: 1 },
            totalAmount: { $sum: '$harga' }
          }
        }
      ]);

      // Get payment status counts
      const paymentCounts = await Booking.aggregate([
        { $match: { pelanggan: userId } },
        {
          $group: {
            _id: '$payment_status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Get recent bookings (last 5)
      const recentBookings = await Booking.find({ pelanggan: userId })
        .populate('lapangan', 'nama jenis_lapangan')
        .sort({ createdAt: -1 })
        .limit(5);

      // Format status summary
      const statusSummary = {
        pending: statusCounts.find(s => s._id === 'pending')?.count || 0,
        confirmed: statusCounts.find(s => s._id === 'confirmed')?.count || 0,
        completed: statusCounts.find(s => s._id === 'completed')?.count || 0,
        cancelled: statusCounts.find(s => s._id === 'cancelled')?.count || 0
      };

      const paymentSummary = {
        no_payment: paymentCounts.find(p => p._id === 'no_payment')?.count || 0,
        pending_payment: paymentCounts.find(p => p._id === 'pending_payment')?.count || 0,
        dp_confirmed: paymentCounts.find(p => p._id === 'dp_confirmed')?.count || 0,
        fully_paid: paymentCounts.find(p => p._id === 'fully_paid')?.count || 0
      };

      const totalBookings = Object.values(statusSummary).reduce((sum, count) => sum + count, 0);
      const totalSpent = statusCounts.reduce((sum, status) => sum + (status.totalAmount || 0), 0);

      return {
        summary: {
          totalBookings,
          totalSpent,
          activeBookings: statusSummary.pending + statusSummary.confirmed,
          completedBookings: statusSummary.completed
        },
        statusBreakdown: statusSummary,
        paymentBreakdown: paymentSummary,
        recentBookings: recentBookings.map(booking => ({
          id: booking._id,
          fieldName: booking.lapangan.nama,
          date: booking.tanggal_bookingWIB,
          time: booking.jam_booking,
          status: booking.status_pemesanan,
          paymentStatus: booking.payment_status,
          amount: booking.harga
        })),
        lastUpdated: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

    } catch (error) {
      logger.error('Error getting booking status summary:', error);
      throw error;
    }
  }

  // ✅ Get all bookings for cashier dengan complex aggregation
  static async getAllBookingsForCashier(filters) {
    try {
      const { status, payment_status, date_from, date_to, search, field_type } = filters;

      // Build filter
      const filter = {};
      
      if (status && status !== 'all') {
        filter.status_pemesanan = status;
      }
      
      if (payment_status && payment_status !== 'all') {
        filter.payment_status = payment_status;
      }

      if (date_from || date_to) {
        filter.tanggal_booking = {};
        if (date_from) {
          filter.tanggal_booking.$gte = new Date(date_from);
        }
        if (date_to) {
          filter.tanggal_booking.$lte = new Date(date_to);
        }
      }

      // Build aggregation pipeline
      let pipeline = [
        {
          $lookup: {
            from: 'users',
            localField: 'pelanggan',
            foreignField: '_id',
            as: 'customer'
          }
        },
        { $unwind: '$customer' },
        {
          $lookup: {
            from: 'fields',
            localField: 'lapangan',
            foreignField: '_id',
            as: 'field'
          }
        },
        { 
          $unwind: { 
            path: '$field', 
            preserveNullAndEmptyArrays: true 
          }
        },
        {
          $lookup: {
            from: 'payments',
            localField: '_id',
            foreignField: 'booking',
            as: 'payment'
          }
        }
      ];

      // Add search filter
      if (search) {
        pipeline.push({
          $match: {
            $or: [
              { 'customer.name': { $regex: search, $options: 'i' } },
              { 'customer.email': { $regex: search, $options: 'i' } },
              { 'field.nama': { $regex: search, $options: 'i' } },
              { 'field.jenis_lapangan': { $regex: search, $options: 'i' } },
              { 'jenis_lapangan': { $regex: search, $options: 'i' } }
            ]
          }
        });
      }

      // Add field type filter
      if (field_type && field_type !== 'all') {
        pipeline.push({
          $match: {
            $or: [
              { 'field.jenis_lapangan': field_type },
              { 'jenis_lapangan': field_type }
            ]
          }
        });
      }

      // Add main filters
      if (Object.keys(filter).length > 0) {
        pipeline.push({ $match: filter });
      }

      // Add sorting
      pipeline.push({ $sort: { createdAt: -1 } });

      // Execute aggregation
      const bookings = await Booking.aggregate(pipeline);

      // Format response
      const formattedBookings = bookings.map(booking => {
        const latestPayment = booking.payment.length > 0 
          ? booking.payment.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
          : null;

        return {
          id: booking._id,
          customer: {
            name: booking.customer.name,
            email: booking.customer.email,
            phone: booking.customer.phone || 'Tidak tersedia'
          },
          field: {
            name: booking.field?.nama || 'Lapangan tidak diketahui',
            type: booking.field?.jenis_lapangan || booking.jenis_lapangan || 'Jenis tidak diketahui',
            price: booking.field?.harga || 0
          },
          booking_details: {
            date: moment(booking.tanggal_booking).tz('Asia/Jakarta').format('DD/MM/YYYY'),
            time: booking.jam_booking,
            duration: booking.durasi,
            total_price: booking.harga
          },
          status: {
            booking: booking.status_pemesanan,
            payment: booking.payment_status
          },
          payment_info: latestPayment ? {
            id: latestPayment._id,
            type: latestPayment.payment_type,
            amount: latestPayment.amount,
            status: latestPayment.status,
            submitted_at: moment(latestPayment.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
            has_proof: !!latestPayment.payment_proof
          } : null,
          timestamps: {
            created: moment(booking.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
            updated: moment(booking.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
          }
        };
      });

      // Calculate summary stats
      const summary = {
        total_bookings: formattedBookings.length,
        pending_bookings: formattedBookings.filter(b => b.status.booking === 'pending').length,
        confirmed_bookings: formattedBookings.filter(b => b.status.booking === 'confirmed').length,
        cancelled_bookings: formattedBookings.filter(b => b.status.booking === 'cancelled').length,
        pending_payments: formattedBookings.filter(b => b.status.payment === 'pending_payment').length,
        approved_payments: formattedBookings.filter(b => b.status.payment === 'dp_confirmed' || b.status.payment === 'fully_paid').length
      };

      return {
        bookings: formattedBookings,
        filters_applied: {
          status: status || 'all',
          payment_status: payment_status || 'all',
          field_type: field_type || 'all',
          date_range: date_from && date_to ? `${date_from} to ${date_to}` : 'all',
          search: search || 'none'
        },
        summary
      };

    } catch (error) {
      logger.error('Error getting bookings for cashier:', error);
      throw error;
    }
  }

  // ✅ Get all bookings for admin dengan filtering
  static async getAllBookingsForAdmin(filters) {
    try {
      const { status, payment_status, date_from, date_to, search, field_type } = filters;

      // Build filter
      const filter = {};
      
      if (status && status !== 'all') {
        filter.status_pemesanan = status;
      }
      
      if (payment_status && payment_status !== 'all') {
        filter.payment_status = payment_status;
      }

      if (date_from || date_to) {
        filter.tanggal_booking = {};
        if (date_from) {
          filter.tanggal_booking.$gte = new Date(date_from);
        }
        if (date_to) {
          filter.tanggal_booking.$lte = new Date(date_to);
        }
      }

      let query = Booking.find(filter)
        .populate('pelanggan', 'name email phone')
        .populate('lapangan', 'nama jenis_lapangan harga')
        .populate('kasir', 'name')
        .sort({ createdAt: -1 });

      if (search) {
        const searchRegex = new RegExp(search, 'i');
        query = query.where({
          $or: [
            { 'pelanggan.name': searchRegex },
            { 'pelanggan.email': searchRegex },
            { 'lapangan.nama': searchRegex }
          ]
        });
      }

      if (field_type && field_type !== 'all') {
        query = query.where('lapangan.jenis_lapangan', field_type);
      }

      const bookings = await query.exec();
      return bookings;

    } catch (error) {
      logger.error('Error getting bookings for admin:', error);
      throw error;
    }
  }
}

export default BookingAnalyticsService;