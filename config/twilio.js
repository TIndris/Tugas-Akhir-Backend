import twilio from 'twilio';
import logger from './logger.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  logger.warn('Twilio credentials not configured. SMS notifications will be disabled.');
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export const sendSMS = async (to, message) => {
  if (!client) {
    logger.warn('Twilio not configured. SMS not sent.');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    // Convert phone number format for WhatsApp
    const whatsappNumber = `whatsapp:${to}`;
    
    const result = await client.messages.create({
      body: message,
      from: `whatsapp:${twilioPhoneNumber}`,
      to: whatsappNumber
    });

    logger.info('SMS sent successfully:', {
      to: whatsappNumber,
      messageSid: result.sid,
      status: result.status
    });

    return { 
      success: true, 
      messageSid: result.sid,
      status: result.status 
    };

  } catch (error) {
    logger.error('Failed to send SMS:', {
      error: error.message,
      to,
      code: error.code,
      status: error.status
    });

    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  }
};

export const formatPhoneNumber = (phoneNumber) => {
  // Remove any non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add country code if not present
  if (!cleaned.startsWith('62') && cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  }
  
  if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  
  return '+' + cleaned;
};

export default { sendSMS, formatPhoneNumber };