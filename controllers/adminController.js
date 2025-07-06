import User from '../models/User.js';
import BankAccount from '../models/BankAccount.js';
import logger from '../config/logger.js';  // ← FIXED PATH

// ============= CASHIER MANAGEMENT =============

export const createCashier = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if cashier already exists
    const existingCashier = await User.findOne({ email });
    if (existingCashier) {
      return res.status(400).json({
        status: 'error',
        message: 'Email already registered'
      });
    }

    // Create cashier without hashing (model will hash automatically)
    const newCashier = await User.create({
      name,
      email,
      password, // Password will be hashed by model middleware
      role: 'cashier',
      isEmailVerified: true,
      createdBy: req.user._id
    });

    // Remove password from response
    newCashier.password = undefined;

    res.status(201).json({
      status: 'success',
      data: {
        user: {
          id: newCashier._id,
          name: newCashier.name,
          email: newCashier.email,
          role: newCashier.role
        }
      }
    });
  } catch (error) {
    logger.error(`Cashier creation failed: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

export const getCashiers = async (req, res) => {
  try {
    const cashiers = await User.find({ role: 'cashier' })
      .select('-password');
    
    res.status(200).json({
      status: 'success',
      data: { cashiers }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

// ============= BANK ACCOUNT MANAGEMENT =============

// Create bank account
export const createBankAccount = async (req, res) => {
  try {
    const { bank_name, account_number, account_name, account_type, description, is_primary } = req.body;

    // Validate required fields
    if (!bank_name || !account_number || !account_name) {
      return res.status(400).json({
        status: 'error',
        message: 'Bank name, account number, dan account name harus diisi'
      });
    }

    // Check if account number already exists
    const existingAccount = await BankAccount.findOne({ account_number });
    if (existingAccount) {
      return res.status(400).json({
        status: 'error',
        message: 'Nomor rekening sudah terdaftar'
      });
    }

    // If this is the first account, make it primary
    const accountCount = await BankAccount.countDocuments();
    const shouldBePrimary = accountCount === 0 || is_primary;

    const bankAccount = await BankAccount.create({
      bank_name,
      account_number,
      account_name,
      account_type,
      description,
      is_primary: shouldBePrimary,
      created_by: req.user._id
    });

    logger.info(`Bank account created: ${bankAccount._id}`, {
      admin: req.user._id,
      account_number: bankAccount.account_number
    });

    res.status(201).json({
      status: 'success',
      message: '✅ Rekening bank berhasil ditambahkan',
      data: { bankAccount }
    });

  } catch (error) {
    logger.error(`Create bank account error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Get all bank accounts
export const getAllBankAccounts = async (req, res) => {
  try {
    const bankAccounts = await BankAccount.find()
      .populate('created_by', 'name email')
      .sort({ is_primary: -1, createdAt: -1 });

    res.status(200).json({
      status: 'success',
      results: bankAccounts.length,
      data: { bankAccounts }
    });

  } catch (error) {
    logger.error(`Get bank accounts error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data rekening'
    });
  }
};

// Update bank account
export const updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { bank_name, account_number, account_name, account_type, description, is_primary, is_active } = req.body;

    const bankAccount = await BankAccount.findById(id);
    if (!bankAccount) {
      return res.status(404).json({
        status: 'error',
        message: 'Rekening tidak ditemukan'
      });
    }

    // Check if new account number already exists (if changed)
    if (account_number && account_number !== bankAccount.account_number) {
      const existingAccount = await BankAccount.findOne({ 
        account_number, 
        _id: { $ne: id } 
      });
      if (existingAccount) {
        return res.status(400).json({
          status: 'error',
          message: 'Nomor rekening sudah terdaftar'
        });
      }
    }

    // Update fields
    if (bank_name) bankAccount.bank_name = bank_name;
    if (account_number) bankAccount.account_number = account_number;
    if (account_name) bankAccount.account_name = account_name;
    if (account_type) bankAccount.account_type = account_type;
    if (description !== undefined) bankAccount.description = description;
    if (is_primary !== undefined) bankAccount.is_primary = is_primary;
    if (is_active !== undefined) bankAccount.is_active = is_active;

    await bankAccount.save();

    logger.info(`Bank account updated: ${bankAccount._id}`, {
      admin: req.user._id
    });

    res.status(200).json({
      status: 'success',
      message: '✅ Rekening bank berhasil diupdate',
      data: { bankAccount }
    });

  } catch (error) {
    logger.error(`Update bank account error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Delete bank account
export const deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const bankAccount = await BankAccount.findById(id);
    if (!bankAccount) {
      return res.status(404).json({
        status: 'error',
        message: 'Rekening tidak ditemukan'
      });
    }

    // Don't allow deletion if it's the only active account
    const activeAccountsCount = await BankAccount.countDocuments({ is_active: true });
    if (bankAccount.is_active && activeAccountsCount === 1) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak dapat menghapus rekening aktif terakhir'
      });
    }

    await BankAccount.findByIdAndDelete(id);

    // If deleted account was primary, set another active account as primary
    if (bankAccount.is_primary) {
      const nextPrimary = await BankAccount.findOne({ is_active: true });
      if (nextPrimary) {
        nextPrimary.is_primary = true;
        await nextPrimary.save();
      }
    }

    logger.info(`Bank account deleted: ${id}`, {
      admin: req.user._id
    });

    res.status(200).json({
      status: 'success',
      message: '✅ Rekening bank berhasil dihapus'
    });

  } catch (error) {
    logger.error(`Delete bank account error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};

// Set primary bank account
export const setPrimaryBankAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const bankAccount = await BankAccount.findById(id);
    if (!bankAccount) {
      return res.status(404).json({
        status: 'error',
        message: 'Rekening tidak ditemukan'
      });
    }

    if (!bankAccount.is_active) {
      return res.status(400).json({
        status: 'error',
        message: 'Rekening tidak aktif tidak dapat dijadikan primary'
      });
    }

    // Set all accounts as non-primary first
    await BankAccount.updateMany({}, { is_primary: false });
    
    // Set this account as primary
    bankAccount.is_primary = true;
    await bankAccount.save();

    logger.info(`Primary bank account set: ${bankAccount._id}`, {
      admin: req.user._id
    });

    res.status(200).json({
      status: 'success',
      message: '✅ Rekening utama berhasil diatur',
      data: { bankAccount }
    });

  } catch (error) {
    logger.error(`Set primary bank account error: ${error.message}`);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
};