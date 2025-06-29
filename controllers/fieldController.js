import Field from '../models/Field.js';

export const createField = async (req, res) => {
  try {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga } = req.body;
    const gambar = req.file ? req.file.path : undefined;

    console.log('BODY:', req.body);
    console.log('FILE:', req.file);
    console.log('USER:', req.user);

    const field = await Field.create({
      nama,
      jenis_lapangan,
      jam_buka,
      jam_tutup,
      harga,
      gambar,
      createdBy: req.user._id
    });

    res.status(201).json({
      status: 'success',
      data: { field }
    });
  } catch (error) {
    console.error('CREATE_FIELD_ERROR:', error, error?.stack); // WAJIB tampilkan error detail
    return res.status(400).json({
      status: 'error',
      message: error.message || JSON.stringify(error) || error
    });
  }
};

// Get all fields
export const getAllFields = async (req, res) => {
  try {
    const fields = await Field.find();
    
    res.status(200).json({
      status: 'success',
      results: fields.length,
      data: { fields }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// Get single field
export const getField = async (req, res) => {
  try {
    const field = await Field.findById(req.params.id);
    
    if (!field) {
      return res.status(404).json({
        status: 'error',
        message: 'Lapangan tidak ditemukan'
      });
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