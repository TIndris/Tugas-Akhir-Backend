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
    console.log('=== UPDATE FIELD DEBUG ===');
    console.log('Field ID:', req.params.id);
    console.log('Content-Type:', req.get('Content-Type'));
    console.log('Raw req.body:', req.body);
    console.log('req.file:', req.file);
    console.log('typeof req.body:', typeof req.body);
    console.log('Object.keys(req.body):', Object.keys(req.body || {}));
    
    const fieldId = req.params.id;
    
    // Check if body exists and has data
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Request body kosong atau tidak valid',
        debug: {
          body: req.body,
          contentType: req.get('Content-Type'),
          hasFile: !!req.file
        }
      });
    }

    const updateData = { ...req.body };
    
    // Add new image if uploaded
    if (req.file) {
      updateData.gambar = req.file.path;
    }

    console.log('Update data to be applied:', updateData);

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

    console.log('About to update with:', updateData);

    // Update field
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      {
        new: true, // Return updated document
        runValidators: true // Validate the update
      }
    );

    console.log('Field after update:', {
      nama: field.nama,
      harga: field.harga,
      status: field.status,
      updatedAt: field.updatedAt
    });

    // Clear cache
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${fieldId}`);
        await client.del('fields:available');
        console.log('Cache cleared successfully');
      }
    } catch (redisError) {
      console.warn('Redis cache clear error:', redisError);
    }

    res.status(200).json({
      status: 'success',
      message: 'Lapangan berhasil diperbarui',
      data: { field },
      debug: {
        receivedData: updateData,
        appliedUpdate: true
      }
    });
    
  } catch (error) {
    console.error('=== UPDATE ERROR ===');
    console.error('Error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memperbarui lapangan',
      error: {
        message: error.message,
        stack: error.stack
      }
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