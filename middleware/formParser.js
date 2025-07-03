import cloudinary from '../config/cloudinary.js';

const parseFormData = (req, res, next) => {
  if (!req.get('content-type')?.includes('multipart/form-data')) {
    return next();
  }

  // Get boundary from content-type
  const contentType = req.get('content-type');
  const boundary = contentType.split('boundary=')[1];
  
  if (!boundary) {
    req.body = {};
    return next();
  }

  let body = '';
  
  // Important: Set encoding to binary untuk file handling
  req.setEncoding('binary');

  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      // Parse form data manually
      const formData = parseMultipartData(body, boundary);
      
      // Set parsed data
      req.body = formData.fields;
      
      // Handle file upload if present
      if (formData.file) {
        try {
          const uploadResult = await uploadToCloudinary(formData.file);
          req.file = {
            fieldname: formData.file.fieldname,
            originalname: formData.file.filename,
            path: uploadResult.secure_url,
            size: formData.file.data.length
          };
        } catch (uploadError) {
          // Continue without file if upload fails
        }
      }

      next();
    } catch (error) {
      req.body = {};
      next();
    }
  });
};

// Helper function to parse multipart data
function parseMultipartData(body, boundary) {
  const fields = {};
  let file = null;

  // Split by boundary
  const parts = body.split('--' + boundary);

  for (let part of parts) {
    if (!part.includes('Content-Disposition')) continue;

    // Extract name
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    
    const name = nameMatch[1];

    if (part.includes('filename=')) {
      // File field
      const filenameMatch = part.match(/filename="([^"]+)"/);
      if (filenameMatch) {
        const filename = filenameMatch[1];
        
        // Find file data
        const dataStart = part.indexOf('\r\n\r\n') + 4;
        const dataEnd = part.lastIndexOf('\r\n');
        
        if (dataStart < dataEnd) {
          const fileData = part.substring(dataStart, dataEnd);
          if (fileData.length > 0) {
            file = {
              fieldname: name,
              filename: filename,
              data: Buffer.from(fileData, 'binary')
            };
          }
        }
      }
    } else {
      // Text field
      const dataStart = part.indexOf('\r\n\r\n') + 4;
      const dataEnd = part.lastIndexOf('\r\n');
      
      if (dataStart < dataEnd) {
        const value = part.substring(dataStart, dataEnd).trim();
        if (value) {
          fields[name] = value;
        }
      }
    }
  }

  return { fields, file };
}

// Helper function to upload to cloudinary
function uploadToCloudinary(file) {
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