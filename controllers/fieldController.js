import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';

export const createField = async (req, res) => {
  try {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga } = req.body;
    
    // Validate required file upload
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'Gambar lapangan harus diupload',
        error: {
          code: 'FILE_REQUIRED',
          field: 'gambar'
        }
      });
    }

    const gambar = req.file.path; // Cloudinary URL

    // Check if field name already exists
    const existingField = await Field.findOne({ nama });
    if (existingField) {
      return res.status(409).json({
        status: 'error',
        message: 'Nama lapangan sudah digunakan',
        error: {
          code: 'DUPLICATE_FIELD_NAME',
          field: 'nama',
          value: nama
        }
      });
    }

    const field = await Field.create({
      nama,
      jenis_lapangan,
      jam_buka,
      jam_tutup,
      harga,
      gambar,
      createdBy: req.user._id
    });

    // Clear cache
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del('fields:available');
        logger.info('Fields cache cleared after create');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Field created: ${field._id}`, {
      role: req.user.role,
      action: 'CREATE_FIELD'
    });

    res.status(201).json({
      status: 'success',
      message: 'Lapangan berhasil dibuat',
      data: { field }
    });
  } catch (error) {
    logger.error(`Field creation error: ${error.message}`, {
      action: 'CREATE_FIELD_ERROR'
    });

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      
      return res.status(409).json({
        status: 'error',
        message: `${field === 'nama' ? 'Nama lapangan' : field} sudah digunakan`,
        error: {
          code: 'DUPLICATE_KEY_ERROR',
          field: field,
          value: value
        }
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid',
        error: {
          code: 'VALIDATION_ERROR',
          details: validationErrors
        }
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan internal server',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      }
    });
  }
};

export const updateField = async (req, res) => {
  try {
    const fieldId = req.params.id;
    
    // More flexible data checking
    const bodyExists = req.body && typeof req.body === 'object';
    const hasTextData = bodyExists && Object.keys(req.body).length > 0;
    const hasFile = req.file && req.file.path;
    
    // Debug info (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('=== UPDATE FIELD DEBUG ===');
      console.log('Body exists:', bodyExists);
      console.log('Body keys:', Object.keys(req.body || {}));
      console.log('Has file:', hasFile);
      console.log('Content-Type:', req.get('Content-Type'));
    }
    
    // Allow update if we have either text data OR file
    if (!hasTextData && !hasFile) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada data yang diterima dari form-data',
        debug: {
          contentType: req.get('Content-Type'),
          bodyExists: bodyExists,
          bodyKeys: Object.keys(req.body || {}),
          hasFile: hasFile
        }
      });
    }

    // Validate field ID
    if (!mongoose.Types.ObjectId.isValid(fieldId)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID lapangan tidak valid'
      });
    }

    // Get current field
    const currentField = await Field.findById(fieldId);
    if (!currentField) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Prepare update data with more robust processing
    const updateData = {};
    
    // Process text fields with better validation
    if (hasTextData) {
      Object.keys(req.body).forEach(key => {
        const value = req.body[key];
        
        if (value !== undefined && value !== null && value !== '') {
          const stringValue = String(value).trim();
          
          if (stringValue.length > 0) {
            switch (key) {
              case 'nama':
                updateData.nama = stringValue;
                break;
              case 'jenis_lapangan':
                updateData.jenis_lapangan = stringValue;
                break;
              case 'jam_buka':
                updateData.jam_buka = stringValue;
                break;
              case 'jam_tutup':
                updateData.jam_tutup = stringValue;
                break;
              case 'harga':
                const parsedHarga = parseInt(stringValue);
                if (!isNaN(parsedHarga) && parsedHarga > 0) {
                  updateData.harga = parsedHarga;
                }
                break;
              case 'status':
                if (['tersedia', 'tidak tersedia'].includes(stringValue)) {
                  updateData.status = stringValue;
                }
                break;
            }
          }
        }
      });
    }
    
    // Add image if uploaded
    if (hasFile) {
      updateData.gambar = req.file.path;
    }

    // Check if we have any valid data to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada data valid untuk diupdate',
        received: req.body
      });
    }

    // Check for duplicate name if nama is being updated
    if (updateData.nama && updateData.nama !== currentField.nama) {
      const existingField = await Field.findOne({ 
        nama: updateData.nama, 
        _id: { $ne: fieldId } 
      });
      
      if (existingField) {
        return res.status(409).json({
          status: 'error',
          message: 'Nama lapangan sudah digunakan'
        });
      }
    }

    // Update field
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    );

    // Clear cache
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${fieldId}`);
        await client.del('fields:available');
      }
    } catch (redisError) {
      // Silent fail for cache
    }

    logger.info(`Field updated: ${field._id}`, {
      role: req.user.role,
      action: 'UPDATE_FIELD',
      hasFile: !!req.file,
      updatedFields: Object.keys(updateData)
    });

    res.status(200).json({
      status: 'success',
      message: 'Lapangan berhasil diperbarui',
      data: { field }
    });
    
  } catch (error) {
    logger.error(`Field update error: ${error.message}`, {
      action: 'UPDATE_FIELD_ERROR',
      fieldId: req.params.id
    });

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid',
        error: { details: validationErrors }
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Nama lapangan sudah digunakan'
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui lapangan'
    });
  }
};

