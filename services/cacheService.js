import { client } from '../config/redis.js';
import logger from '../config/logger.js';

export class CacheService {
  
  // ✅ Invalidate booking-related cache
  static async invalidateBookingCache(userId, fieldId, date) {
    try {
      if (client && client.isOpen) {
        const promises = [
          client.del(`bookings:${userId}`),
        ];
        
        if (fieldId && date) {
          promises.push(client.del(`availability:${fieldId}:${date}`));
        }
        
        await Promise.all(promises);
        logger.info('Booking cache invalidated successfully');
      }
    } catch (error) {
      logger.warn('Cache invalidation failed:', error);
      // Don't throw error - cache failure shouldn't break functionality
    }
  }

  // ✅ Get bookings from cache
  static async getBookingsFromCache(userId) {
    try {
      if (client && client.isOpen) {
        const cachedData = await client.get(`bookings:${userId}`);
        if (cachedData) {
          logger.info('Serving user bookings from cache');
          return JSON.parse(cachedData);
        }
      }
      return null;
    } catch (error) {
      logger.warn('Redis bookings cache read error:', error);
      return null;
    }
  }

  // ✅ Set bookings cache
  static async setBookingsCache(userId, bookings, ttlSeconds = 180) {
    try {
      if (client && client.isOpen) {
        await client.setEx(`bookings:${userId}`, ttlSeconds, JSON.stringify(bookings));
        logger.info('User bookings cached successfully');
      }
    } catch (error) {
      logger.warn('Redis bookings cache save error:', error);
      // Don't throw error - cache failure shouldn't break functionality
    }
  }

  // ✅ Clear all booking-related cache for user
  static async clearUserBookingCache(userId) {
    try {
      if (client && client.isOpen) {
        await client.del(`bookings:${userId}`);
      }
    } catch (error) {
      logger.warn('Redis cache clear error:', error);
    }
  }
}

export default CacheService;