import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import logger from '../config/logger.js';  // ← FIXED PATH

export const createCashier = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if cashier already exists
    const existingCashier = await User.findOne({ email });
    if (existingCashier) {
      return res.status(400).json({
        status: 'error',
        message: 'Email already registered'
      });
    }

    // Create cashier without hashing (model will hash automatically)
    const newCashier = await User.create({
      name,
      email,
      password, // Password will be hashed by model middleware
      role: 'cashier',
      isEmailVerified: true,
      createdBy: req.user._id
    });

    // Remove password from response
    newCashier.password = undefined;

    res.status(201).json({
      status: 'success',
      data: {
        user: {
          id: newCashier._id,
          name: newCashier.name,
          email: newCashier.email,
          role: newCashier.role
        }
      }
    });
  } catch (error) {
    logger.error(`Cashier creation failed: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

export const getCashiers = async (req, res) => {
  try {
    const cashiers = await User.find({ role: 'cashier' })
      .select('-password');
    
    res.status(200).json({
      status: 'success',
      data: { cashiers }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};