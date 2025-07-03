import cloudinary from '../config/cloudinary.js';

const parseFormData = async (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  try {
    const boundary = req.get('content-type').split('boundary=')[1];
    if (!boundary) {
      req.body = {};
      return next();
    }

    // Collect raw data
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const data = buffer.toString('binary');
        const parts = data.split(`--${boundary}`);
        
        const fields = {};
        let fileData = null;

        for (const part of parts) {
          if (!part.includes('Content-Disposition: form-data')) continue;

          const nameMatch = part.match(/name="([^"]+)"/);
          if (!nameMatch) continue;

          const fieldName = nameMatch[1];
          
          if (part.includes('Content-Type:')) {
            // Handle file
            const filenameMatch = part.match(/filename="([^"]+)"/);
            if (filenameMatch && filenameMatch[1]) {
              const contentStart = part.indexOf('\r\n\r\n') + 4;
              const contentEnd = part.lastIndexOf('\r\n');
              
              if (contentStart < contentEnd && contentStart > 0) {
                const fileBuffer = Buffer.from(part.slice(contentStart, contentEnd), 'binary');
                
                if (fileBuffer.length > 0) {
                  fileData = {
                    fieldname: fieldName,
                    originalname: filenameMatch[1],
                    buffer: fileBuffer,
                    mimetype: part.match(/Content-Type:\s*([^\r\n]+)/)?.[1] || 'application/octet-stream'
                  };
                }
              }
            }
          } else {
            // Handle text field
            const valueStart = part.indexOf('\r\n\r\n') + 4;
            const valueEnd = part.lastIndexOf('\r\n');
            
            if (valueStart < valueEnd && valueStart > 0) {
              const value = part.slice(valueStart, valueEnd).trim();
              if (value.length > 0) {
                fields[fieldName] = value;
              }
            }
          }
        }

        // Set fields to req.body
        req.body = fields;

        // Upload file to cloudinary if exists
        if (fileData && fileData.buffer.length > 0) {
          try {
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  folder: 'lapangan',
                  resource_type: 'image',
                  allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
                  transformation: [{ width: 800, height: 600, crop: 'limit' }]
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );
              uploadStream.end(fileData.buffer);
            });

            req.file = {
              fieldname: fileData.fieldname,
              originalname: fileData.originalname,
              mimetype: fileData.mimetype,
              path: uploadResult.secure_url,
              size: fileData.buffer.length,
              cloudinary_id: uploadResult.public_id
            };
          } catch (uploadError) {
            console.error('File upload error:', uploadError);
            return res.status(400).json({
              status: 'error',
              message: 'File upload failed',
              error: uploadError.message
            });
          }
        }

        next();
      } catch (parseError) {
        console.error('Form parsing error:', parseError);
        req.body = {};
        next();
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      req.body = {};
      next();
    });

  } catch (error) {
    console.error('FormParser error:', error);
    req.body = {};
    next();
  }
};

export default parseFormData;