import Busboy from 'busboy';
import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  console.log('=== MANUAL FORM DATA PARSER ===');
  console.log('Content-Type:', req.get('content-type'));
  console.log('Content-Length:', req.get('content-length'));

  const busboy = Busboy({ 
    headers: req.headers,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      fields: 10
    }
  });

  const fields = {};
  const files = [];

  // Handle text fields
  busboy.on('field', (fieldname, val) => {
    console.log(`Field [${fieldname}]: ${val}`);
    fields[fieldname] = val;
  });

  // Handle file uploads
  busboy.on('file', (fieldname, file, info) => {
    console.log(`File [${fieldname}]: ${info.filename}`);
    
    if (!info.filename) {
      file.resume();
      return;
    }

    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });

    file.on('end', () => {
      const buffer = Buffer.concat(chunks);
      files.push({
        fieldname,
        buffer,
        originalname: info.filename,
        mimetype: info.mimeType
      });
    });
  });

  // When parsing is done
  busboy.on('finish', async () => {
    console.log('Form parsing complete');
    console.log('Fields:', fields);
    console.log('Files:', files.map(f => ({ name: f.fieldname, size: f.buffer.length })));

    // Set parsed data to req
    req.body = fields;

    // Handle file upload to cloudinary if exists
    if (files.length > 0) {
      try {
        const file = files[0]; // Take first file
        
        // Upload to cloudinary
        const uploadResult = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: 'lapangan',
              resource_type: 'image'
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          ).end(file.buffer);
        });

        req.file = {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          path: uploadResult.secure_url,
          size: file.buffer.length
        };

        console.log('File uploaded to cloudinary:', uploadResult.secure_url);
      } catch (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({
          status: 'error',
          message: 'File upload failed',
          error: error.message
        });
      }
    }

    next();
  });

  busboy.on('error', (error) => {
    console.error('Busboy parsing error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Form parsing failed',
      error: error.message
    });
  });

  req.pipe(busboy);
};

export default parseFormData;