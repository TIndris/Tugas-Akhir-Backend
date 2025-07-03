import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  // Skip jika bukan multipart/form-data
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  const boundary = req.get('content-type').split('boundary=')[1];
  if (!boundary) {
    req.body = {};
    return next();
  }

  let body = Buffer.alloc(0);
  
  req.on('data', (chunk) => {
    body = Buffer.concat([body, chunk]);
  });

  req.on('end', async () => {
    try {
      const data = body.toString('binary');
      const parts = data.split(`--${boundary}`);
      
      const fields = {};
      let fileBuffer = null;
      let fileName = null;
      let fileType = null;

      for (let part of parts) {
        if (!part.includes('Content-Disposition: form-data')) continue;

        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;

        const fieldName = nameMatch[1];

        if (part.includes('Content-Type:')) {
          // Handle file
          const fileNameMatch = part.match(/filename="([^"]+)"/);
          if (fileNameMatch) {
            fileName = fileNameMatch[1];
            const typeMatch = part.match(/Content-Type:\s*([^\r\n]+)/);
            fileType = typeMatch ? typeMatch[1] : 'application/octet-stream';
            
            const dataStart = part.indexOf('\r\n\r\n') + 4;
            const dataEnd = part.lastIndexOf('\r\n');
            
            if (dataStart < dataEnd && dataStart > 0) {
              fileBuffer = Buffer.from(part.slice(dataStart, dataEnd), 'binary');
            }
          }
        } else {
          // Handle text field
          const valueStart = part.indexOf('\r\n\r\n') + 4;
          const valueEnd = part.lastIndexOf('\r\n');
          
          if (valueStart < valueEnd && valueStart > 0) {
            const value = part.slice(valueStart, valueEnd);
            if (value && value.trim()) {
              fields[fieldName] = value.trim();
            }
          }
        }
      }

      // Set parsed fields to req.body
      req.body = fields;

      // Upload file jika ada
      if (fileBuffer && fileName && fileBuffer.length > 0) {
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
            ).end(fileBuffer);
          });

          req.file = {
            fieldname: 'gambar',
            originalname: fileName,
            mimetype: fileType,
            path: uploadResult.secure_url,
            size: fileBuffer.length
          };
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
        }
      }

      next();
    } catch (error) {
      console.error('Form parse error:', error);
      req.body = {};
      next();
    }
  });

  req.on('error', (error) => {
    console.error('Request error:', error);
    req.body = {};
    next();
  });
};

export default parseFormData;