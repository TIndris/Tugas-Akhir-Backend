import fileUpload from 'express-fileupload';
import cloudinary from '../config/cloudinary.js';

// Configure file upload middleware
const fileUploadMiddleware = fileUpload({
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB
    fieldSize: 1024 * 1024,    // 1MB per field
    fields: 20,
    files: 1
  },
  abortOnLimit: true,
  responseOnLimit: 'File terlalu besar. Maksimal 5MB',
  useTempFiles: false,
  tempFileDir: '/tmp/',
  debug: false
});

const parseFormData = async (req, res, next) => {
  // Skip if not multipart
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  // Apply express-fileupload middleware
  fileUploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: 'Error parsing form data',
        error: err.message
      });
    }

    try {
      // Process uploaded file if exists
      if (req.files && req.files.gambar) {
        const file = req.files.gambar;
        
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          return res.status(400).json({
            status: 'error',
            message: 'File harus berupa gambar (jpg, png, jpeg, webp)'
          });
        }

        // Upload to Cloudinary
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              {
                folder: 'lapangan',
                resource_type: 'image',
                transformation: [{ width: 800, height: 600, crop: 'limit' }]
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            ).end(file.data);
          });

          // Set file info to req.file
          req.file = {
            fieldname: 'gambar',
            originalname: file.name,
            mimetype: file.mimetype,
            path: uploadResult.secure_url,
            size: file.size,
            cloudinary_id: uploadResult.public_id
          };
        } catch (uploadError) {
          return res.status(400).json({
            status: 'error',
            message: 'File upload gagal',
            error: uploadError.message
          });
        }
      }

      next();
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: 'Error processing form data',
        error: error.message
      });
    }
  });
};

export default parseFormData;