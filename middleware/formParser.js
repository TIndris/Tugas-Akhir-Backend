import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  const chunks = [];
  
  req.on('data', chunk => chunks.push(chunk));
  
  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const boundary = req.get('content-type').split('boundary=')[1];
      
      if (!boundary) {
        req.body = {};
        return next();
      }

      const parts = buffer.toString('binary').split(`--${boundary}`);
      const fields = {};
      let fileInfo = null;

      for (const part of parts) {
        if (!part.includes('Content-Disposition: form-data')) continue;

        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;

        const fieldName = nameMatch[1];
        
        if (part.includes('Content-Type:')) {
          // Handle file
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (filenameMatch) {
            const contentStart = part.indexOf('\r\n\r\n') + 4;
            const contentEnd = part.lastIndexOf('\r\n');
            if (contentStart < contentEnd) {
              const fileBuffer = Buffer.from(part.slice(contentStart, contentEnd), 'binary');
              fileInfo = {
                fieldname: fieldName,
                originalname: filenameMatch[1],
                buffer: fileBuffer
              };
            }
          }
        } else {
          // Handle text field
          const valueStart = part.indexOf('\r\n\r\n') + 4;
          const valueEnd = part.lastIndexOf('\r\n');
          if (valueStart < valueEnd) {
            fields[fieldName] = part.slice(valueStart, valueEnd).trim();
          }
        }
      }

      req.body = fields;

      // Upload file if exists
      if (fileInfo && fileInfo.buffer.length > 0) {
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              { folder: 'lapangan', resource_type: 'image' },
              (error, result) => error ? reject(error) : resolve(result)
            ).end(fileInfo.buffer);
          });

          req.file = {
            fieldname: fileInfo.fieldname,
            originalname: fileInfo.originalname,
            path: uploadResult.secure_url,
            size: fileInfo.buffer.length
          };
        } catch (uploadError) {
          // Silent fail for file upload
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