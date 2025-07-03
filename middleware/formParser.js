import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  const boundary = req.get('content-type').split('boundary=')[1];
  if (!boundary) {
    req.body = {};
    return next();
  }

  const chunks = [];
  
  req.on('data', chunk => {
    chunks.push(chunk);
  });

  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const data = buffer.toString();
      
      // Split by boundary
      const parts = data.split(`--${boundary}`);
      const fields = {};
      let fileInfo = null;

      for (const part of parts) {
        if (!part.includes('Content-Disposition: form-data')) continue;

        // Extract field name
        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        
        const fieldName = nameMatch[1];

        if (part.includes('filename=')) {
          // Handle file
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (filenameMatch && filenameMatch[1]) {
            const filename = filenameMatch[1];
            
            // Find binary content between headers and boundary
            const headerEnd = part.indexOf('\r\n\r\n');
            const contentEnd = part.lastIndexOf('\r\n--');
            
            if (headerEnd > 0 && contentEnd > headerEnd) {
              const binaryContent = part.slice(headerEnd + 4, contentEnd);
              const fileBuffer = Buffer.from(binaryContent, 'binary');
              
              if (fileBuffer.length > 100) { // Valid file size
                fileInfo = {
                  fieldname: fieldName,
                  originalname: filename,
                  buffer: fileBuffer
                };
              }
            }
          }
        } else {
          // Handle text field
          const valueStart = part.indexOf('\r\n\r\n');
          const valueEnd = part.lastIndexOf('\r\n');
          
          if (valueStart > 0 && valueEnd > valueStart) {
            const value = part.slice(valueStart + 4, valueEnd).trim();
            
            // Only add non-empty values
            if (value && value.length > 0) {
              fields[fieldName] = value;
            }
          }
        }
      }

      // CRITICAL: Set req.body dengan parsed fields
      req.body = fields;

      // Upload file jika ada
      if (fileInfo && fileInfo.buffer.length > 0) {
        try {
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
            ).end(fileInfo.buffer);
          });

          req.file = {
            fieldname: fileInfo.fieldname,
            originalname: fileInfo.originalname,
            path: uploadResult.secure_url,
            size: fileInfo.buffer.length
          };
        } catch (uploadError) {
          // Continue without file if upload fails
        }
      }

      next();
    } catch (error) {
      // Set empty body on error and continue
      req.body = {};
      next();
    }
  });

  req.on('error', () => {
    req.body = {};
    next();
  });
};

export default parseFormData;