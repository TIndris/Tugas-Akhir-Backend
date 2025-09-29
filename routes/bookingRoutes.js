import express from 'express';
import {
  createBooking,
  getMyBookings,
  getBookingById,
  updateBooking,
  updateBookingByCustomer,
  cancelBooking,
  getAllBookings,
  getAllBookingsForCashier, 
  checkAvailability,
  getAvailability,
  getBookingStatus,
  getBookingStatusSummary,
  approveBookingByAdmin,
  rejectBookingByAdmin
} from '../controllers/bookingController.js';
import { authenticateToken, requireCashierOrAdmin } from '../middleware/auth.js';

const router = express.Router();

// PUBLIC ROUTES (no auth required)
router.get('/check-availability', checkAvailability);
router.get('/availability', getAvailability);

// PROTECTED ROUTES - Authentication required
router.use(authenticateToken);

// ADMIN/KASIR SPECIFIC ROUTES untuk approve/reject booking
router.patch('/:id/approve', requireCashierOrAdmin, approveBookingByAdmin);
router.patch('/:id/reject', requireCashierOrAdmin, rejectBookingByAdmin);

// ADMIN/CASHIER SPECIFIC ROUTES (before general routes)
router.get('/kasir/all', requireCashierOrAdmin, getAllBookingsForCashier);
router.get('/admin/all', requireCashierOrAdmin, getAllBookings);

// CUSTOMER ROUTES (and accessible by admin/cashier)
router.post('/', createBooking);
router.get('/my-bookings', getMyBookings);
router.get('/status-summary', getBookingStatusSummary);

// CUSTOMER SPECIFIC ROUTES
router.patch('/:id/cancel', cancelBooking);
router.patch('/:id/update', updateBookingByCustomer);

// GENERAL ROUTES (accessible by owner or admin/cashier)
router.get('/:id/status', getBookingStatus);
router.get('/:id', getBookingById);
router.patch('/:id', updateBooking);

export default router;