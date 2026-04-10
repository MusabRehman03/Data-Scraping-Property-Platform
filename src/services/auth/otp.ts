import { Twilio } from 'twilio';
import { getAppConfig } from '../../config/appConfig';
import { delay } from '../../utils/delay';

/**
 * Polls Twilio for the latest SMS sent to the configured phone number within the last few minutes.
 * Scans the message body for a 6-digit code.
 * Re-attempts every 3 seconds for up to ~60 seconds.
 */
export async function getLatestOtp(): Promise<string> {
  const config = getAppConfig();
  
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    throw new Error('Twilio credentials or Phone Number are not fully configured in .env file.');
  }

  const client = new Twilio(config.twilioAccountSid, config.twilioAuthToken);
  const maxRetries = 20; // 20 retries * 3 seconds = 60 seconds
  const pollIntervalMs = 3000;
  
  // Calculate a "since" timestamp from 2 minutes ago to prevent grabbing very old codes
  const sinceTime = new Date(Date.now() - 2 * 60 * 1000);

  console.log(`Polling Twilio for new SMS to ${config.twilioPhoneNumber}...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Don't strongly filter by `to` parameter (sometimes there are weird country-code issues).
      // Let's just fetch the absolute latest messages on this Twilio account since 2 minutes ago.
      const messages = await client.messages.list({
        limit: 5,
        dateSentAfter: sinceTime
      });

      for (const message of messages) {
        // Using regex to find exactly 6 consecutive digits
        const match = message.body.match(/\b\d{6}\b/);
        if (match) {
          console.log(`✅ Extracted 6-digit OTP: ${match[0]} from SMS. (ID: ${message.sid})`);
          return match[0];
        }
      }
    } catch (err: any) {
      console.error('Error fetching messages from Twilio:', err.message);
    }

    // Wait before polling again
    await delay(pollIntervalMs);
  }

  throw new Error('Timeout: Did not receive an SMS with a 6-digit code within 60 seconds.');
}
