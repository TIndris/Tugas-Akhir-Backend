import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  // Skip jika bukan multipart
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  const boundary = req.get('content-type').match(/boundary=(.+)$/)?.[1];
  if (!boundary) {
    req.body = {};
    return next();
  }

  const chunks = [];
  let totalSize = 0;
  const maxSize = 10 * 1024 * 1024; // 10MB

  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > maxSize) {
      return res.status(413).json({
        status: 'error',
        message: 'File terlalu besar'
      });
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const result = parseMultipartBuffer(buffer, boundary);
      
      // Set hasil parsing
      req.body = result.fields;
      
      // Upload file jika ada
      if (result.file) {
        try {
          const uploadResult = await uploadFileToCloudinary(result.file);
          req.file = {
            fieldname: result.file.name,
            originalname: result.file.filename,
            path: uploadResult.secure_url,
            size: result.file.data.length
          };
        } catch (uploadError) {
          // Continue tanpa file jika upload gagal
        }
      }

      next();
    } catch (error) {
      req.body = {};
      next();
    }
  });

  req.on('error', () => {
    req.body = {};
    next();
  });
};

function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  let file = null;

  try {
    const data = buffer.toString('binary');
    const parts = data.split(`--${boundary}`);

    for (const part of parts) {
      if (!part.includes('Content-Disposition: form-data')) continue;

      const nameMatch = part.match(/name="([^"]+)"/);
      if (!nameMatch) continue;

      const fieldName = nameMatch[1];

      if (part.includes('filename=')) {
        // File handling
        const filenameMatch = part.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          const headerEnd = part.indexOf('\r\n\r\n');
          const contentEnd = part.lastIndexOf('\r\n');
          
          if (headerEnd > 0 && contentEnd > headerEnd) {
            const fileData = part.slice(headerEnd + 4, contentEnd);
            if (fileData.length > 100) { // Valid file
              file = {
                name: fieldName,
                filename: filenameMatch[1],
                data: Buffer.from(fileData, 'binary')
              };
            }
          }
        }
      } else {
        // Text field handling
        const valueStart = part.indexOf('\r\n\r\n');
        const valueEnd = part.lastIndexOf('\r\n');
        
        if (valueStart > 0 && valueEnd > valueStart) {
          const value = part.slice(valueStart + 4, valueEnd).trim();
          if (value) {
            fields[fieldName] = value;
          }
        }
      }
    }
  } catch (error) {
    // Silent parsing error
  }

  return { fields, file };
}

function uploadFileToCloudinary(file) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'lapangan',
        resource_type: 'image',
        timeout: 10000 // 10 second timeout
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(file.data);
  });
}

export default parseFormData;