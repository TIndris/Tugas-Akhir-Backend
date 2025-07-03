import winston from 'winston';

// Create different log levels for different environments
const logLevel = process.env.NODE_ENV === 'production' ? 'error' : 'info';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production' 
      ? winston.format.json()
      : winston.format.simple()
  ),
  transports: [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'production'
    })
  ]
});

// Untuk production, hanya log error level
if (process.env.NODE_ENV === 'production') {
  logger.transports[0].silent = false;
  logger.transports[0].level = 'error';
}

export default logger;