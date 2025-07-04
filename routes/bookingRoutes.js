import express from 'express';
import { 
  createBooking,
  getAllBookings,
  getBooking,
  getMyBookings,
  getAvailableSlots
} from '../controllers/bookingController.js';
import { authenticateToken, restrictTo } from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticateToken);

// Routes for customers
router.post('/', restrictTo('customer'), createBooking);
router.get('/my-bookings', restrictTo('customer'), getMyBookings);

// Routes for admin/cashier
router.get('/', restrictTo('admin', 'cashier'), getAllBookings);
router.get('/:id', restrictTo('admin', 'cashier', 'customer'), getBooking);

// Public route for getting available slots
router.get('/available-slots', getAvailableSlots);

export default router;