import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../utils/logger.js';

export const createField = async (req, res) => {
  try {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga } = req.body;
    const gambar = req.file ? req.file.path : undefined;

    const field = await Field.create({
      nama,
      jenis_lapangan,
      jam_buka,
      jam_tutup,
      harga,
      gambar,
      createdBy: req.user._id
    });

    // Clear cache after creating new field
    try {
      if (client && client.isOpen) {
        await client.del('fields:all');
        await client.del('fields:available');
        logger.info('Fields cache cleared after create');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    res.status(201).json({
      status: 'success',
      data: { field }
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || JSON.stringify(error) || error
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
      message: error.message
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
        message: 'Lapangan tidak ditemukan'
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
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Update field
export const updateField = async (req, res) => {
  try {
    const field = await Field.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Clear cache after update
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${req.params.id}`);
        await client.del('fields:available');
        logger.info('Fields cache cleared after update');
      }
    } catch (redisError) {
      logger.warn('Redis cache clear error:', redisError);
    }

    logger.info(`Field updated: ${field._id}`, {
      role: req.user.role,
      action: 'UPDATE_FIELD'
    });
    res.status(200).json({
      status: 'success',
      data: { field }
    });
  } catch (error) {
    logger.error(`Field update error: ${error.message}`, {
      action: 'UPDATE_FIELD_ERROR'
    });
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Delete field
export const deleteField = async (req, res) => {
  try {
    const field = await Field.findByIdAndDelete(req.params.id);
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
    }

    // Clear cache after delete
    try {
      if (client && client.isOpen) {
        await client.del('fields:all:all:all');
        await client.del(`field:${req.params.id}`);
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
    res.status(204).json({
      status: 'success',
      data: null
    });
  } catch (error) {
    logger.error(`Field deletion error: ${error.message}`, {
      action: 'DELETE_FIELD_ERROR'
    });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};