import Field from '../models/Field.js';
import { client } from '../config/redis.js';
import logger from '../config/logger.js';

export class FieldService {
  
  // ============= CONSTANTS =============
  static FIELD_TYPES = ['Badminton', 'Futsal', 'Tenis', 'Basket', 'Voli'];
  static FIELD_STATUSES = ['tersedia', 'tidak tersedia'];

  // ============= VALIDATION METHODS =============
  static validateFieldData(fieldData) {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga } = fieldData;

    if (!nama || nama.trim().length < 2) {
      throw new Error('Nama lapangan minimal 2 karakter');
    }

    if (!this.FIELD_TYPES.includes(jenis_lapangan)) {
      throw new Error('Jenis lapangan tidak valid');
    }

    if (!this.validateTimeFormat(jam_buka) || !this.validateTimeFormat(jam_tutup)) {
      throw new Error('Format jam tidak valid (gunakan HH:MM)');
    }

    if (harga < 1000 || harga > 10000000) {
      throw new Error('Harga harus antara Rp 1.000 - Rp 10.000.000');
    }

    return true;
  }

  static validateTimeFormat(time) {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }

  static validateOperatingHours(jamBuka, jamTutup) {
    const [openHour, openMin] = jamBuka.split(':').map(Number);
    const [closeHour, closeMin] = jamTutup.split(':').map(Number);
    
    const openTime = openHour * 60 + openMin;
    const closeTime = closeHour * 60 + closeMin;
    
    return openTime < closeTime && (closeTime - openTime) >= 60;
  }

  // ============= BUSINESS LOGIC METHODS =============
  static async checkFieldNameExists(nama, excludeId = null) {
    const query = { nama: nama.trim() };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingField = await Field.findOne(query);
    return !!existingField;
  }

  static calculateDailyRevenue(field, hoursBooked) {
    return field.harga * hoursBooked;
  }

  static getOperatingHours(field) {
    const [openHour] = field.jam_buka.split(':').map(Number);
    const [closeHour] = field.jam_tutup.split(':').map(Number);
    return closeHour - openHour;
  }

  // ============= CRUD OPERATIONS =============
  static async createField(fieldData, createdBy) {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga, gambar } = fieldData;

    // Validate field data
    this.validateFieldData(fieldData);

    // Check operating hours
    if (!this.validateOperatingHours(jam_buka, jam_tutup)) {
      throw new Error('Jam operasional minimal 1 jam');
    }

    // Check if name already exists
    const nameExists = await this.checkFieldNameExists(nama);
    if (nameExists) {
      throw new Error('Nama lapangan sudah digunakan');
    }

    // Create field
    const field = await Field.create({
      nama: nama.trim(),
      jenis_lapangan,
      jam_buka,
      jam_tutup,
      harga,
      gambar,
      createdBy
    });

    logger.info(`Field created: ${field._id}`, {
      nama: field.nama,
      type: field.jenis_lapangan,
      price: field.harga
    });

    return field;
  }

  static async updateField(fieldId, updateData) {
    // Validate field exists
    const existingField = await Field.findById(fieldId);
    if (!existingField) {
      throw new Error('Lapangan tidak ditemukan');
    }

    // Check name uniqueness if name is being updated
    if (updateData.nama && updateData.nama !== existingField.nama) {
      const nameExists = await this.checkFieldNameExists(updateData.nama, fieldId);
      if (nameExists) {
        throw new Error('Nama lapangan sudah digunakan');
      }
    }

    // Validate operating hours if being updated
    if (updateData.jam_buka || updateData.jam_tutup) {
      const jamBuka = updateData.jam_buka || existingField.jam_buka;
      const jamTutup = updateData.jam_tutup || existingField.jam_tutup;
      
      if (!this.validateOperatingHours(jamBuka, jamTutup)) {
        throw new Error('Jam operasional minimal 1 jam');
      }
    }

    // Update field
    const field = await Field.findByIdAndUpdate(
      fieldId,
      updateData,
      { new: true, runValidators: true }
    );

    logger.info(`Field updated: ${field._id}`, {
      updatedFields: Object.keys(updateData)
    });

    return field;
  }

  static async deleteField(fieldId) {
    const field = await Field.findByIdAndDelete(fieldId);
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }

    logger.info(`Field deleted: ${fieldId}`, {
      nama: field.nama
    });

    return field;
  }

  static async getFieldById(fieldId) {
    const field = await Field.findById(fieldId);
    if (!field) {
      throw new Error('Lapangan tidak ditemukan');
    }
    return field;
  }

  static async getAllFields(filters = {}) {
    const query = {};
    if (filters.jenis_lapangan) query.jenis_lapangan = filters.jenis_lapangan;
    if (filters.status) query.status = filters.status;

    return await Field.find(query).sort({ createdAt: -1 });
  }

  static async getAvailableFields() {
    return await Field.find({ status: 'tersedia' }).sort({ nama: 1 });
  }

  // ============= PRICING METHODS =============
  static async getFieldPricing() {
    const pricing = await Field.aggregate([
      {
        $group: {
          _id: '$jenis_lapangan',
          minPrice: { $min: '$harga' },
          maxPrice: { $max: '$harga' },
          avgPrice: { $avg: '$harga' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return pricing;
  }

  // ============= STATISTICS METHODS =============
  static async getFieldStatistics() {
    const stats = await Field.aggregate([
      {
        $group: {
          _id: {
            type: '$jenis_lapangan',
            status: '$status'
          },
          count: { $sum: 1 },
          avgPrice: { $avg: '$harga' }
        }
      }
    ]);

    return stats;
  }

  // ============= CACHE METHODS =============
  static async clearFieldCache() {
    try {
      if (client && client.isOpen) {
        const keys = await client.keys('field*');
        if (keys.length > 0) {
          await client.del(keys);
        }
      }
    } catch (error) {
      logger.warn('Field cache clear error:', error.message);
    }
  }

  // ✅ MOVE: Field creation validation from controller
  static async validateFieldCreation(fieldData) {
    const { nama, jenis_lapangan, jam_buka, jam_tutup, harga } = fieldData;
    
    // Required fields validation
    if (!nama || !jenis_lapangan || !jam_buka || !jam_tutup || !harga) {
      throw new Error('Semua field harus diisi');
    }
    
    // Check if field name already exists
    const existingField = await Field.findOne({ nama: nama.trim() });
    if (existingField) {
      throw new Error('Nama lapangan sudah digunakan');
    }
    
    // Validate field type
    if (!this.FIELD_TYPES.includes(jenis_lapangan.trim())) {
      throw new Error('Jenis lapangan tidak valid');
    }
    
    // Validate operating hours
    if (!this.validateOperatingHours(jam_buka.trim(), jam_tutup.trim())) {
      throw new Error('Jam operasional tidak valid');
    }
    
    // Validate price
    const hargaNum = parseInt(harga);
    if (isNaN(hargaNum) || hargaNum <= 0) {
      throw new Error('Harga harus berupa angka positif');
    }
    
    return {
      nama: nama.trim(),
      jenis_lapangan: jenis_lapangan.trim(),
      jam_buka: jam_buka.trim(),
      jam_tutup: jam_tutup.trim(),
      harga: hargaNum
    };
  }
  
  // ✅ MOVE: Field update validation from controller
  static async validateFieldUpdate(fieldId, updateData) {
    const currentField = await Field.findById(fieldId);
    if (!currentField) {
      throw new Error('Lapangan tidak ditemukan');
    }

    // Check for duplicate name if nama is being updated
    if (updateData.nama && updateData.nama !== currentField.nama) {
      const existingField = await Field.findOne({ 
        nama: updateData.nama, 
        _id: { $ne: fieldId } 
      });
      
      if (existingField) {
        throw new Error('Nama lapangan sudah digunakan');
      }
    }

    // Validate operating hours if being updated
    if (updateData.jam_buka || updateData.jam_tutup) {
      const jamBuka = updateData.jam_buka || currentField.jam_buka;
      const jamTutup = updateData.jam_tutup || currentField.jam_tutup;
      
      if (!this.validateOperatingHours(jamBuka, jamTutup)) {
        throw new Error('Jam operasional tidak valid');
      }
    }

    return currentField;
  }
}