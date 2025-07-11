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

// Public routes
router.get('/check-availability', checkAvailability);
router.get('/availability', getAvailability);

// Protected routes
router.use(authenticateToken);
router.post('/', createBooking);
router.get('/my-bookings', getMyBookings);
router.get('/status-summary', getBookingStatusSummary);
router.get('/:id', getBookingById);
router.get('/:id/status', getBookingStatus);
router.patch('/:id', updateBooking);
router.delete('/:id', deleteBooking);

// Admin/Cashier routes
router.use(restrictTo('admin', 'cashier'));
router.get('/admin/all', getAllBookings);

export default router;