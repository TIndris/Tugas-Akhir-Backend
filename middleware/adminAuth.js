import rateLimit from 'express-rate-limit';

// Store failed attempts with timestamps
const loginAttempts = new Map();

// Reset time in minutes
const RESET_TIME = 15;

export const loginLimiter = (role) => {
  return rateLimit({
    windowMs: RESET_TIME * 60 * 1000, // 15 minutes in milliseconds
    max: async (req) => {
      const email = req.body.email;
      const attempt = loginAttempts.get(email);
      
      // If no previous attempts or reset time passed
      if (!attempt || (Date.now() - attempt.timestamp) > RESET_TIME * 60 * 1000) {
        loginAttempts.set(email, {
          count: 1,
          timestamp: Date.now()
        });
        return req.body.email === process.env.ADMIN_EMAIL ? 10 : 5;
      }
      
      // Update attempts count
      attempt.count += 1;
      loginAttempts.set(email, attempt);
      
      return req.body.email === process.env.ADMIN_EMAIL ? 10 : 5;
    },
    keyGenerator: (req) => req.body.email,
    handler: (req, res) => {
      const email = req.body.email;
      const attempt = loginAttempts.get(email);
      
      if (attempt) {
        const elapsedMinutes = Math.floor((Date.now() - attempt.timestamp) / 60000);
        const minutesLeft = RESET_TIME - elapsedMinutes;
        
        res.status(429).json({
          status: 'error',
          message: `Too many login attempts. Please try again after ${minutesLeft} minutes`,
          attemptsLeft: 0,
          minutesLeft: minutesLeft
        });
      }
    },
    skipSuccessfulRequests: true
  });
};

export const adminRouteLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: {
    status: 'error',
    message: 'Too many requests from this IP'
  }
});