import twilio from 'twilio';
import logger from './logger.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// ✅ ENHANCED: Configuration validation
if (!accountSid || !authToken || !twilioPhoneNumber) {
  logger.error('Twilio configuration incomplete:', {
    accountSid: accountSid ? 'Present' : 'Missing',
    authToken: authToken ? 'Present' : 'Missing',
    twilioPhoneNumber: twilioPhoneNumber ? 'Present' : 'Missing'
  });
} else {
  logger.info('Twilio configuration loaded successfully:', {
    accountSid: accountSid.slice(-4),
    twilioPhoneNumber: twilioPhoneNumber
  });
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

// ✅ ENHANCED: SMS sending with fallback options
export const sendSMS = async (to, message) => {
  if (!client) {
    logger.warn('Twilio not configured. SMS not sent.');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    // ✅ TRY WHATSAPP FIRST, FALLBACK TO SMS
    let result;
    
    // Try WhatsApp first
    try {
      const whatsappNumber = `whatsapp:${to}`;
      logger.info('Attempting WhatsApp message:', { to: whatsappNumber });
      
      result = await client.messages.create({
        body: message,
        from: `whatsapp:${twilioPhoneNumber}`,
        to: whatsappNumber
      });
      
      logger.info('WhatsApp message sent successfully:', {
        to: whatsappNumber,
        messageSid: result.sid,
        status: result.status
      });
      
    } catch (whatsappError) {
      logger.warn('WhatsApp failed, trying regular SMS:', {
        error: whatsappError.message,
        code: whatsappError.code
      });
      
      // Fallback to regular SMS
      result = await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: to
      });
      
      logger.info('SMS sent successfully:', {
        to: to,
        messageSid: result.sid,
        status: result.status
      });
    }

    return { 
      success: true, 
      messageSid: result.sid,
      status: result.status,
      to: to
    };

  } catch (error) {
    logger.error('Failed to send SMS/WhatsApp:', {
      error: error.message,
      to,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo
    });

    return { 
      success: false, 
      error: error.message,
      code: error.code,
      status: error.status
    };
  }
};

// ✅ ENHANCED: Phone number formatting
export const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;
  
  // Remove any non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Handle Indonesian phone numbers
  if (cleaned.startsWith('08')) {
    cleaned = '628' + cleaned.substring(2);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  
  return '+' + cleaned;
};

// ✅ ADD: Test connection function
export const testConnection = async () => {
  if (!client) {
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    // Test by fetching account info
    const account = await client.api.accounts(accountSid).fetch();
    
    logger.info('Twilio connection test successful:', {
      accountSid: account.sid,
      friendlyName: account.friendlyName,
      status: account.status
    });
    
    return {
      success: true,
      account: {
        sid: account.sid,
        friendlyName: account.friendlyName,
        status: account.status
      }
    };
    
  } catch (error) {
    logger.error('Twilio connection test failed:', {
      error: error.message,
      code: error.code
    });
    
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

export default { sendSMS, formatPhoneNumber, testConnection };