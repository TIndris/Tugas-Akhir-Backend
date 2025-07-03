import { createClient } from 'redis';
import logger from './logger.js';

let client = null;

const connectRedis = async () => {
  if (client && client.isOpen) {
    return client;
  }

  try {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        keepAlive: false,
        reconnectStrategy: (retries) => {
          if (retries > 2) {
            logger.warn('Redis: Max reconnection attempts reached, stopping');
            return false; // Stop reconnecting after 2 attempts
          }
          return Math.min(retries * 100, 1000);
        }
      }
    });

    client.on('error', (err) => {
      // Silent Redis errors untuk production
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Redis Client Error:', err.message);
      }
    });

    client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    client.on('reconnecting', () => {
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis reconnecting...');
      }
    });

    client.on('end', () => {
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis connection ended');
      }
    });

    await client.connect();
    return client;
  } catch (error) {
    // Silent Redis connection failures untuk production
    if (process.env.NODE_ENV !== 'production') {
      logger.error('Redis connection failed:', error.message);
    }
    client = null;
    return null;
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (client && client.isOpen) {
    try {
      await client.quit();
    } catch (error) {
      // Silent shutdown errors
    }
  }
});

export { client, connectRedis };