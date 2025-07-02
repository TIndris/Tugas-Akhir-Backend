import redis from 'redis';
import logger from '../utils/logger.js';

const client = redis.createClient({
  url: process.env.REDIS_URL,
  retry_delay_on_cluster_down: 300,
  retry_delay_on_failover: 100,
  max_attempts: 3,
  socket: {
    connectTimeout: 60000,
    lazyConnect: true,
  }
});

client.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

client.on('connect', () => {
  logger.info('Redis connected successfully');
});

client.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

const connectRedis = async () => {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
    logger.info('Redis connection established');
  } catch (error) {
    logger.error('Redis connection failed:', error);
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Continuing without Redis cache...');
    }
  }
};

export { client, connectRedis };