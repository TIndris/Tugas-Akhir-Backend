import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Field from '../models/Field.js';
import logger from '../config/logger.js';
import moment from 'moment-timezone';

export class AdminService {
  
  // ============= DASHBOARD STATISTICS =============
  static async getDashboardStats(dateRange = {}) {
    const { startDate, endDate } = dateRange;
    const dateFilter = {};
    
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get basic counts
    const [
      totalUsers,
      totalFields,
      totalBookings,
      totalPayments,
      revenueStats
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      Field.countDocuments(),
      Booking.countDocuments(dateFilter),
      Payment.countDocuments({ status: 'verified', ...dateFilter }),
      this.getRevenueStatistics(dateFilter)
    ]);

    return {
      overview: {
        totalUsers,
        totalFields,
        totalBookings,
        totalPayments
      },
      revenue: revenueStats,
      lastUpdated: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
    };
  }

  static async getRevenueStatistics(dateFilter = {}) {
    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'verified',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          avgPayment: { $avg: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    const result = revenueData[0] || {
      totalRevenue: 0,
      avgPayment: 0,
      totalTransactions: 0
    };

    // Get revenue by payment type
    const revenueByType = await Payment.aggregate([
      {
        $match: {
          status: 'verified',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$payment_type',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    result.byType = revenueByType;
    return result;
  }

  // ============= BOOKING ANALYTICS =============
  static async getBookingAnalytics(period = 'week') {
    let groupBy;
    let dateRange;
    
    if (period === 'week') {
      groupBy = {
        year: { $year: '$createdAt' },
        week: { $week: '$createdAt' }
      };
      dateRange = moment().subtract(7, 'days').toDate();
    } else if (period === 'month') {
      groupBy = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' }
      };
      dateRange = moment().subtract(30, 'days').toDate();
    } else {
      groupBy = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' }
      };
      dateRange = moment().subtract(365, 'days').toDate();
    }

    const bookingTrends = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange }
        }
      },
      {
        $group: {
          _id: groupBy,
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    return bookingTrends;
  }

  // ============= FIELD PERFORMANCE =============
  static async getFieldPerformance() {
    const fieldStats = await Booking.aggregate([
      {
        $lookup: {
          from: 'fields',
          localField: 'lapangan',
          foreignField: '_id',
          as: 'fieldInfo'
        }
      },
      { $unwind: '$fieldInfo' },
      {
        $group: {
          _id: '$lapangan',
          fieldName: { $first: '$fieldInfo.nama' },
          fieldType: { $first: '$fieldInfo.jenis_lapangan' },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgRevenue: { $avg: '$harga' },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          confirmationRate: {
            $multiply: [
              { $divide: ['$confirmedBookings', '$totalBookings'] },
              100
            ]
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    return fieldStats;
  }

  // ============= USER ANALYTICS =============
  static async getUserAnalytics() {
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get customer booking behavior
    const customerBookings = await Booking.aggregate([
      {
        $group: {
          _id: '$pelanggan',
          totalBookings: { $sum: 1 },
          totalSpent: { $sum: '$harga' },
          lastBooking: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          userName: '$userInfo.name',
          userEmail: '$userInfo.email',
          totalBookings: 1,
          totalSpent: 1,
          lastBooking: 1
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]);

    return {
      usersByRole: userStats,
      topCustomers: customerBookings
    };
  }

  // ============= PAYMENT ANALYTICS =============
  static async getPaymentAnalytics() {
    const paymentStats = await Payment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Average processing time for payments
    const processingTime = await Payment.aggregate([
      {
        $match: {
          status: { $in: ['verified', 'rejected'] },
          verified_at: { $exists: true }
        }
      },
      {
        $addFields: {
          processingTimeHours: {
            $divide: [
              { $subtract: ['$verified_at', '$createdAt'] },
              1000 * 60 * 60
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgProcessingTime: { $avg: '$processingTimeHours' },
          minProcessingTime: { $min: '$processingTimeHours' },
          maxProcessingTime: { $max: '$processingTimeHours' }
        }
      }
    ]);

    return {
      statusDistribution: paymentStats,
      processingTime: processingTime[0] || {
        avgProcessingTime: 0,
        minProcessingTime: 0,
        maxProcessingTime: 0
      }
    };
  }

  // ============= REPORTS GENERATION =============
  static async generateReport(reportType, params = {}) {
    const { startDate, endDate } = params;
    
    switch (reportType) {
      case 'revenue':
        return await this.generateRevenueReport(startDate, endDate);
      case 'bookings':
        return await this.generateBookingReport(startDate, endDate);
      case 'users':
        return await this.generateUserReport();
      case 'fields':
        return await this.generateFieldReport();
      default:
        throw new Error('Tipe laporan tidak valid');
    }
  }

  static async generateRevenueReport(startDate, endDate) {
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.verified_at = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'verified',
          ...dateFilter
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking',
          foreignField: '_id',
          as: 'bookingInfo'
        }
      },
      { $unwind: '$bookingInfo' },
      {
        $lookup: {
          from: 'fields',
          localField: 'bookingInfo.lapangan',
          foreignField: '_id',
          as: 'fieldInfo'
        }
      },
      { $unwind: '$fieldInfo' },
      {
        $group: {
          _id: {
            year: { $year: '$verified_at' },
            month: { $month: '$verified_at' },
            day: { $dayOfMonth: '$verified_at' }
          },
          dailyRevenue: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
          fieldTypes: { $addToSet: '$fieldInfo.jenis_lapangan' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    return revenueData;
  }

  static async generateBookingReport(startDate, endDate) {
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.tanggal_booking = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const bookingData = await Booking.aggregate([
      { $match: dateFilter },
      {
        $lookup: {
          from: 'fields',
          localField: 'lapangan',
          foreignField: '_id',
          as: 'fieldInfo'
        }
      },
      { $unwind: '$fieldInfo' },
      {
        $group: {
          _id: {
            fieldType: '$fieldInfo.jenis_lapangan',
            status: '$status_pemesanan'
          },
          count: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgDuration: { $avg: '$durasi' }
        }
      }
    ]);

    return bookingData;
  }

  static async generateUserReport() {
    return await this.getUserAnalytics();
  }

  static async generateFieldReport() {
    return await this.getFieldPerformance();
  }

  // ============= SYSTEM MONITORING =============
  static async getSystemHealth() {
    const health = {
      database: 'connected',
      redis: 'unknown',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
    };

    // Check Redis if available
    try {
      const { client } = await import('../config/redis.js');
      if (client && client.isOpen) {
        health.redis = 'connected';
      } else {
        health.redis = 'disconnected';
      }
    } catch (error) {
      health.redis = 'error';
    }

    return health;
  }
}