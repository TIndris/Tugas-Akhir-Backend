import AnalyticsService from '../services/analyticsService.js';
import logger from '../config/logger.js';

// Revenue Analytics
export const getRevenueReport = async (req, res) => {
  try {
    const { period = 'monthly', year } = req.query;
    
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({
        status: 'error',
        message: 'Period harus: daily, weekly, atau monthly'
      });
    }

    const report = await AnalyticsService.getRevenueReport(period, year);
    
    res.status(200).json({
      status: 'success',
      message: `Laporan revenue ${period} berhasil dibuat`,
      data: report
    });

  } catch (error) {
    logger.error(`Revenue report error: ${error.message}`);
    res.status(500).json({
      status: 'error', 
      message: 'Gagal membuat laporan revenue'
    });
  }
};

// Popular Fields Analytics
export const getPopularFieldsReport = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query; // ✅ ADD: period parameter
    
    const report = await AnalyticsService.getPopularFieldsReport(period);
    
    res.status(200).json({
      status: 'success',
      message: `Laporan lapangan populer ${period} berhasil dibuat`,
      data: report
    });

  } catch (error) {
    logger.error(`Popular fields error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Gagal membuat laporan lapangan populer'
    });
  }
};

// Peak Hours Analytics  
export const getPeakHoursReport = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query; // ✅ ADD: period parameter
    
    const report = await AnalyticsService.getPeakHoursReport(period);
    
    res.status(200).json({
      status: 'success',
      message: `Laporan jam sibuk ${period} berhasil dibuat`, 
      data: report
    });

  } catch (error) {
    logger.error(`Peak hours error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Gagal membuat laporan jam sibuk'
    });
  }
};

// Combined Dashboard
export const getDashboardAnalytics = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    
    const dashboard = await AnalyticsService.getDashboardAnalytics(period);
    
    res.status(200).json({
      status: 'success',
      message: 'Dashboard analytics berhasil dibuat',
      data: dashboard
    });

  } catch (error) {
    logger.error(`Dashboard analytics error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Gagal membuat dashboard analytics'
    });
  }
};