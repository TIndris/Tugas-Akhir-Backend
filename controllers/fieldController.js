import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../config/logger.js';  
import mongoose from 'mongoose';
import { FieldService } from '../services/fieldService.js';

export const createField = async (req, res) => {
  try {
    console.log('=== CREATE FIELD DEBUG ===');
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    
  
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        status: 'error',
        message: 'Gambar lapangan harus diupload',
        error: {
          code: 'FILE_REQUIRED',
          field: 'gambar'
        }
      });
    }

    const gambar = req.file.path;
    
    
    const validatedData = await FieldService.validateFieldCreation(req.body);
    
    
    const field = await Field.create({
      ...validatedData,
      gambar,
      createdBy: req.user._id
    });

    console.log('Field created successfully:', field._id);

    
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
    console.error('=== CREATE FIELD ERROR ===');
    console.error('Error:', error);
    
    logger.error(`Field creation error: ${error.message}`, {
      action: 'CREATE_FIELD_ERROR'
    });

    
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
      message: error.message
    });
  }
};

export const updateField = async (req, res) => {
  try {
    const fieldId = req.params.id;
    
    
    const hasFormData = req.body && Object.keys(req.body).length > 0;
    const hasFile = req.file && req.file.path;
    
    if (!hasFormData && !hasFile) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada data yang diterima dari form-data'
      });
    }

    
    if (!mongoose.Types.ObjectId.isValid(fieldId)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID lapangan tidak valid'
      });
    }

    
    const updateData = {};
    
    if (hasFormData) {
      if (req.body.nama && req.body.nama.trim()) {
        updateData.nama = req.body.nama.trim();
      }
      if (req.body.jenis_lapangan && req.body.jenis_lapangan.trim()) {
        updateData.jenis_lapangan = req.body.jenis_lapangan.trim();
      }
      if (req.body.jam_buka && req.body.jam_buka.trim()) {
        updateData.jam_buka = req.body.jam_buka.trim();
      }
      if (req.body.jam_tutup && req.body.jam_tutup.trim()) {
        updateData.jam_tutup = req.body.jam_tutup.trim();
      }
      if (req.body.harga) {
        const hargaNum = parseInt(req.body.harga);
        if (!isNaN(hargaNum) && hargaNum > 0) {
          updateData.harga = hargaNum;
        }
      }
      if (req.body.status && ['tersedia', 'tidak tersedia'].includes(req.body.status.trim())) {
        updateData.status = req.body.status.trim();
      }
    }
    
    if (hasFile) {
      updateData.gambar = req.file.path;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada data valid untuk diupdate'
      });
    }

    
    const currentField = await FieldService.validateFieldUpdate(fieldId, updateData);

    
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      { new: true, runValidators: true }
    );

    
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${fieldId}`);
        await client.del('fields:available');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
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

    if (error.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Nama lapangan sudah digunakan'
      });
    }

    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};


export const getAllFields = async (req, res) => {
  try {
    const { jenis_lapangan, status } = req.query;
    const cacheKey = `fields:all:${jenis_lapangan || 'all'}:${status || 'all'}`;
    
    
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

   
    const filter = {};
    if (jenis_lapangan) filter.jenis_lapangan = jenis_lapangan;
    if (status) filter.status = status;

    
    const fields = await Field.find(filter);
    
    
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


export const getField = async (req, res) => {
  try {
    const fieldId = req.params.id;
    const cacheKey = `field:${fieldId}`;
    
    
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


export const updateFieldJSON = async (req, res) => {
  try {
    console.log('=== UPDATE FIELD JSON DEBUG ===');
    console.log('Field ID:', req.params.id);
    console.log('User:', req.user?.name, req.user?.role);
    console.log('Request Body:', req.body);
    console.log('Content-Type:', req.get('Content-Type'));
    
    const fieldId = req.params.id;
    const updateData = { ...req.body };

    
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Request body kosong atau tidak valid'
      });
    }

    
    if (!mongoose.Types.ObjectId.isValid(fieldId)) {
      return res.status(400).json({
        status: 'error',
        message: 'ID lapangan tidak valid'
      });
    }

    
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

    
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      {
        new: true, 
        runValidators: true 
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