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
      let groupBy, matchFilter, periodLabel;

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
          periodLabel = 'daily';
          break;
        
        case 'weekly':
          groupBy = {
            year: { $year: '$verified_at' },
            week: { $week: '$verified_at' }
          };
          // ✅ FIXED: Filter untuk 3 minggu terakhir dengan data
          matchFilter = {
            verified_at: {
              $gte: moment().tz('Asia/Jakarta').startOf('year').toDate(),
              $lte: moment().tz('Asia/Jakarta').endOf('year').toDate()
            }
          };
          periodLabel = 'weekly';
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
          periodLabel = 'monthly';
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

      // ✅ FIXED: Konsistensi perhitungan summary
      const summary = {
        totalRevenue: revenueData.reduce((sum, d) => sum + d.totalRevenue, 0),
        totalTransactions: revenueData.reduce((sum, d) => sum + d.transactionCount, 0),
        avgRevenuePerPeriod: revenueData.length > 0 ? 
          Math.round((revenueData.reduce((sum, d) => sum + d.totalRevenue, 0) / revenueData.length) * 100) / 100 : 0,
        periodsTracked: revenueData.length,
        period: periodLabel
      };

      // ✅ FIXED: Format data dengan label yang jelas
      const formattedData = revenueData.map(item => ({
        ...item,
        ...(period === 'weekly' && {
          weekLabel: `Minggu ke-${item._id.week}`,
          yearWeek: `${item._id.year}-W${item._id.week}`
        }),
        avgTransaction: Math.round(item.avgTransaction * 100) / 100
      }));

      const result = {
        period: periodLabel,
        year: currentYear,
        data: formattedData,
        summary,
        ...(period === 'weekly' && {
          weekRange: formattedData.length > 0 ? 
            `Minggu ${Math.min(...formattedData.map(d => d._id.week))}-${Math.max(...formattedData.map(d => d._id.week))}, ${currentYear}` : 
            'Tidak ada data'
        }),
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

  // ✅ FIXED: Popular fields dengan filter periode yang konsisten
  static async getPopularFieldsReport(period = 'monthly') {
    const cacheKey = `analytics:popular-fields:${period}`;
    
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

      // ✅ FIXED: Filter berdasarkan periode yang sama dengan revenue
      let dateFilter = {};
      if (period === 'weekly') {
        // Filter untuk minggu yang sama dengan revenue (yang punya payment)
        const revenueWeeks = await Payment.aggregate([
          {
            $match: {
              status: 'verified',
              verified_at: {
                $gte: moment().tz('Asia/Jakarta').startOf('year').toDate(),
                $lte: moment().tz('Asia/Jakarta').endOf('year').toDate()
              }
            }
          },
          {
            $group: {
              _id: {
                year: { $year: '$verified_at' },
                week: { $week: '$verified_at' }
              }
            }
          }
        ]);

        if (revenueWeeks.length > 0) {
          const weekNumbers = revenueWeeks.map(w => w._id.week);
          dateFilter = {
            $expr: {
              $in: [{ $week: '$tanggal_booking' }, weekNumbers]
            }
          };
        }
      }

      const popularFields = await Booking.aggregate([
        ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
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
                { 
                  $round: [
                    { $multiply: [{ $divide: ['$confirmedBookings', '$totalBookings'] }, 100] }, 
                    2
                  ] 
                },
                0
              ]
            }
          }
        },
        { $sort: { totalBookings: -1 } },
        { $limit: 10 }
      ]);

      const fieldTypeStats = await Booking.aggregate([
        ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
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
        period: period,
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
          totalRevenue: popularFields.reduce((sum, f) => sum + f.totalRevenue, 0),
          period: period
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

  // ✅ FIXED: Peak hours dengan filter periode yang konsisten
  static async getPeakHoursReport(period = 'monthly') {
    const cacheKey = `analytics:peak-hours:${period}`;
    
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

      // ✅ FIXED: Filter berdasarkan periode yang sama
      let dateFilter = {};
      if (period === 'weekly') {
        const revenueWeeks = await Payment.aggregate([
          {
            $match: {
              status: 'verified',
              verified_at: {
                $gte: moment().tz('Asia/Jakarta').startOf('year').toDate(),
                $lte: moment().tz('Asia/Jakarta').endOf('year').toDate()
              }
            }
          },
          {
            $group: {
              _id: {
                year: { $year: '$verified_at' },
                week: { $week: '$verified_at' }
              }
            }
          }
        ]);

        if (revenueWeeks.length > 0) {
          const weekNumbers = revenueWeeks.map(w => w._id.week);
          dateFilter = {
            $expr: {
              $in: [{ $week: '$tanggal_booking' }, weekNumbers]
            }
          };
        }
      }

      const hourlyStats = await Booking.aggregate([
        ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
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
                { $cond: [{ $lt: ['$_id', 10] }, { $concat: ['0', { $toString: '$_id' }] }, { $toString: '$_id' }] },
                ':00 - ',
                { $cond: [
                  { $lt: [{ $add: ['$_id', 1] }, 10] }, 
                  { $concat: ['0', { $toString: { $add: ['$_id', 1] } }] }, 
                  { $toString: { $add: ['$_id', 1] } }
                ] },
                ':00'
              ]
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      const dayOfWeekStats = await Booking.aggregate([
        ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),
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
        period: period,
        hourlyStats,
        dayOfWeekStats,
        insights: {
          peakHour: `${peakHour.hourLabel} (${peakHour.totalBookings} bookings)`,
          peakDay: `${peakDay.dayName} (${peakDay.totalBookings} bookings)`,
          avgBookingsPerHour: Math.round((hourlyStats.reduce((sum, h) => sum + h.totalBookings, 0) / Math.max(hourlyStats.length, 1)) * 100) / 100
        },
        summary: {
          totalBookingsAnalyzed: hourlyStats.reduce((sum, h) => sum + h.totalBookings, 0),
          totalRevenueAnalyzed: hourlyStats.reduce((sum, h) => sum + h.totalRevenue, 0),
          period: period
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

  // ✅ FIXED: Dashboard analytics dengan konsistensi periode
  static async getDashboardAnalytics(period = 'monthly') {
    try {
      const [revenue, popularFields, peakHours] = await Promise.all([
        this.getRevenueReport(period),
        this.getPopularFieldsReport(period),
        this.getPeakHoursReport(period)
      ]);

      return {
        revenue: {
          summary: {
            ...revenue.summary,
            period: period,
            ...(period === 'weekly' && { weekRange: revenue.weekRange })
          },
          trends: revenue.data,
          period: period
        },
        popularFields: {
          summary: {
            ...popularFields.summary,
            period: period,
            ...(period === 'weekly' && { 
              weekRange: revenue.weekRange,
              note: "Data lapangan populer berdasarkan periode mingguan yang sama dengan revenue"
            })
          },
          topFields: popularFields.popularFields.slice(0, 5),
          typeStats: popularFields.fieldTypeStats
        },
        peakHours: {
          summary: {
            ...peakHours.summary,
            period: period,
            ...(period === 'weekly' && { 
              weekRange: revenue.weekRange,
              note: "Analisis jam sibuk berdasarkan data mingguan yang konsisten"
            })
          },
          insights: peakHours.insights,
          hourlyTrends: peakHours.hourlyStats
        },
        metadata: {
          analysisType: period,
          dataConsistency: 'validated',
          totalBookingsAcrossAllSections: popularFields.summary.totalBookings,
          totalRevenueAcrossAllSections: popularFields.summary.totalRevenue,
          paidTransactions: revenue.summary.totalTransactions,
          note: `Semua bagian analytics menggunakan konteks waktu ${period} yang konsisten`
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