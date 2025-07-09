import moment from 'moment-timezone';
// ✅ FIX: Import individual models (sesuai struktur folder Anda)
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import Field from '../models/Field.js';
import User from '../models/User.js';
import { client } from '../config/redis.js';  // ✅ Sesuaikan dengan export redis Anda
import logger from '../config/logger.js';

class AnalyticsService {
  
  // ============= REVENUE ANALYTICS =============
  
  static async getRevenueReport(period = 'monthly', year = null) {
    const cacheKey = `analytics:revenue:${period}:${year || 'current'}`;
    
    try {
      // ✅ Check Redis with proper error handling
      let cached = null;
      try {
        if (client && client.isOpen) {
          cached = await client.get(cacheKey);
        }
      } catch (redisError) {
        logger.warn('Redis cache read error:', redisError.message);
        // Continue without cache
      }

      if (cached) {
        logger.info('Revenue report served from cache', { period, year });
        return JSON.parse(cached);
      }

      const currentYear = year || new Date().getFullYear();
      const { groupBy, matchFilter, periodFormat } = this._getPeriodConfig(period, currentYear);

      // ✅ Optimized aggregation with indexes
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
            as: 'bookingInfo',
            pipeline: [
              {
                $lookup: {
                  from: 'fields',
                  localField: 'lapangan',
                  foreignField: '_id',
                  as: 'fieldInfo',
                  pipeline: [
                    { $project: { nama: 1, jenis_lapangan: 1, harga: 1 } }
                  ]
                }
              }
            ]
          }
        },
        { $unwind: '$bookingInfo' },
        { $unwind: '$bookingInfo.fieldInfo' },
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
            },
            fieldTypes: { $addToSet: '$bookingInfo.fieldInfo.jenis_lapangan' },
            topFields: {
              $push: {
                fieldName: '$bookingInfo.fieldInfo.nama',
                fieldType: '$bookingInfo.fieldInfo.jenis_lapangan',
                amount: '$amount'
              }
            }
          }
        },
        {
          $addFields: {
            periodLabel: this._formatPeriodLabel(period, '$_id'),
            revenueGrowth: 0 // Will be calculated post-aggregation
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
      ]);

      // ✅ Calculate growth rates
      const enrichedData = this._calculateGrowthRates(revenueData);

      // ✅ Calculate comprehensive summary
      const summary = this._calculateRevenueSummary(enrichedData);

      const result = {
        period,
        year: currentYear,
        data: enrichedData,
        summary,
        trends: this._analyzeTrends(enrichedData),
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
        cacheStatus: 'fresh'
      };

      // ✅ Cache with error handling
      try {
        if (client && client.isOpen) {
          await client.setex(cacheKey, 300, JSON.stringify(result));
        }
      } catch (redisError) {
        logger.warn('Redis cache save error:', redisError.message);
        // Continue without caching
      }
      
      logger.info('Revenue report generated and cached', { 
        period, 
        year: currentYear,
        dataPoints: enrichedData.length 
      });

      return result;

    } catch (error) {
      logger.error('Revenue report generation failed', { 
        error: error.message, 
        period, 
        year 
      });
      throw new Error(`Failed to generate revenue report: ${error.message}`);
    }
  }

  // ============= POPULAR FIELDS ANALYTICS =============
  
  static async getPopularFieldsReport() {
    const cacheKey = 'analytics:popular-fields';
    
    try {
      // ✅ Check cache
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Popular fields report served from cache');
        return JSON.parse(cached);
      }

      // ✅ Parallel execution for better performance
      const [popularFields, fieldTypeStats, performanceMetrics] = await Promise.all([
        this._getFieldBookingStats(),
        this._getFieldTypeAnalytics(),
        this._getFieldPerformanceMetrics()
      ]);

      // ✅ Calculate rankings and insights
      const rankedFields = this._rankFields(popularFields);
      const insights = this._generateFieldInsights(rankedFields, fieldTypeStats);

      const result = {
        popularFields: rankedFields.slice(0, 10), // Top 10
        fieldTypeStats,
        performanceMetrics,
        insights,
        summary: this._calculateFieldSummary(rankedFields),
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
        cacheStatus: 'fresh'
      };

      // ✅ Cache for 10 minutes
      await redisClient.setex(cacheKey, 600, JSON.stringify(result));

      logger.info('Popular fields report generated', { 
        totalFields: rankedFields.length 
      });

      return result;

    } catch (error) {
      logger.error('Popular fields report failed', { error: error.message });
      throw new Error(`Failed to generate popular fields report: ${error.message}`);
    }
  }

  // ============= PEAK HOURS ANALYTICS =============
  
  static async getPeakHoursReport() {
    const cacheKey = 'analytics:peak-hours';
    
    try {
      // ✅ Check cache
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Peak hours report served from cache');
        return JSON.parse(cached);
      }

      // ✅ Parallel data fetching
      const [hourlyStats, dayStats, monthlyStats, seasonalStats] = await Promise.all([
        this._getHourlyBookingStats(),
        this._getDayOfWeekStats(),
        this._getMonthlyTrends(),
        this._getSeasonalPatterns()
      ]);

      // ✅ Generate insights with ML-like analysis
      const insights = this._generatePeakInsights(hourlyStats, dayStats, monthlyStats);
      const recommendations = this._generateSchedulingRecommendations(insights);

      const result = {
        hourlyStats,
        dayOfWeekStats: dayStats,
        monthlyTrends: monthlyStats,
        seasonalPatterns: seasonalStats,
        insights,
        recommendations,
        patterns: this._identifyPatterns(hourlyStats, dayStats),
        generatedAt: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss'),
        cacheStatus: 'fresh'
      };

      // ✅ Cache for 15 minutes
      await redisClient.setex(cacheKey, 900, JSON.stringify(result));

      logger.info('Peak hours report generated');

      return result;

    } catch (error) {
      logger.error('Peak hours report failed', { error: error.message });
      throw new Error(`Failed to generate peak hours report: ${error.message}`);
    }
  }

  // ============= COMBINED DASHBOARD =============
  
  static async getDashboardAnalytics(period = 'monthly') {
    const cacheKey = `analytics:dashboard:${period}`;
    
    try {
      // ✅ Check cache
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info('Dashboard analytics served from cache');
        return JSON.parse(cached);
      }

      // ✅ Parallel execution for optimal performance
      const [revenue, popularFields, peakHours, kpiMetrics] = await Promise.all([
        this.getRevenueReport(period),
        this.getPopularFieldsReport(),
        this.getPeakHoursReport(),
        this._getKPIMetrics()
      ]);

      // ✅ Create optimized dashboard data
      const dashboardData = {
        kpis: kpiMetrics,
        revenue: {
          summary: revenue.summary,
          trends: revenue.data.slice(-12), // Last 12 periods
          growth: revenue.trends,
          period: revenue.period
        },
        popularFields: {
          topFields: popularFields.popularFields.slice(0, 5),
          typeStats: popularFields.fieldTypeStats,
          insights: popularFields.insights
        },
        peakHours: {
          insights: peakHours.insights,
          recommendations: peakHours.recommendations,
          hourlyTrends: peakHours.hourlyStats.slice(6, 24), // 06:00 - 23:00
          weeklyPattern: peakHours.dayOfWeekStats
        },
        alerts: this._generateAlerts(revenue, popularFields, peakHours),
        lastUpdated: moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')
      };

      // ✅ Cache for 5 minutes (frequent updates for dashboard)
      await redisClient.setex(cacheKey, 300, JSON.stringify(dashboardData));

      logger.info('Dashboard analytics generated', { period });

      return dashboardData;

    } catch (error) {
      logger.error('Dashboard analytics failed', { error: error.message });
      throw new Error(`Failed to generate dashboard analytics: ${error.message}`);
    }
  }

  // ============= PRIVATE HELPER METHODS =============

  static _getPeriodConfig(period, year) {
    const configs = {
      daily: {
        groupBy: {
          year: { $year: '$verified_at' },
          month: { $month: '$verified_at' },
          day: { $dayOfMonth: '$verified_at' }
        },
        matchFilter: {
          verified_at: {
            $gte: moment().tz('Asia/Jakarta').startOf('month').toDate(),
            $lte: moment().tz('Asia/Jakarta').endOf('month').toDate()
          }
        }
      },
      weekly: {
        groupBy: {
          year: { $year: '$verified_at' },
          week: { $week: '$verified_at' }
        },
        matchFilter: {
          verified_at: {
            $gte: new Date(`${year}-01-01`),
            $lte: new Date(`${year}-12-31`)
          }
        }
      },
      monthly: {
        groupBy: {
          year: { $year: '$verified_at' },
          month: { $month: '$verified_at' }
        },
        matchFilter: {
          verified_at: {
            $gte: new Date(`${year}-01-01`),
            $lte: new Date(`${year}-12-31`)
          }
        }
      }
    };

    return configs[period] || configs.monthly;
  }

  static _formatPeriodLabel(period, idField) {
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    switch (period) {
      case 'daily':
        return {
          $dateToString: {
            format: '%d/%m/%Y',
            date: {
              $dateFromParts: {
                year: `${idField}.year`,
                month: `${idField}.month`,
                day: `${idField}.day`
              }
            }
          }
        };
      case 'weekly':
        return {
          $concat: [
            'Week ',
            { $toString: `${idField}.week` },
            ', ',
            { $toString: `${idField}.year` }
          ]
        };
      default: // monthly
        return {
          $concat: [
            { $arrayElemAt: [monthNames, `${idField}.month`] },
            ' ',
            { $toString: `${idField}.year` }
          ]
        };
    }
  }

  static _calculateGrowthRates(data) {
    return data.map((current, index) => {
      if (index === 0) {
        current.revenueGrowth = 0;
        return current;
      }
      
      const previous = data[index - 1];
      const growth = previous.totalRevenue > 0 
        ? ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100
        : 0;
      
      current.revenueGrowth = Math.round(growth * 100) / 100;
      return current;
    });
  }

  static _calculateRevenueSummary(data) {
    const totals = data.reduce((acc, curr) => ({
      totalRevenue: acc.totalRevenue + curr.totalRevenue,
      totalTransactions: acc.totalTransactions + curr.transactionCount,
      totalDpPayments: acc.totalDpPayments + curr.dpPayments,
      totalFullPayments: acc.totalFullPayments + curr.fullPayments
    }), { totalRevenue: 0, totalTransactions: 0, totalDpPayments: 0, totalFullPayments: 0 });

    return {
      ...totals,
      avgRevenuePerPeriod: data.length > 0 ? totals.totalRevenue / data.length : 0,
      avgTransactionValue: totals.totalTransactions > 0 ? totals.totalRevenue / totals.totalTransactions : 0,
      dpPaymentPercentage: totals.totalTransactions > 0 ? (totals.totalDpPayments / totals.totalTransactions) * 100 : 0,
      periodsTracked: data.length
    };
  }

  static _analyzeTrends(data) {
    if (data.length < 2) return { trend: 'insufficient_data' };

    const recentPeriods = data.slice(-3);
    const avgGrowth = recentPeriods.reduce((sum, period) => sum + (period.revenueGrowth || 0), 0) / recentPeriods.length;

    return {
      trend: avgGrowth > 5 ? 'increasing' : avgGrowth < -5 ? 'decreasing' : 'stable',
      avgGrowthRate: Math.round(avgGrowth * 100) / 100,
      volatility: this._calculateVolatility(data),
      forecast: this._simpleForecast(data)
    };
  }

  static _calculateVolatility(data) {
    if (data.length < 3) return 0;
    
    const growthRates = data.slice(1).map(d => d.revenueGrowth || 0);
    const avgGrowth = growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;
    const variance = growthRates.reduce((sum, rate) => sum + Math.pow(rate - avgGrowth, 2), 0) / growthRates.length;
    
    return Math.sqrt(variance);
  }

  static _simpleForecast(data) {
    if (data.length < 3) return null;
    
    const recentData = data.slice(-3);
    const avgRevenue = recentData.reduce((sum, d) => sum + d.totalRevenue, 0) / recentData.length;
    const avgGrowth = recentData.reduce((sum, d) => sum + (d.revenueGrowth || 0), 0) / recentData.length;
    
    return {
      nextPeriodEstimate: Math.round(avgRevenue * (1 + avgGrowth / 100)),
      confidence: this._calculateConfidence(data)
    };
  }

  static _calculateConfidence(data) {
    const volatility = this._calculateVolatility(data);
    if (volatility < 5) return 'high';
    if (volatility < 15) return 'medium';
    return 'low';
  }

  // ✅ Field Analytics Helper Methods
  static async _getFieldBookingStats() {
    return await Booking.aggregate([
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
          fieldPrice: { $first: '$fieldInfo.harga' },
          fieldStatus: { $first: '$fieldInfo.status' },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgDuration: { $avg: '$durasi' },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
          },
          pendingBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'pending'] }, 1, 0] }
          },
          cancelledBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'cancelled'] }, 1, 0] }
          },
          uniqueCustomers: { $addToSet: '$pelanggan' },
          bookingDates: { $addToSet: '$tanggal_booking' },
          recentBookings: {
            $push: {
              date: '$tanggal_booking',
              time: '$jam_booking',
              status: '$status_pemesanan'
            }
          }
        }
      },
      {
        $addFields: {
          uniqueCustomerCount: { $size: '$uniqueCustomers' },
          bookingDaysCount: { $size: '$bookingDates' },
          confirmationRate: {
            $multiply: [
              { $divide: ['$confirmedBookings', '$totalBookings'] },
              100
            ]
          },
          avgRevenuePerBooking: {
            $divide: ['$totalRevenue', '$totalBookings']
          },
          customerRetentionRate: {
            $divide: ['$totalBookings', '$uniqueCustomerCount']
          },
          utilizationRate: {
            $multiply: [
              { $divide: ['$bookingDaysCount', 30] }, // Assuming 30-day period
              100
            ]
          }
        }
      }
    ]);
  }

  static async _getFieldTypeAnalytics() {
    return await Booking.aggregate([
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
          _id: '$fieldInfo.jenis_lapangan',
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgBookingValue: { $avg: '$harga' },
          fieldCount: { $addToSet: '$lapangan' },
          avgDuration: { $avg: '$durasi' },
          peakHours: { $push: '$jam_booking' }
        }
      },
      {
        $addFields: {
          activeFieldCount: { $size: '$fieldCount' },
          avgBookingsPerField: {
            $divide: ['$totalBookings', { $size: '$fieldCount' }]
          },
          revenuePerField: {
            $divide: ['$totalRevenue', { $size: '$fieldCount' }]
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
  }

  static async _getFieldPerformanceMetrics() {
    return await Field.aggregate([
      {
        $lookup: {
          from: 'bookings',
          localField: '_id',
          foreignField: 'lapangan',
          as: 'bookings'
        }
      },
      {
        $addFields: {
          totalBookings: { $size: '$bookings' },
          isActive: { $eq: ['$status', 'tersedia'] }
        }
      },
      {
        $group: {
          _id: null,
          totalFields: { $sum: 1 },
          activeFields: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalBookings: { $sum: '$totalBookings' },
          avgBookingsPerField: { $avg: '$totalBookings' }
        }
      }
    ]);
  }

  // ✅ Peak Hours Helper Methods
  static async _getHourlyBookingStats() {
    return await Booking.aggregate([
      {
        $addFields: {
          bookingHour: { $toInt: { $substr: ['$jam_booking', 0, 2] } },
          bookingDay: { $dayOfWeek: '$tanggal_booking' },
          bookingMonth: { $month: '$tanggal_booking' }
        }
      },
      {
        $group: {
          _id: '$bookingHour',
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgDuration: { $avg: '$durasi' },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] }
          },
          weekdayBookings: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$bookingDay', 2] }, { $lte: ['$bookingDay', 6] }] },
                1, 0
              ]
            }
          },
          weekendBookings: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ['$bookingDay', 1] }, { $eq: ['$bookingDay', 7] }] },
                1, 0
              ]
            }
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
          },
          confirmationRate: {
            $multiply: [
              { $divide: ['$confirmedBookings', '$totalBookings'] },
              100
            ]
          },
          avgRevenuePerHour: {
            $divide: ['$totalRevenue', '$totalBookings']
          },
          weekdayPercentage: {
            $multiply: [
              { $divide: ['$weekdayBookings', '$totalBookings'] },
              100
            ]
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
  }

  static async _getDayOfWeekStats() {
    return await Booking.aggregate([
      {
        $addFields: {
          dayOfWeek: { $dayOfWeek: '$tanggal_booking' }
        }
      },
      {
        $group: {
          _id: '$dayOfWeek',
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgBookingValue: { $avg: '$harga' },
          avgDuration: { $avg: '$durasi' }
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
          },
          isWeekend: {
            $or: [{ $eq: ['$_id', 1] }, { $eq: ['$_id', 7] }]
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
  }

  static async _getMonthlyTrends() {
    return await Booking.aggregate([
      {
        $group: {
          _id: { $month: '$tanggal_booking' },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgBookingValue: { $avg: '$harga' }
        }
      },
      {
        $addFields: {
          monthName: {
            $switch: {
              branches: [
                { case: { $eq: ['$_id', 1] }, then: 'January' },
                { case: { $eq: ['$_id', 2] }, then: 'February' },
                { case: { $eq: ['$_id', 3] }, then: 'March' },
                { case: { $eq: ['$_id', 4] }, then: 'April' },
                { case: { $eq: ['$_id', 5] }, then: 'May' },
                { case: { $eq: ['$_id', 6] }, then: 'June' },
                { case: { $eq: ['$_id', 7] }, then: 'July' },
                { case: { $eq: ['$_id', 8] }, then: 'August' },
                { case: { $eq: ['$_id', 9] }, then: 'September' },
                { case: { $eq: ['$_id', 10] }, then: 'October' },
                { case: { $eq: ['$_id', 11] }, then: 'November' },
                { case: { $eq: ['$_id', 12] }, then: 'December' }
              ],
              default: 'Unknown'
            }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
  }

  static async _getSeasonalPatterns() {
    return await Booking.aggregate([
      {
        $addFields: {
          season: {
            $switch: {
              branches: [
                { case: { $in: [{ $month: '$tanggal_booking' }, [12, 1, 2]] }, then: 'Winter' },
                { case: { $in: [{ $month: '$tanggal_booking' }, [3, 4, 5]] }, then: 'Spring' },
                { case: { $in: [{ $month: '$tanggal_booking' }, [6, 7, 8]] }, then: 'Summer' },
                { case: { $in: [{ $month: '$tanggal_booking' }, [9, 10, 11]] }, then: 'Fall' }
              ],
              default: 'Unknown'
            }
          }
        }
      },
      {
        $group: {
          _id: '$season',
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$harga' },
          avgBookingValue: { $avg: '$harga' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
  }

  // ✅ Insight Generation Methods
  static _rankFields(fields) {
    return fields
      .map(field => ({
        ...field,
        performanceScore: this._calculatePerformanceScore(field)
      }))
      .sort((a, b) => b.performanceScore - a.performanceScore);
  }

  static _calculatePerformanceScore(field) {
    const bookingWeight = 0.3;
    const revenueWeight = 0.4;
    const confirmationWeight = 0.2;
    const utilizationWeight = 0.1;

    return (
      (field.totalBookings * bookingWeight) +
      (field.totalRevenue / 1000000 * revenueWeight) +
      (field.confirmationRate * confirmationWeight) +
      (field.utilizationRate * utilizationWeight)
    );
  }

  static _generateFieldInsights(fields, typeStats) {
    const topField = fields[0];
    const bottomField = fields[fields.length - 1];
    const avgConfirmation = fields.reduce((sum, f) => sum + f.confirmationRate, 0) / fields.length;

    return {
      topPerformer: {
        name: topField?.fieldName,
        type: topField?.fieldType,
        bookings: topField?.totalBookings,
        revenue: topField?.totalRevenue
      },
      underPerformer: {
        name: bottomField?.fieldName,
        improvementNeeded: bottomField?.confirmationRate < avgConfirmation ? 'confirmation_rate' : 'booking_frequency'
      },
      mostProfitableType: typeStats[0]?._id,
      avgConfirmationRate: Math.round(avgConfirmation * 100) / 100,
      recommendations: this._generateFieldRecommendations(fields, typeStats)
    };
  }

  static _generateFieldRecommendations(fields, typeStats) {
    const recommendations = [];
    
    // Low confirmation rate fields
    const lowConfirmationFields = fields.filter(f => f.confirmationRate < 80);
    if (lowConfirmationFields.length > 0) {
      recommendations.push({
        type: 'improvement',
        priority: 'high',
        message: `${lowConfirmationFields.length} lapangan memiliki confirmation rate rendah (<80%). Perlu evaluasi pricing atau maintenance.`,
        affectedFields: lowConfirmationFields.map(f => f.fieldName)
      });
    }

    // Underutilized fields
    const underutilizedFields = fields.filter(f => f.utilizationRate < 30);
    if (underutilizedFields.length > 0) {
      recommendations.push({
        type: 'marketing',
        priority: 'medium',
        message: `${underutilizedFields.length} lapangan kurang dimanfaatkan (<30% utilization). Pertimbangkan promosi khusus.`,
        affectedFields: underutilizedFields.map(f => f.fieldName)
      });
    }

    return recommendations;
  }

  static _generatePeakInsights(hourlyStats, dayStats, monthlyStats) {
    const peakHour = hourlyStats.reduce((max, hour) => 
      hour.totalBookings > max.totalBookings ? hour : max, 
      { totalBookings: 0 }
    );

    const peakDay = dayStats.reduce((max, day) => 
      day.totalBookings > max.totalBookings ? day : max, 
      { totalBookings: 0 }
    );

    const peakMonth = monthlyStats.reduce((max, month) => 
      month.totalBookings > max.totalBookings ? month : max, 
      { totalBookings: 0 }
    );

    return {
      peakHour: `${peakHour.hourLabel} (${peakHour.totalBookings} bookings)`,
      peakDay: `${peakDay.dayName} (${peakDay.totalBookings} bookings)`,
      peakMonth: `${peakMonth.monthName} (${peakMonth.totalBookings} bookings)`,
      avgBookingsPerHour: hourlyStats.reduce((sum, h) => sum + h.totalBookings, 0) / hourlyStats.length,
      weekdayVsWeekend: {
        weekday: dayStats.filter(d => !d.isWeekend).reduce((sum, d) => sum + d.totalBookings, 0),
        weekend: dayStats.filter(d => d.isWeekend).reduce((sum, d) => sum + d.totalBookings, 0)
      },
      busyHours: hourlyStats.filter(h => h.totalBookings > (peakHour.totalBookings * 0.7)).map(h => h.hourLabel)
    };
  }

  static _generateSchedulingRecommendations(insights) {
    const recommendations = [];

    // Staff scheduling
    recommendations.push({
      category: 'staffing',
      priority: 'high',
      message: `Pastikan staff yang cukup pada jam ${insights.peakHour.split(' ')[0]} dan hari ${insights.peakDay.split(' ')[0]}.`,
      timeframe: 'immediate'
    });

    // Pricing optimization
    recommendations.push({
      category: 'pricing',
      priority: 'medium',
      message: 'Pertimbangkan dynamic pricing untuk jam sibuk guna mengoptimalkan revenue.',
      timeframe: 'short_term'
    });

    // Marketing timing
    recommendations.push({
      category: 'marketing',
      priority: 'medium',
      message: 'Fokuskan promosi pada jam dan hari dengan booking rendah untuk meratakan demand.',
      timeframe: 'ongoing'
    });

    return recommendations;
  }

  static _identifyPatterns(hourlyStats, dayStats) {
    const morningPeak = hourlyStats.filter(h => h._id >= 6 && h._id <= 11).reduce((sum, h) => sum + h.totalBookings, 0);
    const afternoonPeak = hourlyStats.filter(h => h._id >= 12 && h._id <= 17).reduce((sum, h) => sum + h.totalBookings, 0);
    const eveningPeak = hourlyStats.filter(h => h._id >= 18 && h._id <= 23).reduce((sum, h) => sum + h.totalBookings, 0);

    const weekdayTotal = dayStats.filter(d => !d.isWeekend).reduce((sum, d) => sum + d.totalBookings, 0);
    const weekendTotal = dayStats.filter(d => d.isWeekend).reduce((sum, d) => sum + d.totalBookings, 0);

    return {
      timeOfDay: {
        morning: morningPeak,
        afternoon: afternoonPeak,
        evening: eveningPeak,
        primaryPeak: eveningPeak > afternoonPeak && eveningPeak > morningPeak ? 'evening' : 
                    afternoonPeak > morningPeak ? 'afternoon' : 'morning'
      },
      weekPattern: {
        weekday: weekdayTotal,
        weekend: weekendTotal,
        preference: weekendTotal > weekdayTotal ? 'weekend' : 'weekday'
      },
      consistency: this._calculatePatternConsistency(hourlyStats, dayStats)
    };
  }

  static _calculatePatternConsistency(hourlyStats, dayStats) {
    const hourlyVariance = this._calculateVariance(hourlyStats.map(h => h.totalBookings));
    const dailyVariance = this._calculateVariance(dayStats.map(d => d.totalBookings));
    
    return {
      hourly: hourlyVariance < 100 ? 'consistent' : hourlyVariance < 500 ? 'moderate' : 'variable',
      daily: dailyVariance < 50 ? 'consistent' : dailyVariance < 200 ? 'moderate' : 'variable'
    };
  }

  static _calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  static async _getKPIMetrics() {
    const [bookingMetrics, revenueMetrics, fieldMetrics] = await Promise.all([
      Booking.aggregate([
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            confirmedBookings: { $sum: { $cond: [{ $eq: ['$status_pemesanan', 'confirmed'] }, 1, 0] } },
            avgBookingValue: { $avg: '$harga' },
            uniqueCustomers: { $addToSet: '$pelanggan' }
          }
        },
        {
          $addFields: {
            confirmationRate: { $multiply: [{ $divide: ['$confirmedBookings', '$totalBookings'] }, 100] },
            uniqueCustomerCount: { $size: '$uniqueCustomers' }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: { status: 'verified' }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            totalPayments: { $sum: 1 },
            avgPaymentValue: { $avg: '$amount' }
          }
        }
      ]),
      Field.aggregate([
        {
          $group: {
            _id: null,
            totalFields: { $sum: 1 },
            activeFields: { $sum: { $cond: [{ $eq: ['$status', 'tersedia'] }, 1, 0] } }
          }
        },
        {
          $addFields: {
            utilizationRate: { $multiply: [{ $divide: ['$activeFields', '$totalFields'] }, 100] }
          }
        }
      ])
    ]);

    return {
      bookings: bookingMetrics[0] || {},
      revenue: revenueMetrics[0] || {},
      fields: fieldMetrics[0] || {}
    };
  }

  static _calculateFieldSummary(fields) {
    return {
      totalFields: fields.length,
      totalBookings: fields.reduce((sum, f) => sum + f.totalBookings, 0),
      totalRevenue: fields.reduce((sum, f) => sum + f.totalRevenue, 0),
      avgConfirmationRate: fields.reduce((sum, f) => sum + f.confirmationRate, 0) / fields.length,
      avgUtilizationRate: fields.reduce((sum, f) => sum + f.utilizationRate, 0) / fields.length,
      topPerformingType: this._getTopPerformingType(fields)
    };
  }

  static _getTopPerformingType(fields) {
    const typeStats = {};
    fields.forEach(field => {
      if (!typeStats[field.fieldType]) {
        typeStats[field.fieldType] = { bookings: 0, revenue: 0, count: 0 };
      }
      typeStats[field.fieldType].bookings += field.totalBookings;
      typeStats[field.fieldType].revenue += field.totalRevenue;
      typeStats[field.fieldType].count += 1;
    });

    return Object.entries(typeStats)
      .map(([type, stats]) => ({ type, ...stats, avgRevenue: stats.revenue / stats.count }))
      .sort((a, b) => b.avgRevenue - a.avgRevenue)[0]?.type;
  }

  static _generateAlerts(revenue, fields, peakHours) {
    const alerts = [];

    // Revenue alerts
    if (revenue.trends && revenue.trends.trend === 'decreasing') {
      alerts.push({
        type: 'warning',
        category: 'revenue',
        message: `Revenue trend menurun ${Math.abs(revenue.trends.avgGrowthRate)}% dalam periode terakhir.`,
        action: 'review_pricing_strategy'
      });
    }

    // Field performance alerts
    const lowPerformingFields = fields.popularFields.filter(f => f.confirmationRate < 70);
    if (lowPerformingFields.length > 0) {
      alerts.push({
        type: 'warning',
        category: 'fields',
        message: `${lowPerformingFields.length} lapangan memiliki confirmation rate sangat rendah (<70%).`,
        action: 'field_maintenance_check'
      });
    }

    // Peak hours capacity alerts
    const overloadedHours = peakHours.hourlyStats.filter(h => h.totalBookings > 50); // Assuming 50+ is high
    if (overloadedHours.length > 0) {
      alerts.push({
        type: 'info',
        category: 'capacity',
        message: `${overloadedHours.length} jam memiliki demand tinggi. Pertimbangkan ekspansi atau dynamic pricing.`,
        action: 'capacity_planning'
      });
    }

    return alerts;
  }
}

export default AnalyticsService;