import express from 'express';
import { 
  createBooking,
  getAllBookings,
  getBooking,
  getMyBookings,
  getAvailableSlots,
  getBookingStatus,
  getBookingStatusSummary
} from '../controllers/bookingController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticateToken);

// Routes for customers
router.post('/', restrictTo('customer'), createBooking);
router.get('/my-bookings', restrictTo('customer'), getMyBookings);
router.get('/my-bookings', authenticateToken, getMyBookings);  // ✅ SUDAH ADA

// Routes for admin/cashier
router.get('/', restrictTo('admin', 'cashier'), getAllBookings);
router.get('/:id', restrictTo('admin', 'cashier', 'customer'), getBooking);
router.get('/status-summary', authenticateToken, getBookingStatusSummary);  // ⭐ NEW
router.get('/:id/status', authenticateToken, getBookingStatus);  // ⭐ NEW

// Public route for getting available slots
router.get('/available-slots', getAvailableSlots);

export default router;