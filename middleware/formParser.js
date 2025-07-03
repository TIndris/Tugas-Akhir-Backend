import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  // Get boundary
  const contentType = req.get('content-type');
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    req.body = {};
    return next();
  }

  const boundary = boundaryMatch[1];
  let rawData = '';

  // Set encoding for text parsing
  req.setEncoding('binary');

  req.on('data', chunk => {
    rawData += chunk;
  });

  req.on('end', async () => {
    try {
      const fields = {};
      let fileData = null;

      // Split by boundary
      const parts = rawData.split(`--${boundary}`);

      for (const part of parts) {
        if (!part.includes('Content-Disposition: form-data')) continue;

        // Extract field name
        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        const fieldName = nameMatch[1];

        if (part.includes('filename=')) {
          // File field
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (filenameMatch && filenameMatch[1]) {
            const filename = filenameMatch[1];
            const contentTypeMatch = part.match(/Content-Type:\s*(.+)\r?\n/);
            const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';

            // Find file content
            const fileStart = part.indexOf('\r\n\r\n');
            if (fileStart !== -1) {
              const fileContent = part.substring(fileStart + 4, part.lastIndexOf('\r\n'));
              if (fileContent.length > 0) {
                fileData = {
                  fieldname: fieldName,
                  originalname: filename,
                  mimetype: contentType,
                  buffer: Buffer.from(fileContent, 'binary')
                };
              }
            }
          }
        } else {
          // Text field
          const valueStart = part.indexOf('\r\n\r\n');
          if (valueStart !== -1) {
            const value = part.substring(valueStart + 4, part.lastIndexOf('\r\n'));
            if (value.trim()) {
              fields[fieldName] = value.trim();
            }
          }
        }
      }

      // Set fields
      req.body = fields;

      // Upload file if present
      if (fileData && fileData.buffer.length > 0) {
        try {
          const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              { folder: 'lapangan', resource_type: 'image' },
              (error, result) => error ? reject(error) : resolve(result)
            ).end(fileData.buffer);
          });

          req.file = {
            fieldname: fileData.fieldname,
            originalname: fileData.originalname,
            mimetype: fileData.mimetype,
            path: result.secure_url,
            size: fileData.buffer.length
          };
        } catch (error) {
          // File upload failed, continue without file
        }
      }

      next();
    } catch (error) {
      req.body = {};
      next();
    }
  });
};

export default parseFormData;