import express from 'express';
import { authenticateToken, restrictTo } from '../middleware/auth.js';
import {
  getRevenueReport,
  getPopularFieldsReport, 
  getPeakHoursReport,
  getDashboardAnalytics
} from '../controllers/analyticsController.js';

const router = express.Router();

router.use(authenticateToken, restrictTo('admin'));

router.get('/revenue', getRevenueReport);
router.get('/popular-fields', getPopularFieldsReport);
router.get('/peak-hours', getPeakHoursReport);
router.get('/dashboard', getDashboardAnalytics);

export default router;