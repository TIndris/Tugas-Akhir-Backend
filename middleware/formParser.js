import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  // Skip jika bukan multipart
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  // Simple form parser tanpa external dependency
  req.body = req.body || {};
  
  // Jika ada files dari express default
  if (req.files && req.files.gambar) {
    // Handle file upload
    uploadFileToCloudinary(req.files.gambar)
      .then(result => {
        req.file = {
          fieldname: 'gambar',
          originalname: req.files.gambar.name,
          path: result.secure_url,
          size: req.files.gambar.size
        };
        next();
      })
      .catch(() => {
        next(); // Continue without file
      });
  } else {
    next();
  }
};

function uploadFileToCloudinary(file) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'lapangan',
        resource_type: 'image'
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(file.data);
  });
}

export default parseFormData;