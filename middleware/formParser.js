import cloudinary from '../config/cloudinary.js';

// Minimal parser - just pass through
const parseFormData = (req, res, next) => {
  next();
};

export default parseFormData;