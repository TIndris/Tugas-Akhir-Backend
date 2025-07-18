import jwt from 'jsonwebtoken';

// In-memory blacklist (for serverless environments)
const tokenBlacklist = new Set();

// Store logout timestamps for additional security
const logoutTimestamps = new Map();

export const blacklistToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.id) {
      // Add token to blacklist
      tokenBlacklist.add(token);
      
      // Store logout timestamp for user
      logoutTimestamps.set(decoded.id, Date.now());
      
      console.log(`Token blacklisted for user: ${decoded.id}`);
    }
  } catch (error) {
    console.error('Error blacklisting token:', error);
  }
};

export const isTokenBlacklisted = (token) => {
  if (tokenBlacklist.has(token)) {
    return true;
  }
  
  // Check if token was issued before user's last logout
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.id && decoded.iat) {
      const lastLogout = logoutTimestamps.get(decoded.id);
      if (lastLogout && (decoded.iat * 1000) < lastLogout) {
        return true; // Token issued before logout
      }
    }
  } catch (error) {
    return true; // Invalid token
  }
  
  return false;
};

// Clean up old blacklisted tokens (run periodically)
export const cleanupBlacklist = () => {
  const now = Date.now();
  const TOKEN_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const token of tokenBlacklist) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp && (decoded.exp * 1000) < now) {
        tokenBlacklist.delete(token);
      }
    } catch (error) {
      tokenBlacklist.delete(token); // Remove invalid tokens
    }
  }
  
  // Clean up old logout timestamps (older than 30 days)
  const CLEANUP_THRESHOLD = 30 * 24 * 60 * 60 * 1000;
  for (const [userId, timestamp] of logoutTimestamps) {
    if (now - timestamp > CLEANUP_THRESHOLD) {
      logoutTimestamps.delete(userId);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupBlacklist, 60 * 60 * 1000);