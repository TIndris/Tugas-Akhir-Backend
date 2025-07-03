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
        connectTimeout: 5000,
        lazyConnect: true,
        // Untuk serverless, set keepAlive false
        keepAlive: false,
        // Handle connection errors gracefully
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            return false; // Stop reconnecting after 3 attempts
          }
          return Math.min(retries * 50, 500);
        }
      }
    });

    client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
      // Don't crash the app on Redis errors
    });

    client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    client.on('end', () => {
      logger.info('Redis connection ended');
    });

    await client.connect();
    return client;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    client = null;
    return null;
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (client && client.isOpen) {
    await client.quit();
  }
});

export { client, connectRedis };