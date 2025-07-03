import Busboy from 'busboy';
import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  // Skip if not multipart
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
      fields: 10,
      fieldSize: 1024 * 1024 // 1MB per field
    }
  });

  const fields = {};
  const files = [];
  let finished = false;

  // Handle text fields
  busboy.on('field', (fieldname, val, { nameTruncated, valueTruncated }) => {
    console.log(`Field [${fieldname}]: ${val}`);
    
    if (nameTruncated) {
      console.warn(`Field name truncated: ${fieldname}`);
    }
    if (valueTruncated) {
      console.warn(`Field value truncated: ${fieldname}`);
    }
    
    fields[fieldname] = val;
  });

  // Handle file uploads
  busboy.on('file', (fieldname, file, { filename, encoding, mimeType }) => {
    console.log(`File [${fieldname}]: ${filename}, encoding: ${encoding}, mimeType: ${mimeType}`);
    
    if (!filename) {
      console.log('No filename provided, skipping file');
      file.resume(); // Drain the file stream
      return;
    }

    const chunks = [];
    let totalSize = 0;
    
    file.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > 5 * 1024 * 1024) { // 5MB limit
        console.error('File too large');
        file.destroy();
        return;
      }
      chunks.push(chunk);
    });

    file.on('end', () => {
      if (chunks.length > 0) {
        const buffer = Buffer.concat(chunks);
        console.log(`File buffer created: ${buffer.length} bytes`);
        files.push({
          fieldname,
          buffer,
          originalname: filename,
          mimetype: mimeType,
          encoding,
          size: buffer.length
        });
      }
    });

    file.on('error', (err) => {
      console.error('File stream error:', err);
    });
  });

  // Handle errors
  busboy.on('error', (error) => {
    console.error('Busboy parsing error:', error);
    if (!finished) {
      finished = true;
      return res.status(400).json({
        status: 'error',
        message: 'Form parsing failed',
        error: error.message
      });
    }
  });

  // When parsing is complete
  busboy.on('finish', async () => {
    if (finished) return;
    finished = true;
    
    console.log('=== BUSBOY PARSING COMPLETE ===');
    console.log('Fields received:', Object.keys(fields));
    console.log('Files received:', files.map(f => ({ name: f.fieldname, size: f.size })));

    // Set parsed data to req
    req.body = fields;

    // Handle file upload to cloudinary if exists
    if (files.length > 0) {
      try {
        const file = files[0]; // Take first file
        
        console.log('Uploading file to Cloudinary...');
        
        // Upload to cloudinary using buffer
        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'lapangan',
              resource_type: 'image',
              format: 'jpg' // Convert to jpg for consistency
            },
            (error, result) => {
              if (error) {
                console.error('Cloudinary upload error:', error);
                reject(error);
              } else {
                console.log('Cloudinary upload success:', result.secure_url);
                resolve(result);
              }
            }
          );
          
          uploadStream.end(file.buffer);
        });

        req.file = {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          path: uploadResult.secure_url,
          size: file.size,
          cloudinary_id: uploadResult.public_id
        };

        console.log('File uploaded successfully:', uploadResult.secure_url);
      } catch (error) {
        console.error('Cloudinary upload failed:', error);
        return res.status(500).json({
          status: 'error',
          message: 'File upload failed',
          error: error.message
        });
      }
    }

    console.log('=== PARSER COMPLETE - CALLING NEXT ===');
    console.log('Final req.body:', req.body);
    console.log('Final req.file:', req.file ? 'File present' : 'No file');
    
    next();
  });

  // Handle request ending without busboy finishing
  req.on('end', () => {
    if (!finished) {
      console.log('Request ended without busboy finishing');
      finished = true;
      req.body = fields;
      next();
    }
  });

  // Pipe request to busboy
  try {
    req.pipe(busboy);
  } catch (error) {
    console.error('Error piping request to busboy:', error);
    if (!finished) {
      finished = true;
      return res.status(400).json({
        status: 'error',
        message: 'Failed to initialize form parser',
        error: error.message
      });
    }
  }
};

export default parseFormData;