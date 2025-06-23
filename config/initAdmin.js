import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

export const initAdmin = async () => {
  try {
    logger.info('Checking for admin account...');
    
    const adminExists = await User.findOne({ 
      email: process.env.ADMIN_EMAIL,
      role: 'admin'
    });

    if (!adminExists) {
      logger.info('Admin account not found, creating...');
      
      const admin = await User.create({
        name: 'Administrator',
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        role: 'admin',
        isEmailVerified: true
      });

      logger.info(`Admin account created with email: ${admin.email}`);
      return true;
    }

    logger.info('Admin account already exists');
    return true;
  } catch (error) {
    logger.error(`Admin initialization failed: ${error.message}`);
    return false;
  }
};