import express from 'express';
import {
  createBooking,
  getMyBookings,
  getBookingById,
  updateBooking,
  deleteBooking,
  getAllBookings,
  checkAvailability,
  getAvailability,
  getBookingStatus,
  getBookingStatusSummary
} from '../controllers/bookingController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';

const router = express.Router();

// ✅ PUBLIC ROUTES (no auth required)
router.get('/check-availability', checkAvailability);
router.get('/availability', getAvailability);

// ✅ PROTECTED ROUTES - Authentication required
router.use(authenticateToken);

// ✅ CUSTOMER ROUTES (and accessible by admin/cashier)
router.post('/', createBooking);
router.get('/my-bookings', getMyBookings);
router.get('/status-summary', getBookingStatusSummary);

// ✅ SPECIFIC BOOKING ROUTES (order matters - put specific routes before :id)
router.get('/:id/status', getBookingStatus);
router.get('/:id', getBookingById);
router.patch('/:id', updateBooking);
router.delete('/:id', deleteBooking);

// ✅ ADMIN/CASHIER ROUTES
router.use(restrictTo('admin', 'cashier'));
router.get('/admin/all', getAllBookings);

export default router;