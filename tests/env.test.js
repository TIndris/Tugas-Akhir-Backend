const dotenv = require('dotenv');
const mongoose = require('mongoose');

describe('Environment Configuration Tests', () => {
  beforeAll(() => {
    dotenv.config();
  });

  test('should have all required environment variables', () => {
    expect(process.env.PORT).toBeDefined();
    expect(process.env.MONGODB_URI).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_ID).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeDefined();
    expect(process.env.SESSION_SECRET).toBeDefined();
    expect(process.env.CLIENT_URL).toBeDefined();
  });

  test('should connect to MongoDB', async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      expect(mongoose.connection.readyState).toBe(1);
      await mongoose.disconnect();
    } catch (err) {
      throw err;
    }
  });

  test('PORT should be a valid number', () => {
    expect(Number(process.env.PORT)).toBe(5000);
  });

  test('CLIENT_URL should be valid URL', () => {
    const url = new URL(process.env.CLIENT_URL);
    expect(url.protocol).toBe('http:');
    expect(url.host).toBe('localhost:3000');
  });
});
