import moment from 'moment-timezone';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import User from '../models/User.js';
import { client } from '../config/redis.js';
import logger from '../config/logger.js';

class AnalyticsService {
  
  static async getRevenueReport(period = 'monthly', year = null) {
    const cacheKey = `analytics:revenue:${period}:${year || 'current'}`;
    
    try {
      let cached = null;
      try {
        if (client && client.isOpen) {
          cached = await client.get(cacheKey);
        }
      } catch (redisError) {
        // Silent cache error
      }

      if (cached) {
        return JSON.parse(cached);
      }

      const currentYear = year || new Date().getFullYear();
      let groupBy, matchFilter;

      switch (period) {
        case 'daily':
          groupBy = {
            year: { $year: '$verified_at' },
            month: { $month: '$verified_at' },
            day: { $dayOfMonth: '$verified_at' }
          };
          matchFilter = {
            verified_at: {
              $gte: moment().tz('Asia/Jakarta').startOf('month').toDate(),
              $lte: moment().tz('Asia/Jakarta').endOf('month').toDate()
            }
          };
          break;
        
        case 'weekly':
          groupBy = {
            year: { $year: '$verified_at' },
            week: { $week: '$verified_at' }
          };
          matchFilter = {
            verified_at: {
              $gte: new Date(`${currentYear}-01-01`),
              $lte: new Date(`${currentYear}-12-31`)
            }
          };
          break;
        
        default: // monthly
          groupBy = {
            year: { $year: '$verified_at' },
            month: { $month: '$verified_at' }
          };
          matchFilter = {
            verified_at: {
              $gte: new Date(`${currentYear}-01-01`),
              $lte: new Date(`${currentYear}-12-31`)
            }
          };
          break;
      }

      const revenueData = await Payment.aggregate([
        {
          $match: {
            status: 'verified',
            ...matchFilter
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
        { $unwind: { path: '$bookingInfo', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'fields',
            localField: 'bookingInfo.lapangan',
            foreignField: '_id',
            as: 'fieldInfo'
          }
        },
        { $unwind: { path: '$fieldInfo', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: groupBy,
            totalRevenue: { $sum: '$amount' },
            transactionCount: { $sum: 1 },
            avgTransaction: { $avg: '$amount' },
            dpPayments: {
              $sum: { $cond: [{ $eq: ['$payment_type', 'dp_payment'] }, 1, 0] }
            },
            fullPayments: {
              $sum: { $cond: [{ $eq: ['$payment_type', 'full_payment'] }, 1, 0] }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
      ]);

      const summary = {
        totalRevenue: revenueData.reduce((sum, d) => sum + d.totalRevenue, 0),
        totalTransactions: revenueData.reduce((sum, d) => sum + d.transactionCount, 0),
        avgRevenuePerPeriod: revenueData.length > 0 ? revenueData.reduce((sum, d) => sum + d.totalRevenue, 0) / revenueData.length : 0,
        periodsTracked: revenueData.length
      };

      const result = {
        period,
        year: currentYear,
        data: revenueData,
        summary,
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

      try {
        if (client && client.isOpen) {
          await client.setex(cacheKey, 300, JSON.stringify(result));
        }
      } catch (redisError) {
        // Silent cache error
      }

      return result;

    } catch (error) {
      logger.error('Revenue report failed:', error.message);
      throw new Error(`Failed to generate revenue report: ${error.message}`);
    }
  }

  static async getPopularFieldsReport() {
    const cacheKey = 'analytics:popular-fields';
    
    try {
      let cached = null;
      try {
        if (client && client.isOpen) {
          cached = await client.get(cacheKey);
        }
      } catch (redisError) {
        // Silent cache error
      }

      if (cached) {
        return JSON.parse(cached);
      }

      const popularFields = await Booking.aggregate([
        {
          $group: {
            _id: '$lapangan',
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$harga' },
            confirmedBookings: {
              $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
            }
          }
        },
        {
          $lookup: {
            from: 'fields',
            localField: '_id',
            foreignField: '_id',
            as: 'fieldInfo'
          }
        },
        { $unwind: { path: '$fieldInfo', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            fieldName: { $ifNull: ['$fieldInfo.nama', 'Unknown Field'] },
            fieldType: { $ifNull: ['$fieldInfo.jenis_lapangan', 'Unknown'] },
            confirmationRate: {
              $cond: [
                { $gt: ['$totalBookings', 0] },
                { $multiply: [{ $divide: ['$confirmedBookings', '$totalBookings'] }, 100] },
                0
              ]
            }
          }
        },
        { $sort: { totalBookings: -1 } },
        { $limit: 10 }
      ]);

      const fieldTypeStats = await Booking.aggregate([
        {
          $lookup: {
            from: 'fields',
            localField: 'lapangan',
            foreignField: '_id',
            as: 'fieldInfo'
          }
        },
        { $unwind: { path: '$fieldInfo', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$fieldInfo.jenis_lapangan',
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$harga' }
          }
        },
        { $sort: { totalRevenue: -1 } }
      ]);

      const result = {
        popularFields: popularFields,
        fieldTypeStats: fieldTypeStats,
        insights: {
          topPerformer: popularFields[0] ? {
            name: popularFields[0].fieldName,
            bookings: popularFields[0].totalBookings
          } : null,
          mostProfitableType: fieldTypeStats[0] ? fieldTypeStats[0]._id : null
        },
        summary: {
          totalFields: popularFields.length,
          totalBookings: popularFields.reduce((sum, f) => sum + f.totalBookings, 0),
          totalRevenue: popularFields.reduce((sum, f) => sum + f.totalRevenue, 0)
        },
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

      try {
        if (client && client.isOpen) {
          await client.setex(cacheKey, 600, JSON.stringify(result));
        }
      } catch (redisError) {
        // Silent cache error
      }

      return result;

    } catch (error) {
      logger.error('Popular fields report failed:', error.message);
      throw new Error(`Failed to generate popular fields report: ${error.message}`);
    }
  }

  static async getPeakHoursReport() {
    const cacheKey = 'analytics:peak-hours';
    
    try {
      let cached = null;
      try {
        if (client && client.isOpen) {
          cached = await client.get(cacheKey);
        }
      } catch (redisError) {
        // Silent cache error
      }

      if (cached) {
        return JSON.parse(cached);
      }

      const hourlyStats = await Booking.aggregate([
        {
          $addFields: {
            bookingHour: { $toInt: { $substr: ['$jam_booking', 0, 2] } },
            bookingDay: { $dayOfWeek: '$tanggal_booking' }
          }
        },
        {
          $group: {
            _id: '$bookingHour',
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$harga' },
            confirmedBookings: {
              $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
            }
          }
        },
        {
          $addFields: {
            hourLabel: {
              $concat: [
                { $toString: '$_id' },
                ':00 - ',
                { $toString: { $add: ['$_id', 1] } },
                ':00'
              ]
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      const dayOfWeekStats = await Booking.aggregate([
        {
          $addFields: {
            dayOfWeek: { $dayOfWeek: '$tanggal_booking' }
          }
        },
        {
          $group: {
            _id: '$dayOfWeek',
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$harga' }
          }
        },
        {
          $addFields: {
            dayName: {
              $switch: {
                branches: [
                  { case: { $eq: ['$_id', 1] }, then: 'Sunday' },
                  { case: { $eq: ['$_id', 2] }, then: 'Monday' },
                  { case: { $eq: ['$_id', 3] }, then: 'Tuesday' },
                  { case: { $eq: ['$_id', 4] }, then: 'Wednesday' },
                  { case: { $eq: ['$_id', 5] }, then: 'Thursday' },
                  { case: { $eq: ['$_id', 6] }, then: 'Friday' },
                  { case: { $eq: ['$_id', 7] }, then: 'Saturday' }
                ],
                default: 'Unknown'
              }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      const peakHour = hourlyStats.reduce((max, hour) => 
        hour.totalBookings > max.totalBookings ? hour : max, 
        { totalBookings: 0, hourLabel: 'Unknown' }
      );

      const peakDay = dayOfWeekStats.reduce((max, day) => 
        day.totalBookings > max.totalBookings ? day : max, 
        { totalBookings: 0, dayName: 'Unknown' }
      );

      const result = {
        hourlyStats,
        dayOfWeekStats,
        insights: {
          peakHour: `${peakHour.hourLabel} (${peakHour.totalBookings} bookings)`,
          peakDay: `${peakDay.dayName} (${peakDay.totalBookings} bookings)`,
          avgBookingsPerHour: hourlyStats.reduce((sum, h) => sum + h.totalBookings, 0) / hourlyStats.length || 0
        },
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

      try {
        if (client && client.isOpen) {
          await client.setex(cacheKey, 900, JSON.stringify(result));
        }
      } catch (redisError) {
        // Silent cache error
      }

      return result;

    } catch (error) {
      logger.error('Peak hours report failed:', error.message);
      throw new Error(`Failed to generate peak hours report: ${error.message}`);
    }
  }

  static async getDashboardAnalytics(period = 'monthly') {
    try {
      const [revenue, popularFields, peakHours] = await Promise.all([
        this.getRevenueReport(period),
        this.getPopularFieldsReport(),
        this.getPeakHoursReport()
      ]);

      return {
        revenue: {
          summary: revenue.summary,
          trends: revenue.data.slice(-12),
          period: revenue.period
        },
        popularFields: {
          topFields: popularFields.popularFields.slice(0, 5),
          typeStats: popularFields.fieldTypeStats
        },
        peakHours: {
          insights: peakHours.insights,
          hourlyTrends: peakHours.hourlyStats
        },
        lastUpdated: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

    } catch (error) {
      logger.error('Dashboard analytics failed:', error.message);
      throw new Error(`Failed to generate dashboard analytics: ${error.message}`);
    }
  }
}

export default AnalyticsService;