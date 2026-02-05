import twilio from 'twilio';

function smsGloballyDisabled(): boolean {
  return process.env.OTTO_AIRGAP === "true" || process.env.OTTO_DISABLE_SMS === "true";
}

function getTwilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const fromPhoneNumber = process.env.TWILIO_FROM_PHONE;

  if (!accountSid || !fromPhoneNumber) {
    throw new Error("Twilio credentials missing: set TWILIO_ACCOUNT_SID and TWILIO_FROM_PHONE");
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (authToken) {
    return { accountSid, fromPhoneNumber, authToken };
  }

  if (apiKey && apiKeySecret) {
    return { accountSid, fromPhoneNumber, apiKey, apiKeySecret };
  }

  throw new Error(
    "Twilio credentials missing: set either TWILIO_AUTH_TOKEN or TWILIO_API_KEY + TWILIO_API_KEY_SECRET",
  );
}

export async function getTwilioClient() {
  if (smsGloballyDisabled()) {
    throw new Error("SMS is disabled (OTTO_AIRGAP/OTTO_DISABLE_SMS)");
  }

  const creds = getTwilioCredentials();
  if ("authToken" in creds) {
    return twilio(creds.accountSid, creds.authToken);
  }

  return twilio(creds.apiKey, creds.apiKeySecret, { accountSid: creds.accountSid });
}

export async function getTwilioFromPhoneNumber() {
  const creds = getTwilioCredentials();
  return creds.fromPhoneNumber;
}

// SMS sending function
export async function sendSMS(to: string, message: string) {
  if (smsGloballyDisabled()) {
    return {
      success: false,
      error: "SMS disabled",
      errorCode: "SMS_DISABLED",
    };
  }

  try {
    const client = await getTwilioClient();
    const fromNumber = await getTwilioFromPhoneNumber();
    
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to
    });
    
    return {
      success: true,
      messageSid: result.sid,
      status: result.status
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code
    };
  }
}