// Get all fields dengan Redis caching - FIXED untuk konsistensi
export const getAllFields = async (req, res) => {
  try {
    const { jenis_lapangan, status } = req.query;
    const cacheKey = `fields:all:${jenis_lapangan || 'all'}:${status || 'all'}`;
    
    // Check cache first
    let cachedFields = null;
    try {
      if (client && client.isOpen) {
        cachedFields = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis cache read error:', redisError);
    }

    if (cachedFields) {
      logger.info('Serving fields from cache');
      const fields = JSON.parse(cachedFields);
      return res.json({
        status: 'success',
        results: fields.length,
        data: { fields }
      });
    }

    // Build query filter
    const filter = {};
    if (jenis_lapangan) filter.jenis_lapangan = jenis_lapangan;
    if (status) filter.status = status;

    // HAPUS .lean() agar virtual fields aktif
    const fields = await Field.find(filter);
    
    // Cache for 5 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 300, JSON.stringify(fields));
        logger.info('Fields cached successfully');
      }
    } catch (redisError) {
      logger.warn('Redis cache save error:', redisError);
    }
    
    res.json({
      status: 'success',
      results: fields.length,
      data: { fields }
    });
  } catch (error) {
    logger.error('Error in getAllFields:', error);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data lapangan',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      }
    });
  }
};

// Get single field dengan cache - FIXED untuk konsistensi
export const getField = async (req, res) => {
  try {
    const fieldId = req.params.id;
    const cacheKey = `field:${fieldId}`;
    
    // Check cache first
    let cachedField = null;
    try {
      if (client && client.isOpen) {
        cachedField = await client.get(cacheKey);
      }
    } catch (redisError) {
      logger.warn('Redis cache read error:', redisError);
    }

    if (cachedField) {
      return res.json({
        status: 'success',
        data: { field: JSON.parse(cachedField) }
      });
    }

    // HAPUS .lean() agar virtual fields aktif
    const field = await Field.findById(fieldId);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan',
        error: {
          code: 'FIELD_NOT_FOUND',
          field: 'id',
          value: fieldId
        }
      });
    }

    // Cache single field for 10 minutes
    try {
      if (client && client.isOpen) {
        await client.setEx(cacheKey, 600, JSON.stringify(field));
      }
    } catch (redisError) {
      logger.warn('Redis cache save error:', redisError);
    }
    
    res.status(200).json({
      status: 'success',
      data: { field }
    });
  } catch (error) {
    logger.error('Error in getField:', error);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data lapangan',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      }
    });
  }
};

// Delete field
export const deleteField = async (req, res) => {
  try {
    const fieldId = req.params.id;
    const field = await Field.findByIdAndDelete(fieldId);
    
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan',
        error: {
          code: 'FIELD_NOT_FOUND',
          field: 'id',
          value: fieldId
        }
      });
    }

    // Clear cache after delete
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${fieldId}`);
        await client.del('fields:available');
        logger.info('Fields cache cleared after delete');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Field deleted: ${field._id}`, {
      role: req.user.role,
      action: 'DELETE_FIELD'
    });
    
    res.status(200).json({
      status: 'success',
      message: 'Lapangan berhasil dihapus',
      data: null
    });
  } catch (error) {
    logger.error(`Field deletion error: ${error.message}`, {
      action: 'DELETE_FIELD_ERROR'
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus lapangan',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      }
    });
  }
};

// TAMBAH FUNCTION INI DI AKHIR FILE
export const updateFieldJSON = async (req, res) => {
  try {
    console.log('=== UPDATE FIELD JSON DEBUG ===');
    console.log('Field ID:', req.params.id);
    console.log('User:', req.user?.name, req.user?.role);
    console.log('Request Body:', req.body);
    console.log('Content-Type:', req.get('Content-Type'));
    
    const fieldId = req.params.id;
    const updateData = { ...req.body };

    // Check if body exists and has data
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Request body kosong atau tidak valid'
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(fieldId)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID lapangan tidak valid'
      });
    }

    // Get current field
    const currentField = await Field.findById(fieldId);
    if (!currentField) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    console.log('Current field before update:', {
      nama: currentField.nama,
      harga: currentField.harga,
      status: currentField.status
    });

    // Check for duplicate name (if nama is being updated)
    if (updateData.nama && updateData.nama !== currentField.nama) {
      const existingField = await Field.findOne({ 
        nama: updateData.nama, 
        _id: { $ne: fieldId } 
      });
      
      if (existingField) {
        return res.status(409).json({
          status: 'error',
          message: 'Nama lapangan sudah digunakan'
        });
      }
    }

    console.log('About to update with data:', updateData);

    // Update field - PENTING: runValidators true
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      {
        new: true, // Return updated document
        runValidators: true // Validate the update
      }
    );

    console.log('Field AFTER update:', {
      nama: field.nama,
      harga: field.harga,
      status: field.status,
      jenis_lapangan: field.jenis_lapangan,
      jam_buka: field.jam_buka,
      jam_tutup: field.jam_tutup,
      updatedAt: field.updatedAt
    });

    // Clear cache after update
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${fieldId}`);
        await client.del('fields:available');
        logger.info('Fields cache cleared after update');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Field updated via JSON: ${field._id}`, {
      role: req.user.role,
      action: 'UPDATE_FIELD_JSON'
    });

    res.status(200).json({
      status: 'success',
      message: 'Lapangan berhasil diperbarui',
      data: { field }
    });
    
  } catch (error) {
    console.error('=== UPDATE FIELD JSON ERROR ===');
    console.error('Error:', error);
    
    logger.error(`Field JSON update error: ${error.message}`, {
      action: 'UPDATE_FIELD_JSON_ERROR',
      fieldId: req.params.id,
      body: req.body
    });

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Data tidak valid',
        error: {
          code: 'VALIDATION_ERROR',
          details: validationErrors
        }
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui lapangan',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message
      }
    });
  }
};